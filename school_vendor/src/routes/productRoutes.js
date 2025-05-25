const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const productValidation = require('../validations/productValidation');
const { productImagesUpload } = require('../middleware/upload');

// Public routes
router.get('/', productController.getProducts);
router.get('/featured', productController.getFeaturedProducts);
router.get('/:id', productController.getProductById);
router.get('/category/:categoryId', productController.getProductsByCategory);
router.get('/search', productController.searchProducts);

// Protected routes (admin only)
router.post(
  '/', 
  protect, 
  authorize('admin'), 
  productImagesUpload,
  validateRequest(productValidation.createProduct),
  productController.createProduct
);

router.put(
  '/:id', 
  protect, 
  authorize('admin'), 
  productImagesUpload,
  validateRequest(productValidation.updateProduct),
  productController.updateProduct
);

router.delete(
  '/:id', 
  protect, 
  authorize('admin'),
  productController.deleteProduct
);

router.put(
  '/:id/toggle-status', 
  protect, 
  authorize('admin'),
  productController.updateProductStatus
);

router.put(
  '/:id/toggle-featured', 
  protect, 
  authorize('admin'),
  productController.toggleFeatured
);

router.put(
  '/bulk/status', 
  protect, 
  authorize('admin'), 
  validateRequest(productValidation.bulkUpdateStatus),
  productController.bulkUpdateStatus
);

router.delete(
  '/bulk', 
  protect, 
  authorize('admin'), 
  validateRequest(productValidation.bulkDelete),
  productController.bulkDeleteProducts
);

// Inventory management
router.put(
  '/:id/stock', 
  protect, 
  authorize('admin'), 
  validateRequest(productValidation.updateStock),
  productController.updateStock
);

module.exports = router;

