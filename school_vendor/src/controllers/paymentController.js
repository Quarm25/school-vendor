const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const { 
  NotFoundError,
  ValidationError,
  PaymentError,
  catchAsync 
} = require('../middleware/error');
const crypto = require('crypto');

/**
 * @desc   Initialize payment for an order
 * @route  POST /api/payments/initialize
 * @access Private
 */
const initializePayment = catchAsync(async (req, res) => {
  const { orderId, paymentMethod } = req.body;
  
  // Validate payment method
  if (!['expresspay', 'mobile_money', 'hubtel', 'bank_transfer', 'western_union'].includes(paymentMethod)) {
    throw new ValidationError('Invalid payment method');
  }
  
  // Find order
  const order = await Order.findById(orderId);
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order belongs to the current user
  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to process payment for this order');
  }
  
  // Check if order is ready for payment
  if (!['pending', 'payment_pending', 'payment_failed'].includes(order.status)) {
    throw new ValidationError(`Cannot process payment for order in ${order.status} status`);
  }
  
  // Update payment method if different from the one stored in order
  if (paymentMethod !== order.payment.method) {
    order.payment.method = paymentMethod;
    await order.save();
  }
  
  // Generate a transaction ID
  const transactionId = Transaction.generateTransactionId(paymentMethod);
  
  // Create transaction record
  const transaction = await Transaction.create({
    transactionId,
    order: order._id,
    user: req.user._id,
    amount: order.totalAmount,
    currency: order.currency || 'GHS',
    paymentMethod,
    status: 'initiated',
    paymentReference: `ORD-${order.orderNumber}`,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hour expiry
    statusHistory: [{
      status: 'initiated',
      timestamp: Date.now(),
      note: 'Payment processing initiated'
    }]
  });
  
  // Update order with transaction ID
  order.payment.transactionId = transactionId;
  await order.updateStatus('payment_pending', 'Payment initiated', req.user._id);
  
  // Process payment based on method
  let paymentDetails;
  switch (paymentMethod) {
    case 'expresspay':
      paymentDetails = await processExpressPayPayment(transaction, order, req.user);
      break;
    case 'mobile_money':
      paymentDetails = await processMobileMoneyPayment(transaction, order, req.user);
      break;
    case 'hubtel':
      paymentDetails = await processHubtelPayment(transaction, order, req.user);
      break;
    case 'bank_transfer':
      paymentDetails = await processBankTransferPayment(transaction, order, req.user);
      break;
    case 'western_union':
      paymentDetails = await processWesternUnionPayment(transaction, order, req.user);
      break;
    default:
      throw new ValidationError('Invalid payment method');
  }
  
  res.status(200).json({
    success: true,
    message: 'Payment initialized successfully',
    transaction: {
      id: transaction._id,
      transactionId: transaction.transactionId,
      amount: transaction.amount,
      currency: transaction.currency,
      paymentMethod: transaction.paymentMethod,
      expiresAt: transaction.expiresAt
    },
    paymentDetails
  });
});

/**
 * Process payment with ExpressPay
 * @param {Object} transaction - Transaction record
 * @param {Object} order - Order record
 * @param {Object} user - User record
 * @returns {Object} Payment details
 */
const processExpressPayPayment = async (transaction, order, user) => {
  // In a real implementation, this would integrate with ExpressPay API
  // For demonstration, we're mocking the integration
  
  // Update transaction with ExpressPay details
  transaction.expressPayDetails = {
    merchantTransactionId: `EP-${Date.now()}`,
    checkoutUrl: `${process.env.FRONTEND_URL}/checkout/expresspay/${transaction.transactionId}`,
    paymentToken: crypto.randomBytes(16).toString('hex')
  };
  
  await transaction.save();
  
  return {
    redirectUrl: transaction.expressPayDetails.checkoutUrl,
    paymentToken: transaction.expressPayDetails.paymentToken,
    merchantTransactionId: transaction.expressPayDetails.merchantTransactionId,
    instructions: 'You will be redirected to ExpressPay to complete your payment'
  };
};

