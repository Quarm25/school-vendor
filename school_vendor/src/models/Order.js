const mongoose = require('mongoose');

// Order item schema for products in the order
const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  sku: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1']
  },
  productType: {
    type: String,
    enum: ['physical', 'digital', 'both'],
    required: true
  },
  // Store additional product details at time of purchase
  productSnapshot: {
    type: Object
  },
  // For digital products
  digitalDelivery: {
    deliveryStatus: {
      type: String,
      enum: ['pending', 'delivered', 'failed'],
      default: 'pending'
    },
    downloadLink: String,
    accessExpiration: Date,
    downloadCount: {
      type: Number,
      default: 0
    },
    downloadLimit: Number
  }
});

// Shipping details schema
const ShippingSchema = new mongoose.Schema({
  address: {
    street: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    postalCode: {
      type: String,
      required: true
    },
    country: {
      type: String,
      required: true,
      default: 'Ghana'
    }
  },
  contactPhone: {
    type: String,
    required: true
  },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express', 'pickup'],
    default: 'standard'
  },
  shippingCost: {
    type: Number,
    default: 0
  },
  trackingNumber: String,
  carrier: String,
  estimatedDelivery: Date,
  shippedDate: Date,
  deliveredDate: Date
});

// Payment schema
const PaymentSchema = new mongoose.Schema({
  method: {
    type: String,
    enum: ['expresspay', 'mobile_money', 'hubtel', 'bank_transfer', 'western_union'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'GHS',
    enum: ['GHS', 'USD', 'EUR', 'GBP']
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending'
  },
  transactionId: String,
  paymentDate: Date,
  gatewayResponse: Object,
  receiptNumber: String,
  paymentReference: String
});

// Order status history schema
const StatusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  note: String,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

const OrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Store customer info at time of purchase
  customerInfo: {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    phone: String,
    studentId: String
  },
  items: [OrderItemSchema],
  itemsCount: {
    type: Number,
    required: true
  },
  hasDigitalItems: {
    type: Boolean,
    default: false
  },
  hasPhysicalItems: {
    type: Boolean,
    default: false
  },
  subtotal: {
    type: Number,
    required: true
  },
  taxAmount: {
    type: Number,
    default: 0
  },
  taxRate: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  discountCode: String,
  shippingAmount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'GHS',
    enum: ['GHS', 'USD', 'EUR', 'GBP']
  },
  status: {
    type: String,
    enum: [
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
    ],
    default: 'pending',
    index: true
  },
  statusHistory: [StatusHistorySchema],
  notes: [{
    content: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    isInternal: {
      type: Boolean,
      default: true
    }
  }],
  payment: PaymentSchema,
  shipping: ShippingSchema,
  billingAddress: {
    sameAsShipping: {
      type: Boolean,
      default: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: {
        type: String,
        default: 'Ghana'
      }
    }
  },
  ipAddress: String,
  userAgent: String,
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Create indexes for common queries
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ 'payment.status': 1 });
OrderSchema.index({ 'items.product': 1 });

// Set hasDigitalItems and hasPhysicalItems flags based on order items
OrderSchema.pre('save', function(next) {
  this.hasDigitalItems = this.items.some(item => 
    item.productType === 'digital' || item.productType === 'both'
  );
  
  this.hasPhysicalItems = this.items.some(item => 
    item.productType === 'physical' || item.productType === 'both'
  );
  
  this.itemsCount = this.items.length;
  
  next();
});

// Add status change to history
OrderSchema.methods.updateStatus = async function(newStatus, note, userId) {
  if (!this.status !== newStatus) {
    this.status = newStatus;
    
    this.statusHistory.push({
      status: newStatus,
      timestamp: Date.now(),
      note: note || `Order status changed to ${newStatus}`,
      updatedBy: userId
    });
    
    // Handle special status changes
    switch (newStatus) {
      case 'completed':
        this.completedAt = Date.now();
        break;
      case 'cancelled':
        this.cancelledAt = Date.now();
        if (note) {
          this.cancellationReason = note;
        }
        break;
      case 'shipped':
        if (this.shipping) {
          this.shipping.shippedDate = Date.now();
        }
        break;
      case 'delivered':
        if (this.shipping) {
          this.shipping.deliveredDate = Date.now();
        }
        break;
    }
    
    await this.save();
    return true;
  }
  return false;
};

// Update payment status
OrderSchema.methods.updatePayment = async function(paymentStatus, transactionId, gatewayResponse) {
  this.payment.status = paymentStatus;
  
  if (transactionId) {
    this.payment.transactionId = transactionId;
  }
  
  if (gatewayResponse) {
    this.payment.gatewayResponse = gatewayResponse;
  }
  
  if (paymentStatus === 'completed') {
    this.payment.paymentDate = Date.now();
    
    // Update order status if payment is completed
    if (this.status === 'payment_pending' || this.status === 'pending') {
      if (this.hasPhysicalItems) {
        await this.updateStatus('processing', 'Payment completed, processing order', null);
      } else {
        await this.updateStatus('completed', 'Digital order fulfilled automatically', null);
      }
    }
  } else if (paymentStatus === 'failed') {
    await this.updateStatus('payment_failed', 'Payment failed', null);
  }
  
  await this.save();
  return true;
};

// Add tracking information
OrderSchema.methods.addTracking = async function(trackingNumber, carrier, estimatedDelivery) {
  if (this.shipping) {
    this.shipping.trackingNumber = trackingNumber;
    this.shipping.carrier = carrier;
    
    if (estimatedDelivery) {
      this.shipping.estimatedDelivery = new Date(estimatedDelivery);
    }
    
    await this.save();
    return true;
  }
  return false;
};

// Generate unique order number
OrderSchema.statics.generateOrderNumber = async function() {
  const date = new Date();
  const year = date.getFullYear().toString().substr(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  
  // Get count of orders today for sequential numbering
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));
  
  const orderCount = await this.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });
  
  // Format: SV-YYMMDD-XXXX (SV = School Vendor, followed by date and sequential number)
  const sequentialNumber = (orderCount + 1).toString().padStart(4, '0');
  return `SV-${year}${month}${day}-${sequentialNumber}`;
};

module.exports = mongoose.model('Order', OrderSchema);

