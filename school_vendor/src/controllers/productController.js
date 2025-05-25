const Product = require('../models/Product');
const Category = require('../models/Category');
const { 
  NotFoundError, 
  ValidationError, 
  DatabaseError,
  catchAsync 
} = require('../middleware/error');

/**
 * @desc   Create a new product
 * @route  POST /api/products
 * @access Admin
 */
const createProduct = catchAsync(async (req, res) => {
  // Add the current user as creator
  req.body.createdBy = req.user._id;
  
  // Validate category exists
  const category = await Category.findById(req.body.category);
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Generate SKU if not provided
  if (!req.body.sku) {
    req.body.sku = generateSKU(req.body.name, req.body.productType);
  }
  
  // Create product
  const product = await Product.create(req.body);
  
  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    product
  });
});

/**
 * @desc   Get all products with filtering and pagination
 * @route  GET /api/products
 * @access Public
 */
const getProducts = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Extract query parameters for filtering
  const { 
    category, 
    subcategory, 
    minPrice, 
    maxPrice, 
    productType,
    search,
    tags,
    status,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;
  
  // Build query
  const query = {};
  
  // Only show active and published products for non-admin users
  if (!req.user || req.user.role !== 'admin') {
    query.isPublished = true;
    query.status = 'active';
  } else if (status) {
    query.status = status;
  }
  
  // Filter by category if provided
  if (category) {
    query.category = category;
  }
  
  // Filter by subcategory if provided
  if (subcategory) {
    query.subcategory = subcategory;
  }
  
  // Filter by product type if provided
  if (productType) {
    query.productType = productType;
  }
  
  // Filter by price range if provided
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.price = {};
    if (minPrice !== undefined) {
      query.price.$gte = parseFloat(minPrice);
    }
    if (maxPrice !== undefined) {
      query.price.$lte = parseFloat(maxPrice);
    }
  }
  
  // Filter by tags if provided
  if (tags) {
    const tagArray = tags.split(',').map(tag => tag.trim());
    query.tags = { $in: tagArray };
  }
  
  // Search by name, description or tags
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } }
    ];
  }
  
  // Determine sort direction
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  
  // Build sort object
  const sort = {};
  sort[sortBy] = sortDirection;
  
  // Execute query with pagination
  const products = await Product.find(query)
    .populate('category', 'name slug')
    .populate('subcategory', 'name slug')
    .populate('createdBy', 'firstName lastName')
    .sort(sort)
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Product.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: products.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    products
  });
});

/**
 * @desc   Get a single product by ID
 * @route  GET /api/products/:id
 * @access Public
 */
const getProductById = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('category', 'name slug')
    .populate('subcategory', 'name slug')
    .populate('createdBy', 'firstName lastName');
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  // For non-admin users, only show active and published products
  if ((!req.user || req.user.role !== 'admin') && 
      (!product.isPublished || product.status !== 'active')) {
    throw new NotFoundError('Product not found');
  }
  
  res.status(200).json({
    success: true,
    product
  });
});

/**
 * @desc   Update a product
 * @route  PUT /api/products/:id
 * @access Admin
 */
const updateProduct = catchAsync(async (req, res) => {
  // Add updatedBy field
  req.body.updatedBy = req.user._id;
  
  // If category is being updated, validate it exists
  if (req.body.category) {
    const category = await Category.findById(req.body.category);
    if (!category) {
      throw new NotFoundError('Category not found');
    }
  }
  
  // Validate subcategory if provided
  if (req.body.subcategory) {
    const subcategory = await Category.findById(req.body.subcategory);
    if (!subcategory) {
      throw new NotFoundError('Subcategory not found');
    }
  }
  
  // Find product and update
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  ).populate('category', 'name slug')
   .populate('subcategory', 'name slug');
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  res.status(200).json({
    success: true,
    message: 'Product updated successfully',
    product
  });
});

/**
 * @desc   Delete a product
 * @route  DELETE /api/products/:id
 * @access Admin
 */
const deleteProduct = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id);
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  await product.deleteOne();
  
  res.status(200).json({
    success: true,
    message: 'Product deleted successfully'
  });
});

/**
 * @desc   Update product stock
 * @route  PUT /api/products/:id/stock
 * @access Admin
 */
