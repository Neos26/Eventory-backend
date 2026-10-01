const express = require('express');
const {
  getReservations,
  getReservation,
  createReservation,
  updateReservation,
  deleteReservation,
} = require('../controllers/reservationController');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', getReservations);
router.get('/:id', getReservation);
router.post('/', authenticate, authorizeRole('management'), createReservation);
router.put('/:id', authenticate, authorizeRole('management'), updateReservation);
router.delete('/:id', authenticate, authorizeRole('management'), deleteReservation);

module.exports = router;
