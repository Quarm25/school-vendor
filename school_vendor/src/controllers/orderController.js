const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const { 
  NotFoundError, 
  ValidationError, 
  DatabaseError,
  PaymentError,
  catchAsync 
} = require('../middleware/error');

/**
 * @desc   Create a new order
 * @route  POST /api/orders
 * @access Private
 */
const createOrder = catchAsync(async (req, res) => {
  const { items, shipping, billingAddress, notes, paymentMethod } = req.body;
  
  // Verify items and check stock
  const orderItems = [];
  let subtotal = 0;
  let hasDigitalItems = false;
  let hasPhysicalItems = false;
  
  // Validate all products and check stock
  for (const item of items) {
    const product = await Product.findById(item.product);
    
    if (!product) {
      throw new NotFoundError(`Product with ID ${item.product} not found`);
    }
    
    // Check if product is active and published
    if (!product.isPublished || product.status !== 'active') {
      throw new ValidationError(`Product ${product.name} is not available for purchase`);
    }
    
    // Check stock for physical products
    if (product.productType !== 'digital') {
      if (product.stock < item.quantity) {
        throw new ValidationError(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
      }
      hasPhysicalItems = true;
    }
    
    if (product.productType === 'digital' || product.productType === 'both') {
      hasDigitalItems = true;
    }
    
    // Calculate price (consider sale price if applicable)
    const price = product.saleActive && product.salePrice ? product.salePrice : product.price;
    
    // Add to order items
    orderItems.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      price,
      quantity: item.quantity,
      productType: product.productType,
      productSnapshot: {
        name: product.name,
        price,
        description: product.shortDescription || product.description.substring(0, 100),
        image: product.images && product.images.length > 0 ? product.images[0].url : null
      },
      // For digital products, initialize delivery status
      digitalDelivery: product.productType === 'digital' || product.productType === 'both' ? {
        deliveryStatus: 'pending',
        downloadLimit: product.digitalDetails?.downloadLimit || 0,
        accessExpiration: product.digitalDetails?.accessDuration ? 
          new Date(Date.now() + product.digitalDetails.accessDuration * 24 * 60 * 60 * 1000) : null
      } : undefined
    });
    
    // Add to subtotal
    subtotal += price * item.quantity;
  }
  
  // Calculate shipping cost (simplified, would typically use a shipping service)
  const shippingAmount = hasPhysicalItems ? calculateShippingCost(shipping.shippingMethod, orderItems) : 0;
  
  // Calculate tax (simplified, would typically use tax service)
  const taxRate = 0.05; // 5% tax
  const taxAmount = subtotal * taxRate;
  
  // Calculate total
  const totalAmount = subtotal + shippingAmount + taxAmount;
  
  // Generate a unique order number
  const orderNumber = await Order.generateOrderNumber();
  
  // Create order
  const order = await Order.create({
    orderNumber,
    user: req.user._id,
    customerInfo: {
      name: `${req.user.firstName} ${req.user.lastName}`,
      email: req.user.email,
      phone: shipping.contactPhone,
      studentId: req.user.studentId
    },
    items: orderItems,
    itemsCount: orderItems.length,
    hasDigitalItems,
    hasPhysicalItems,
    subtotal,
    taxAmount,
    taxRate,
    shippingAmount,
    totalAmount,
    status: 'pending',
    shipping: hasPhysicalItems ? shipping : undefined,
    billingAddress,
    payment: {
      method: paymentMethod,
      amount: totalAmount,
      status: 'pending'
    },
    notes,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    statusHistory: [{
      status: 'pending',
      timestamp: Date.now(),
      note: 'Order created'
    }]
  });
  
  // If order has physical items, reserve the stock
  if (hasPhysicalItems) {
    try {
      await reserveStock(orderItems);
    } catch (error) {
      // If stock reservation fails, mark order as failed
      await order.updateStatus('cancelled', 'Failed to reserve stock', null);
      throw new ValidationError(error.message);
    }
  }
  
  // Return the new order
  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      status: order.status,
      paymentMethod: order.payment.method
    },
    paymentDetails: {
      amount: order.totalAmount,
      currency: order.currency,
      paymentMethod: order.payment.method
    }
  });
});

