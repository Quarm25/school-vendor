const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Default file size limits
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE || 5 * 1024 * 1024; // 5MB default
const MAX_IMAGE_SIZE = process.env.MAX_IMAGE_SIZE || 2 * 1024 * 1024; // 2MB default
const MAX_DOCUMENT_SIZE = process.env.MAX_DOCUMENT_SIZE || 10 * 1024 * 1024; // 10MB default

// Upload directories
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const PRODUCT_IMG_DIR = path.join(UPLOAD_DIR, 'products');
const PROFILE_IMG_DIR = path.join(UPLOAD_DIR, 'profiles');
const RECEIPT_DIR = path.join(UPLOAD_DIR, 'receipts');
const DOCUMENT_DIR = path.join(UPLOAD_DIR, 'documents');

// Ensure upload directories exist
const createUploadDirs = () => {
  [UPLOAD_DIR, PRODUCT_IMG_DIR, PROFILE_IMG_DIR, RECEIPT_DIR, DOCUMENT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// Create upload directories on initialization
createUploadDirs();

/**
 * Configure storage for multer
 * 
 * @param {String} destination - Destination folder for uploads
 * @returns {Object} Multer storage configuration
 */
const configureStorage = (destination) => {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, destination);
    },
    filename: (req, file, cb) => {
      // Create unique filename with original extension
      const fileExt = path.extname(file.originalname).toLowerCase();
      const fileName = `${uuidv4()}${fileExt}`;
      cb(null, fileName);
    }
  });
};

/**
 * File filter for image uploads
 * 
 * @param {Object} req - Express request object
 * @param {Object} file - File object from multer
 * @param {Function} cb - Callback function
 */
const imageFilter = (req, file, cb) => {
  // Allow only image files
  const allowedMimeTypes = [
    'image/jpeg', 
    'image/jpg', 
    'image/png', 
    'image/gif', 
    'image/webp'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP)'), false);
  }
};

/**
 * File filter for documents
 * 
 * @param {Object} req - Express request object
 * @param {Object} file - File object from multer
 * @param {Function} cb - Callback function
 */
const documentFilter = (req, file, cb) => {
  // Allow image, PDF, DOC, XLS files
  const allowedMimeTypes = [
    'image/jpeg', 
    'image/jpg', 
    'image/png', 
    'application/pdf',
    'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: images, PDF, DOC, XLS, TXT'), false);
  }
};

/**
 * Error handling middleware for multer
 * 
 * @param {Function} multerMiddleware - Configured multer middleware
 * @returns {Function} Error-handling middleware
 */
const handleMulterErrors = (multerMiddleware) => {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File too large. Please upload a smaller file.'
          });
        }
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
          error: `File size should be less than ${formatBytes(
            err.field === 'profileImage'
              ? MAX_IMAGE_SIZE
              : err.field === 'receipt'
              ? MAX_FILE_SIZE
              : MAX_IMAGE_SIZE
          )}`
        });
      } else if (err) {
        // Custom errors from fileFilter or other issues
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed'
        });
      }
      
      next();
    });
  };
};

// Configure multer for product images (single)
const productImageUpload = handleMulterErrors(
  multer({
    storage: configureStorage(PRODUCT_IMG_DIR),
    limits: { fileSize: MAX_IMAGE_SIZE },
    fileFilter: imageFilter
  }).single('image')
);

// Configure multer for product images (multiple)
const productImagesUpload = handleMulterErrors(
  multer({
    storage: configureStorage(PRODUCT_IMG_DIR),
    limits: { fileSize: MAX_IMAGE_SIZE },
    fileFilter: imageFilter
  }).array('images', 5) // Maximum 5 product images
);

// Configure multer for profile images
const profileImageUpload = handleMulterErrors(
  multer({
    storage: configureStorage(PROFILE_IMG_DIR),
    limits: { fileSize: MAX_IMAGE_SIZE },
    fileFilter: imageFilter
  }).single('profileImage')
);

// Configure multer for payment receipts
const receiptUpload = handleMulterErrors(
  multer({
    storage: configureStorage(RECEIPT_DIR),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: documentFilter
  }).single('receipt')
);

// Configure multer for general document uploads
const documentUpload = handleMulterErrors(
  multer({
    storage: configureStorage(DOCUMENT_DIR),
    limits: { fileSize: MAX_DOCUMENT_SIZE },
    fileFilter: documentFilter
  }).single('document')
);

/**
 * Delete file utility function
 * 
 * @param {String} filePath - Path to file to be deleted
 * @returns {Promise<Boolean>} Success status
 */
const deleteFile = async (filePath) => {
  try {
    if (!filePath) return false;
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
};

/**
 * Delete multiple files utility function
 * 
 * @param {Array} filePaths - Array of file paths to delete
 * @returns {Promise<Array>} Array of results
 */
const deleteFiles = async (filePaths = []) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return [];
    }
    
    const results = await Promise.all(
      filePaths.map(async (path) => {
        try {
          return { path, success: await deleteFile(path) };
        } catch (error) {
          return { path, success: false, error: error.message };
        }
      })
    );
    
    return results;
  } catch (error) {
    console.error('Error deleting files:', error);
    return [];
  }
};

/**
 * Get file path utility function
 * Creates the appropriate file path for a file based on its type
 * 
 * @param {String} fileName - Name of the file
 * @param {String} fileType - Type of file (product, profile, receipt, document)
 * @returns {String} Complete file path
 */
const getFilePath = (fileName, fileType = 'document') => {
  if (!fileName) return null;
  
  let dir;
  switch (fileType.toLowerCase()) {
    case 'product':
      dir = PRODUCT_IMG_DIR;
      break;
    case 'profile':
      dir = PROFILE_IMG_DIR;
      break;
    case 'receipt':
      dir = RECEIPT_DIR;
      break;
    case 'document':
    default:
      dir = DOCUMENT_DIR;
  }
  
  return path.join(dir, fileName);
};

/**
 * Format bytes to readable format
 * @param {Number} bytes - Bytes to format
 * @returns {String} Formatted size with unit
 */
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

module.exports = {
  // Upload middlewares
  productImageUpload,
  productImagesUpload,
  profileImageUpload,
  receiptUpload,
  documentUpload,
  
  // Utility functions
  deleteFile,
  deleteFiles,
  getFilePath,
  formatBytes,
  
  // Constants for external use
  UPLOAD_DIR,
  PRODUCT_IMG_DIR,
  PROFILE_IMG_DIR,
  RECEIPT_DIR,
  DOCUMENT_DIR
};
