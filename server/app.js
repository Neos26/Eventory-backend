const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/healthRoutes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Parse incoming JSON payloads.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Allow the React frontend (CLIENT_URL) to talk to this API.
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);

// Request logger (helpful while developing).
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// Routes
app.use('/api', healthRoutes);

// 404 for unknown routes, then the global error handler.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
