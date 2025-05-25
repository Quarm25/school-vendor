const User = require('../models/User');
const crypto = require('crypto');
const { 
  AppError, 
  AuthenticationError, 
  NotFoundError, 
  ValidationError,
  catchAsync 
} = require('../middleware/error');
const { 
  generateToken, 
  updateLastLogin 
} = require('../middleware/auth');

/**
 * @desc   Register a new user
 * @route  POST /api/users/register
 * @access Public
 */
const registerUser = catchAsync(async (req, res) => {
  const { 
    firstName, 
    lastName, 
    email, 
    password, 
    role, 
    contactNumber, 
    address, 
    studentId,
    grade 
  } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ValidationError('User with this email already exists');
  }

  // Create user with specified role (default to student if not specified)
  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: role || 'student',
    contactNumber,
    address,
    studentId,
    grade,
    createdAt: Date.now(),
    lastLogin: Date.now()
  });

  // Generate JWT token
  const token = generateToken(user);

  // Remove password from response
  user.password = undefined;

  res.status(201).json({
    success: true,
    token,
    user: user.getPublicProfile()
  });
});

/**
 * @desc   Login user
 * @route  POST /api/users/login
 * @access Public
 */
const loginUser = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // Check if email and password are provided
  if (!email || !password) {
    throw new ValidationError('Please provide email and password');
  }

  // Find user and include password for verification
  const user = await User.findOne({ email }).select('+password');

  // Check if user exists
  if (!user) {
    throw new AuthenticationError('Invalid credentials');
  }

  // Check if user is active
  if (!user.isActive) {
    throw new AuthenticationError('Your account has been deactivated. Please contact support.');
  }

  // Verify password
  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    throw new AuthenticationError('Invalid credentials');
  }

  // Update last login time
  await updateLastLogin(user._id);

  // Generate JWT token
  const token = generateToken(user);

  // Set cookie if in production
  if (process.env.NODE_ENV === 'production') {
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: 'strict'
    });
  }

  // Remove password from response
  user.password = undefined;

  res.status(200).json({
    success: true,
    token,
    user: user.getPublicProfile()
  });
});

/**
 * @desc   Logout user / clear cookie
 * @route  POST /api/users/logout
 * @access Private
 */
const logoutUser = catchAsync(async (req, res) => {
  // Clear cookie if it exists
  if (req.cookies.token) {
    res.clearCookie('token');
  }

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * @desc   Get current user profile
 * @route  GET /api/users/profile
 * @access Private
 */
const getUserProfile = catchAsync(async (req, res) => {
  // User is already attached to req by auth middleware
  const user = req.user;

  res.status(200).json({
    success: true,
    user: user.getPublicProfile()
  });
});

/**
 * @desc   Update user profile
 * @route  PUT /api/users/profile
 * @access Private
 */
const updateUserProfile = catchAsync(async (req, res) => {
  const { 
    firstName, 
    lastName, 
    contactNumber, 
    address, 
    profilePhoto,
    grade 
  } = req.body;

  // Get user from database to ensure we have the latest data
  const user = await User.findById(req.user._id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Update fields if provided
  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (contactNumber) user.contactNumber = contactNumber;
  if (address) user.address = address;
  if (profilePhoto) user.profilePhoto = profilePhoto;
  if (grade) user.grade = grade;

  // Save updated user
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: user.getPublicProfile()
  });
});

/**
 * @desc   Update user password
 * @route  PUT /api/users/password
 * @access Private
 */
const updatePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Verify current password
  const isPasswordMatch = await user.comparePassword(currentPassword);
  if (!isPasswordMatch) {
    throw new ValidationError('Current password is incorrect');
  }

  // Update password
  user.password = newPassword;
  await user.save();

  // Generate new token
  const token = generateToken(user);

  res.status(200).json({
    success: true,
    message: 'Password updated successfully',
    token
  });
});

/**
 * @desc   Forgot password - send reset email
 * @route  POST /api/users/forgot-password
 * @access Public
 */
const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  // Find user by email
  const user = await User.findOne({ email });

  if (!user) {
    throw new NotFoundError('User with this email does not exist');
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  // Hash token and save to user
  user.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  // Set token expiration (10 minutes)
  user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
  
  await user.save();

  // Create reset URL
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  // Send email with reset URL (using a mail service)
  // This is a placeholder - actual email sending would be implemented
  try {
    // TODO: Implement actual email sending logic
    console.log(`Password reset link: ${resetUrl}`);

    res.status(200).json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error) {
    // If email sending fails, clear the reset token
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    throw new AppError('Email could not be sent', 500);
  }
});

/**
 * @desc   Reset password
 * @route  POST /api/users/reset-password/:token
 * @access Public
 */
const resetPassword = catchAsync(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // Hash the token to compare with stored hash
  const resetPasswordToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid token and non-expired token
  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() }
  });

  if (!user) {
    throw new ValidationError('Invalid or expired token');
  }

  // Update password and clear reset fields
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  
  await user.save();

  // Generate new token
  const newToken = generateToken(user);

  res.status(200).json({
    success: true,
    message: 'Password has been reset',
    token: newToken
  });
});

/**
 * @desc   Deactivate user account
 * @route  PUT /api/users/deactivate
 * @access Private
 */
const deactivateAccount = catchAsync(async (req, res) => {
  // Get user
  const user = await User.findById(req.user._id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Set user as inactive
  user.isActive = false;
  await user.save();

  // Clear cookie if it exists
  if (req.cookies.token) {
    res.clearCookie('token');
  }

  res.status(200).json({
    success: true,
    message: 'Account deactivated successfully'
  });
});

/**
 * @desc   Get user by ID (admin only)
 * @route  GET /api/users/:id
 * @access Admin
 */
const getUserById = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.status(200).json({
    success: true,
    user: user.getPublicProfile()
  });
});

/**
 * @desc   Get all users (admin only)
 * @route  GET /api/users
 * @access Admin
 */
const getAllUsers = catchAsync(async (req, res) => {
  // Implement pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Query parameters for filtering
  const { role, search } = req.query;

  // Build query
  const query = {};
  
  // Filter by role if provided
  if (role) {
    query.role = role;
  }
  
  // Search by name or email
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  // Execute query with pagination
  const users = await User.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Get total count for pagination
  const total = await User.countDocuments(query);

  res.status(200).json({
    success: true,
    count: users.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    users: users.map(user => user.getPublicProfile())
  });
});

/**
 * @desc   Update user status (admin only)
 * @route  PUT /api/users/:id/status
 * @access Admin
 */
const updateUserStatus = catchAsync(async (req, res) => {
  const { isActive } = req.body;
  
  if (typeof isActive !== 'boolean') {
    throw new ValidationError('Status must be a boolean value');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.status(200).json({
    success: true,
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
    user: user.getPublicProfile()
  });
});

/**
 * @desc   Update user role (admin only)
 * @route  PUT /api/users/:id/role
 * @access Admin
 */
const updateUserRole = catchAsync(async (req, res) => {
  const { role } = req.body;
  
  // Validate role
  if (!['admin', 'student', 'parent'].includes(role)) {
    throw new ValidationError('Invalid role');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.status(200).json({
    success: true,
    message: 'User role updated successfully',
    user: user.getPublicProfile()
  });
});

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  updatePassword,
  forgotPassword,
  resetPassword,
  deactivateAccount,
  getUserById,
  getAllUsers,
  updateUserStatus,
  updateUserRole
};

