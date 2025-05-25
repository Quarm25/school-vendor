const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const { connectDB } = require('./config/database');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/error');
const { protect, authorize } = require('./middleware/auth');
const upload = require('./middleware/upload');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
  credentials: true
}));

// Request logging with different formats for development and production
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  // Create a logging directory if it doesn't exist
  const logDirectory = path.join(__dirname, '../logs');
  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
  }
  
  // Create a write stream for access logs
  const accessLogStream = fs.createWriteStream(
    path.join(logDirectory, 'access.log'),
    { flags: 'a' }
  );
  
  app.use(morgan('combined', { stream: accessLogStream }));
}

// Add rate limiting for API requests
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// Parse JSON and URL-encoded bodies with size limits from environment variables
app.use(express.json({ limit: `${process.env.MAX_FILE_UPLOAD || 5}mb` }));
app.use(express.urlencoded({ 
  extended: true,
  limit: `${process.env.MAX_FILE_UPLOAD || 5}mb`
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'school-vendor-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
const uploadPath = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Create directories for different upload types
const createUploadDirs = () => {
  const directories = ['products', 'users', 'receipts', 'categories'];
  
  directories.forEach(dir => {
    const dirPath = path.join(uploadPath, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
};

createUploadDirs();

// Serve uploaded files with specific security headers
app.use('/uploads', (req, res, next) => {
  // Add security headers for files
  res.set({
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff'
  });
  next();
}, express.static(uploadPath));

// API Routes with error handling
// Function to safely import routes
const safeImport = (routePath, routeName) => {
  try {
    return require(routePath);
  } catch (error) {
    console.error(`Error loading ${routeName} routes:`, error.message);
    return express.Router().get('*', (req, res) => {
      res.status(503).json({ message: `${routeName} service is currently unavailable` });
    });
  }
};

// User routes
app.use('/api/users', safeImport('./routes/userRoutes', 'user'));

// Product routes
app.use('/api/products', safeImport('./routes/productRoutes', 'product'));

// Order routes
app.use('/api/orders', safeImport('./routes/orderRoutes', 'order'));

// Admin routes
app.use('/api/admin', safeImport('./routes/adminRoutes', 'admin'));

// Payment routes
app.use('/api/payments', safeImport('./routes/paymentRoutes', 'payment'));

// Category routes
app.use('/api/categories', safeImport('./routes/categoryRoutes', 'category'));

// Payment webhook endpoints
const paymentWebhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many webhook requests, please try again after 15 minutes'
});

// Webhook routes need special handling for raw body
app.post('/webhooks/expresspay', 
  express.raw({ type: 'application/json' }),
  paymentWebhookLimiter,
  (req, res) => {
    const signature = req.headers['x-expresspay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing signature header' });
    }
    
    try {
      // Import the controller dynamically to handle webhook logic
      const { handleExpressPayWebhook } = require('./controllers/paymentController');
      return handleExpressPayWebhook(req, res);
    } catch (error) {
      console.error('ExpressPay webhook error:', error);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

app.post('/webhooks/momo', 
  express.raw({ type: 'application/json' }),
  paymentWebhookLimiter,
  (req, res) => {
    try {
      // Import the controller dynamically to handle webhook logic
      const { handleMobileMoneyWebhook } = require('./controllers/paymentController');
      return handleMobileMoneyWebhook(req, res);
    } catch (error) {
      console.error('Mobile Money webhook error:', error);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

app.post('/webhooks/hubtel', 
  express.raw({ type: 'application/json' }),
  paymentWebhookLimiter,
  (req, res) => {
    const hubtelToken = req.headers['x-hubtel-token'];
    if (!hubtelToken) {
      return res.status(400).json({ error: 'Missing Hubtel authorization token' });
    }
    
    try {
      // Import the controller dynamically to handle webhook logic
      const { handleHubtelWebhook } = require('./controllers/paymentController');
      return handleHubtelWebhook(req, res);
    } catch (error) {
      console.error('Hubtel webhook error:', error);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime())
  });
});

// Basic route for testing
app.get('/', (req, res) => {
  res.send('School Vendor API is running');
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ message: 'Resource not found' });
});

// Global error handler
app.use(errorHandler);

// Set port and start the server
const PORT = process.env.PORT || 3000;

// Create server-ready application with database connection
const createServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('Database connection established');
    
    // Ensure upload directories exist
    createUploadDirs();
    
    // Set port
    const PORT = process.env.PORT || 3000;
    
    // Start server function
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`API URL: ${process.env.API_URL || `http://localhost:${PORT}`}`);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      console.error('UNHANDLED REJECTION! Shutting down...');
      console.error(err.name, err.message);
      // Gracefully close server before exiting
      server.close(() => {
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('UNCAUGHT EXCEPTION! Shutting down...');
      console.error(err.name, err.message);
      process.exit(1);
    });

    // Graceful shutdown handler
    const gracefulShutdown = () => {
      console.log('Received shutdown signal, closing server gracefully...');
      server.close(() => {
        console.log('Server closed. Exiting process.');
        process.exit(0);
      });
      
      // Force close after 10 seconds if not closed gracefully
      setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    // Handle termination signals
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Add a startup function to initialize the server
const startServer = async () => {
  try {
    const server = await createServer();
    return server;
  } catch (error) {
    console.error('Server initialization failed:', error);
    process.exit(1);
  }
};

// If this file is run directly, start the server
if (require.main === module) {
  startServer();
}

// Export the app for testing and server initialization
module.exports = { app, createServer, startServer };

