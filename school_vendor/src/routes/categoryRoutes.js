const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const categoryValidation = require('../validations/categoryValidation');

// Public routes
router.get('/', categoryController.getAllCategories);
router.get('/tree', categoryController.getCategoryTree);
router.get('/featured', categoryController.getFeaturedCategories);
router.get('/slug/:slug', categoryController.getCategoryBySlug);
router.get('/:id', categoryController.getCategoryById);
router.get('/:id/subcategories', categoryController.getSubcategories);
router.get('/:id/descendants', categoryController.getCategoryDescendants);
router.get('/:id/products', categoryController.getCategoryProducts);

// Protected routes (admin only)
router.post(
  '/', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.createCategory),
  categoryController.createCategory
);

router.put(
  '/:id', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.updateCategory),
  categoryController.updateCategory
);

router.delete(
  '/:id', 
  protect, 
  authorize('admin'),
  categoryController.deleteCategory
);

router.put(
  '/:id/move', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.moveCategory),
  categoryController.moveCategory
);

router.put(
  '/:id/toggle-status', 
  protect, 
  authorize('admin'),
  categoryController.toggleCategoryStatus
);

router.put(
  '/:id/toggle-featured', 
  protect, 
  authorize('admin'),
  categoryController.toggleCategoryFeatured
);

router.put(
  '/:id/order', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.updateOrder),
  categoryController.updateCategoryOrder
);

router.post(
  '/update-product-counts', 
  protect, 
  authorize('admin'),
  categoryController.updateProductCounts
);

router.put(
  '/bulk/status', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.bulkUpdateStatus),
  categoryController.bulkUpdateCategoryStatus
);

router.delete(
  '/bulk', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.bulkDelete),
  categoryController.bulkDeleteCategories
);

router.put(
  '/bulk/order', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.bulkUpdateOrder),
  categoryController.bulkUpdateCategoryOrder
);

// Route for reordering root-level categories (no parent)
router.put(
  '/reorder', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.reorderCategories),
  categoryController.reorderCategories
);

// Route for reordering categories within a specific parent
router.put(
  '/reorder/:parentId', 
  protect, 
  authorize('admin'), 
  validateRequest(categoryValidation.reorderCategories),
  categoryController.reorderCategories
);

module.exports = router;

