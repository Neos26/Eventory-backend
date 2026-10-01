const express = require('express');
const {
  getVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
  getVenueAvailability,
} = require('../controllers/venueController');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', getVenues);
router.get('/:id/availability', getVenueAvailability);
router.get('/:id', getVenue);
router.post('/', authenticate, authorizeRole('management'), createVenue);
router.put('/:id', authenticate, authorizeRole('management'), updateVenue);
router.delete('/:id', authenticate, authorizeRole('management'), deleteVenue);

module.exports = router;
