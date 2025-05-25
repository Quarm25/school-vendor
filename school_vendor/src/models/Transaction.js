const mongoose = require('mongoose');

// Status history for tracking changes in transaction status
const TransactionStatusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
    enum: [
      'initiated', 
      'pending', 
      'processing', 
      'completed', 
      'failed', 
      'refunded', 
      'partially_refunded', 
      'cancelled',
      'expired',
      'disputed'
    ]
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  note: String,
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

// Schema for webhook responses
const WebhookResponseSchema = new mongoose.Schema({
  provider: {
    type: String,
    required: true
  },
  event: String,
  payload: Object,
  timestamp: {
    type: Date,
    default: Date.now
  },
  ipAddress: String,
  headers: Object,
  verified: {
    type: Boolean,
    default: false
  }
});

// Refund details schema
const RefundSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true
  },
  reason: String,
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  refundDate: {
    type: Date,
    default: Date.now
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  refundReference: String,
  gatewayResponse: Object
});

// Provider-specific details schemas
const ExpressPayDetailsSchema = new mongoose.Schema({
  merchantTransactionId: String,
  checkoutUrl: String,
  paymentToken: String,
  cardType: String,
  cardLastFour: String,
  authorizationCode: String
});

const MobileMoneyDetailsSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['mtn', 'vodafone', 'airtel_tigo'],
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  networkReference: String,
  transactionId: String
});

const HubtelDetailsSchema = new mongoose.Schema({
  clientReference: String,
  hubtelTransactionId: String,
  checkoutId: String,
  channel: String
});

const BankTransferDetailsSchema = new mongoose.Schema({
  bankName: String,
  accountNumber: String,
  transferReference: String,
  transferDate: Date,
  depositSlipUrl: String,
  verificationNotes: String
});

const WesternUnionDetailsSchema = new mongoose.Schema({
  mtcn: String, // Money Transfer Control Number
  senderName: String,
  senderCountry: String,
  receiverName: String,
  transferDate: Date,
  verificationNotes: String
});

const TransactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
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
  paymentMethod: {
    type: String,
    required: true,
    enum: ['expresspay', 'mobile_money', 'hubtel', 'bank_transfer', 'western_union'],
    index: true
  },
  status: {
    type: String,
    required: true,
    enum: [
      'initiated', 
      'pending', 
      'processing', 
      'completed', 
      'failed', 
      'refunded', 
      'partially_refunded', 
      'cancelled',
      'expired',
      'disputed'
    ],
    default: 'initiated',
    index: true
  },
  statusHistory: [TransactionStatusHistorySchema],
  
  // Provider-specific details
  expressPayDetails: ExpressPayDetailsSchema,
  mobileMoneyDetails: MobileMoneyDetailsSchema,
  hubtelDetails: HubtelDetailsSchema,
  bankTransferDetails: BankTransferDetailsSchema,
  westernUnionDetails: WesternUnionDetailsSchema,
  
  // General payment info
  paymentReference: {
    type: String,
    index: true
  },
  gatewayReference: String,
  gatewayResponse: Object,
  
  // Verification details
  verified: {
    type: Boolean,
    default: false
  },
  verifiedAt: Date,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verificationMethod: {
    type: String,
    enum: ['automatic', 'manual', 'webhook']
  },
  verificationDetails: Object,
  
  // Refund information
  refunds: [RefundSchema],
  totalRefundAmount: {
    type: Number,
    default: 0
  },
  
  // Webhook responses
  webhookResponses: [WebhookResponseSchema],
  
  // Additional metadata
  ipAddress: String,
  userAgent: String,
  notes: String,
  metadata: Object,
  
  // Error tracking
  errorMessage: String,
  errorCode: String,
  errorDetails: Object,
  
  expiresAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Create additional indexes for common queries
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ 'refunds.status': 1 });
TransactionSchema.index({ verified: 1 });

// Calculate remaining amount after refunds
TransactionSchema.virtual('remainingAmount').get(function() {
  return this.amount - this.totalRefundAmount;
});

// Method to update transaction status
TransactionSchema.methods.updateStatus = async function(newStatus, note, userId) {
  if (this.status !== newStatus) {
    this.status = newStatus;
    
    // Add to status history
    this.statusHistory.push({
      status: newStatus,
      timestamp: Date.now(),
      note: note || `Transaction status changed to ${newStatus}`,
      performedBy: userId
    });
    
    // Handle status-specific actions
    switch (newStatus) {
      case 'completed':
        this.verified = true;
        this.verifiedAt = Date.now();
        this.verifiedBy = userId;
        this.verificationMethod = 'manual';
        break;
      case 'refunded':
        this.totalRefundAmount = this.amount;
        break;
    }
    
    await this.save();
    return true;
  }
  return false;
};

// Method to add a refund
TransactionSchema.methods.addRefund = async function(amount, reason, userId) {
  // Check if amount is valid
  if (amount <= 0 || amount > this.remainingAmount) {
    throw new Error('Invalid refund amount');
  }
  
  const refund = {
    amount,
    reason,
    processedBy: userId,
    status: 'pending',
    refundDate: Date.now()
  };
  
  this.refunds.push(refund);
  this.totalRefundAmount += amount;
  
  // Update status if fully refunded
  if (this.totalRefundAmount >= this.amount) {
    await this.updateStatus('refunded', 'Fully refunded', userId);
  } else if (this.totalRefundAmount > 0) {
    await this.updateStatus('partially_refunded', 'Partially refunded', userId);
  }
  
  await this.save();
  return refund;
};

// Method to record webhook response
TransactionSchema.methods.recordWebhook = async function(provider, event, payload, ipAddress, headers) {
  const webhook = {
    provider,
    event,
    payload,
    ipAddress,
    headers,
    timestamp: Date.now()
  };
  
  this.webhookResponses.push(webhook);
  await this.save();
  return webhook;
};

// Method to verify transaction
TransactionSchema.methods.verifyTransaction = async function(method, details, userId) {
  this.verified = true;
  this.verifiedAt = Date.now();
  this.verifiedBy = userId;
  this.verificationMethod = method;
  this.verificationDetails = details;
  
  // Update status to completed
  await this.updateStatus('completed', 'Transaction verified', userId);
  
  await this.save();
  return true;
};

// Generate transaction ID based on payment method and timestamp
TransactionSchema.statics.generateTransactionId = function(paymentMethod) {
  const prefix = paymentMethod.substring(0, 3).toUpperCase();
  const timestamp = Date.now().toString();
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  
  return `${prefix}-${timestamp.substring(timestamp.length - 8)}-${randomStr}`;
};

module.exports = mongoose.model('Transaction', TransactionSchema);

