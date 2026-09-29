require('dotenv').config();

const app = require('./app');
const { connectDB } = require('./config/database');

const PORT = process.env.PORT || 5000;

const start = async () => {
  // Connect to MongoDB first so models are usable as soon as we listen.
  try {
    await connectDB();
  } catch (err) {
    // Do not crash the whole server: the API can still boot and the
    // health endpoint will report the database as "disconnected".
    console.error(`MongoDB connection failed: ${err.message}`);
    console.error('Fix MONGODB_URI in .env and restart the server.');
  }

  app.listen(PORT, () => {
    console.log(`Eventory API listening on http://localhost:${PORT}`);
  });
};

start();
