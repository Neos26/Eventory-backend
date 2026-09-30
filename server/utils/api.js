const mongoose = require('mongoose');

// Wraps async route handlers so thrown/rejected errors reach the error middleware.
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Error with an explicit HTTP status code (used by the global error handler).
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Rejects malformed MongoDB ids early with a clean 400 instead of a CastError.
const validateId = (id, label = 'Record') => {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, `Invalid ${label} id: ${id}`);
  }
};

module.exports = { asyncHandler, HttpError, validateId };
