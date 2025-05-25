/**
 * Request validation middleware
 * Uses Joi for schema validation of requests
 */
const Joi = require('joi');

/**
 * Validate request against a Joi schema
 * @param {Object} schema - Joi validation schema with body, query, params
 * @returns {Function} Express middleware function
 */
const validateRequest = (schema) => {
  return (req, res, next) => {
    // Skip validation if no schema provided
    if (!schema) return next();

    // Object to collect validation errors
    const validationErrors = {};

    // Validate request body if schema.body exists
    if (schema.body) {
      const { error } = schema.body.validate(req.body, { 
        abortEarly: false,
        stripUnknown: true
      });
      
      if (error) {
        validationErrors.body = formatJoiErrors(error);
      }
    }

    // Validate query parameters if schema.query exists
    if (schema.query) {
      const { error } = schema.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true
      });
      
      if (error) {
        validationErrors.query = formatJoiErrors(error);
      }
    }

    // Validate URL parameters if schema.params exists
    if (schema.params) {
      const { error } = schema.params.validate(req.params, {
        abortEarly: false,
        stripUnknown: true
      });
      
      if (error) {
        validationErrors.params = formatJoiErrors(error);
      }
    }

    // If validation errors exist, return 400 with error details
    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error',
        errors: validationErrors
      });
    }

    // No validation errors, proceed to the next middleware
    next();
  };
};

/**
 * Format Joi validation errors into a more readable format
 * @param {Object} error - Joi validation error object
 * @returns {Object} Formatted error object
 */
const formatJoiErrors = (error) => {
  const formattedErrors = {};
  
  if (error && error.details) {
    error.details.forEach((detail) => {
      const path = detail.path.join('.');
      formattedErrors[path] = detail.message.replace(/['"]/g, '');
    });
  }
  
  return formattedErrors;
};

module.exports = {
  validateRequest
};