/**
 * Helper function to calculate shipping cost
 * @param {String} shippingMethod - Shipping method (standard, express, pickup)
 * @param {Array} items - Order items
 * @returns {Number} Shipping cost
 */
const calculateShippingCost = (shippingMethod, items) => {
  // This is a simplified shipping cost calculator
  // In a real application, this would use shipping APIs, weight, dimensions, etc.
  switch (shippingMethod) {
    case 'express':
      return 50; // Higher cost for express
    case 'pickup':
      return 0; // No cost for pickup
    case 'standard':
    default:
      return 25; // Standard shipping cost
  }
};

/**
 * Helper function to reserve stock for order items
 * @param {Array} items - Order items
 */
const reserveStock = async (items) => {
  for (const item of items) {
    if (item.productType !== 'digital') {
      const product = await Product.findById(item.product);
      
      if (!product) {
        throw new NotFoundError(`Product with ID ${item.product} not found`);
      }
      
      if (product.stock < item.quantity) {
        throw new ValidationError(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
      }
      
      // Update stock
      await product.updateStock(
        item.quantity,
        'remove',
        `Reserved for order`,
        null
      );
    }
  }
};

/**
 * @desc   Get all orders for current user
 * @route  GET /api/orders
 * @access Private
 */
const getUserOrders = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Get orders for current user
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Order.countDocuments({ user: req.user._id });
  
  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    orders
  });
});

/**
 * @desc   Get order by ID
 * @route  GET /api/orders/:id
 * @access Private
 */
const getOrderById = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order belongs to current user or user is admin
  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to access this order');
  }
  
  res.status(200).json({
    success: true,
    order
  });
});

/**
 * @desc   Update order status
 * @route  PUT /api/orders/:id/status
 * @access Admin
 */
const updateOrderStatus = catchAsync(async (req, res) => {
  const { status, note } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Validate status transition
  validateStatusTransition(order.status, status);
  
  // Update order status
  await order.updateStatus(status, note, req.user._id);
  
  // Handle post-status-change actions
  await handleStatusChangeActions(order, status);
  
  res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusHistory: order.statusHistory
    }
  });
});

/**
 * Helper function to validate status transitions
 * @param {String} currentStatus - Current order status
 * @param {String} newStatus - New order status
 */
