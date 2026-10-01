const Event = require('../models/Event');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');
const { asyncHandler, HttpError, validateId } = require('../utils/api');

const RESOURCE_FIELDS = 'name category quantityTotal quantityAvailable unit';

const EVENT_UPDATABLE = [
  'name',
  'description',
  'category',
  'organization',
  'venue',
  'startDate',
  'endDate',
  'expectedAttendees',
  'status',
];

const REQUIREMENT_UPDATABLE = ['resource', 'quantity', 'requiredDate', 'priority', 'status', 'notes'];

// ---------- helpers ----------

const findEventOr404 = async (id) => {
  validateId(id, 'Event');
  const event = await Event.findById(id).populate('venue', 'name isActive');
  if (!event) throw new HttpError(404, 'Event not found');
  return event;
};

// Management sees everything; a booker only ever owns their own events.
const ownsEvent = (user, event) =>
  user.role === 'management' ||
  (event.bookerId != null && String(event.bookerId) === String(user._id));

// Read access: anonymous requests keep working (public reads), but an
// authenticated booker may only open their own events.
const assertEventReadAccess = (req, event) => {
  if (req.user && !ownsEvent(req.user, event)) {
    throw new HttpError(403, 'You are not allowed to view this event.');
  }
};

// Write access: always called behind authenticate, so req.user exists.
const assertEventWriteAccess = (req, event) => {
  if (!ownsEvent(req.user, event)) {
    throw new HttpError(403, 'You are not allowed to modify this event.');
  }
};

// Checks that a referenced document actually exists before saving it.
const assertReference = async (Model, id, label) => {
  validateId(id, label);
  const doc = await Model.findById(id).select('_id');
  if (!doc) throw new HttpError(400, `${label} not found`);
};

// Two events overlap when one starts before the other ends.
const overlapClause = (event) => ({
  _id: { $ne: event._id },
  status: { $ne: 'cancelled' },
  startDate: { $lt: event.endDate },
  endDate: { $gt: event.startDate },
});

// Requirements whose quantity cannot be covered after other events' reservations.
const computeResourceIssues = async (event) => {
  const requirements = await ResourceRequirement.find({ event: event._id });
  if (requirements.length === 0) return [];

  const resourceIds = requirements.map((requirement) => requirement.resource);
  const resources = await Resource.find({ _id: { $in: resourceIds } });
  const resourceMap = new Map(resources.map((resource) => [String(resource._id), resource]));

  // Reservations made by OTHER events reduce what this event can use.
  const reservations = await ResourceReservation.find({
    resource: { $in: resourceIds },
    status: { $in: ['reserved', 'issued'] },
    event: { $ne: event._id },
  }).select('resource quantity');

  const reservedByOthers = new Map();
  for (const reservation of reservations) {
    const key = String(reservation.resource);
    reservedByOthers.set(key, (reservedByOthers.get(key) || 0) + reservation.quantity);
  }

  const issues = [];
  for (const requirement of requirements) {
    const key = String(requirement.resource);
    const resource = resourceMap.get(key);
    const total = resource ? resource.quantityTotal : 0;
    const reserved = reservedByOthers.get(key) || 0;
    const available = total - reserved;
    const shortage = requirement.quantity - available;

    if (shortage > 0) {
      issues.push({
        resource: resource ? resource.name : 'Unknown resource',
        resourceId: requirement.resource,
        required: requirement.quantity,
        available,
        shortage,
      });
    }
  }
  return issues;
};

const computeConflicts = async (event) => {
  const [venueConflicts, scheduleConflicts, resourceIssues] = await Promise.all([
    event.venue
      ? Event.find({ ...overlapClause(event), venue: event.venue._id })
          .select('name startDate endDate status')
          .lean()
      : Promise.resolve([]),
    // Schedule conflict: the same organization has two events at the same time.
    Event.find({ ...overlapClause(event), organization: event.organization })
      .select('name startDate endDate status')
      .lean(),
    computeResourceIssues(event),
  ]);

  return { venueConflicts, scheduleConflicts, resourceIssues };
};

