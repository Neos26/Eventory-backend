const Event = require('../models/Event');
const Resource = require('../models/Resource');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');
const Booking = require('../models/Booking');
const Venue = require('../models/Venue');
const { asyncHandler } = require('../utils/api');

const ACTIVE_RESERVATION_STATUSES = ['reserved', 'issued'];

// Low stock threshold: at or below 20% of total.
const LOW_STOCK_RATIO = 0.2;

// Detects venue clashes, same-org schedule overlaps and resource shortages
// across a list of active events. Returns one entry per problem.
const detectConflicts = async (activeEvents) => {
  const conflicts = [];
  for (let i = 0; i < activeEvents.length; i += 1) {
    for (let j = i + 1; j < activeEvents.length; j += 1) {
      const first = activeEvents[i];
      const second = activeEvents[j];
      // Overlap rule: first.start < second.end && second.start < first.end
      if (first.startDate >= second.endDate || second.startDate >= first.endDate) continue;

      const sameVenue =
        first.venue && second.venue && String(first.venue._id) === String(second.venue._id);

      if (sameVenue) {
        conflicts.push({
          type: 'venue',
          message: `${first.name} and ${second.name} share ${first.venue.name}`,
          date: second.startDate,
        });
      } else if (String(first.organization) === String(second.organization)) {
        conflicts.push({
          type: 'schedule',
          message: `${first.name} and ${second.name} overlap on the schedule`,
          date: second.startDate,
        });
      }
    }
  }

  // ---- resource shortages (same rule as event readiness) ----
  const [requirements, reservations] = await Promise.all([
    ResourceRequirement.find().populate('resource', 'name quantityTotal'),
    ResourceReservation.find({ status: { $in: ACTIVE_RESERVATION_STATUSES } }).select(
      'event resource quantity',
    ),
  ]);

  for (const requirement of requirements) {
    if (!requirement.resource) continue;
    const resourceId = String(requirement.resource._id);
    const requirementEvent = String(requirement.event);

    // Reserved by OTHER events reduces what this event can claim.
    let reservedByOthers = 0;
    for (const reservation of reservations) {
      if (
        String(reservation.resource) === resourceId &&
        String(reservation.event) !== requirementEvent
      ) {
        reservedByOthers += reservation.quantity;
      }
    }

    const available = Math.max(0, requirement.resource.quantityTotal - reservedByOthers);
    const shortage = requirement.quantity - available;
    if (shortage > 0) {
      const owner = activeEvents.find((event) => String(event._id) === requirementEvent);
      conflicts.push({
        type: 'resource',
        message: `${requirement.resource.name}: required ${requirement.quantity}, available ${available}`,
        resource: requirement.resource.name,
        required: requirement.quantity,
        available,
        shortage,
        date: owner ? owner.startDate : new Date(),
      });
    }
  }

  return conflicts;
};

