const express = require('express');
const {
  createBooking,
  getBookings,
  getBooking,
  cancelBooking,
  rejectBooking,
  approveBooking,
} = require('../controllers/bookingController');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, createBooking);
router.get('/', authenticate, getBookings);
router.get('/:id', authenticate, getBooking);
router.put('/:id/cancel', authenticate, cancelBooking);
router.put('/:id/approve', authenticate, authorizeRole('management'), approveBooking);
router.put('/:id/reject', authenticate, authorizeRole('management'), rejectBooking);

module.exports = router;
