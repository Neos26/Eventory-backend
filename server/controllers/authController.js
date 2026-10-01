const User = require('../models/User');
const Organization = require('../models/Organization');
const { signToken } = require('../utils/token');
const { hashPassword, verifyPassword } = require('../utils/password');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

const ALLOWED_ROLES = ['booker', 'management'];
const PASSWORD_MIN_LENGTH = 6;

// The user object sent to the frontend (never includes the password).
const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId || null,
  createdAt: user.createdAt,
});

const authPayload = (user) => ({ token: signToken(user), user: publicUser(user) });

const requireField = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${label} is required`);
  }
  return value.trim();
};

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const name = requireField(req.body.name, 'name');
  const email = requireField(req.body.email, 'email').toLowerCase();
  const password = requireField(req.body.password, 'password');

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new HttpError(400, `password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }

  const role = req.body.role === undefined ? 'booker' : req.body.role;
  if (!ALLOWED_ROLES.includes(role)) {
    throw new HttpError(400, 'role must be either booker or management');
  }

  if (req.body.organizationId) {
    validateId(req.body.organizationId, 'Organization');
    const organization = await Organization.findById(req.body.organizationId).select('_id');
    if (!organization) throw new HttpError(400, 'Organization not found');
  }

  const existing = await User.findOne({ email }).select('_id');
  if (existing) throw new HttpError(409, 'An account with this email already exists.');

  const hashed = await hashPassword(password);
  const user = await User.create({
    name,
    email,
    password: hashed,
    role,
    ...(req.body.organizationId && { organizationId: req.body.organizationId }),
  });

  res.status(201).json({ success: true, data: authPayload(user) });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const email = requireField(req.body.email, 'email').toLowerCase();
  const password = requireField(req.body.password, 'password');

  const user = await User.findOne({ email }).select('+password');
  // Same message for unknown email and wrong password so the endpoint
  // does not reveal which accounts exist.
  if (!user) throw new HttpError(401, 'Invalid email or password.');

  const matches = await verifyPassword(password, user.password);
  if (!matches) throw new HttpError(401, 'Invalid email or password.');

  res.json({ success: true, data: authPayload(user) });
});

// GET /api/auth/me (requires authenticate middleware)
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: publicUser(req.user) });
});

module.exports = { register, login, me, publicUser };
