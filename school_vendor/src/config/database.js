const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Environment-specific MongoDB connection strings
const MONGODB_URI = {
  development: process.env.MONGODB_URI_DEV || 'mongodb://localhost:27017/school_vendor_dev',
  test: process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/school_vendor_test',
  production: process.env.MONGODB_URI_PROD || 'mongodb://localhost:27017/school_vendor_prod'
};

// Determine current environment
const environment = process.env.NODE_ENV || 'development';

// Set debug mode based on environment
mongoose.set('debug', environment === 'development');

// Connection options
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  autoIndex: environment !== 'production', // Don't build indexes in production
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
  maxPoolSize: 10, // Maintain up to 10 socket connections
  minPoolSize: 2 // Minimum number of socket connections
};

/**
 * Connect to MongoDB
 * @returns {Promise} Mongoose connection promise
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGODB_URI[environment], options);

    console.log(`MongoDB Connected: ${conn.connection.host} (${environment})`);
    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);  // Exit with failure
  }
};

// Connection event listeners
mongoose.connection.on('connected', () => {
  console.log(`Mongoose connected to ${MONGODB_URI[environment]}`);
});

mongoose.connection.on('error', (err) => {
  console.error(`Mongoose connection error: ${err}`);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});

// Capture app termination/restart events
// To be called when process is restarted or terminated
const gracefulShutdown = (msg, callback) => {
  mongoose.connection.close(() => {
    console.log(`Mongoose disconnected through ${msg}`);
    callback();
  });
};

// For nodemon restarts
process.once('SIGUSR2', () => {
  gracefulShutdown('nodemon restart', () => {
    process.kill(process.pid, 'SIGUSR2');
  });
});

// For app termination
process.on('SIGINT', () => {
  gracefulShutdown('app termination', () => {
    process.exit(0);
  });
});

// For Heroku app termination
process.on('SIGTERM', () => {
  gracefulShutdown('Heroku app shutdown', () => {
    process.exit(0);
  });
});

module.exports = {
  connectDB,
  mongoose
};

