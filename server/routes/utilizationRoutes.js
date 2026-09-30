const express = require('express');
const { getResourceUtilization } = require('../controllers/statisticsController');

const router = express.Router();

// Mounted at /api/resources - registered before the CRUD router so the
// literal "utilization" path is not captured by the /:id routes.
router.get('/utilization', getResourceUtilization);

module.exports = router;