// ---------- events CRUD ----------

// GET /api/events
// Bookers see only their own events; everyone else sees all.
const getEvents = asyncHandler(async (req, res) => {
  const filter = req.user && req.user.role === 'booker' ? { bookerId: req.user._id } : {};
  const events = await Event.find(filter).sort({ startDate: 1 });
  res.json({ success: true, count: events.length, data: events });
});

// GET /api/events/:id
const getEvent = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.id);
  assertEventReadAccess(req, event);
  res.json({ success: true, data: event });
});

// POST /api/events
const createEvent = asyncHandler(async (req, res) => {
  if (req.body.organization) await assertReference(Organization, req.body.organization, 'Organization');
  if (req.body.venue) await assertReference(Venue, req.body.venue, 'Venue');

  // Ownership always comes from the token - a bookerId in the body is ignored.
  const event = await Event.create({ ...req.body, bookerId: req.user._id });
  res.status(201).json({ success: true, data: event });
});

// PUT /api/events/:id
const updateEvent = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.id);
  assertEventWriteAccess(req, event);

  if ('organization' in req.body && req.body.organization) {
    await assertReference(Organization, req.body.organization, 'Organization');
  }
  if ('venue' in req.body && req.body.venue) {
    await assertReference(Venue, req.body.venue, 'Venue');
  }

  for (const field of EVENT_UPDATABLE) {
    if (field in req.body) event[field] = req.body[field];
  }
  await event.save(); // runs model validators (including date ordering)
  res.json({ success: true, data: event });
});

// DELETE /api/events/:id
const deleteEvent = asyncHandler(async (req, res) => {
  const existing = await findEventOr404(req.params.id);
  assertEventWriteAccess(req, existing);

  validateId(req.params.id, 'Event');
  const event = await Event.findByIdAndDelete(req.params.id);
  if (!event) throw new HttpError(404, 'Event not found');

  // Requirements and reservations belong to the event. Removing them keeps
  // stock holds and dashboard shortages from outliving a deleted event.
  await Promise.all([
    ResourceRequirement.deleteMany({ event: event._id }),
    ResourceReservation.deleteMany({ event: event._id }),
  ]);

  res.json({ success: true, message: 'Event deleted', data: event });
});

// ---------- resource requirements ----------

// GET /api/events/:eventId/requirements
const getEventRequirements = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.eventId);
  assertEventReadAccess(req, event);
  const requirements = await ResourceRequirement.find({ event: event._id })
    .populate('resource', RESOURCE_FIELDS)
    .sort({ createdAt: 1 });

  res.json({ success: true, count: requirements.length, data: requirements });
});

// POST /api/events/:eventId/requirements
const createEventRequirement = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.eventId);
  assertEventWriteAccess(req, event);
  const { resource, quantity, requiredDate, priority, notes } = req.body;

  if (!resource) throw new HttpError(400, 'resource is required');
  await assertReference(Resource, resource, 'Resource');

  const requirement = await ResourceRequirement.create({
    event: event._id,
    resource,
    quantity,
    // Falls back to the event start date when not provided.
    requiredDate: requiredDate || event.startDate,
    ...(priority && { priority }),
    ...(notes && { notes }),
  });
  await requirement.populate('resource', RESOURCE_FIELDS);

  res.status(201).json({ success: true, data: requirement });
});

// PUT /api/events/:eventId/requirements/:requirementId
const updateEventRequirement = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.eventId);
  assertEventWriteAccess(req, event);
  validateId(req.params.requirementId, 'Requirement');

  const requirement = await ResourceRequirement.findOne({
    _id: req.params.requirementId,
    event: event._id,
  });
  if (!requirement) throw new HttpError(404, 'Requirement not found');

  if ('resource' in req.body && req.body.resource) {
    await assertReference(Resource, req.body.resource, 'Resource');
  }
  for (const field of REQUIREMENT_UPDATABLE) {
    if (field in req.body) requirement[field] = req.body[field];
  }
  await requirement.save();
  await requirement.populate('resource', RESOURCE_FIELDS);

  res.json({ success: true, data: requirement });
});