const updateStock = catchAsync(async (req, res) => {
  const { quantity, action, reason } = req.body;
  
  if (!quantity || !action) {
    throw new ValidationError('Quantity and action are required');
  }
  
  if (!['add', 'remove', 'adjust'].includes(action)) {
    throw new ValidationError('Invalid action. Must be add, remove, or adjust');
  }
  
  const product = await Product.findById(req.params.id);
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  // Check if product is digital
  if (product.productType === 'digital') {
    throw new ValidationError('Cannot update stock for digital products');
  }
  
  try {
    // Call the stock update method defined in the Product model
    await product.updateStock(
      parseInt(quantity), 
      action, 
      reason || `Stock ${action} by ${req.user.firstName} ${req.user.lastName}`, 
      req.user._id
    );
    
    res.status(200).json({
      success: true,
      message: `Stock ${action}ed successfully`,
      currentStock: product.stock,
      isLowStock: product.isLowStock
    });
  } catch (error) {
    throw new DatabaseError(error.message);
  }
});

/**
 * @desc   Get low stock products
 * @route  GET /api/products/low-stock
 * @access Admin
 */
const getLowStockProducts = catchAsync(async (req, res) => {
  const products = await Product.getLowStockProducts()
    .populate('category', 'name slug');
  
  res.status(200).json({
    success: true,
    count: products.length,
    products
  });
});

/**
 * @desc   Get products by category
 * @route  GET /api/products/category/:categoryId
 * @access Public
 */
const getProductsByCategory = catchAsync(async (req, res) => {
  const categoryId = req.params.categoryId;
  
  // Validate category exists
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Get all subcategories to include their products too
  const subcategories = await Category.find({ parent: categoryId });
  const subcategoryIds = subcategories.map(sub => sub._id);
  
  // Include both the category and its subcategories
  const query = {
    $or: [
      { category: categoryId },
      { subcategory: { $in: subcategoryIds } }
    ],
    isPublished: true,
    status: 'active'
  };
  
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Execute query with pagination
  const products = await Product.find(query)
    .populate('category', 'name slug')
    .populate('subcategory', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Product.countDocuments(query);
  
  res.status(200).json({
    success: true,
    category: category.name,
    count: products.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    products
  });
});

/**
 * @desc   Get digital products
 * @route  GET /api/products/type/digital
 * @access Public
 */
const getDigitalProducts = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  const query = {
    productType: { $in: ['digital', 'both'] },
    isPublished: true,
    status: 'active'
  };
  
  // Execute query with pagination
  const products = await Product.find(query)
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Product.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: products.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    products
  });
});

/**
 * @desc   Get physical products
 * @route  GET /api/products/type/physical
 * @access Public
 */
const getPhysicalProducts = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  const query = {
    productType: { $in: ['physical', 'both'] },
    isPublished: true,
    status: 'active'
  };
  
  // Execute query with pagination
  const products = await Product.find(query)
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Product.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: products.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    products
  });
});

/**
 * @desc   Search products
 * @route  GET /api/products/search
 * @access Public
 */
const searchProducts = catchAsync(async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    throw new ValidationError('Search query is required');
  }
  
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Build search query
  const searchQuery = {
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { shortDescription: { $regex: q, $options: 'i' } },
      { tags: { $regex: q, $options: 'i' } }
    ],
    isPublished: true,
    status: 'active'
  };
  
  // Execute query with pagination
  const products = await Product.find(searchQuery)
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Get total count for pagination
  const total = await Product.countDocuments(searchQuery);
  
  res.status(200).json({
    success: true,
    query: q,
    count: products.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    products
  });
});

/**
 * @desc   Get featured products
 * @route  GET /api/products/featured
 * @access Public
 */
const getFeaturedProducts = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit) || 8;
  
  const products = await Product.find({
    isFeatured: true,
    isPublished: true,
    status: 'active'
  })
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .limit(limit);
  
  res.status(200).json({
    success: true,
    count: products.length,
    products
  });
});

/**
 * @desc   Get related products
 * @route  GET /api/products/:id/related
 * @access Public
 */
const getRelatedProducts = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id);
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  const limit = parseInt(req.query.limit) || 4;
  
  // Find products in the same category, excluding the current product
  const relatedProducts = await Product.find({
    _id: { $ne: product._id },
    category: product.category,
    isPublished: true,
    status: 'active'
  })
    .populate('category', 'name slug')
    .limit(limit);
  
  res.status(200).json({
    success: true,
    count: relatedProducts.length,
    products: relatedProducts
  });
});

/**
 * @desc   Update product status
 * @route  PUT /api/products/:id/status
 * @access Admin
 */
const updateProductStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  
  if (!['active', 'draft', 'archived', 'out_of_stock'].includes(status)) {
    throw new ValidationError('Invalid status');
  }
  
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { 
      status,
      updatedBy: req.user._id
    },
    { new: true }
  );
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  res.status(200).json({
    success: true,
    message: `Product status updated to ${status}`,
    product
  });
});

