const { getConnectionState } = require('../config/database');

// GET /api/health - basic liveness/readiness check.
const getHealth = (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    message: 'Eventory API is running',
    database: getConnectionState(),
    timestamp: new Date().toISOString(),
  });
};

module.exports = { getHealth };