// GET /api/dashboard/summary
// Single request that powers the whole dashboard page.
const getDashboardSummary = asyncHandler(async (req, res) => {
  const now = new Date();

  const [events, resources, activeReservations] = await Promise.all([
    Event.find().populate('venue', 'name'),
    Resource.find(),
    ResourceReservation.countDocuments({ status: { $in: ACTIVE_RESERVATION_STATUSES } }),
  ]);

  // ---- counts ----
  const activeEvents = events.filter((event) => event.status !== 'cancelled');
  const upcoming = activeEvents
    .filter((event) => event.startDate >= now)
    .sort((a, b) => a.startDate - b.startDate);
  const confirmedEvents = events.filter(
    (event) => event.status === 'planned' || event.status === 'ongoing',
  ).length;

  const conflicts = await detectConflicts(activeEvents);
  const recentConflicts = [...conflicts].sort((a, b) => b.date - a.date).slice(0, 5);

  // ---- resource alerts (out of stock / low stock / unavailable) ----
  const resourceAlerts = resources
    .map((resource) => {
      const outOfStock = resource.quantityAvailable === 0;
      const lowStock =
        resource.quantityTotal > 0 &&
        resource.quantityAvailable / resource.quantityTotal <= LOW_STOCK_RATIO;
      if (!resource.isAvailable) {
        return {
          _id: resource._id,
          name: resource.name,
          category: resource.category,
          total: resource.quantityTotal,
          available: resource.quantityAvailable,
          level: 'critical',
          message: 'Temporarily unavailable',
        };
      }
      if (outOfStock) {
        return {
          _id: resource._id,
          name: resource.name,
          category: resource.category,
          total: resource.quantityTotal,
          available: resource.quantityAvailable,
          level: 'critical',
          message: 'Out of stock',
        };
      }
      if (lowStock) {
        return {
          _id: resource._id,
          name: resource.name,
          category: resource.category,
          total: resource.quantityTotal,
          available: resource.quantityAvailable,
          level: 'low',
          message: 'Low stock',
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1));

  res.json({
    success: true,
    data: {
      stats: {
        totalEvents: events.length,
        upcomingEvents: upcoming.length,
        confirmedEvents,
        totalResources: resources.length,
        activeReservations,
        conflicts: conflicts.length,
      },
      upcoming: upcoming.slice(0, 5).map((event) => ({
        _id: event._id,
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
        status: event.status,
        venue: event.venue ? event.venue.name : null,
      })),
      recentConflicts,
      resourceAlerts,
    },
  });
});

// GET /api/dashboard/booker (booker role)
// Upcoming own events, booking counts and recent activity.
const getBookerDashboard = asyncHandler(async (req, res) => {
  const now = new Date();
  const bookerId = req.user._id;

  const [upcomingEvents, pendingBookings, approvedBookings, rejectedBookings, bookings, events] =
    await Promise.all([
      Event.find({ bookerId, status: { $ne: 'cancelled' }, startDate: { $gte: now } })
        .populate('venue', 'name')
        .sort({ startDate: 1 })
        .limit(10),
      Booking.countDocuments({ bookerId, status: 'Pending' }),
      Booking.countDocuments({ bookerId, status: 'Approved' }),
      Booking.countDocuments({ bookerId, status: 'Rejected' }),
      Booking.find({ bookerId })
        .populate('eventId', 'name')
        .select('status createdAt')
        .sort({ createdAt: -1 })
        .limit(5),
      Event.find({ bookerId }).select('name status createdAt').sort({ createdAt: -1 }).limit(5),
    ]);

  // Merge bookings + events into one recent-activity feed.
  const recentActivity = [
    ...bookings.map((booking) => ({
      type: 'booking',
      id: booking._id,
      label: booking.eventId ? `Booking for ${booking.eventId.name}` : 'Booking',
      status: booking.status,
      date: booking.createdAt,
    })),
    ...events.map((event) => ({
      type: 'event',
      id: event._id,
      label: event.name,
      status: event.status,
      date: event.createdAt,
    })),
  ]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);

  res.json({
    success: true,
    data: {
      upcomingEvents: upcomingEvents.map((event) => ({
        _id: event._id,
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
        status: event.status,
        venue: event.venue ? event.venue.name : null,
      })),
      pendingBookings,
      approvedBookings,
      rejectedBookings,
      recentActivity,
    },
  });
});

// GET /api/dashboard/management (management role)
// System-wide counts, active conflicts and resource utilization.
const getManagementDashboard = asyncHandler(async (req, res) => {
  const now = new Date();

  const [events, pendingRequests, approvedEvents, totalResources, totalVenues, reservations] =
    await Promise.all([
      Event.find().populate('venue', 'name'),
      Booking.countDocuments({ status: 'Pending' }),
      Booking.countDocuments({ status: 'Approved' }),
      Resource.countDocuments(),
      Venue.countDocuments(),
      ResourceReservation.find({ status: { $in: ACTIVE_RESERVATION_STATUSES } }).select(
        'resource quantity',
      ),
    ]);

  const activeEvents = events.filter((event) => event.status !== 'cancelled');
  const upcomingEvents = activeEvents.filter((event) => event.startDate >= now).length;
  const conflicts = await detectConflicts(activeEvents);

  // Resource utilization: reserved share of total stock (same math as
  // GET /api/resources/utilization).
  const resources = await Resource.find();
  const reservedByResource = new Map();
  for (const reservation of reservations) {
    const key = String(reservation.resource);
    reservedByResource.set(key, (reservedByResource.get(key) || 0) + reservation.quantity);
  }
  const utilization = resources.map((resource) => {
    const reserved = reservedByResource.get(String(resource._id)) || 0;
    const percent =
      resource.quantityTotal > 0
        ? Math.min(100, Math.round((reserved / resource.quantityTotal) * 100))
        : 0;
    return { _id: resource._id, name: resource.name, utilization: percent };
  });
  const averageUtilization =
    utilization.length > 0
      ? Math.round(utilization.reduce((sum, item) => sum + item.utilization, 0) / utilization.length)
      : 0;

  res.json({
    success: true,
    data: {
      totalEvents: events.length,
      pendingRequests,
      approvedEvents,
      upcomingEvents,
      totalResources,
      totalVenues,
      activeConflicts: conflicts.length,
      resourceUtilization: {
        average: averageUtilization,
        resources: utilization,
      },
    },
  });
});

module.exports = { getDashboardSummary, getBookerDashboard, getManagementDashboard };