/**
 * Process payment with Mobile Money
 * @param {Object} transaction - Transaction record
 * @param {Object} order - Order record
 * @param {Object} user - User record
 * @returns {Object} Payment details
 */
const processMobileMoneyPayment = async (transaction, order, user) => {
  // In a real implementation, this would integrate with Mobile Money API
  // For demonstration, we're mocking the integration
  
  // Update transaction with Mobile Money details
  transaction.mobileMoneyDetails = {
    provider: 'mtn', // Default to MTN, can be overridden in specific payment step
    phoneNumber: '', // Will be provided by user in next step
    networkReference: `MM-${Date.now()}`
  };
  
  await transaction.save();
  
  return {
    redirectUrl: `${process.env.FRONTEND_URL}/checkout/mobile-money/${transaction.transactionId}`,
    instructions: 'Provide your mobile money details to complete the payment',
    supportedProviders: ['mtn', 'vodafone', 'airtel_tigo']
  };
};

/**
 * Process payment with Hubtel
 * @param {Object} transaction - Transaction record
 * @param {Object} order - Order record
 * @param {Object} user - User record
 * @returns {Object} Payment details
 */
const processHubtelPayment = async (transaction, order, user) => {
  // In a real implementation, this would integrate with Hubtel API
  // For demonstration, we're mocking the integration
  
  // Update transaction with Hubtel details
  transaction.hubtelDetails = {
    clientReference: `HUB-${Date.now()}`,
    checkoutId: crypto.randomBytes(8).toString('hex'),
    hubtelTransactionId: ''
  };
  
  await transaction.save();
  
  return {
    redirectUrl: `${process.env.FRONTEND_URL}/checkout/hubtel/${transaction.transactionId}`,
    clientReference: transaction.hubtelDetails.clientReference,
    instructions: 'You will be redirected to Hubtel to complete your payment'
  };
};

/**
 * Process payment with Bank Transfer
 * @param {Object} transaction - Transaction record
 * @param {Object} order - Order record
 * @param {Object} user - User record
 * @returns {Object} Payment details
 */
const processBankTransferPayment = async (transaction, order, user) => {
  // For bank transfers, we provide account details for manual transfer
  
  // Update transaction with Bank Transfer details
  transaction.bankTransferDetails = {
    bankName: 'School Vendor Bank',
    accountNumber: '1234567890',
    transferReference: `BT-${order.orderNumber}`
  };
  
  await transaction.save();
  
  return {
    bankDetails: {
      bankName: transaction.bankTransferDetails.bankName,
      accountNumber: transaction.bankTransferDetails.accountNumber,
      accountName: 'School Vendor Account',
      swiftCode: 'SCHVEND'
    },
    paymentReference: transaction.bankTransferDetails.transferReference,
    amount: transaction.amount,
    currency: transaction.currency,
    instructions: 'Please transfer the exact amount using the provided reference. Upload your receipt after payment.',
    verificationUrl: `${process.env.FRONTEND_URL}/verify-payment/${transaction.transactionId}`
  };
};

/**
 * Process payment with Western Union
 * @param {Object} transaction - Transaction record
 * @param {Object} order - Order record
 * @param {Object} user - User record
 * @returns {Object} Payment details
 */
const processWesternUnionPayment = async (transaction, order, user) => {
  // For Western Union, we provide recipient details for manual transfer
  
  // Update transaction with Western Union details
  transaction.westernUnionDetails = {
    recipientName: 'School Vendor Finance',
    senderName: '',
    senderCountry: '',
    mtcn: ''
  };
  
  await transaction.save();
  
  return {
    recipientDetails: {
      fullName: transaction.westernUnionDetails.recipientName,
      country: 'Ghana',
      city: 'Accra',
      address: '123 Education Street'
    },
    amount: transaction.amount,
    currency: transaction.currency,
    instructions: 'Please send the exact amount via Western Union to the recipient details above. After payment, you will need to provide the MTCN and sender information.',
    verificationUrl: `${process.env.FRONTEND_URL}/verify-payment/${transaction.transactionId}`
  };
};

/**
 * @desc   Process Mobile Money payment details
 * @route  POST /api/payments/mobile-money/:transactionId
 * @access Private
 */
