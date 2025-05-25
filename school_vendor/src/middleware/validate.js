const Joi = require('joi');
const { validateRequest } = require('./error');
const mongoose = require('mongoose');

// Custom validation helpers
const customValidators = {
  // Check if ID is a valid MongoDB ObjectId
  isValidObjectId: (value, helpers) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  },
  
  // Check if email is from school domain (if needed)
  isSchoolEmail: (value, helpers) => {
    // Replace with actual school domain validation if needed
    const schoolDomains = ['schooldomain.edu', 'school.com'];
    const domain = value.split('@')[1];
    
    if (!schoolDomains.includes(domain)) {
      return helpers.error('string.domain');
    }
    return value;
  }
};

// Common validation schemas for reuse
const commonSchemas = {
  id: Joi.string()
    .custom(customValidators.isValidObjectId)
    .messages({
      'any.invalid': 'Invalid ID format',
      'string.empty': 'ID cannot be empty'
    }),
  
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .messages({
      'string.min': 'Name must be at least {#limit} characters long',
      'string.max': 'Name cannot exceed {#limit} characters',
      'string.empty': 'Name is required'
    }),
  
  email: Joi.string()
    .trim()
    .email()
    .lowercase()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.empty': 'Email is required'
    }),
  
  password: Joi.string()
    .min(8)
    .max(30)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])'))
    .required()
    .messages({
      'string.min': 'Password must be at least {#limit} characters long',
      'string.max': 'Password cannot exceed {#limit} characters',
      'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, and one number',
      'string.empty': 'Password is required'
    }),
  
  phoneNumber: Joi.string()
    .trim()
    .pattern(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/)
    .messages({
      'string.pattern.base': 'Please provide a valid phone number',
      'string.empty': 'Phone number is required'
    }),
  
  price: Joi.number()
    .precision(2)
    .min(0)
    .messages({
      'number.base': 'Price must be a number',
      'number.min': 'Price cannot be negative'
    }),
  
  quantity: Joi.number()
    .integer()
    .min(1)
    .messages({
      'number.base': 'Quantity must be a number',
      'number.integer': 'Quantity must be an integer',
      'number.min': 'Quantity must be at least 1'
    }),
  
  date: Joi.date()
    .iso()
    .messages({
      'date.base': 'Please provide a valid date',
      'date.format': 'Date format must be YYYY-MM-DD'
    }),
  
  boolean: Joi.boolean()
    .messages({
      'boolean.base': 'Value must be a boolean (true/false)'
    })
};

// Address schema for reuse in user and order schemas
const addressSchema = Joi.object({
  street: Joi.string().trim().required(),
  city: Joi.string().trim().required(),
  state: Joi.string().trim().required(),
  postalCode: Joi.string().trim().required(),
  country: Joi.string().trim().default('Ghana')
});

//------------------------------------------------------
// User validation schemas
//------------------------------------------------------
const userSchemas = {
  // Registration validation
  register: Joi.object({
    firstName: commonSchemas.name.required(),
    lastName: commonSchemas.name.required(),
    email: commonSchemas.email,
    password: commonSchemas.password,
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'string.empty': 'Please confirm your password'
      }),
    role: Joi.string()
      .valid('student', 'parent')
      .default('student'),
    contactNumber: commonSchemas.phoneNumber.optional(),
    address: addressSchema.optional(),
    studentId: Joi.string().trim().optional(),
    grade: Joi.string().trim().optional()
  }),
  
  // Login validation
  login: Joi.object({
    email: commonSchemas.email,
    password: Joi.string().required().messages({
      'string.empty': 'Password is required'
    })
  }),
  
  // Password update validation
  updatePassword: Joi.object({
    currentPassword: Joi.string().required().messages({
      'string.empty': 'Current password is required'
    }),
    newPassword: commonSchemas.password,
    confirmNewPassword: Joi.string()
      .valid(Joi.ref('newPassword'))
      .required()
      .messages({
        'any.only': 'New passwords do not match',
        'string.empty': 'Please confirm your new password'
      })
  }),
  
  // Profile update validation
  updateProfile: Joi.object({
    firstName: commonSchemas.name.optional(),
    lastName: commonSchemas.name.optional(),
    contactNumber: commonSchemas.phoneNumber.optional(),
    address: addressSchema.optional(),
    profilePhoto: Joi.string().uri().optional().messages({
      'string.uri': 'Profile photo must be a valid URL'
    }),
    grade: Joi.string().trim().optional()
  }),
  
  // Password reset request validation
  forgotPassword: Joi.object({
    email: commonSchemas.email
  }),
  
  // Password reset validation
  resetPassword: Joi.object({
    token: Joi.string().required().messages({
      'string.empty': 'Reset token is required'
    }),
    password: commonSchemas.password,
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required()
      .messages({
        'any.only': 'Passwords do not match',
        'string.empty': 'Please confirm your password'
      })
  })
};

