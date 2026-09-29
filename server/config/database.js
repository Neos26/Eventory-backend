const mongoose = require('mongoose');

/**
 * Establishes the connection to MongoDB using the connection string
 * stored in the MONGODB_URI environment variable.
 *
 * The promise is returned so the caller decides how to react to a
 * failure (the server can still start and report the status via
 * GET /api/health).
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is missing. Add it to your .env file.');
  }

  mongoose.set('strictQuery', true);

  // Fail fast instead of hanging for the default 30s when MongoDB is down.
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  return conn;
};

// Simple status helper used by the health-check endpoint.
const getConnectionState = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] || 'unknown';
};

module.exports = { connectDB, getConnectionState };
