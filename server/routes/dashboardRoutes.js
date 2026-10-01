const express = require('express');
const {
  getDashboardSummary,
  getBookerDashboard,
  getManagementDashboard,
} = require('../controllers/dashboardController');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', getDashboardSummary);
router.get('/booker', authenticate, authorizeRole('booker'), getBookerDashboard);
router.get('/management', authenticate, authorizeRole('management'), getManagementDashboard);

module.exports = router;