//------------------------------------------------------
// Product validation schemas
//------------------------------------------------------
const productSchemas = {
  // Product creation validation
  create: Joi.object({
    name: Joi.string().trim().min(3).max(100).required().messages({
      'string.min': 'Product name must be at least {#limit} characters long',
      'string.max': 'Product name cannot exceed {#limit} characters',
      'string.empty': 'Product name is required'
    }),
    description: Joi.string().trim().min(10).required().messages({
      'string.min': 'Description must be at least {#limit} characters long',
      'string.empty': 'Description is required'
    }),
    shortDescription: Joi.string().trim().max(200).optional(),
    price: commonSchemas.price.required(),
    salePrice: Joi.number().precision(2).min(0).less(Joi.ref('price')).optional().messages({
      'number.less': 'Sale price must be less than regular price'
    }),
    saleActive: commonSchemas.boolean.default(false),
    saleStartDate: commonSchemas.date.optional(),
    saleEndDate: Joi.date().iso().min(Joi.ref('saleStartDate')).optional().messages({
      'date.min': 'Sale end date must be after sale start date'
    }),
    productType: Joi.string().valid('physical', 'digital', 'both').required(),
    category: commonSchemas.id.required(),
    subcategory: commonSchemas.id.optional(),
    tags: Joi.array().items(Joi.string().trim()).optional(),
    images: Joi.array().items(
      Joi.object({
        url: Joi.string().uri().required().messages({
          'string.uri': 'Image URL must be a valid URL'
        }),
        alt: Joi.string().trim().optional(),
        isPrimary: commonSchemas.boolean.default(false)
      })
    ).optional(),
    stock: Joi.when('productType', {
      is: Joi.string().valid('physical', 'both'),
      then: Joi.number().integer().min(0).required().messages({
        'number.base': 'Stock must be a number',
        'number.integer': 'Stock must be an integer',
        'number.min': 'Stock cannot be negative'
      }),
      otherwise: Joi.number().optional()
    }),
    lowStockThreshold: Joi.number().integer().min(1).default(10).optional(),
    stockManagement: commonSchemas.boolean.default(true),
    
    // Digital product specific fields
    digitalDetails: Joi.when('productType', {
      is: Joi.string().valid('digital', 'both'),
      then: Joi.object({
        fileUrl: Joi.string().uri().required().messages({
          'string.uri': 'File URL must be a valid URL'
        }),
        fileType: Joi.string().valid('pdf', 'doc', 'image', 'audio', 'video', 'software', 'other').required(),
        fileSize: Joi.number().min(0).required(),
        accessDuration: Joi.number().min(0).default(0),
        downloadLimit: Joi.number().min(0).default(0)
      }).required(),
      otherwise: Joi.optional()
    }),
    
    // Physical product specific fields
    physicalDetails: Joi.when('productType', {
      is: Joi.string().valid('physical', 'both'),
      then: Joi.object({
        weight: Joi.number().min(0).required(),
        dimensions: Joi.object({
          length: Joi.number().min(0).required(),
          width: Joi.number().min(0).required(),
          height: Joi.number().min(0).required()
        }).required(),
        shippingClass: Joi.string().valid('standard', 'express', 'oversized', 'fragile').default('standard'),
        hasWarranty: commonSchemas.boolean.default(false),
        warrantyPeriod: Joi.number().min(0).default(0)
      }).required(),
      otherwise: Joi.optional()
    }),
    
    isPublished: commonSchemas.boolean.default(true),
    isFeatured: commonSchemas.boolean.default(false),
    status: Joi.string().valid('active', 'draft', 'archived', 'out_of_stock').default('active')
  }),
  
  // Product update validation (similar to create but all fields optional)
  update: Joi.object({
    name: Joi.string().trim().min(3).max(100).optional(),
    description: Joi.string().trim().min(10).optional(),
    shortDescription: Joi.string().trim().max(200).optional(),
    price: commonSchemas.price.optional(),
    salePrice: Joi.number().precision(2).min(0).optional(),
    saleActive: commonSchemas.boolean.optional(),
    saleStartDate: commonSchemas.date.optional(),
    saleEndDate: commonSchemas.date.optional(),
    productType: Joi.string().valid('physical', 'digital', 'both').optional(),
    category: commonSchemas.id.optional(),
    subcategory: commonSchemas.id.optional(),
    tags: Joi.array().items(Joi.string().trim()).optional(),
    images: Joi.array().items(
      Joi.object({
        url: Joi.string().uri().required(),
        alt: Joi.string().trim().optional(),
        isPrimary: commonSchemas.boolean.optional()
      })
    ).optional(),
    stock: Joi.number().integer().min(0).optional(),
    lowStockThreshold: Joi.number().integer().min(1).optional(),
    stockManagement: commonSchemas.boolean.optional(),
    digitalDetails: Joi.object({
      fileUrl: Joi.string().uri().optional(),
      fileType: Joi.string().valid('pdf', 'doc', 'image', 'audio', 'video', 'software', 'other').optional(),
      fileSize: Joi.number().min(0).optional(),
      accessDuration: Joi.number().min(0).optional(),
      downloadLimit: Joi.number().min(0).optional()
    }).optional(),
    physicalDetails: Joi.object({
      weight: Joi.number().min(0).optional(),
      dimensions: Joi.object({
        length: Joi.number().min(0).optional(),
        width: Joi.number().min(0).optional(),
        height: Joi.number().min(0).optional()
      }).optional(),
      shippingClass: Joi.string().valid('standard', 'express', 'oversized', 'fragile').optional(),
      hasWarranty: commonSchemas.boolean.optional(),
      warrantyPeriod: Joi.number().min(0).optional()
    }).optional(),
    isPublished: commonSchemas.boolean.optional(),
    isFeatured: commonSchemas.boolean.optional(),
    status: Joi.string().valid('active', 'draft', 'archived', 'out_of_stock').optional()
  })
};

