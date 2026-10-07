const Booking = require('../models/Booking');
const Event = require('../models/Event');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

const BOOKING_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed'];
// Statuses that block a second booking for the same event.
const BLOCKING_STATUSES = ['Pending', 'Approved', 'Completed'];

const EVENT_FIELDS = 'name startDate endDate status venue organization bookerId';
const BOOKER_FIELDS = 'name email role';

const populateBooking = (query) =>
  query.populate('eventId', EVENT_FIELDS).populate('bookerId', BOOKER_FIELDS);

// Documents (just created/saved) cannot chain populate - re-fetch by id so
// the response always carries the same populated shape.
const populatedById = (booking) => populateBooking(Booking.findById(booking._id));

// Management reviews everything; a booker only ever sees their own bookings.
// bookerId may be a plain ObjectId (freshly loaded) or a populated user
// (read responses) - normalise before comparing.
const ownsBooking = (user, booking) => {
  if (user.role === 'management') return true;
  const ownerId = booking.bookerId && booking.bookerId._id !== undefined
    ? booking.bookerId._id
    : booking.bookerId;
  return ownerId != null && String(ownerId) === String(user._id);
};

const assertBookingReadAccess = (user, booking) => {
  if (!ownsBooking(user, booking)) {
    throw new HttpError(403, 'You are not allowed to view this booking.');
  }
};

// POST /api/bookings
const createBooking = asyncHandler(async (req, res) => {
  const { eventId, notes } = req.body;
  if (!eventId) throw new HttpError(400, 'eventId is required');

  validateId(eventId, 'Event');
  const event = await Event.findById(eventId);
  if (!event) throw new HttpError(404, 'Event not found');
  if (event.status === 'cancelled') {
    throw new HttpError(409, 'Cannot create a booking for a cancelled event.');
  }

  // A booker may only book their own event; management may book any event.
  const isOwner =
    req.user.role === 'management' ||
    (event.bookerId != null && String(event.bookerId) === String(req.user._id));
  if (!isOwner) {
    throw new HttpError(403, 'You can only create bookings for your own events.');
  }

  const existing = await Booking.findOne({
    eventId: event._id,
    status: { $in: BLOCKING_STATUSES },
  }).select('_id');
  if (existing) {
    throw new HttpError(409, 'A booking already exists for this event.');
  }

  const booking = await Booking.create({
    eventId: event._id,
    bookerId: req.user._id,
    ...(notes && { notes }),
  });

  res.status(201).json({ success: true, data: await populatedById(booking) });
});

