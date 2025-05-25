const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/admin/dashboard
 * @access  Admin
 */
exports.getDashboardStats = catchAsync(async (req, res) => {
  // Get total sales amount from transactions
  const totalSales = await Transaction.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  // Get total number of orders
  const totalOrders = await Order.countDocuments();
  
  // Get active users (users who have placed orders in the last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const activeUsers = await Order.aggregate([
    { $match: { createdAt: { $gte: thirtyDaysAgo } } },
    { $group: { _id: '$user' } },
    { $count: 'activeUserCount' }
  ]);

  // Get low stock items
  const lowStockItems = await Product.countDocuments({ 
    productType: 'physical',
    quantity: { $lte: 10 } 
  });

  // Get recent orders (last 10)
  const recentOrders = await Order.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('user', 'firstName lastName email')
    .populate('items.product', 'name price');

  // Get sales by category
  const salesByCategory = await Order.aggregate([
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'productDetails'
      }
    },
    { $unwind: '$productDetails' },
    {
      $lookup: {
        from: 'categories',
        localField: 'productDetails.category',
        foreignField: '_id',
        as: 'categoryDetails'
      }
    },
    { $unwind: '$categoryDetails' },
    {
      $group: {
        _id: '$categoryDetails.name',
        totalSales: { $sum: { $multiply: ['$items.quantity', '$productDetails.price'] } }
      }
    },
    { $project: { category: '$_id', totalSales: 1, _id: 0 } }
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      totalSales: totalSales.length > 0 ? totalSales[0].total : 0,
      totalOrders,
      activeUsers: activeUsers.length > 0 ? activeUsers[0].activeUserCount : 0,
      lowStockItems,
      recentOrders,
      salesByCategory
    }
  });
});

// =========================
// INVENTORY MANAGEMENT
// =========================

/**
 * @desc    Add a new product
 * @route   POST /api/admin/products
 * @access  Admin
 */
exports.createProduct = catchAsync(async (req, res) => {
  const newProduct = await Product.create(req.body);

  res.status(201).json({
    status: 'success',
    data: {
      product: newProduct
    }
  });
});

/**
 * @desc    Update a product
 * @route   PUT /api/admin/products/:id
 * @access  Admin
 */
exports.updateProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });

  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      product
    }
  });
});

/**
 * @desc    Delete a product
 * @route   DELETE /api/admin/products/:id
 * @access  Admin
 */
exports.deleteProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    return next(new AppError('No product found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: null
  });
});

/**
 * @desc    Get products with low stock
 * @route   GET /api/admin/products/low-stock
 * @access  Admin
 */
exports.getLowStockProducts = catchAsync(async (req, res) => {
  const lowStockThreshold = req.query.threshold || 10;

  const products = await Product.find({ 
    productType: 'physical',
    quantity: { $lte: lowStockThreshold } 
  }).populate('category', 'name');

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products
    }
  });
});

// =========================
// USER MANAGEMENT
// =========================

/**
 * @desc    Get all users
 * @route   GET /api/admin/users
 * @access  Admin
 */
exports.getAllUsers = catchAsync(async (req, res) => {
  const users = await User.find()
    .select('-password -passwordResetToken -passwordResetExpires');

  res.status(200).json({
    status: 'success',
    results: users.length,
    data: {
      users
    }
  });
});

/**
 * @desc    Get user by ID
 * @route   GET /api/admin/users/:id
 * @access  Admin
 */
exports.getUserById = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .select('-password -passwordResetToken -passwordResetExpires');

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

/**
 * @desc    Update user
 * @route   PUT /api/admin/users/:id
 * @access  Admin
 */
exports.updateUser = catchAsync(async (req, res, next) => {
  // Prevent password updates through this route
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /updatePassword.',
        400
      )
    );
  }

  const user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  }).select('-password -passwordResetToken -passwordResetExpires');

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

/**
 * @desc    Delete user
 * @route   DELETE /api/admin/users/:id
 * @access  Admin
 */
exports.deleteUser = catchAsync(async (req, res, next) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: null
  });
});

// =========================
// ORDER MANAGEMENT
// =========================

/**
 * @desc    Get all orders
 * @route   GET /api/admin/orders
 * @access  Admin
 */
exports.getAllOrders = catchAsync(async (req, res) => {
  const orders = await Order.find()
    .populate('user', 'firstName lastName email')
    .populate('items.product', 'name price imageUrl');

  res.status(200).json({
    status: 'success',
    results: orders.length,
    data: {
      orders
    }
  });
});

/**
 * @desc    Update order status
 * @route   PUT /api/admin/orders/:id/status
 * @access  Admin
 */
exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;

  if (!status) {
    return next(new AppError('Status is required', 400));
  }

  // Validate status value
  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return next(new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400));
  }

  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true, runValidators: true }
  ).populate('user', 'firstName lastName email');

  if (!order) {
    return next(new AppError('No order found with that ID', 404));
  }

  // If order was delivered, update the transaction status
  if (status === 'delivered') {
    await Transaction.findOneAndUpdate(
      { orderId: order._id },
      { status: 'completed' }
    );
  }

  // If order was cancelled and there's a transaction, mark it as refunded
  if (status === 'cancelled') {
    await Transaction.findOneAndUpdate(
      { orderId: order._id },
      { status: 'refunded' }
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      order
    }
  });
});

