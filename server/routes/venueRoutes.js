const express = require('express');
const {
  getVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
  getVenueAvailability,
} = require('../controllers/venueController');

const router = express.Router();

router.get('/', getVenues);
router.get('/:id/availability', getVenueAvailability);
router.get('/:id', getVenue);
router.post('/', createVenue);
router.put('/:id', updateVenue);
router.delete('/:id', deleteVenue);

module.exports = router;
