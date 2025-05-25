const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');

/**
 * Rate limiter for login attempts to prevent brute force attacks
 * Limits login attempts to 5 per 15 minutes per IP
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window
  message: 'Too many login attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Authentication middleware to protect routes
 * Verifies JWT token and attaches user to request object
 */
const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from Authorization header (Bearer token)
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } 
    // If not in header, check cookies (for browser clients)
    else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // Check if token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route',
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Find user by id
      const user = await User.findById(decoded.id);

      // Check if user exists
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User no longer exists',
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'User account is inactive',
        });
      }

      // Add user to request object
      req.user = user;
      next();
    } catch (error) {
      // Handle JWT errors
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
        });
      }

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired',
        });
      }

      // Other errors
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route',
      });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

/**
 * Role-based authorization middleware
 * Restricts access to routes based on user roles
 * @param {...String} roles - Allowed roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // Check if user exists (should be attached by protect middleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route',
      });
    }

    // Check if user role is allowed
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`,
      });
    }

    next();
  };
};

/**
 * Admin route protection middleware
 * Shorthand for authorize('admin')
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  }
  next();
};

/**
 * Session validation middleware
 * Verifies session is active and valid
 */
const validateSession = (req, res, next) => {
  // Check if session exists
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Session expired, please login again',
    });
  }

  // Add user id to request for later use
  req.userId = req.session.userId;
  next();
};

/**
 * Update last login time for user
 */
const updateLastLogin = async (userId) => {
  try {
    await User.findByIdAndUpdate(userId, {
      lastLogin: Date.now(),
    });
  } catch (error) {
    console.error('Error updating last login:', error);
  }
};

/**
 * Generate JWT token for user
 * @param {Object} user - User object
 * @returns {String} JWT token
 */
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || '24h',
    }
  );
};

/**
 * Verify a token and return decoded data
 * @param {String} token - JWT token
 * @returns {Object} Decoded token payload
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

/**
 * Owner access middleware - allows only resource owner or admin
 * @param {Function} getOwnerId - Function to extract owner ID from request
 */
const ownerOrAdmin = (getOwnerId) => async (req, res, next) => {
  try {
    // Get owner ID using the provided function
    const ownerId = await getOwnerId(req);
    
    // Check if user is admin or resource owner
    if (
      req.user.role === 'admin' || 
      req.user._id.toString() === ownerId.toString()
    ) {
      return next();
    }
    
    res.status(403).json({
      success: false,
      message: 'Not authorized to access this resource',
    });
  } catch (error) {
    console.error('Owner verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying resource ownership',
    });
  }
};

module.exports = {
  protect,
  authorize,
  adminOnly,
  validateSession,
  updateLastLogin,
  generateToken,
  verifyToken,
  loginLimiter,
  ownerOrAdmin,
};