// DELETE /api/events/:eventId/requirements/:requirementId
const deleteEventRequirement = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.eventId);
  assertEventWriteAccess(req, event);
  validateId(req.params.requirementId, 'Requirement');

  const requirement = await ResourceRequirement.findOneAndDelete({
    _id: req.params.requirementId,
    event: event._id,
  });
  if (!requirement) throw new HttpError(404, 'Requirement not found');

  res.json({ success: true, message: 'Requirement deleted', data: requirement });
});

// ---------- conflicts & readiness ----------

// GET /api/events/:id/conflicts
const getEventConflicts = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.id);
  assertEventReadAccess(req, event);
  const { venueConflicts, scheduleConflicts, resourceIssues } = await computeConflicts(event);

  // Flat, spec-friendly list alongside the grouped arrays above:
  // [{ type: "RESOURCE_SHORTAGE", resource, required, available, shortage }, ...]
  const conflicts = [];
  if (event.endDate <= event.startDate) {
    conflicts.push({ type: 'INVALID_SCHEDULE', message: 'End time is not after start time' });
  }
  const venuePairIds = new Set(venueConflicts.map((conflict) => String(conflict._id)));
  for (const conflict of venueConflicts) {
    conflicts.push({
      type: 'VENUE_CONFLICT',
      venue: event.venue ? event.venue.name : null,
      event: conflict.name,
      startDate: conflict.startDate,
      endDate: conflict.endDate,
    });
  }
  for (const conflict of scheduleConflicts) {
    if (venuePairIds.has(String(conflict._id))) continue; // venue already reports it
    conflicts.push({
      type: 'SCHEDULE_CONFLICT',
      event: conflict.name,
      startDate: conflict.startDate,
      endDate: conflict.endDate,
    });
  }
  for (const issue of resourceIssues) {
    conflicts.push({
      type: 'RESOURCE_SHORTAGE',
      resource: issue.resource,
      resourceId: issue.resourceId,
      required: issue.required,
      available: issue.available,
      shortage: issue.shortage,
    });
  }

  res.json({
    success: true,
    data: {
      event: { id: event._id, name: event.name, startDate: event.startDate, endDate: event.endDate },
      venueConflicts,
      scheduleConflicts,
      resourceConflicts: resourceIssues,
      conflicts,
      hasConflicts:
        venueConflicts.length + scheduleConflicts.length + resourceIssues.length > 0,
    },
  });
});

// GET /api/events/:id/readiness
const getEventReadiness = asyncHandler(async (req, res) => {
  const event = await findEventOr404(req.params.id);
  assertEventReadAccess(req, event);
  const { venueConflicts, scheduleConflicts, resourceIssues } = await computeConflicts(event);

  const venueAvailable = Boolean(event.venue) && event.venue.isActive && venueConflicts.length === 0;

  // One conflicting event should only be reported once (venue beats schedule).
  const seen = new Set();
  const conflicts = [];
  for (const [type, list] of [
    ['venue', venueConflicts],
    ['schedule', scheduleConflicts],
  ]) {
    for (const conflict of list) {
      const key = String(conflict._id);
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({ type, ...conflict });
    }
  }

  const ready = venueAvailable && resourceIssues.length === 0 && conflicts.length === 0;

  res.json({
    success: true,
    data: {
      ready,
      venueAvailable,
      resourceIssues,
      conflicts,
    },
  });
});

module.exports = {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventRequirements,
  createEventRequirement,
  updateEventRequirement,
  deleteEventRequirement,
  getEventConflicts,
  getEventReadiness,
};