//------------------------------------------------------
// Order validation schemas
//------------------------------------------------------
const orderSchemas = {
  // Order creation validation
  create: Joi.object({
    items: Joi.array().items(
      Joi.object({
        product: commonSchemas.id.required(),
        quantity: commonSchemas.quantity.required()
      })
    ).min(1).required().messages({
      'array.min': 'Order must contain at least one item',
      'array.base': 'Items must be an array'
    }),
    shipping: Joi.object({
      address: addressSchema.required(),
      contactPhone: commonSchemas.phoneNumber.required(),
      shippingMethod: Joi.string().valid('standard', 'express', 'pickup').default('standard')
    }).required(),
    billingAddress: Joi.object({
      sameAsShipping: commonSchemas.boolean.default(true),
      address: Joi.when('sameAsShipping', {
        is: false,
        then: addressSchema.required(),
        otherwise: Joi.optional()
      })
    }).default({ sameAsShipping: true }),
    notes: Joi.string().trim().max(500).optional(),
    paymentMethod: Joi.string().valid('expresspay', 'mobile_money', 'hubtel', 'bank_transfer', 'western_union').required()
  }),
  
  // Order status update validation
  updateStatus: Joi.object({
    status: Joi.string().valid(
      'pending', 
      'processing', 
      'payment_pending', 
      'payment_failed', 
      'paid', 
      'ready_for_shipping', 
      'shipped', 
      'delivered', 
      'completed', 
      'cancelled', 
      'refunded'
    ).required().messages({
      'string.empty': 'Status is required',
      'any.only': 'Invalid order status'
    }),
    note: Joi.string().trim().max(500).optional()
  }),
  
  // Tracking information update validation
  updateTracking: Joi.object({
    trackingNumber: Joi.string().trim().required().messages({
      'string.empty': 'Tracking number is required'
    }),
    carrier: Joi.string().trim().required().messages({
      'string.empty': 'Carrier is required'
    }),
    estimatedDelivery: commonSchemas.date.optional()
  }),
  
  // Cancel order validation
  cancelOrder: Joi.object({
    reason: Joi.string().trim().max(500).required().messages({
      'string.empty': 'Cancellation reason is required',
      'string.max': 'Reason cannot exceed {#limit} characters'
    })
  })
};

