const Category = require('../models/Category');
const Product = require('../models/Product');
const { 
  NotFoundError, 
  ValidationError, 
  DatabaseError,
  catchAsync 
} = require('../middleware/error');

/**
 * @desc   Create a new category
 * @route  POST /api/categories
 * @access Admin
 */
const createCategory = catchAsync(async (req, res) => {
  // Add the current user as creator
  req.body.createdBy = req.user._id;
  
  // If parent category is provided, validate it exists
  if (req.body.parent) {
    const parentCategory = await Category.findById(req.body.parent);
    if (!parentCategory) {
      throw new NotFoundError('Parent category not found');
    }
    
    // Check for maximum nesting level (defined in model as 5)
    if (parentCategory.level >= 5) {
      throw new ValidationError('Maximum category nesting level reached (5)');
    }
  }
  
  // Create category
  const category = await Category.create(req.body);
  
  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    category
  });
});

/**
 * @desc   Get all categories
 * @route  GET /api/categories
 * @access Public
 */
const getAllCategories = catchAsync(async (req, res) => {
  // Filter params
  const { isActive, featured, search } = req.query;
  
  // Build query
  const query = {};
  
  // Filter by active status if specified
  if (isActive !== undefined) {
    query.isActive = isActive === 'true';
  }
  
  // Filter featured categories
  if (featured === 'true') {
    query.featuredInHomepage = true;
  }
  
  // Search by name or description
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }
  
  // Get categories, sorted by order and name
  const categories = await Category.find(query)
    .populate('parent', 'name slug')
    .sort({ order: 1, name: 1 });
  
  res.status(200).json({
    success: true,
    count: categories.length,
    categories
  });
});

/**
 * @desc   Get category hierarchy (tree structure)
 * @route  GET /api/categories/tree
 * @access Public
 */
const getCategoryTree = catchAsync(async (req, res) => {
  // Only include active categories for public access
  const onlyActive = req.user?.role !== 'admin';
  
  // Get full hierarchical tree
  const categoryTree = await Category.getFullHierarchy();
  
  // Filter inactive categories if needed
  const filteredTree = onlyActive ? filterInactiveCategories(categoryTree) : categoryTree;
  
  res.status(200).json({
    success: true,
    categories: filteredTree
  });
});

/**
 * Helper function to filter inactive categories from tree
 * @param {Array} categories - Category array with children
 * @returns {Array} Filtered category array
 */
const filterInactiveCategories = (categories) => {
  if (!Array.isArray(categories)) return [];
  
  return categories
    .filter(category => category.isActive)
    .map(category => ({
      ...category,
      children: filterInactiveCategories(category.children)
    }));
};

/**
 * @desc   Get category by ID
 * @route  GET /api/categories/:id
 * @access Public
 */
const getCategoryById = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id)
    .populate('parent', 'name slug');
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Check if category is active for non-admin users
  if (!category.isActive && req.user?.role !== 'admin') {
    throw new NotFoundError('Category not found');
  }
  
  res.status(200).json({
    success: true,
    category
  });
});

/**
 * @desc   Get category by slug
 * @route  GET /api/categories/slug/:slug
 * @access Public
 */
const getCategoryBySlug = catchAsync(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug })
    .populate('parent', 'name slug');
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Check if category is active for non-admin users
  if (!category.isActive && req.user?.role !== 'admin') {
    throw new NotFoundError('Category not found');
  }
  
  res.status(200).json({
    success: true,
    category
  });
});

/**
 * @desc   Update category
 * @route  PUT /api/categories/:id
 * @access Admin
 */
const updateCategory = catchAsync(async (req, res) => {
  // Add updatedBy field
  req.body.updatedBy = req.user._id;
  
  // If parent is being updated, validate it exists and check for circular references
  if (req.body.parent) {
    // Check if parent exists
    const parentCategory = await Category.findById(req.body.parent);
    if (!parentCategory) {
      throw new NotFoundError('Parent category not found');
    }
    
    // Prevent setting parent to self
    if (req.body.parent === req.params.id) {
      throw new ValidationError('Category cannot be its own parent');
    }
    
    // Check for circular reference - ensure parent is not a descendant of this category
    const category = await Category.findById(req.params.id);
    if (category && category.ancestors.includes(req.body.parent)) {
      throw new ValidationError('Circular reference detected in category hierarchy');
    }
    
    // Check for maximum nesting level
    if (parentCategory.level >= 5) {
      throw new ValidationError('Maximum category nesting level reached (5)');
    }
  }
  
  // Find and update category
  const category = await Category.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  ).populate('parent', 'name slug');
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  res.status(200).json({
    success: true,
    message: 'Category updated successfully',
    category
  });
});