const validateStatusTransition = (currentStatus, newStatus) => {
  // Define allowed status transitions
  const allowedTransitions = {
    'pending': ['processing', 'payment_pending', 'cancelled'],
    'processing': ['ready_for_shipping', 'shipped', 'completed', 'cancelled'],
    'payment_pending': ['paid', 'payment_failed', 'cancelled'],
    'payment_failed': ['payment_pending', 'cancelled'],
    'paid': ['processing', 'ready_for_shipping', 'completed', 'refunded'],
    'ready_for_shipping': ['shipped', 'cancelled'],
    'shipped': ['delivered', 'cancelled'],
    'delivered': ['completed', 'refunded'],
    'completed': ['refunded'],
    'cancelled': [],
    'refunded': []
  };
  
  if (!allowedTransitions[currentStatus].includes(newStatus)) {
    throw new ValidationError(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }
};

/**
 * Helper function to handle actions after status change
 * @param {Object} order - Order object
 * @param {String} status - New status
 */
const handleStatusChangeActions = async (order, status) => {
  // Handle specific status change actions
  switch (status) {
    case 'paid':
      // Update payment status
      order.payment.status = 'completed';
      order.payment.paymentDate = Date.now();
      
      // For digital-only orders, mark as completed
      if (order.hasDigitalItems && !order.hasPhysicalItems) {
        await order.updateStatus('completed', 'Digital order fulfilled automatically', null);
        
        // Create download links for digital items
        await generateDigitalDownloadLinks(order);
      }
      break;
      
    case 'cancelled':
      // If order had physical items and was not already 'completed', restore stock
      if (order.hasPhysicalItems && order.status !== 'completed') {
        await restoreStock(order.items);
      }
      break;
      
    case 'refunded':
      // Update payment status
      order.payment.status = 'refunded';
      break;
      
    case 'completed':
      order.completedAt = Date.now();
      break;
  }
  
  await order.save();
};

/**
 * Helper function to generate download links for digital items
 * @param {Object} order - Order object
 */
const generateDigitalDownloadLinks = async (order) => {
  for (const item of order.items) {
    if (item.productType === 'digital' || item.productType === 'both') {
      // Get product to get file URL
      const product = await Product.findById(item.product);
      
      if (product && product.digitalDetails && product.digitalDetails.fileUrl) {
        // Generate secure download link (typically with token, expiry, etc.)
        const downloadLink = generateSecureDownloadLink(
          product.digitalDetails.fileUrl,
          order._id,
          item.product
        );
        
        // Update item with download link
        item.digitalDelivery.downloadLink = downloadLink;
        item.digitalDelivery.deliveryStatus = 'delivered';
      }
    }
  }
  
  await order.save();
};

/**
 * Helper function to generate secure download link
 * @param {String} fileUrl - Original file URL
 * @param {String} orderId - Order ID
 * @param {String} productId - Product ID
 * @returns {String} Secure download link
 */
const generateSecureDownloadLink = (fileUrl, orderId, productId) => {
  // In a real application, this would generate a secure, time-limited link
  // For simplicity, we're just appending tokens to the URL
  return `${process.env.API_URL}/api/downloads/${orderId}/${productId}`;
};

/**
 * Helper function to restore stock for cancelled orders
 * @param {Array} items - Order items
 */
const restoreStock = async (items) => {
  for (const item of items) {
    if (item.productType !== 'digital') {
      const product = await Product.findById(item.product);
      
      if (product) {
        // Add stock back
        await product.updateStock(
          item.quantity,
          'add',
          'Restored from cancelled order',
          null
        );
      }
    }
  }
};

/**
 * @desc   Add tracking information to order
 * @route  PUT /api/orders/:id/tracking
 * @access Admin
 */
const addTrackingInfo = catchAsync(async (req, res) => {
  const { trackingNumber, carrier, estimatedDelivery } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  if (!order.hasPhysicalItems) {
    throw new ValidationError('Cannot add tracking to an order without physical items');
  }
  
  // Add tracking information
  await order.addTracking(trackingNumber, carrier, estimatedDelivery);
  
  // If order is in 'ready_for_shipping' status, update to 'shipped'
  if (order.status === 'ready_for_shipping') {
    await order.updateStatus('shipped', 'Order shipped with tracking information', req.user._id);
  }
  
  res.status(200).json({
    success: true,
    message: 'Tracking information added successfully',
    tracking: {
      trackingNumber: order.shipping.trackingNumber,
      carrier: order.shipping.carrier,
      estimatedDelivery: order.shipping.estimatedDelivery
    }
  });
});

/**
 * @desc   Process payment for an order
 * @route  POST /api/orders/:id/payment
 * @access Private
 */
const processPayment = catchAsync(async (req, res) => {
  const { paymentMethod, paymentDetails } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order belongs to current user
  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to process payment for this order');
  }
  
  // Check if order is in a payment-ready state
  if (!['pending', 'payment_pending', 'payment_failed'].includes(order.status)) {
    throw new ValidationError(`Cannot process payment for order in ${order.status} status`);
  }
  
  // Update payment method if specified
  if (paymentMethod && paymentMethod !== order.payment.method) {
    order.payment.method = paymentMethod;
  }
  
  // Set order to payment_pending
  await order.updateStatus('payment_pending', 'Payment processing initiated', req.user._id);
  
  try {
    // Generate a unique transaction ID
    const transactionId = Transaction.generateTransactionId(order.payment.method);
    
    // Create transaction record
    const transaction = await Transaction.create({
      transactionId,
      order: order._id,
      user: req.user._id,
      amount: order.totalAmount,
      currency: order.currency,
      paymentMethod: order.payment.method,
      status: 'initiated',
      paymentReference: `ORD-${order.orderNumber}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour expiry
      statusHistory: [{
        status: 'initiated',
        timestamp: Date.now(),
        note: 'Payment processing initiated'
      }]
    });
    
    // Store transaction ID in order
    order.payment.transactionId = transactionId;
    await order.save();
    
    // Return payment information
    res.status(200).json({
      success: true,
      message: 'Payment processing initiated',
      transactionId,
      paymentDetails: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: order.totalAmount,
        currency: order.currency,
        paymentMethod: order.payment.method
      },
      redirectUrl: getPaymentRedirectUrl(order.payment.method, transactionId)
    });
  } catch (error) {
    // If transaction creation fails, revert order status
    await order.updateStatus('payment_failed', 'Payment processing failed', null);
    throw new PaymentError('Failed to initiate payment processing');
  }
});

/**
 * Helper function to get payment redirect URL
 * @param {String} paymentMethod - Payment method
 * @param {String} transactionId - Transaction ID
 * @returns {String} Redirect URL
 */
const getPaymentRedirectUrl = (paymentMethod, transactionId) => {
  const baseUrl = `${process.env.FRONTEND_URL}/payment`;
  
  switch (paymentMethod) {
    case 'expresspay':
      return `${baseUrl}/expresspay/${transactionId}`;
    case 'mobile_money':
      return `${baseUrl}/mobile-money/${transactionId}`;
    case 'hubtel':
      return `${baseUrl}/hubtel/${transactionId}`;
    case 'bank_transfer':
      return `${baseUrl}/bank-transfer/${transactionId}`;
    case 'western_union':
      return `${baseUrl}/western-union/${transactionId}`;
    default:
      return `${baseUrl}/${transactionId}`;
  }
};

/**
 * @desc   Verify payment
 * @route  POST /api/orders/:id/verify-payment
 * @access Private
 */
const verifyPayment = catchAsync(async (req, res) => {
  const { paymentReference, transactionId, receiptNumber } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order belongs to current user or user is admin
  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to verify payment for this order');
  }
  
  // Find transaction
  const transaction = await Transaction.findOne({
    order: order._id,
    transactionId: order.payment.transactionId || transactionId
  });
  
  if (!transaction) {
    throw new NotFoundError('Transaction record not found');
  }
  
  // For methods requiring manual verification (bank transfer, western union)
  if (['bank_transfer', 'western_union'].includes(order.payment.method)) {
    // Update transaction with verification details
    await transaction.verifyTransaction('manual', {
      verifiedBy: req.user._id,
      paymentReference,
      receiptNumber,
      verificationNote: 'Manually verified payment'
    }, req.user._id);
    
    // Update order status to paid
    await order.updateStatus('paid', 'Payment verified manually', req.user._id);
  } else {
    // For other methods, we would typically verify through the payment gateway
    // This is a simplified version
    transaction.paymentReference = paymentReference;
    transaction.status = 'completed';
    await transaction.save();
    
    // Update order status
    await order.updateStatus('paid', 'Payment verified', req.user._id);
  }
  
  // Handle post-payment actions
  await handleStatusChangeActions(order, 'paid');
  
  res.status(200).json({
    success: true,
    message: 'Payment verified successfully',
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status
    }
  });
});

/**
 * @desc   Cancel an order
 * @route  PUT /api/orders/:id/cancel
 * @access Private
 */
const cancelOrder = catchAsync(async (req, res) => {
  const { reason } = req.body;
  
  if (!reason) {
    throw new ValidationError('Cancellation reason is required');
  }
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order belongs to current user or user is admin
  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ValidationError('Not authorized to cancel this order');
  }
  
  // Check if order can be cancelled
  const cancellableStatuses = [
    'pending', 
    'payment_pending', 
    'payment_failed', 
    'processing',
    'ready_for_shipping'
  ];
  
  if (!cancellableStatuses.includes(order.status)) {
    throw new ValidationError(`Cannot cancel order in ${order.status} status`);
  }
  
  // Update order status to cancelled
  await order.updateStatus('cancelled', reason, req.user._id);
  
  // Handle post-cancellation actions (like restoring stock)
  await handleStatusChangeActions(order, 'cancelled');
  
  res.status(200).json({
    success: true,
    message: 'Order cancelled successfully',
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status
    }
  });
});

/**
 * @desc   Download digital product
 * @route  GET /api/orders/:orderId/download/:itemId
 * @access Private
 */
const downloadDigitalProduct = catchAsync(async (req, res) => {
  const { orderId, itemId } = req.params;
  
  const order = await Order.findById(orderId);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order belongs to current user
  if (order.user.toString() !== req.user._id.toString()) {
    throw new ValidationError('Not authorized to access this order');
  }
  
  // Check if order is completed
  if (order.status !== 'completed' && order.status !== 'delivered') {
    throw new ValidationError('Order is not completed yet');
  }
  
  // Find the item in the order
  const item = order.items.find(i => i.product.toString() === itemId);
  
  if (!item) {
    throw new NotFoundError('Product not found in this order');
  }
  
  // Check if item is digital
  if (item.productType !== 'digital' && item.productType !== 'both') {
    throw new ValidationError('This product is not a digital item');
  }
  
  // Check if digital delivery is available
  if (!item.digitalDelivery || !item.digitalDelivery.downloadLink) {
    throw new ValidationError('Digital content is not available for download');
  }
  
  // Check download limits if applicable
  if (item.digitalDelivery.downloadLimit > 0 && 
      item.digitalDelivery.downloadCount >= item.digitalDelivery.downloadLimit) {
    throw new ValidationError('Download limit reached for this product');
  }
  
  // Check expiration if applicable
  if (item.digitalDelivery.accessExpiration && 
      new Date() > new Date(item.digitalDelivery.accessExpiration)) {
    throw new ValidationError('Access to this product has expired');
  }
  
  // Increment download count
  item.digitalDelivery.downloadCount += 1;
  await order.save();
  
  // In a real application, we would fetch the file and serve it
  // or redirect to a secure, time-limited URL
  
  // For this example, we'll redirect to the "file URL"
  const product = await Product.findById(itemId);
  if (!product || !product.digitalDetails || !product.digitalDetails.fileUrl) {
    throw new NotFoundError('Digital product file not found');
  }
  
  res.redirect(product.digitalDetails.fileUrl);
});

/**
 * @desc   Process refund for an order
 * @route  POST /api/orders/:id/refund
 * @access Admin
 */
const processRefund = catchAsync(async (req, res) => {
  const { amount, reason } = req.body;
  
  if (!amount || !reason) {
    throw new ValidationError('Refund amount and reason are required');
  }
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  
  // Check if order can be refunded
  const refundableStatuses = ['paid', 'completed', 'delivered'];
  
  if (!refundableStatuses.includes(order.status)) {
    throw new ValidationError(`Cannot refund order in ${order.status} status`);
  }
  
  // Validate refund amount
  if (parseFloat(amount) > order.totalAmount) {
    throw new ValidationError('Refund amount cannot exceed order total');
  }
  
  // Find transaction
  const transaction = await Transaction.findOne({
    order: order._id,
    transactionId: order.payment.transactionId
  });
  
  if (!transaction) {
    throw new NotFoundError('Transaction record not found');
  }
  
  try {
    // Process refund (in a real app, this would call payment provider's API)
    await transaction.addRefund(parseFloat(amount), reason, req.user._id);
    
    // Update order status if fully refunded
    if (parseFloat(amount) >= order.totalAmount) {
      await order.updateStatus('refunded', reason, req.user._id);
    }
    
    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        refundAmount: amount
      }
    });
  } catch (error) {
    throw new PaymentError('Failed to process refund: ' + error.message);
  }
});

/**
 * @desc   Get all orders (admin)
 * @route  GET /api/admin/orders
 * @access Admin
 */
const getAllOrders = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Extract query parameters for filtering
  const { 
    status, 
    paymentMethod, 
    minAmount, 
    maxAmount, 
    startDate, 
    endDate,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;
  
  // Build query
  const query = {};
  
  // Filter by status if provided
  if (status) {
    query.status = status;
  }
  
  // Filter by payment method if provided
  if (paymentMethod) {
    query['payment.method'] = paymentMethod;
  }
  
  // Filter by amount range if provided
  if (minAmount !== undefined || maxAmount !== undefined) {
    query.totalAmount = {};
    if (minAmount !== undefined) {
      query.totalAmount.$gte = parseFloat(minAmount);
    }
    if (maxAmount !== undefined) {
      query.totalAmount.$lte = parseFloat(maxAmount);
    }
  }
  
  // Filter by date range if provided
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      // Set endDate to end of day
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      query.createdAt.$lte = endOfDay;
    }
  }
  
  // Search by order number or customer info
  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { 'customerInfo.name': { $regex: search, $options: 'i' } },
      { 'customerInfo.email': { $regex: search, $options: 'i' } },
      { 'customerInfo.phone': { $regex: search, $options: 'i' } },
      { 'customerInfo.studentId': { $regex: search, $options: 'i' } }
    ];
  }
  
  // Determine sort direction
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  
  // Build sort object
  const sort = {};
  sort[sortBy] = sortDirection;
  
  // Execute query with pagination
  const orders = await Order.find(query)
    .populate('user', 'firstName lastName email')
    .sort(sort)
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Order.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: orders.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    orders
  });
});

/**
 * @desc   Get order analytics
 * @route  GET /api/admin/orders/analytics
 * @access Admin
 */
const getOrderAnalytics = catchAsync(async (req, res) => {
  // Extract query parameters for date range
  const { startDate, endDate, groupBy = 'day' } = req.query;
  
  // Set default date range to last 30 days if not provided
  const endDateObj = endDate ? new Date(endDate) : new Date();
  endDateObj.setHours(23, 59, 59, 999); // End of day
  
  const startDateObj = startDate 
    ? new Date(startDate) 
    : new Date(endDateObj.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  startDateObj.setHours(0, 0, 0, 0); // Start of day
  
  // Basic analytics - total orders, total revenue, average order value
  const basicAnalytics = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: { $nin: ['cancelled', 'refunded'] }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        avgOrderValue: { $avg: '$totalAmount' }
      }
    }
  ]);
  
  // Status distribution
  const ordersByStatus = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  // Payment method distribution
  const ordersByPaymentMethod = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: { $nin: ['cancelled', 'refunded'] }
      }
    },
    {
      $group: {
        _id: '$payment.method',
        count: { $sum: 1 },
        revenue: { $sum: '$totalAmount' }
      }
    },
    {
      $sort: { revenue: -1 }
    }
  ]);
  
  // Orders over time (grouped by day, week, or month)
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
  
  const ordersOverTime = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: { $nin: ['cancelled', 'refunded'] }
      }
    },
    {
      $group: {
        _id: timeGrouping,
        orders: { $sum: 1 },
        revenue: { $sum: '$totalAmount' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
  
  // Digital vs physical orders
  const productTypeDistribution = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDateObj, $lte: endDateObj },
        status: { $nin: ['cancelled', 'refunded'] }
      }
    },
    {
      $group: {
        _id: {
          hasDigitalItems: '$hasDigitalItems',
          hasPhysicalItems: '$hasPhysicalItems'
        },
        count: { $sum: 1 },
        revenue: { $sum: '$totalAmount' }
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
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0
    },
    ordersByStatus,
    ordersByPaymentMethod,
    ordersOverTime,
    productTypeDistribution
  });
});

/**
 * @desc   Export orders as CSV
 * @route  GET /api/admin/orders/export
 * @access Admin
 */
const exportOrders = catchAsync(async (req, res) => {
  // Extract query parameters for filtering
  const { 
    status, 
    startDate, 
    endDate 
  } = req.query;
  
  // Build query
  const query = {};
  
  // Filter by status if provided
  if (status) {
    query.status = status;
  }
  
  // Filter by date range if provided
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      // Set endDate to end of day
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      query.createdAt.$lte = endOfDay;
    }
  }
  
  // Execute query (no pagination for export)
  const orders = await Order.find(query)
    .populate('user', 'firstName lastName email')
    .sort({ createdAt: -1 });
  
  // Transform orders to CSV format
  // This is a simplified version - a real implementation would use a CSV library
  const csvHeader = 'Order Number,Date,Customer,Email,Status,Payment Method,Items,Subtotal,Shipping,Tax,Total,Currency\n';
  
  const csvRows = orders.map(order => {
    const date = new Date(order.createdAt).toISOString().split('T')[0];
    const customer = order.customerInfo.name;
    const email = order.customerInfo.email;
    const items = order.itemsCount;
    
    return `${order.orderNumber},${date},"${customer}","${email}","${order.status}","${order.payment.method}",${items},${order.subtotal},${order.shippingAmount},${order.taxAmount},${order.totalAmount},${order.currency}`;
  }).join('\n');
  
  const csv = csvHeader + csvRows;
  
  // Set response headers for file download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=orders-${new Date().toISOString().split('T')[0]}.csv`);
  
  res.status(200).send(csv);
});

/**
 * @desc   Bulk update order status
 * @route  PUT /api/admin/orders/bulk/status
 * @access Admin
 */
const bulkUpdateOrderStatus = catchAsync(async (req, res) => {
  const { orderIds, status, note } = req.body;
  
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    throw new ValidationError('Order IDs are required');
  }
  
  // Validate status
  const validStatuses = [
    'pending', 'processing', 'payment_pending', 'paid', 
    'ready_for_shipping', 'shipped', 'delivered', 'completed'
  ];
  
  if (!validStatuses.includes(status)) {
    throw new ValidationError('Invalid status');
  }
  
  // Get orders
  const orders = await Order.find({ _id: { $in: orderIds } });
  
  if (orders.length === 0) {
    throw new NotFoundError('No orders found with the provided IDs');
  }
  
  // Track success and failures
  const results = {
    success: [],
    failure: []
  };
  
  // Update each order
  for (const order of orders) {
    try {
      // Validate status transition
      validateStatusTransition(order.status, status);
      
      // Update order status
      await order.updateStatus(status, note || `Bulk update to ${status}`, req.user._id);
      
      // Handle post-status-change actions
      await handleStatusChangeActions(order, status);
      
      results.success.push({
        id: order._id,
        orderNumber: order.orderNumber,
        newStatus: status
      });
    } catch (error) {
      results.failure.push({
        id: order._id,
        orderNumber: order.orderNumber,
        currentStatus: order.status,
        error: error.message
      });
    }
  }
  
  res.status(200).json({
    success: true,
    message: `Updated ${results.success.length} orders to status ${status}. ${results.failure.length} orders failed.`,
    successCount: results.success.length,
    failureCount: results.failure.length,
    results
  });
});

/**
 * @desc   Get order count by status
 * @route  GET /api/admin/orders/count
 * @access Admin
 */
const getOrderCountByStatus = catchAsync(async (req, res) => {
  const counts = await Order.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  // Transform to object format
  const statusCounts = {};
  counts.forEach(item => {
    statusCounts[item._id] = item.count;
  });
  
  // Get total
  const total = await Order.countDocuments();
  
  res.status(200).json({
    success: true,
    counts: statusCounts,
    total
  });
});

module.exports = {
  createOrder,
  getUserOrders,
  getOrderById,
  updateOrderStatus,
  addTrackingInfo,
  processPayment,
  verifyPayment,
  cancelOrder,
  downloadDigitalProduct,
  processRefund,
  getAllOrders,
  getOrderAnalytics,
  exportOrders,
  bulkUpdateOrderStatus,
  getOrderCountByStatus
};

