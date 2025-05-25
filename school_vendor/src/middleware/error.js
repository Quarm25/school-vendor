const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

/**
 * Custom error classes for different error types
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors = {}) {
    super(message, 400);
    this.errors = errors;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Not authorized to access this resource') {
    super(message, 403);
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500);
  }
}

class PaymentError extends AppError {
  constructor(message = 'Payment processing failed') {
    super(message, 400);
  }
}

/**
 * Log error to file
 * @param {Error} err - Error object
 */
const logError = (err) => {
  try {
    const logDir = path.join(__dirname, '../../logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, 'errors.log');
    const timestamp = new Date().toISOString();
    const errorLog = `[${timestamp}] ${err.name}: ${err.message}\n${err.stack}\n\n`;
    
    fs.appendFileSync(logFile, errorLog);
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
};

/**
 * Handle Mongoose validation errors
 * @param {Error} err - Mongoose validation error
 * @returns {ValidationError} - Formatted validation error
 */
const handleMongooseValidationError = (err) => {
  const errors = {};
  
  Object.values(err.errors).forEach((error) => {
    errors[error.path] = error.message;
  });
  
  return new ValidationError('Validation failed', errors);
};

/**
 * Handle MongoDB duplicate key errors
 * @param {Error} err - MongoDB duplicate key error
 * @returns {ValidationError} - Formatted validation error
 */
const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  
  return new ValidationError(`Duplicate value: ${value} for field: ${field}. Please use another value.`);
};

/**
 * Handle MongoDB cast errors
 * @param {Error} err - MongoDB cast error
 * @returns {ValidationError} - Formatted validation error
 */
const handleCastError = (err) => {
  return new ValidationError(`Invalid ${err.path}: ${err.value}`);
};

/**
 * Handle JWT errors
 * @param {Error} err - JWT error
 * @returns {AuthenticationError} - Authentication error
 */
const handleJWTError = () => {
  return new AuthenticationError('Invalid token. Please log in again.');
};

/**
 * Handle JWT expired errors
 * @returns {AuthenticationError} - Authentication error
 */
const handleJWTExpiredError = () => {
  return new AuthenticationError('Your token has expired. Please log in again.');
};

/**
 * Error response for development environment
 * Includes detailed error information including stack trace
 */
const sendDevError = (err, res) => {
  res.status(err.statusCode || 500).json({
    success: false,
    status: err.status,
    message: err.message,
    errors: err.errors,
    stack: err.stack,
    error: err
  });
};

/**
 * Error response for production environment
 * Limited information for security reasons
 */
const sendProdError = (err, res) => {
  // Operational, trusted errors: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      status: err.status,
      message: err.message,
      errors: err.errors
    });
  } 
  // Programming or unknown errors: don't leak error details
  else {
    // Log error
    console.error('ERROR:', err);
    
    // Send generic message
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Something went wrong'
    });
  }
};

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';
  
  // Log all errors
  console.error(`${err.name}: ${err.message}`);
  logError(err);
  
  // Handle specific error types
  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.stack = err.stack;
  
  // Mongoose validation error
  if (err instanceof mongoose.Error.ValidationError) {
    error = handleMongooseValidationError(err);
  }
  
  // Mongoose CastError (invalid ID)
  if (err.name === 'CastError') {
    error = handleCastError(err);
  }
  
  // Mongoose duplicate key error
  if (err.code === 11000) {
    error = handleDuplicateKeyError(err);
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = handleJWTError();
  }
  
  if (err.name === 'TokenExpiredError') {
    error = handleJWTExpiredError();
  }
  
  // Send appropriate error response based on environment
  if (process.env.NODE_ENV === 'development') {
    sendDevError(error, res);
  } else {
    sendProdError(error, res);
  }
};

/**
 * Catch async errors to avoid try-catch blocks
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Express middleware function
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * Validate request data against a schema
 * @param {Object} schema - Validation schema (e.g., Joi schema)
 * @param {String} source - Request property to validate ('body', 'query', 'params')
 */
const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      const errors = {};
      
      error.details.forEach((detail) => {
        errors[detail.path[0]] = detail.message;
      });
      
      return next(new ValidationError('Validation failed', errors));
    }
    
    // Replace request data with validated data
    req[source] = value;
    next();
  };
};

/**
 * Not found route handler - for undefined routes
 */
const notFoundHandler = (req, res, next) => {
  next(new NotFoundError(`Route not found: ${req.originalUrl}`));
};

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  DatabaseError,
  PaymentError,
  errorHandler,
  catchAsync,
  validateRequest,
  notFoundHandler,
  logError
};

