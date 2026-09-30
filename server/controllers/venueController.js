const Venue = require('../models/Venue');
const Event = require('../models/Event');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

// GET /api/venues
const getVenues = asyncHandler(async (req, res) => {
  const venues = await Venue.find().sort({ createdAt: -1 });
  res.json({ success: true, count: venues.length, data: venues });
});

// GET /api/venues/:id
const getVenue = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Venue');
  const venue = await Venue.findById(req.params.id);
  if (!venue) throw new HttpError(404, 'Venue not found');
  res.json({ success: true, data: venue });
});

// POST /api/venues
const createVenue = asyncHandler(async (req, res) => {
  const venue = await Venue.create(req.body);
  res.status(201).json({ success: true, data: venue });
});

// PUT /api/venues/:id
const updateVenue = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Venue');
  const venue = await Venue.findById(req.params.id);
  if (!venue) throw new HttpError(404, 'Venue not found');

  venue.set(req.body);
  await venue.save();
  res.json({ success: true, data: venue });
});

// DELETE /api/venues/:id
const deleteVenue = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Venue');
  const venue = await Venue.findByIdAndDelete(req.params.id);
  if (!venue) throw new HttpError(404, 'Venue not found');
  res.json({ success: true, message: 'Venue deleted', data: venue });
});

// GET /api/venues/:id/availability?start=...&end=... (or ?date=YYYY-MM-DD)
// Tells the frontend whether the venue is free during the requested window.
const getVenueAvailability = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Venue');
  const venue = await Venue.findById(req.params.id);
  if (!venue) throw new HttpError(404, 'Venue not found');

  let { start, end, date } = req.query;

  // A single date means "the whole day".
  if (date) {
    if (Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Invalid date parameter');
    const day = new Date(date);
    start = new Date(day);
    start.setHours(0, 0, 0, 0);
    end = new Date(day);
    end.setHours(23, 59, 59, 999);
  }

  if (!start || !end) {
    throw new HttpError(400, 'start and end query parameters are required (or a single date)');
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new HttpError(400, 'Invalid start or end value');
  }
  if (endDate < startDate) throw new HttpError(400, 'end must be after start');

  // Overlap rule: existing.start < requested.end && existing.end > requested.start
  const conflicts = await Event.find({
    venue: venue._id,
    status: { $ne: 'cancelled' },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
  }).select('name startDate endDate status');

  res.json({
    success: true,
    data: {
      venue: { id: venue._id, name: venue.name, capacity: venue.capacity, isActive: venue.isActive },
      requested: { start: startDate, end: endDate },
      available: conflicts.length === 0 && venue.isActive,
      conflicts,
    },
  });
});

module.exports = {
  getVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
  getVenueAvailability,
};