// GET /api/bookings?status=Pending
const getBookings = asyncHandler(async (req, res) => {
  const { status } = req.query;
  if (status !== undefined) {
    if (!BOOKING_STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${BOOKING_STATUSES.join(', ')}`);
    }
  }

  const filter = {};
  if (req.user.role === 'booker') filter.bookerId = req.user._id;
  if (status !== undefined) filter.status = status;

  const bookings = await populateBooking(Booking.find(filter)).sort({ createdAt: -1 });
  res.json({ success: true, count: bookings.length, data: bookings });
});

// GET /api/bookings/:id
const getBooking = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Booking');
  const booking = await populateBooking(Booking.findById(req.params.id));
  if (!booking) throw new HttpError(404, 'Booking not found');

  assertBookingReadAccess(req.user, booking);
  res.json({ success: true, data: booking });
});

// PUT /api/bookings/:id/cancel
const cancelBooking = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Booking');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');

  // The booker cancels their own request; management may cancel any request.
  if (!ownsBooking(req.user, booking)) {
    throw new HttpError(403, 'You are not allowed to cancel this booking.');
  }
  if (booking.status !== 'Pending') {
    throw new HttpError(409, 'Only pending bookings can be cancelled.');
  }

  booking.status = 'Cancelled';
  await booking.save();

  res.json({ success: true, data: await populatedById(booking) });
});

// PUT /api/bookings/:id/reject  { rejectionReason: "..." }
const rejectBooking = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Booking');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'Pending') {
    throw new HttpError(409, 'Only pending bookings can be reviewed.');
  }

  const reason = typeof req.body.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';
  if (!reason) throw new HttpError(400, 'rejectionReason is required');

  booking.status = 'Rejected';
  booking.rejectionReason = reason;
  await booking.save();

  res.json({ success: true, data: await populatedById(booking) });
});

// PUT /api/bookings/:id/approve  (management only)
// Spec workflow: verify booking -> event -> venue -> resources -> conflicts
// -> create reservations -> set Approved. Any conflict means no approval.
const approveBooking = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Booking');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'Pending') {
    throw new HttpError(409, 'Only pending bookings can be reviewed.');
  }

  // 1) Verify the event (still exists, not cancelled).
  const event = await Event.findById(booking.eventId).populate('venue', 'name isActive');
  if (!event) throw new HttpError(404, 'Event not found for this booking');
  if (event.status === 'cancelled') {
    throw new HttpError(409, 'Cannot approve a booking for a cancelled event.');
  }

  // 2) Verify the venue.
  if (!event.venue) throw new HttpError(409, 'The event has no venue assigned.');
  if (!event.venue.isActive) {
    throw new HttpError(409, 'The assigned venue is inactive.');
  }

  const conflicts = [];

  // 3) Invalid schedule.
  if (event.endDate <= event.startDate) {
    conflicts.push({ type: 'INVALID_SCHEDULE', message: 'Event end time is not after its start time' });
  }

  // 3b) Venue conflicts + overlapping events (same organization) on that date.
  const overlapping = await Event.find({
    _id: { $ne: event._id },
    status: { $ne: 'cancelled' },
    startDate: { $lt: event.endDate },
    endDate: { $gt: event.startDate },
  }).select('name startDate endDate venue organization');

  for (const other of overlapping) {
    const sameVenue = other.venue && String(other.venue) === String(event.venue._id);
    const sameOrg = String(other.organization) === String(event.organization);
    if (sameVenue) {
      conflicts.push({
        type: 'VENUE_CONFLICT',
        venue: event.venue.name,
        event: other.name,
        startDate: other.startDate,
        endDate: other.endDate,
      });
    } else if (sameOrg) {
      conflicts.push({
        type: 'SCHEDULE_CONFLICT',
        event: other.name,
        startDate: other.startDate,
        endDate: other.endDate,
      });
    }
  }

  // 4) Resource availability: Available = Total - Reserved (by other events).
  const requirements = await ResourceRequirement.find({ event: event._id }).populate(
    'resource',
    'name quantityTotal',
  );

  for (const requirement of requirements) {
    if (!requirement.resource) continue;
    const resourceId = requirement.resource._id;

    const reservations = await ResourceReservation.find({
      resource: resourceId,
      status: { $in: ['reserved', 'issued'] },
    }).select('event quantity');
    const reservedByOthers = reservations
      .filter((reservation) => String(reservation.event) !== String(event._id))
      .reduce((sum, reservation) => sum + reservation.quantity, 0);

    const available = Math.max(0, requirement.resource.quantityTotal - reservedByOthers);
    const shortage = requirement.quantity - available;
    if (shortage > 0) {
      conflicts.push({
        type: 'RESOURCE_SHORTAGE',
        resource: requirement.resource.name,
        resourceId,
        required: requirement.quantity,
        available,
        shortage,
      });
    }
  }

  if (conflicts.length > 0) {
    // Friendly message based on the first problem; full detail in conflicts[].
    const messages = {
      INVALID_SCHEDULE: 'The event schedule is invalid.',
      VENUE_CONFLICT: 'The requested venue is already booked.',
      SCHEDULE_CONFLICT: 'The event overlaps with another event of the same organization.',
      RESOURCE_SHORTAGE: 'There are not enough resources to approve this booking.',
    };
    return res.status(409).json({
      success: false,
      message: messages[conflicts[0].type] || 'The booking has conflicts and cannot be approved.',
      conflicts,
    });
  }

  // 5) Create the reservations (holds on stock), one per requirement.
  // If this event already holds part of a resource (manual reservation),
  // only the remaining amount is held again.
  for (const requirement of requirements) {
    if (!requirement.resource) continue;
    const alreadyHeld = await ResourceReservation.find({
      event: event._id,
      resource: requirement.resource._id,
      status: { $in: ['reserved', 'issued'] },
    }).select('quantity');
    const held = alreadyHeld.reduce((sum, reservation) => sum + reservation.quantity, 0);
    const toCreate = requirement.quantity - held;
    if (toCreate <= 0) continue;

    await ResourceReservation.create({
      event: event._id,
      requirement: requirement._id,
      resource: requirement.resource._id,
      quantity: toCreate,
      reservedFrom: event.startDate,
      reservedUntil: event.endDate,
      status: 'reserved',
      notes: `Approved booking ${booking._id}`,
    });
  }

  // 6) Mark approved.
  booking.status = 'Approved';
  await booking.save();

  res.json({ success: true, data: await populatedById(booking) });
});

module.exports = {
  createBooking,
  getBookings,
  getBooking,
  cancelBooking,
  rejectBooking,
  approveBooking,
  BOOKING_STATUSES,
};
