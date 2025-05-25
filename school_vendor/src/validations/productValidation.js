/**
 * Product validation schemas
 * Uses Joi for schema validation
 */
const Joi = require('joi');

// Common validation rules
const name = Joi.string().trim().min(2).max(100).required()
  .messages({
    'string.empty': 'Product name is required',
    'string.min': 'Product name must be at least {#limit} characters',
    'string.max': 'Product name cannot exceed {#limit} characters',
    'any.required': 'Product name is required'
  });

const slug = Joi.string().trim().min(2).max(100).pattern(/^[a-z0-9-]+$/)
  .messages({
    'string.empty': 'Slug is required',
    'string.min': 'Slug must be at least {#limit} characters',
    'string.max': 'Slug cannot exceed {#limit} characters',
    'string.pattern.base': 'Slug must contain only lowercase letters, numbers, and hyphens',
    'any.required': 'Slug is required'
  });

const description = Joi.string().trim().allow('').max(2000)
  .messages({
    'string.max': 'Description cannot exceed {#limit} characters'
  });

const price = Joi.number().precision(2).min(0).required()
  .messages({
    'number.base': 'Price must be a number',
    'number.min': 'Price cannot be negative',
    'number.precision': 'Price cannot have more than 2 decimal places',
    'any.required': 'Price is required'
  });

const salePrice = Joi.number().precision(2).min(0).allow(null)
  .messages({
    'number.base': 'Sale price must be a number',
    'number.min': 'Sale price cannot be negative',
    'number.precision': 'Sale price cannot have more than 2 decimal places'
  });

const categoryId = Joi.string().trim().required()
  .messages({
    'string.empty': 'Category ID is required',
    'any.required': 'Category ID is required'
  });

const stock = Joi.number().integer().min(0).default(0)
  .messages({
    'number.base': 'Stock must be a number',
    'number.integer': 'Stock must be an integer',
    'number.min': 'Stock cannot be negative'
  });

const status = Joi.string().valid('active', 'inactive', 'draft').default('active')
  .messages({
    'any.only': 'Status must be either active, inactive, or draft'
  });

const featured = Joi.boolean().default(false);

const id = Joi.string().trim().required()
  .messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required'
  });

const ids = Joi.array().items(Joi.string().trim()).min(1).required()
  .messages({
    'array.min': 'At least one ID is required',
    'any.required': 'IDs are required'
  });

// Schemas for product operations
const createProduct = {
  body: Joi.object({
    name,
    slug,
    description,
    price,
    salePrice,
    categoryId,
    stock,
    status,
    featured,
    sku: Joi.string().trim().max(50).allow('').optional(),
    barcode: Joi.string().trim().max(50).allow('').optional(),
    weight: Joi.number().min(0).optional(),
    dimensions: Joi.object({
      length: Joi.number().min(0).optional(),
      width: Joi.number().min(0).optional(),
      height: Joi.number().min(0).optional()
    }).optional(),
    attributes: Joi.array().items(
      Joi.object({
        name: Joi.string().trim().required(),
        value: Joi.string().trim().required()
      })
    ).optional(),
    images: Joi.array().items(Joi.string()).optional(),
    meta: Joi.object({
      title: Joi.string().trim().max(200).optional(),
      description: Joi.string().trim().max(500).optional(),
      keywords: Joi.string().trim().max(500).optional()
    }).optional()
  })
};

const updateProduct = {
  body: Joi.object({
    name,
    slug,
    description,
    price,
    salePrice,
    categoryId,
    stock,
    status,
    featured,
    sku: Joi.string().trim().max(50).allow('').optional(),
    barcode: Joi.string().trim().max(50).allow('').optional(),
    weight: Joi.number().min(0).optional(),
    dimensions: Joi.object({
      length: Joi.number().min(0).optional(),
      width: Joi.number().min(0).optional(),
      height: Joi.number().min(0).optional()
    }).optional(),
    attributes: Joi.array().items(
      Joi.object({
        name: Joi.string().trim().required(),
        value: Joi.string().trim().required()
      })
    ).optional(),
    images: Joi.array().items(Joi.string()).optional(),
    meta: Joi.object({
      title: Joi.string().trim().max(200).optional(),
      description: Joi.string().trim().max(500).optional(),
      keywords: Joi.string().trim().max(500).optional()
    }).optional()
  })
};

const bulkUpdateStatus = {
  body: Joi.object({
    ids,
    status
  })
};

const bulkDelete = {
  body: Joi.object({
    ids
  })
};

const updateStock = {
  body: Joi.object({
    quantity: Joi.number().integer().min(0).required()
      .messages({
        'number.base': 'Quantity must be a number',
        'number.integer': 'Quantity must be an integer',
        'number.min': 'Quantity cannot be negative',
        'any.required': 'Quantity is required'
      }),
    action: Joi.string().valid('add', 'remove', 'adjust').required()
      .messages({
        'string.empty': 'Action is required',
        'any.only': 'Action must be either add, remove, or adjust',
        'any.required': 'Action is required'
      }),
    reason: Joi.string().trim().max(200).optional()
      .messages({
        'string.max': 'Reason cannot exceed {#limit} characters'
      })
  })
};

module.exports = {
  createProduct,
  updateProduct,
  bulkUpdateStatus,
  bulkDelete,
  updateStock
};

