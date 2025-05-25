/**
 * Category validation schemas
 * Uses Joi for schema validation
 */
const Joi = require('joi');

// Common validation rules
const name = Joi.string().trim().min(2).max(100).required()
  .messages({
    'string.empty': 'Category name is required',
    'string.min': 'Category name must be at least {#limit} characters',
    'string.max': 'Category name cannot exceed {#limit} characters',
    'any.required': 'Category name is required'
  });

const slug = Joi.string().trim().min(2).max(100).pattern(/^[a-z0-9-]+$/)
  .messages({
    'string.empty': 'Slug is required',
    'string.min': 'Slug must be at least {#limit} characters',
    'string.max': 'Slug cannot exceed {#limit} characters',
    'string.pattern.base': 'Slug must contain only lowercase letters, numbers, and hyphens',
    'any.required': 'Slug is required'
  });

const description = Joi.string().trim().allow('').max(1000)
  .messages({
    'string.max': 'Description cannot exceed {#limit} characters'
  });

const parentId = Joi.string().trim().allow(null, '')
  .messages({
    'string.base': 'Parent ID must be a string'
  });

const status = Joi.string().valid('active', 'inactive').default('active')
  .messages({
    'any.only': 'Status must be either active or inactive'
  });

const featured = Joi.boolean().default(false);

const order = Joi.number().integer().min(0).default(0)
  .messages({
    'number.base': 'Order must be a number',
    'number.integer': 'Order must be an integer',
    'number.min': 'Order must be a positive number or zero'
  });

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

// Schemas for category operations
const createCategory = {
  body: Joi.object({
    name,
    slug,
    parentId,
    description,
    status,
    featured,
    order,
    image: Joi.string().trim().allow('').optional(),
    icon: Joi.string().trim().allow('').optional(),
    attributes: Joi.array().items(Joi.object()).optional(),
    meta: Joi.object({
      title: Joi.string().trim().max(200).optional(),
      description: Joi.string().trim().max(500).optional(),
      keywords: Joi.string().trim().max(500).optional()
    }).optional()
  })
};

const updateCategory = {
  body: Joi.object({
    name,
    slug,
    parentId,
    description,
    status,
    featured,
    order,
    image: Joi.string().trim().allow('', null).optional(),
    icon: Joi.string().trim().allow('', null).optional(),
    attributes: Joi.array().items(Joi.object()).optional(),
    meta: Joi.object({
      title: Joi.string().trim().max(200).optional(),
      description: Joi.string().trim().max(500).optional(),
      keywords: Joi.string().trim().max(500).optional()
    }).optional()
  })
};

const moveCategory = {
  body: Joi.object({
    newParentId: Joi.string().trim().allow(null, '').required()
      .messages({
        'any.required': 'New parent ID is required'
      })
  })
};

const updateOrder = {
  body: Joi.object({
    order
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

const bulkUpdateOrder = {
  body: Joi.object({
    categories: Joi.array().items(
      Joi.object({
        id,
        order
      })
    ).min(1).required()
    .messages({
      'array.min': 'At least one category is required',
      'any.required': 'Categories are required'
    })
  })
};

const reorderCategories = {
  body: Joi.object({
    categories: Joi.array().items(
      Joi.object({
        id,
        position: Joi.number().integer().min(0).required()
          .messages({
            'number.base': 'Position must be a number',
            'number.integer': 'Position must be an integer',
            'number.min': 'Position must be a positive number or zero',
            'any.required': 'Position is required'
          })
      })
    ).min(1).required()
    .messages({
      'array.min': 'At least one category is required',
      'any.required': 'Categories are required'
    })
  })
};

module.exports = {
  createCategory,
  updateCategory,
  moveCategory,
  updateOrder,
  bulkUpdateStatus,
  bulkDelete,
  bulkUpdateOrder,
  reorderCategories
};

