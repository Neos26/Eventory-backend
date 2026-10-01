const User = require('../models/User');
const { verifyToken } = require('../utils/token');

const unauthorized = (res, message) => res.status(401).json({ success: false, message });

// authenticate: requires "Authorization: Bearer <token>".
// Loads the user from the database so req.user is always fresh.
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return unauthorized(res, 'Authentication required. Provide a Bearer token.');
  }

  try {
    const decoded = verifyToken(header.slice(7));
    const user = await User.findById(decoded.id);
    if (!user) {
      return unauthorized(res, 'The account for this token no longer exists.');
    }
    req.user = user;
    return next();
  } catch (err) {
    return unauthorized(res, 'Invalid or expired token.');
  }
};

// attachUser: optional authentication for public GET routes.
// Populates req.user when a valid token is present so ownership rules can
// scope the response, but never rejects - the route itself stays public.
const attachUser = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();

  try {
    const decoded = verifyToken(header.slice(7));
    const user = await User.findById(decoded.id);
    if (user) req.user = user;
  } catch (err) {
    // Invalid token on a public read: treat the caller as anonymous.
  }
  return next();
};

// authorizeRole('management') or authorizeRole('booker', 'management').
// Must run after authenticate.
const authorizeRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. This action requires the ${roles.join(' or ')} role.`,
    });
  }
  return next();
};

module.exports = { authenticate, attachUser, authorizeRole };