/**
 * @desc   Delete category
 * @route  DELETE /api/categories/:id
 * @access Admin
 */
const deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Check if category has products
  const hasProducts = await Product.countDocuments({ category: req.params.id });
  if (hasProducts > 0) {
    throw new ValidationError('Cannot delete category with associated products. Move or delete the products first.');
  }
  
  // Check if category has subcategories
  const hasSubcategories = await Category.countDocuments({ parent: req.params.id });
  if (hasSubcategories > 0) {
    throw new ValidationError('Cannot delete category with subcategories. Delete or move the subcategories first.');
  }
  
  await category.deleteOne();
  
  res.status(200).json({
    success: true,
    message: 'Category deleted successfully'
  });
});

/**
 * @desc   Move category to new parent
 * @route  PUT /api/categories/:id/move
 * @access Admin
 */
const moveCategory = catchAsync(async (req, res) => {
  const { newParentId } = req.body;
  
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  try {
    // Use the model's moveToParent method
    const updatedCategory = await category.moveToParent(newParentId);
    
    res.status(200).json({
      success: true,
      message: 'Category moved successfully',
      category: updatedCategory
    });
  } catch (error) {
    throw new ValidationError(error.message);
  }
});

/**
 * @desc   Toggle category active status
 * @route  PUT /api/categories/:id/toggle-status
 * @access Admin
 */
const toggleCategoryStatus = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Toggle active status
  category.isActive = !category.isActive;
  category.updatedBy = req.user._id;
  
  await category.save();
  
  res.status(200).json({
    success: true,
    message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
    isActive: category.isActive
  });
});

/**
 * @desc   Toggle category featured status
 * @route  PUT /api/categories/:id/toggle-featured
 * @access Admin
 */
const toggleCategoryFeatured = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Toggle featured status
  category.featuredInHomepage = !category.featuredInHomepage;
  category.updatedBy = req.user._id;
  
  await category.save();
  
  res.status(200).json({
    success: true,
    message: `Category ${category.featuredInHomepage ? 'added to' : 'removed from'} featured`,
    featuredInHomepage: category.featuredInHomepage
  });
});

/**
 * @desc   Update category order
 * @route  PUT /api/categories/:id/order
 * @access Admin
 */
const updateCategoryOrder = catchAsync(async (req, res) => {
  const { order } = req.body;
  
  if (typeof order !== 'number') {
    throw new ValidationError('Order must be a number');
  }
  
  const category = await Category.findByIdAndUpdate(
    req.params.id,
    { 
      order,
      updatedBy: req.user._id
    },
    { new: true }
  );
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  res.status(200).json({
    success: true,
    message: 'Category order updated successfully',
    order: category.order
  });
});

/**
 * @desc   Get subcategories of a category
 * @route  GET /api/categories/:id/subcategories
 * @access Public
 */
const getSubcategories = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Get direct children
  const subcategories = await category.getChildren();
  
  // Filter inactive categories for non-admin users
  const filteredSubcategories = req.user?.role !== 'admin'
    ? subcategories.filter(cat => cat.isActive)
    : subcategories;
  
  res.status(200).json({
    success: true,
    count: filteredSubcategories.length,
    subcategories: filteredSubcategories
  });
});

/**
 * @desc   Get all descendants of a category
 * @route  GET /api/categories/:id/descendants
 * @access Public
 */
const getCategoryDescendants = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Get all descendants
  const descendants = await category.getAllDescendants();
  
  // Filter inactive categories for non-admin users
  const filteredDescendants = req.user?.role !== 'admin'
    ? descendants.filter(cat => cat.isActive)
    : descendants;
  
  res.status(200).json({
    success: true,
    count: filteredDescendants.length,
    descendants: filteredDescendants
  });
});