/**
 * @desc   Toggle product featured status
 * @route  PUT /api/products/:id/featured
 * @access Admin
 */
const toggleFeatured = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id);
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  product.isFeatured = !product.isFeatured;
  product.updatedBy = req.user._id;
  
  await product.save();
  
  res.status(200).json({
    success: true,
    message: `Product ${product.isFeatured ? 'marked as featured' : 'removed from featured'}`,
    isFeatured: product.isFeatured
  });
});

/**
 * @desc   Bulk update product status
 * @route  PUT /api/products/bulk/status
 * @access Admin
 */
const bulkUpdateStatus = catchAsync(async (req, res) => {
  const { productIds, status } = req.body;
  
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    throw new ValidationError('Product IDs are required');
  }
  
  if (!['active', 'draft', 'archived', 'out_of_stock'].includes(status)) {
    throw new ValidationError('Invalid status');
  }
  
  const result = await Product.updateMany(
    { _id: { $in: productIds } },
    { 
      status,
      updatedBy: req.user._id
    }
  );
  
  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} products updated to ${status}`,
    modifiedCount: result.modifiedCount
  });
});

/**
 * @desc   Bulk delete products
 * @route  DELETE /api/products/bulk
 * @access Admin
 */
const bulkDeleteProducts = catchAsync(async (req, res) => {
  const { productIds } = req.body;
  
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    throw new ValidationError('Product IDs are required');
  }
  
  const result = await Product.deleteMany({ _id: { $in: productIds } });
  
  res.status(200).json({
    success: true,
    message: `${result.deletedCount} products deleted successfully`,
    deletedCount: result.deletedCount
  });
});

/**
 * Helper function to generate SKU
 * @param {String} name - Product name
 * @param {String} type - Product type
 * @returns {String} Generated SKU
 */
const generateSKU = (name, type) => {
  // Get first 3 letters of product name (uppercase)
  const namePrefix = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 3)
    .toUpperCase();
  
  // Get first letter of product type
  const typePrefix = type.charAt(0).toUpperCase();
  
  // Generate random alphanumeric string (5 characters)
  const randomStr = Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase();
  
  // Current timestamp for uniqueness
  const timestamp = Date.now().toString().substring(9, 13);
  
  // Combine to create SKU
  return `${namePrefix}-${typePrefix}${timestamp}${randomStr}`;
};

/**
 * @desc   Get products stock history
 * @route  GET /api/products/:id/stock-history
 * @access Admin
 */
const getStockHistory = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate({
      path: 'stockHistory.performedBy',
      select: 'firstName lastName email'
    });
  
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  
  if (product.productType === 'digital') {
    throw new ValidationError('Digital products do not have stock history');
  }
  
  res.status(200).json({
    success: true,
    count: product.stockHistory.length,
    product: {
      id: product._id,
      name: product.name,
      sku: product.sku,
      currentStock: product.stock,
      lowStockThreshold: product.lowStockThreshold,
      isLowStock: product.isLowStock
    },
    stockHistory: product.stockHistory.sort((a, b) => b.timestamp - a.timestamp)
  });
});

/**
 * @desc   Import products in bulk (CSV/JSON)
 * @route  POST /api/products/import
 * @access Admin
 */
const importProducts = catchAsync(async (req, res) => {
  // This would typically handle file upload and parsing
  // For simplicity, we'll assume the data is already parsed and in req.body.products
  const { products } = req.body;
  
  if (!products || !Array.isArray(products) || products.length === 0) {
    throw new ValidationError('No products to import');
  }
  
  const createdProducts = [];
  const failedProducts = [];
  
  // Process each product
  for (const productData of products) {
    try {
      // Add createdBy field
      productData.createdBy = req.user._id;
      
      // Generate SKU if not provided
      if (!productData.sku) {
        productData.sku = generateSKU(productData.name, productData.productType);
      }
      
      // Create product
      const product = await Product.create(productData);
      createdProducts.push(product);
    } catch (error) {
      failedProducts.push({
        data: productData,
        error: error.message
      });
    }
  }
  
  res.status(201).json({
    success: true,
    message: `Imported ${createdProducts.length} products successfully. ${failedProducts.length} products failed.`,
    created: createdProducts.length,
    failed: failedProducts.length,
    failedDetails: failedProducts
  });
});

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  updateStock,
  getLowStockProducts,
  getProductsByCategory,
  getDigitalProducts,
  getPhysicalProducts,
  searchProducts,
  getFeaturedProducts,
  getRelatedProducts,
  updateProductStatus,
  toggleFeatured,
  bulkUpdateStatus,
  bulkDeleteProducts,
  getStockHistory,
  importProducts
};

