// Global error handler. Express picks this up automatically whenever
// next(error) is called or a route throws synchronously.
// It must declare 4 parameters so Express treats it as an error handler.
const errorHandler = (err, req, res, next) => {
  console.error(err);

  // Fall back to the response status set by the route, or 500.
  let statusCode = err.statusCode || res.statusCode;
  if (!statusCode || statusCode < 400) statusCode = 500;

  // Mongoose errors are client problems, not server crashes.
  if (err.name === 'ValidationError' || err.name === 'CastError') statusCode = 400;
  if (err.code === 11000) statusCode = 409;

  let message = err.message || 'Internal server error';

  if (err.name === 'ValidationError') {
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
  }

  res.status(statusCode).json({
    success: false,
    message,
    // Only expose the stack trace while developing.
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