/**
 * @desc   Get products in a category (including subcategories)
 * @route  GET /api/categories/:id/products
 * @access Public
 */
const getCategoryProducts = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  
  // Check if category is active for non-admin users
  if (!category.isActive && req.user?.role !== 'admin') {
    throw new NotFoundError('Category not found');
  }
  
  // Get subcategory IDs
  const subcategories = await category.getAllDescendants();
  const subcategoryIds = subcategories.map(sub => sub._id);
  
  // Include current category and all subcategories
  const categoryIds = [category._id, ...subcategoryIds];
  
  // Build query
  const query = { category: { $in: categoryIds } };
  
  // Only show active and published products for non-admin users
  if (!req.user || req.user.role !== 'admin') {
    query.isPublished = true;
    query.status = 'active';
  }
  
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Apply sorting
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = {};
  sort[sortBy] = sortOrder;
  
  // Execute query
  const products = await Product.find(query)
    .sort(sort)
    .skip(skip)
    .limit(limit);
  
  // Get total count
  const total = await Product.countDocuments(query);
  
  res.status(200).json({
    success: true,
    category: {
      _id: category._id,
      name: category.name,
      slug: category.slug
    },
    count: products.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    products
  });
});

/**
 * @desc   Update category product counts
 * @route  POST /api/categories/update-product-counts
 * @access Admin
 */
const updateProductCounts = catchAsync(async (req, res) => {
  // Get all categories
  const categories = await Category.find();
  
  // Update product count for each category
  for (const category of categories) {
    // Count products directly in this category
    const productCount = await Product.countDocuments({ 
      category: category._id,
      isPublished: true,
      status: 'active'
    });
    
    // Update the product count
    category.productCount = productCount;
    await category.save();
  }
  
  res.status(200).json({
    success: true,
    message: 'Category product counts updated successfully'
  });
});

/**
 * @desc   Get featured categories for homepage
 * @route  GET /api/categories/featured
 * @access Public
 */
const getFeaturedCategories = catchAsync(async (req, res) => {
  // Get featured categories
  const featuredCategories = await Category.find({
    featuredInHomepage: true,
    isActive: true
  })
    .sort({ order: 1, name: 1 })
    .limit(10); // Limit to 10 featured categories
  
  // For each category, get some sample products
  const categoriesWithProducts = await Promise.all(
    featuredCategories.map(async (category) => {
      // Get a few active products for this category
      const products = await Product.find({
        category: category._id,
        isPublished: true,
        status: 'active'
      })
        .sort({ createdAt: -1 })
        .limit(4); // Get 4 recent products
      
      return {
        category: {
          _id: category._id,
          name: category.name,
          slug: category.slug,
          image: category.image,
          description: category.description
        },
        products
      };
    })
  );
  
  res.status(200).json({
    success: true,
    count: featuredCategories.length,
    categories: categoriesWithProducts
  });
});

/**
 * @desc   Bulk update category status
 * @route  PUT /api/categories/bulk/status
 * @access Admin
 */
