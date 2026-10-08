const Event = require('../models/Event');
const Organization = require('../models/Organization');
const Resource = require('../models/Resource');
const ResourceReservation = require('../models/ResourceReservation');
const { asyncHandler } = require('../utils/api');

const EVENT_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'completed'];
const ACTIVE_RESERVATION_STATUSES = ['reserved', 'issued'];
const MONTH_LIMIT = 12;

// GET /api/events/statistics
// Aggregates for the analytics charts: status, organization, monthly.
const getEventStatistics = asyncHandler(async (req, res) => {
  const [events, organizations] = await Promise.all([
    Event.find().select('organization startDate status'),
    Organization.find().select('name'),
  ]);

  // Events by status (fixed order, zero-filled).
  const statusCounts = new Map(EVENT_STATUSES.map((status) => [status, 0]));
  // Events by organization.
  const organizationCounts = new Map();
  // Events by month of startDate.
  const monthCounts = new Map();

  const orgNameById = new Map(
    organizations.map((organization) => [String(organization._id), organization.name]),
  );

  for (const event of events) {
    statusCounts.set(event.status, (statusCounts.get(event.status) || 0) + 1);

    const orgKey = String(event.organization);
    const orgLabel = orgNameById.get(orgKey) || 'Unknown organization';
    organizationCounts.set(orgLabel, (organizationCounts.get(orgLabel) || 0) + 1);

    const start = new Date(event.startDate);
    if (!Number.isNaN(start.getTime())) {
      const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    }
  }

  res.json({
    success: true,
    data: {
      total: events.length,
      byStatus: EVENT_STATUSES.map((status) => ({
        status,
        count: statusCounts.get(status) || 0,
      })),
      byOrganization: [...organizationCounts.entries()]
        .map(([organization, count]) => ({ organization, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      monthly: [...monthCounts.entries()]
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-MONTH_LIMIT),
    },
  });
});

// GET /api/resources/utilization
// Reserved stock vs total stock per resource, plus the overall average.
const getResourceUtilization = asyncHandler(async (req, res) => {
  const [resources, reservations] = await Promise.all([
    Resource.find(),
    ResourceReservation.find({ status: { $in: ACTIVE_RESERVATION_STATUSES } }).select(
      'resource quantity',
    ),
  ]);

  const reservedByResource = new Map();
  for (const reservation of reservations) {
    const key = String(reservation.resource);
    reservedByResource.set(key, (reservedByResource.get(key) || 0) + reservation.quantity);
  }

  const utilization = resources
    .map((resource) => {
      const reserved = reservedByResource.get(String(resource._id)) || 0;
      const percent =
        resource.quantityTotal > 0
          ? Math.min(100, Math.round((reserved / resource.quantityTotal) * 100))
          : 0;
      return {
        _id: resource._id,
        name: resource.name,
        category: resource.category,
        unit: resource.unit,
        total: resource.quantityTotal,
        reserved,
        available: resource.quantityAvailable,
        utilization: percent,
      };
    })
    .sort((a, b) => b.utilization - a.utilization);

  const average =
    utilization.length > 0
      ? Math.round(
          utilization.reduce((sum, item) => sum + item.utilization, 0) / utilization.length,
        )
      : 0;

  res.json({
    success: true,
    data: {
      resources: utilization,
      averageUtilization: average,
    },
  });
});

module.exports = { getEventStatistics, getResourceUtilization };