//------------------------------------------------------
// Payment validation schemas
//------------------------------------------------------
const paymentSchemas = {
  // Payment initialization validation
  initialize: Joi.object({
    orderId: commonSchemas.id.required(),
    amount: Joi.number().precision(2).min(1).required().messages({
      'number.base': 'Amount must be a number',
      'number.min': 'Amount must be at least 1',
      'number.empty': 'Amount is required'
    }),
    paymentMethod: Joi.string().valid(
      'expresspay', 
      'mobile_money', 
      'hubtel', 
      'bank_transfer', 
      'western_union'
    ).required().messages({
      'string.empty': 'Payment method is required',
      'any.only': 'Invalid payment method'
    }),
    currency: Joi.string().valid('GHS', 'USD', 'EUR', 'GBP').default('GHS')
  }),
  
  // Payment method specific validation - ExpressPay
  expressPay: Joi.object({
    cardNumber: Joi.string().pattern(/^[0-9]{16}$/).required().messages({
      'string.pattern.base': 'Invalid card number format',
      'string.empty': 'Card number is required'
    }),
    expiryMonth: Joi.string().pattern(/^(0[1-9]|1[0-2])$/).required().messages({
      'string.pattern.base': 'Invalid expiry month format (MM)',
      'string.empty': 'Expiry month is required'
    }),
    expiryYear: Joi.string().pattern(/^[0-9]{2}$/).required().messages({
      'string.pattern.base': 'Invalid expiry year format (YY)',
      'string.empty': 'Expiry year is required'
    }),
    cvv: Joi.string().pattern(/^[0-9]{3,4}$/).required().messages({
      'string.pattern.base': 'Invalid CVV format',
      'string.empty': 'CVV is required'
    }),
    cardholderName: Joi.string().trim().required().messages({
      'string.empty': 'Cardholder name is required'
    })
  }),
  
  // Mobile Money validation
  mobileMoney: Joi.object({
    provider: Joi.string().valid('mtn', 'vodafone', 'airtel_tigo').required().messages({
      'string.empty': 'Provider is required',
      'any.only': 'Invalid mobile money provider'
    }),
    phoneNumber: Joi.string().pattern(/^[0-9]{10}$/).required().messages({
      'string.pattern.base': 'Phone number must be 10 digits',
      'string.empty': 'Phone number is required'
    }),
    voucherCode: Joi.when('provider', {
      is: 'vodafone',
      then: Joi.string().trim().required().messages({
        'string.empty': 'Voucher code is required for Vodafone Cash'
      }),
      otherwise: Joi.optional()
    })
  }),
  
  // Hubtel validation
  hubtel: Joi.object({
    customerEmail: commonSchemas.email,
    customerMobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required().messages({
      'string.pattern.base': 'Mobile number must be 10 digits',
      'string.empty': 'Mobile number is required'
    })
  }),
  
  // Bank Transfer validation
  bankTransfer: Joi.object({
    bankName: Joi.string().trim().required().messages({
      'string.empty': 'Bank name is required'
    }),
    accountNumber: Joi.string().trim().pattern(/^[0-9]+$/).required().messages({
      'string.pattern.base': 'Account number must contain only digits',
      'string.empty': 'Account number is required'
    }),
    transferReference: Joi.string().trim().required().messages({
      'string.empty': 'Transfer reference is required'
    }),
    transferDate: commonSchemas.date.required().messages({
      'date.base': 'Transfer date is required',
      'date.format': 'Invalid date format'
    }),
    depositSlipUrl: Joi.string().uri().optional().messages({
      'string.uri': 'Deposit slip URL must be a valid URL'
    })
  }),
  
  // Western Union validation
  westernUnion: Joi.object({
    mtcn: Joi.string().trim().pattern(/^[0-9]{10}$/).required().messages({
      'string.pattern.base': 'MTCN must be 10 digits',
      'string.empty': 'MTCN is required'
    }),
    senderName: Joi.string().trim().required().messages({
      'string.empty': 'Sender name is required'
    }),
    senderCountry: Joi.string().trim().required().messages({
      'string.empty': 'Sender country is required'
    }),
    transferDate: commonSchemas.date.required().messages({
      'date.base': 'Transfer date is required',
      'date.format': 'Invalid date format'
    })
  }),
  
  // Payment verification validation
  verify: Joi.object({
    paymentId: Joi.string().trim().required().messages({
      'string.empty': 'Payment ID is required'
    }),
    reference: Joi.string().trim().required().messages({
      'string.empty': 'Reference is required'
    }),
    receiptNumber: Joi.string().trim().optional()
  }),
  
  // Refund validation
  refund: Joi.object({
    paymentId: Joi.string().trim().required().messages({
      'string.empty': 'Payment ID is required'
    }),
    amount: Joi.number().precision(2).min(1).required().messages({
      'number.base': 'Amount must be a number',
      'number.min': 'Amount must be at least 1',
      'number.empty': 'Amount is required'
    }),
    reason: Joi.string().trim().max(500).required().messages({
      'string.empty': 'Refund reason is required',
      'string.max': 'Reason cannot exceed {#limit} characters'
    })
  })
};