const bulkUpdateCategoryStatus = catchAsync(async (req, res) => {
  const { categoryIds, isActive } = req.body;
  
  if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw new ValidationError('Category IDs are required');
  }
  
  if (typeof isActive !== 'boolean') {
    throw new ValidationError('isActive must be a boolean value');
  }
  
  // Update categories
  const result = await Category.updateMany(
    { _id: { $in: categoryIds } },
    { 
      isActive,
      updatedBy: req.user._id
    }
  );
  
  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} categories updated to ${isActive ? 'active' : 'inactive'}`,
    modifiedCount: result.modifiedCount
  });
});

/**
 * @desc   Bulk delete categories
 * @route  DELETE /api/categories/bulk
 * @access Admin
 */
const bulkDeleteCategories = catchAsync(async (req, res) => {
  const { categoryIds } = req.body;
  
  if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw new ValidationError('Category IDs are required');
  }
  
  // Check if any categories have products or subcategories
  const categoriesWithProducts = [];
  const categoriesWithSubcategories = [];
  
  for (const categoryId of categoryIds) {
    // Check for products
    const productCount = await Product.countDocuments({ category: categoryId });
    if (productCount > 0) {
      const category = await Category.findById(categoryId);
      categoriesWithProducts.push(category ? category.name : categoryId);
    }
    
    // Check for subcategories
    const subcategoryCount = await Category.countDocuments({ parent: categoryId });
    if (subcategoryCount > 0) {
      const category = await Category.findById(categoryId);
      categoriesWithSubcategories.push(category ? category.name : categoryId);
    }
  }
  
  // If categories have products or subcategories, return an error
  if (categoriesWithProducts.length > 0 || categoriesWithSubcategories.length > 0) {
    const errors = [];
    
    if (categoriesWithProducts.length > 0) {
      errors.push(`Categories with products cannot be deleted: ${categoriesWithProducts.join(', ')}`);
    }
    
    if (categoriesWithSubcategories.length > 0) {
      errors.push(`Categories with subcategories cannot be deleted: ${categoriesWithSubcategories.join(', ')}`);
    }
    
    throw new ValidationError(errors.join(' '));
  }
  
  // Delete categories
  const result = await Category.deleteMany({ _id: { $in: categoryIds } });
  
  res.status(200).json({
    success: true,
    message: `${result.deletedCount} categories deleted successfully`,
    deletedCount: result.deletedCount
  });
});

/**
 * @desc   Bulk update category order
 * @route  PUT /api/categories/bulk/order
 * @access Admin
 */
const bulkUpdateCategoryOrder = catchAsync(async (req, res) => {
  const { categoryOrders } = req.body;
  
  if (!categoryOrders || !Array.isArray(categoryOrders) || categoryOrders.length === 0) {
    throw new ValidationError('Category orders are required');
  }
  
  // Validate each category order
  for (const categoryOrder of categoryOrders) {
    if (!categoryOrder.id || typeof categoryOrder.order !== 'number') {
      throw new ValidationError('Each category order must have id and order fields');
    }
  }
  
  // Update each category's order
  const updatePromises = categoryOrders.map(({ id, order }) => 
    Category.findByIdAndUpdate(id, { 
      order,
      updatedBy: req.user._id
    })
  );
  
  await Promise.all(updatePromises);
  
  res.status(200).json({
    success: true,
    message: `${categoryOrders.length} category orders updated successfully`
  });
});

/**
 * @desc   Reorder categories within a parent
 * @route  PUT /api/categories/reorder/:parentId?
 * @access Admin
 */
const reorderCategories = catchAsync(async (req, res) => {
  const { parentId } = req.params;
  const { categoryIds } = req.body;
  
  if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw new ValidationError('Category IDs are required in the correct order');
  }
  
  // Find categories with the same parent
  const query = parentId ? { parent: parentId } : { parent: null };
  const categories = await Category.find(query);
  
  // Validate that all provided category IDs belong to the same parent
  const categoryIdSet = new Set(categories.map(c => c._id.toString()));
  const providedIds = new Set(categoryIds);
  
  // Check if all provided IDs exist in the parent's children
  const invalidIds = [...providedIds].filter(id => !categoryIdSet.has(id));
  if (invalidIds.length > 0) {
    throw new ValidationError(`Some categories do not belong to the specified parent: ${invalidIds.join(', ')}`);
  }
  
  // Update the order of each category
  const updates = categoryIds.map((id, index) => 
    Category.findByIdAndUpdate(id, { 
      order: index, 
      updatedBy: req.user._id 
    })
  );
  
  await Promise.all(updates);
  
  res.status(200).json({
    success: true,
    message: `Categories reordered successfully for parent ${parentId || 'root'}`
  });
});

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryTree,
  getCategoryById,
  getCategoryBySlug,
  updateCategory,
  deleteCategory,
  moveCategory,
  toggleCategoryStatus,
  toggleCategoryFeatured,
  updateCategoryOrder,
  getSubcategories,
  getCategoryDescendants,
  getCategoryProducts,
  updateProductCounts,
  getFeaturedCategories,
  bulkUpdateCategoryStatus,
  bulkDeleteCategories,
  bulkUpdateCategoryOrder,
  reorderCategories
};

