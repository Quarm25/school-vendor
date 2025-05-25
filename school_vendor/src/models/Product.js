const mongoose = require('mongoose');

const StockHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['add', 'remove', 'adjust'],
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  previousStock: {
    type: Number,
    required: true
  },
  newStock: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    trim: true
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const ProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot be more than 100 characters'],
    index: true
  },
  sku: {
    type: String,
    unique: true,
    required: [true, 'SKU is required'],
    trim: true,
    index: true
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true
  },
  shortDescription: {
    type: String,
    trim: true,
    maxlength: [200, 'Short description cannot be more than 200 characters']
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  salePrice: {
    type: Number,
    min: [0, 'Sale price cannot be negative'],
    validate: {
      validator: function(val) {
        return val <= this.price;
      },
      message: 'Sale price ({VALUE}) must be less than or equal to regular price'
    }
  },
  saleActive: {
    type: Boolean,
    default: false
  },
  saleStartDate: {
    type: Date
  },
  saleEndDate: {
    type: Date
  },
  currency: {
    type: String,
    default: 'GHS', // Ghana Cedi
    enum: ['GHS', 'USD', 'EUR', 'GBP']
  },
  productType: {
    type: String,
    required: [true, 'Product type is required'],
    enum: ['physical', 'digital', 'both'],
    index: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required'],
    index: true
  },
  subcategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  tags: [{
    type: String,
    trim: true
  }],
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: {
      type: String,
      trim: true
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  stock: {
    type: Number,
    default: 0,
    min: [0, 'Stock cannot be negative'],
    required: function() {
      return this.productType !== 'digital';
    }
  },
  lowStockThreshold: {
    type: Number,
    default: 10,
    min: [1, 'Low stock threshold must be at least 1']
  },
  isLowStock: {
    type: Boolean,
    default: false
  },
  stockManagement: {
    type: Boolean,
    default: true
  },
  stockHistory: [StockHistorySchema],
  
  // Digital product specific fields
  digitalDetails: {
    fileUrl: {
      type: String,
      required: function() {
        return this.productType === 'digital' || this.productType === 'both';
      }
    },
    fileType: {
      type: String,
      enum: ['pdf', 'doc', 'image', 'audio', 'video', 'software', 'other'],
      required: function() {
        return this.productType === 'digital' || this.productType === 'both';
      }
    },
    fileSize: {
      type: Number, // in KB
      required: function() {
        return this.productType === 'digital' || this.productType === 'both';
      }
    },
    accessDuration: {
      type: Number, // in days, 0 for unlimited
      default: 0
    },
    downloadLimit: {
      type: Number, // 0 for unlimited
      default: 0
    }
  },
  
  // Physical product specific fields
  physicalDetails: {
    weight: {
      type: Number, // in kg
      required: function() {
        return this.productType === 'physical' || this.productType === 'both';
      }
    },
    dimensions: {
      length: {
        type: Number, // in cm
        required: function() {
          return this.productType === 'physical' || this.productType === 'both';
        }
      },
      width: {
        type: Number, // in cm
        required: function() {
          return this.productType === 'physical' || this.productType === 'both';
        }
      },
      height: {
        type: Number, // in cm
        required: function() {
          return this.productType === 'physical' || this.productType === 'both';
        }
      }
    },
    shippingClass: {
      type: String,
      enum: ['standard', 'express', 'oversized', 'fragile'],
      default: 'standard'
    },
    hasWarranty: {
      type: Boolean,
      default: false
    },
    warrantyPeriod: {
      type: Number, // in months
      default: 0
    }
  },
  
  // Visibility and status
  isPublished: {
    type: Boolean,
    default: true,
    index: true
  },
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'draft', 'archived', 'out_of_stock'],
    default: 'active',
    index: true
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Create virtual for current price based on sale status
ProductSchema.virtual('currentPrice').get(function() {
  if (this.saleActive && this.salePrice) {
    const now = new Date();
    if ((!this.saleStartDate || now >= this.saleStartDate) && 
        (!this.saleEndDate || now <= this.saleEndDate)) {
      return this.salePrice;
    }
  }
  return this.price;
});

// Create index for efficient search
ProductSchema.index({ name: 'text', description: 'text', tags: 'text' });

// Check if product is low on stock before saving
ProductSchema.pre('save', function(next) {
  if (this.productType !== 'digital' && this.stockManagement) {
    this.isLowStock = this.stock <= this.lowStockThreshold;
  }
  next();
});

// Methods for stock management
ProductSchema.methods.updateStock = async function(quantity, action, reason, userId) {
  if (this.productType === 'digital') {
    return true; // Digital products don't need stock management
  }
  
  if (!this.stockManagement) {
    return true; // Stock management is disabled
  }
  
  const previousStock = this.stock;
  let newStock;
  
  switch (action) {
    case 'add':
      newStock = previousStock + quantity;
      break;
    case 'remove':
      newStock = previousStock - quantity;
      if (newStock < 0) {
        throw new Error('Insufficient stock');
      }
      break;
    case 'adjust':
      newStock = quantity;
      break;
    default:
      throw new Error('Invalid stock action');
  }
  
  // Update stock history
  this.stockHistory.push({
    action,
    quantity,
    previousStock,
    newStock,
    reason,
    performedBy: userId
  });
  
  // Update current stock
  this.stock = newStock;
  this.isLowStock = newStock <= this.lowStockThreshold;
  
  await this.save();
  return true;
};

// Static method to get low stock products
ProductSchema.statics.getLowStockProducts = function() {
  return this.find({
    productType: { $ne: 'digital' },
    stockManagement: true,
    isLowStock: true
  }).sort({ stock: 1 });
};

module.exports = mongoose.model('Product', ProductSchema);