//------------------------------------------------------
// Category validation schemas
//------------------------------------------------------
const categorySchemas = {
  // Category creation validation
  create: Joi.object({
    name: Joi.string().trim().min(2).max(50).required().messages({
      'string.min': 'Category name must be at least {#limit} characters long',
      'string.max': 'Category name cannot exceed {#limit} characters',
      'string.empty': 'Category name is required'
    }),
    slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().messages({
      'string.pattern.base': 'Slug must contain only lowercase letters, numbers, and hyphens'
    }),
    description: Joi.string().trim().max(500).optional(),
    parent: commonSchemas.id.optional(),
    image: Joi.object({
      url: Joi.string().uri().required().messages({
        'string.uri': 'Image URL must be a valid URL'
      }),
      alt: Joi.string().trim().optional()
    }).optional(),
    icon: Joi.string().trim().optional(),
    isActive: commonSchemas.boolean.default(true),
    order: Joi.number().integer().min(0).default(0),
    featuredInHomepage: commonSchemas.boolean.default(false)
  }),
  
  // Category update validation (similar to create but all fields optional)
  update: Joi.object({
    name: Joi.string().trim().min(2).max(50).optional(),
    slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    description: Joi.string().trim().max(500).optional(),
    parent: commonSchemas.id.optional().allow(null),
    image: Joi.object({
      url: Joi.string().uri().required(),
      alt: Joi.string().trim().optional()
    }).optional(),
    icon: Joi.string().trim().optional(),
    isActive: commonSchemas.boolean.optional(),
    order: Joi.number().integer().min(0).optional(),
    featuredInHomepage: commonSchemas.boolean.optional()
  })
};

// Middleware functions that use validateRequest from error middleware
const validate = {
  user: {
    register: validateRequest(userSchemas.register),
    login: validateRequest(userSchemas.login),
    updatePassword: validateRequest(userSchemas.updatePassword),
    updateProfile: validateRequest(userSchemas.updateProfile),
    forgotPassword: validateRequest(userSchemas.forgotPassword),
    resetPassword: validateRequest(userSchemas.resetPassword)
  },
  
  product: {
    create: validateRequest(productSchemas.create),
    update: validateRequest(productSchemas.update)
  },
  
  order: {
    create: validateRequest(orderSchemas.create),
    updateStatus: validateRequest(orderSchemas.updateStatus),
    updateTracking: validateRequest(orderSchemas.updateTracking),
    cancelOrder: validateRequest(orderSchemas.cancelOrder)
  },
  
  payment: {
    initialize: validateRequest(paymentSchemas.initialize),
    expressPay: validateRequest(paymentSchemas.expressPay),
    mobileMoney: validateRequest(paymentSchemas.mobileMoney),
    hubtel: validateRequest(paymentSchemas.hubtel),
    bankTransfer: validateRequest(paymentSchemas.bankTransfer),
    westernUnion: validateRequest(paymentSchemas.westernUnion),
    verify: validateRequest(paymentSchemas.verify),
    refund: validateRequest(paymentSchemas.refund)
  },
  
  category: {
    create: validateRequest(categorySchemas.create),
    update: validateRequest(categorySchemas.update)
  }
};

module.exports = {
  validate,
  commonSchemas,
  userSchemas,
  productSchemas,
  orderSchemas,
  paymentSchemas,
  categorySchemas,
  addressSchema,
  customValidators
};

