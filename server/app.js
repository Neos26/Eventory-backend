const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/healthRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const statisticsRoutes = require('./routes/statisticsRoutes');
const utilizationRoutes = require('./routes/utilizationRoutes');
const eventRoutes = require('./routes/eventRoutes');
const venueRoutes = require('./routes/venueRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const reservationRoutes = require('./routes/reservationRoutes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Parse incoming JSON payloads.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Allow the React frontend to talk to this API. CLIENT_URL may list several
// origins (comma separated) because Vite falls back to the next free port
// when 5173 is already in use.
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
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
app.use('/api/organizations', organizationRoutes);
app.use('/api/dashboard', dashboardRoutes);
// Literal paths (/statistics, /utilization) must be matched before the
// /:id CRUD routers below.
app.use('/api/events', statisticsRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/resources', utilizationRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/reservations', reservationRoutes);

// 404 for unknown routes, then the global error handler.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