const processMobileMoneyDetails = catchAsync(async (req, res) => {
  const { provider, phoneNumber } = req.body;
  const { transactionId } = req.params;
  
  // Validate required fields
  if (!provider || !phoneNumber) {
    throw new ValidationError('Provider and phone number are required');
  }
  
  // Validate provider
  if (!['mtn', 'vodafone', 'airtel_tigo'].includes(provider)) {
    throw new ValidationError('Invalid mobile money provider');
  }
  
  // Find transaction
  const transaction = await Transaction.findOne({ transactionId });
  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }
  
  // Check if transaction belongs to the current user
  if (transaction.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to process this transaction');
  }
  
  // Update transaction with mobile money details
  transaction.mobileMoneyDetails = {
    ...transaction.mobileMoneyDetails,
    provider,
    phoneNumber,
    networkReference: `MM-${provider.toUpperCase()}-${Date.now()}`
  };
  
  // Update status to processing
  transaction.status = 'processing';
  transaction.statusHistory.push({
    status: 'processing',
    timestamp: Date.now(),
    note: `Mobile Money payment processing for ${provider}`
  });
  
  await transaction.save();
  
  // In a real implementation, this would initiate a request to the mobile money provider
  // For demonstration, we're mocking the response
  
  res.status(200).json({
    success: true,
    message: 'Mobile Money payment processing initiated',
    provider,
    phoneNumber,
    amount: transaction.amount,
    currency: transaction.currency,
    instructions: `Please confirm the payment on your ${provider.toUpperCase()} mobile money account. You will receive a prompt shortly.`
  });
});

/**
 * @desc   Verify payment for bank transfer or Western Union
 * @route  POST /api/payments/verify/:transactionId
 * @access Private
 */
const verifyManualPayment = catchAsync(async (req, res) => {
  const { transactionId } = req.params;
  const { paymentMethod, reference, receiptNumber, senderInfo } = req.body;
  
  // Find transaction
  const transaction = await Transaction.findOne({ transactionId });
  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }
  
  // Check if transaction belongs to the current user
  if (transaction.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to verify this transaction');
  }
  
  // Check payment method
  if (transaction.paymentMethod !== paymentMethod) {
    throw new ValidationError('Payment method mismatch');
  }
  
  // Update transaction based on payment method
  switch (paymentMethod) {
    case 'bank_transfer':
      if (!reference || !receiptNumber) {
        throw new ValidationError('Reference and receipt number are required for bank transfer verification');
      }
      
      transaction.bankTransferDetails = {
        ...transaction.bankTransferDetails,
        transferReference: reference,
        depositSlipUrl: req.body.receiptUrl || '',
        transferDate: new Date()
      };
      break;
      
    case 'western_union':
      if (!reference || !senderInfo) {
        throw new ValidationError('MTCN and sender information are required for Western Union verification');
      }
      
      transaction.westernUnionDetails = {
        ...transaction.westernUnionDetails,
        mtcn: reference,
        senderName: senderInfo.name,
        senderCountry: senderInfo.country,
        transferDate: new Date()
      };
      break;
      
    default:
      throw new ValidationError('Payment method not supported for manual verification');
  }
  
  // Update transaction status
  transaction.status = 'pending';
  transaction.statusHistory.push({
    status: 'pending',
    timestamp: Date.now(),
    note: 'Manual payment verification pending review'
  });
  
  await transaction.save();
  
  // Find order and update status
  const order = await Order.findById(transaction.order);
  if (order) {
    await order.updateStatus('payment_pending', 'Payment verification submitted, pending review', null);
  }
  
  res.status(200).json({
    success: true,
    message: 'Payment verification submitted successfully',
    status: 'pending_verification',
    verificationId: transaction._id
  });
});

/**
 * @desc   Admin verification of manual payments
 * @route  POST /api/payments/admin-verify/:transactionId
 * @access Admin
 */
