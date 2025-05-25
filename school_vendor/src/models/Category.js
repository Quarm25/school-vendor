const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: [50, 'Category name cannot be more than 50 characters'],
    index: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true
  },
  level: {
    type: Number,
    default: 1,
    min: 1,
    max: 5 // Limit nesting to 5 levels
  },
  ancestors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  image: {
    url: {
      type: String
    },
    alt: {
      type: String,
      trim: true
    }
  },
  icon: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  order: {
    type: Number,
    default: 0
  },
  productCount: {
    type: Number,
    default: 0
  },
  featuredInHomepage: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Setup virtual field for subcategories
CategorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent'
});

// Create compound index for parent-name combo to ensure uniqueness at same level
CategorySchema.index({ parent: 1, name: 1 }, { unique: true });

// Create indexes for performance
CategorySchema.index({ isActive: 1, level: 1 });
CategorySchema.index({ ancestors: 1 });

// Generate slug from category name
CategorySchema.pre('validate', async function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  
  // To ensure unique slugs when names are similar, 
  // we append a random string if this is a new category (not an update)
  if (this.isNew) {
    const existingCategory = await mongoose.models.Category.findOne({ slug: this.slug });
    if (existingCategory) {
      const randomString = Math.random().toString(36).substring(2, 6);
      this.slug = `${this.slug}-${randomString}`;
    }
  }
  
  next();
});

// Set level and ancestors based on parent before saving
CategorySchema.pre('save', async function(next) {
  if (this.parent) {
    try {
      const parentCategory = await mongoose.models.Category.findById(this.parent);
      
      if (!parentCategory) {
        return next(new Error('Parent category not found'));
      }
      
      // Check for circular references
      if (
        String(this._id) === String(this.parent) || 
        (parentCategory.ancestors && parentCategory.ancestors.includes(this._id))
      ) {
        return next(new Error('Circular reference detected in category hierarchy'));
      }
      
      this.level = parentCategory.level + 1;
      this.ancestors = [...parentCategory.ancestors, parentCategory._id];
      
      // Validate maximum nesting level
      if (this.level > 5) {
        return next(new Error('Maximum category nesting level exceeded (max: 5)'));
      }
      
    } catch (error) {
      return next(error);
    }
  } else {
    // Root category
    this.level = 1;
    this.ancestors = [];
  }
  
  next();
});

// Static method to get full hierarchy of categories
CategorySchema.statics.getFullHierarchy = async function() {
  const categories = await this.find({ isActive: true })
    .sort({ level: 1, order: 1, name: 1 })
    .lean();
    
  const rootCategories = categories.filter(c => !c.parent);
  
  const buildHierarchy = (parent) => {
    const children = categories.filter(c => 
      parent ? String(c.parent) === String(parent._id) : !c.parent
    );
    
    if (children.length === 0) {
      return [];
    }
    
    return children.map(child => ({
      ...child,
      children: buildHierarchy(child)
    }));
  };
  
  return buildHierarchy(null);
};

// Method to get all descendants of a category
CategorySchema.methods.getAllDescendants = async function() {
  return await mongoose.models.Category.find({
    ancestors: this._id
  });
};

// Method to get direct children of a category
CategorySchema.methods.getChildren = async function() {
  return await mongoose.models.Category.find({
    parent: this._id
  });
};

// Method to move a category to a new parent
CategorySchema.methods.moveToParent = async function(newParentId) {
  // Check if new parent exists (if not null)
  if (newParentId) {
    const newParent = await mongoose.models.Category.findById(newParentId);
    
    if (!newParent) {
      throw new Error('New parent category not found');
    }
    
    // Check if the new parent is a descendant of this category (would create circular reference)
    if (String(this._id) === String(newParentId) || newParent.ancestors.includes(this._id)) {
      throw new Error('Cannot move category to one of its descendants');
    }
    
    // Calculate new level and ancestors
    this.level = newParent.level + 1;
    this.ancestors = [...newParent.ancestors, newParent._id];
    
    // Check if max nesting level is exceeded
    if (this.level > 5) {
      throw new Error('Maximum category nesting level exceeded (max: 5)');
    }
  } else {
    // Moving to root level
    this.level = 1;
    this.ancestors = [];
  }
  
  this.parent = newParentId;
  await this.save();
  
  // Update all descendants
  await this.updateDescendants();
  
  return this;
};

// Helper method to update all descendants after a move
CategorySchema.methods.updateDescendants = async function() {
  const descendants = await this.getAllDescendants();
  
  // Update each descendant's level and ancestors
  for (const descendant of descendants) {
    // Find the direct parent (which might be this category or another descendant)
    const parent = await mongoose.models.Category.findById(descendant.parent);
    
    // Update level and ancestors based on parent
    descendant.level = parent.level + 1;
    descendant.ancestors = [...parent.ancestors, parent._id];
    
    await descendant.save();
  }
};

module.exports = mongoose.model('Category', CategorySchema);

