const express = require('express');
const { getEventStatistics } = require('../controllers/statisticsController');

const router = express.Router();

// Mounted at /api/events - registered before the CRUD router so the literal
// "statistics" path is not captured by the /:id routes.
router.get('/statistics', getEventStatistics);

module.exports = router;