const adminVerifyPayment = catchAsync(async (req, res) => {
  const { transactionId } = req.params;
  const { approved, note } = req.body;
  
  // Find transaction
  const transaction = await Transaction.findOne({ transactionId });
  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }
  
  // Determine new status based on approval
  const newStatus = approved ? 'completed' : 'failed';
  const statusNote = approved 
    ? 'Payment verified and approved by admin' 
    : `Payment verification rejected: ${note || 'No reason provided'}`;
  
  // Update transaction status
  await transaction.updateStatus(newStatus, statusNote, req.user._id);
  
  // Update order status if transaction was approved
  if (approved) {
    const order = await Order.findById(transaction.order);
    if (order) {
      await order.updateStatus('paid', 'Payment verified by admin', req.user._id);
    }
  } else {
    // Update order status if transaction was rejected
    const order = await Order.findById(transaction.order);
    if (order) {
      await order.updateStatus('payment_failed', `Payment verification rejected: ${note || 'No reason provided'}`, req.user._id);
    }
  }
  
  res.status(200).json({
    success: true,
    message: `Payment ${approved ? 'approved' : 'rejected'} successfully`,
    transaction: {
      id: transaction._id,
      transactionId: transaction.transactionId,
      status: transaction.status
    }
  });
});

/**
 * @desc   ExpressPay webhook handler
 * @route  POST /api/payments/webhook/expresspay
 * @access Public
 */
const expressPayWebhook = catchAsync(async (req, res) => {
  // In a real implementation, verify webhook signature for security
  // const isValidSignature = verifyExpressPaySignature(req);
  const isValidSignature = true; // Simplified for example
  
  if (!isValidSignature) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  
  const payload = req.body;
  
  // Record webhook receipt
  console.log('ExpressPay webhook received:', payload);
  
  // Extract transaction ID and status from payload
  const { transactionId, status, merchantReference } = payload;
  
  // Find the corresponding transaction
  const transaction = await Transaction.findOne({
    $or: [
      { transactionId },
      { 'expressPayDetails.merchantTransactionId': merchantReference }
    ]
  });
  
  if (!transaction) {
    // Always return 200 to webhook provider even if transaction not found
    return res.status(200).json({ success: true, message: 'Webhook received but transaction not found' });
  }
  
  // Record webhook response in transaction
  await transaction.recordWebhook('expresspay', status, payload, req.ip, req.headers);
  
  // Map ExpressPay status to our status
  let newStatus;
  switch (status) {
    case 'SUCCESSFUL':
      newStatus = 'completed';
      break;
    case 'FAILED':
      newStatus = 'failed';
      break;
    case 'PENDING':
      newStatus = 'pending';
      break;
    default:
      newStatus = 'processing';
  }
  
  // Update transaction status
  await transaction.updateStatus(newStatus, `ExpressPay webhook received: ${status}`, null);
  
  // Update order status if payment was successful
  if (newStatus === 'completed') {
    const order = await Order.findById(transaction.order);
    if (order) {
      await order.updateStatus('paid', 'Payment confirmed by ExpressPay', null);
    }
  }
  
  // Always return 200 success response for webhooks
  res.status(200).json({ success: true, message: 'Webhook processed successfully' });
});

/**
 * @desc   Mobile Money webhook handler
 * @route  POST /api/payments/webhook/mobile-money
 * @access Public
 */
