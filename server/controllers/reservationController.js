const Event = require('../models/Event');
const Resource = require('../models/Resource');
const ResourceReservation = require('../models/ResourceReservation');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

// Statuses that still hold stock (kept in sync with getResourceAvailability).
const ACTIVE_STATUSES = ['reserved', 'issued'];

const UPDATABLE = [
  'event',
  'resource',
  'quantity',
  'reservedFrom',
  'reservedUntil',
  'status',
  'notes',
];

// ---------- helpers ----------

const populateRefs = async (reservation) => {
  await reservation.populate([
    { path: 'event', select: 'name' },
    { path: 'resource', select: 'name unit' },
  ]);
  return reservation;
};

// Checks that a referenced document actually exists before saving it.
const assertReference = async (Model, id, label) => {
  validateId(id, label);
  const doc = await Model.findById(id).select('_id');
  if (!doc) throw new HttpError(400, `${label} not found`);
};

// Quantity of a resource held by active reservations, optionally ignoring one
// reservation so updates exclude their own hold.
const activeReserved = async (resourceId, excludeId = null) => {
  const filter = { resource: resourceId, status: { $in: ACTIVE_STATUSES } };
  if (excludeId) filter._id = { $ne: excludeId };
  const reservations = await ResourceReservation.find(filter).select('quantity');
  return reservations.reduce((sum, reservation) => sum + reservation.quantity, 0);
};

// Stock guard shared by create and update: the requested quantity must fit in
// total - active reservations (the same math the availability endpoint uses).
const assertStockAvailable = async (resourceId, quantity, excludeId = null) => {
  const resource = await Resource.findById(resourceId).select('name quantityTotal');
  if (!resource) throw new HttpError(400, 'Resource not found');

  const reserved = await activeReserved(resourceId, excludeId);
  const available = resource.quantityTotal - reserved;
  if (quantity > available) {
    throw new HttpError(
      400,
      available <= 0
        ? `No stock available for ${resource.name}`
        : `Only ${available} available for ${resource.name}`,
    );
  }
};

const assertQuantity = (quantity) => {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new HttpError(400, 'quantity must be a whole number of at least 1');
  }
};

// ---------- reservations CRUD ----------

// GET /api/reservations
const getReservations = asyncHandler(async (req, res) => {
  const reservations = await ResourceReservation.find()
    .populate('event', 'name')
    .populate('resource', 'name unit')
    .sort({ reservedFrom: 1 });

  res.json({ success: true, count: reservations.length, data: reservations });
});

// GET /api/reservations/:id
const getReservation = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Reservation');
  const reservation = await ResourceReservation.findById(req.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');

  res.json({ success: true, data: await populateRefs(reservation) });
});

// POST /api/reservations
const createReservation = asyncHandler(async (req, res) => {
  const { event, resource, quantity } = req.body;

  if (!event) throw new HttpError(400, 'event is required');
  if (!resource) throw new HttpError(400, 'resource is required');
  await assertReference(Event, event, 'Event');
  await assertReference(Resource, resource, 'Resource');
  assertQuantity(quantity);
  await assertStockAvailable(resource, quantity);

  const reservation = await ResourceReservation.create(req.body);
  res.status(201).json({ success: true, data: await populateRefs(reservation) });
});

// PUT /api/reservations/:id
const updateReservation = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Reservation');
  const reservation = await ResourceReservation.findById(req.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');

  if ('event' in req.body && req.body.event) {
    await assertReference(Event, req.body.event, 'Event');
  }
  if ('resource' in req.body && req.body.resource) {
    await assertReference(Resource, req.body.resource, 'Resource');
  }
  if ('quantity' in req.body) assertQuantity(req.body.quantity);

  for (const field of UPDATABLE) {
    if (field in req.body) reservation[field] = req.body[field];
  }

  // Only reservations that still hold stock are checked; their own hold is
  // excluded, so keeping the same quantity always passes and cancelling or
  // releasing skips the check entirely.
  if (ACTIVE_STATUSES.includes(reservation.status)) {
    await assertStockAvailable(reservation.resource, reservation.quantity, reservation._id);
  }

  await reservation.save(); // runs model validators (date ordering, enum)
  res.json({ success: true, data: await populateRefs(reservation) });
});

// DELETE /api/reservations/:id
const deleteReservation = asyncHandler(async (req, res) => {
  validateId(req.params.id, 'Reservation');
  const reservation = await ResourceReservation.findByIdAndDelete(req.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');

  res.json({ success: true, message: 'Reservation deleted', data: reservation });
});

module.exports = {
  getReservations,
  getReservation,
  createReservation,
  updateReservation,
  deleteReservation,
};