const mobileMoneyWebhook = catchAsync(async (req, res) => {
  // In a real implementation, verify webhook signature for security
  const isValidSignature = true; // Simplified for example
  
  if (!isValidSignature) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  
  const payload = req.body;
  
  // Record webhook receipt
  console.log('Mobile Money webhook received:', payload);
  
  // Extract transaction ID and status from payload
  const { reference, status, provider } = payload;
  
  // Find the corresponding transaction
  const transaction = await Transaction.findOne({
    $or: [
      { transactionId: reference },
      { 'mobileMoneyDetails.networkReference': reference }
    ]
  });
  
  if (!transaction) {
    // Always return 200 to webhook provider even if transaction not found
    return res.status(200).json({ success: true, message: 'Webhook received but transaction not found' });
  }
  
  // Record webhook response in transaction
  await transaction.recordWebhook('mobile_money', status, payload, req.ip, req.headers);
  
  // Update mobile money details
  transaction.mobileMoneyDetails = {
    ...transaction.mobileMoneyDetails,
    transactionId: payload.transactionId || transaction.mobileMoneyDetails.transactionId
  };
  await transaction.save();
  
  // Map Mobile Money status to our status
  let newStatus;
  switch (status) {
    case 'SUCCESSFUL':
    case 'SUCCESS':
      newStatus = 'completed';
      break;
    case 'FAILED':
    case 'FAILURE':
      newStatus = 'failed';
      break;
    case 'PENDING':
      newStatus = 'pending';
      break;
    default:
      newStatus = 'processing';
  }
  
  // Update transaction status
  await transaction.updateStatus(newStatus, `Mobile Money webhook received: ${status}`, null);
  
  // Update order status if payment was successful
  if (newStatus === 'completed') {
    const order = await Order.findById(transaction.order);
    if (order) {
      await order.updateStatus('paid', `Payment confirmed by ${provider || 'Mobile Money'}`, null);
    }
  }
  
  // Always return 200 success response for webhooks
  res.status(200).json({ success: true, message: 'Webhook processed successfully' });
});

/**
 * @desc   Hubtel webhook handler
 * @route  POST /api/payments/webhook/hubtel
 * @access Public
 */
const hubtelWebhook = catchAsync(async (req, res) => {
  // In a real implementation, verify webhook signature for security
  const isValidSignature = true; // Simplified for example
  
  if (!isValidSignature) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
  
  const payload = req.body;
  
  // Record webhook receipt
  console.log('Hubtel webhook received:', payload);
  
  // Extract transaction ID and status from payload
  const { clientReference, status } = payload;
  
  // Find the corresponding transaction
  const transaction = await Transaction.findOne({
    $or: [
      { 'hubtelDetails.clientReference': clientReference },
      { 'hubtelDetails.checkoutId': payload.checkoutId }
    ]
  });
  
  if (!transaction) {
    // Always return 200 to webhook provider even if transaction not found
    return res.status(200).json({ success: true, message: 'Webhook received but transaction not found' });
  }
  
  // Record webhook response in transaction
  await transaction.recordWebhook('hubtel', status, payload, req.ip, req.headers);
  
  // Update Hubtel details
  transaction.hubtelDetails = {
    ...transaction.hubtelDetails,
    hubtelTransactionId: payload.hubtelTransactionId || transaction.hubtelDetails.hubtelTransactionId
  };
  await transaction.save();
  
  // Map Hubtel status to our status
  let newStatus;
  switch (status) {
    case 'COMPLETED':
    case 'SUCCESS':
      newStatus = 'completed';
      break;
    case 'FAILED':
    case 'FAILURE':
      newStatus = 'failed';
      break;
    case 'PENDING':
      newStatus = 'pending';
      break;
    default:
      newStatus = 'processing';
  }
  
  // Update transaction status
  await transaction.updateStatus(newStatus, `Hubtel webhook received: ${status}`, null);
  
  // Update order status if payment was successful
  if (newStatus === 'completed') {
    const order = await Order.findById(transaction.order);
    if (order) {
      await order.updateStatus('paid', 'Payment confirmed by Hubtel', null);
    }
  }
  
  // Always return 200 success response for webhooks
  res.status(200).json({ success: true, message: 'Webhook processed successfully' });
});

/**
 * @desc   Check payment status
 * @route  GET /api/payments/:transactionId/status
 * @access Private
 */
const checkPaymentStatus = catchAsync(async (req, res) => {
  const { transactionId } = req.params;
  
  // Find transaction
  const transaction = await Transaction.findOne({ transactionId });
  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }
  
  // Check if transaction belongs to the current user
  if (transaction.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to view this transaction');
  }
  
  // Get order details
  const order = await Order.findById(transaction.order);
  
  // Return transaction status with payment details based on payment method
  let paymentDetails = {};
  
  switch (transaction.paymentMethod) {
    case 'expresspay':
      paymentDetails = {
        paymentMethod: 'ExpressPay',
        merchantTransactionId: transaction.expressPayDetails?.merchantTransactionId,
        checkoutUrl: transaction.expressPayDetails?.checkoutUrl
      };
      break;
    case 'mobile_money':
      paymentDetails = {
        paymentMethod: 'Mobile Money',
        provider: transaction.mobileMoneyDetails?.provider,
        phoneNumber: transaction.mobileMoneyDetails?.phoneNumber && 
          `${transaction.mobileMoneyDetails.phoneNumber.substring(0, 3)}****${transaction.mobileMoneyDetails.phoneNumber.substring(7)}`, // Masked for security
        networkReference: transaction.mobileMoneyDetails?.networkReference
      };
      break;
    case 'hubtel':
      paymentDetails = {
        paymentMethod: 'Hubtel',
        clientReference: transaction.hubtelDetails?.clientReference
      };
      break;
    case 'bank_transfer':
      paymentDetails = {
        paymentMethod: 'Bank Transfer',
        bankName: transaction.bankTransferDetails?.bankName,
        transferReference: transaction.bankTransferDetails?.transferReference,
        transferDate: transaction.bankTransferDetails?.transferDate
      };
      break;
    case 'western_union':
      paymentDetails = {
        paymentMethod: 'Western Union',
        mtcn: transaction.westernUnionDetails?.mtcn,
        senderName: transaction.westernUnionDetails?.senderName,
        transferDate: transaction.westernUnionDetails?.transferDate
      };
      break;
  }
  
  res.status(200).json({
    success: true,
    transaction: {
      id: transaction._id,
      transactionId: transaction.transactionId,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      createdAt: transaction.createdAt,
      expiresAt: transaction.expiresAt
    },
    paymentDetails,
    order: order ? {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status
    } : null
  });
});

/**
 * @desc   Get transaction history for current user
 * @route  GET /api/payments/transactions
 * @access Private
 */
const getTransactionHistory = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Filter by payment method and status
  const { paymentMethod, status } = req.query;
  
  // Build query
  const query = { user: req.user._id };
  
  if (paymentMethod) {
    query.paymentMethod = paymentMethod;
  }
  
  if (status) {
    query.status = status;
  }
  
  // Find transactions
  const transactions = await Transaction.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({
      path: 'order',
      select: 'orderNumber status'
    });
  
  // Get total count
  const total = await Transaction.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: transactions.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    transactions: transactions.map(transaction => ({
      id: transaction._id,
      transactionId: transaction.transactionId,
      amount: transaction.amount,
      currency: transaction.currency,
      paymentMethod: transaction.paymentMethod,
      status: transaction.status,
      createdAt: transaction.createdAt,
      order: transaction.order
    }))
  });
});

/**
 * @desc   Process refund
 * @route  POST /api/payments/refund/:transactionId
 * @access Admin
 */
const processRefund = catchAsync(async (req, res) => {
  const { transactionId } = req.params;
  const { amount, reason } = req.body;
  
  if (!amount || !reason) {
    throw new ValidationError('Refund amount and reason are required');
  }
  
  // Find transaction
  const transaction = await Transaction.findOne({ transactionId });
  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }
  
  // Validate refund amount
  if (parseFloat(amount) > transaction.amount) {
    throw new ValidationError('Refund amount cannot exceed transaction amount');
  }
  
  // Check if transaction is completed
  if (transaction.status !== 'completed') {
    throw new ValidationError('Only completed transactions can be refunded');
  }
  
  try {
    // Process refund (in a real app, this would call payment provider's API)
    await transaction.addRefund(parseFloat(amount), reason, req.user._id);
    
    // Update order status if fully refunded
    if (parseFloat(amount) >= transaction.amount - transaction.totalRefundAmount) {
      const order = await Order.findById(transaction.order);
      if (order) {
        await order.updateStatus('refunded', reason, req.user._id);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      refund: {
        transactionId: transaction.transactionId,
        amount: parseFloat(amount),
        reason,
        status: 'pending' // Refunds start as pending until confirmed
      }
    });
  } catch (error) {
    throw new PaymentError('Failed to process refund: ' + error.message);
  }
});

/**
 * @desc   Get payment analytics for admin
 * @route  GET /api/payments/analytics
 * @access Admin
 */
const getPaymentAnalytics = catchAsync(async (req, res) => {
  // Extract query parameters for date range
  const { startDate, endDate, groupBy = 'day' } = req.query;
  
  // Set default date range to last 30 days if not provided
  const endDateObj = endDate ? new Date(endDate) : new Date();
  endDateObj.setHours(23, 59, 59, 999); // End of day
  
  const startDateObj = startDate 
    ? new Date(startDate) 
    : new Date(endDateObj.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  startDateObj.setHours(0, 0, 0, 0); // Start of day
  
  // Basic analytics - total transactions, total revenue, average transaction value
  const basicAnalytics = await Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        totalTransactions: { $sum: 1 },
        totalRevenue: { $sum: '$amount' },
        avgTransactionValue: { $avg: '$amount' }
      }
    }
  ]);
  
  // Status distribution
  const transactionsByStatus = await Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  // Payment method distribution
  const transactionsByMethod = await Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: '$paymentMethod',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $sort: { totalAmount: -1 }
    }
  ]);
  
  // Transactions over time (grouped by day, week, or month)
  let timeGrouping;
  
  switch (groupBy) {
    case 'week':
      timeGrouping = {
        $week: '$createdAt'
      };
      break;
    case 'month':
      timeGrouping = {
        $month: '$createdAt'
      };
      break;
    case 'day':
    default:
      timeGrouping = {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
      };
  }
  
  const transactionsOverTime = await Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: timeGrouping,
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
  
  // Refund statistics
  const refundStats = await Transaction.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        'refunds.0': { $exists: true } // Has at least one refund
      }
    },
    {
      $group: {
        _id: null,
        totalRefunds: { $sum: 1 },
        totalRefundAmount: { $sum: '$totalRefundAmount' }
      }
    }
  ]);
  
  res.status(200).json({
    success: true,
    timeRange: {
      startDate: startDateObj,
      endDate: endDateObj
    },
    basicAnalytics: basicAnalytics[0] || {
      totalTransactions: 0,
      totalRevenue: 0,
      avgTransactionValue: 0
    },
    transactionsByStatus,
    transactionsByMethod,
    transactionsOverTime,
    refundStats: refundStats[0] || {
      totalRefunds: 0,
      totalRefundAmount: 0
    }
  });
});

/**
 * @desc   Get payment methods summary
 * @route  GET /api/payments/methods
 * @access Public
 */
const getPaymentMethods = catchAsync(async (req, res) => {
  // Return available payment methods with details
  const paymentMethods = [
    {
      id: 'expresspay',
      name: 'ExpressPay',
      description: 'Pay with your credit or debit card',
      icon: '/images/payment/expresspay.png',
      supportedCards: ['visa', 'mastercard'],
      processingTime: 'Instant'
    },
    {
      id: 'mobile_money',
      name: 'Mobile Money',
      description: 'Pay with your mobile money account',
      icon: '/images/payment/mobile-money.png',
      providers: ['mtn', 'vodafone', 'airtel_tigo'],
      processingTime: 'Instant to 15 minutes'
    },
    {
      id: 'hubtel',
      name: 'Hubtel',
      description: 'Pay with Hubtel integrated payment solution',
      icon: '/images/payment/hubtel.png',
      processingTime: 'Instant to 15 minutes'
    },
    {
      id: 'bank_transfer',
      name: 'Bank Transfer',
      description: 'Pay by bank transfer to our account',
      icon: '/images/payment/bank-transfer.png',
      processingTime: '1-3 business days',
      requiresVerification: true
    },
    {
      id: 'western_union',
      name: 'Western Union',
      description: 'Pay by Western Union money transfer',
      icon: '/images/payment/western-union.png',
      processingTime: '1-2 business days',
      requiresVerification: true
    }
  ];
  
  res.status(200).json({
    success: true,
    paymentMethods
  });
});

module.exports = {
  initializePayment,
  processMobileMoneyDetails,
  verifyManualPayment,
  adminVerifyPayment,
  expressPayWebhook,
  mobileMoneyWebhook,
  hubtelWebhook,
  checkPaymentStatus,
  getTransactionHistory,
  processRefund,
  getPaymentAnalytics,
  getPaymentMethods
};

