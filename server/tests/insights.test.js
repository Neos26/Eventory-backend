const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const Event = require('../models/Event');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('GET /api/dashboard/summary', () => {
  test('returns zeroed stats on an empty database', async () => {
    const res = await request(app).get('/api/dashboard/summary').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stats).toEqual({
      totalEvents: 0,
      upcomingEvents: 0,
      confirmedEvents: 0,
      totalResources: 0,
      activeReservations: 0,
      conflicts: 0,
    });
    expect(res.body.data.upcoming).toEqual([]);
    expect(res.body.data.recentConflicts).toEqual([]);
    expect(res.body.data.resourceAlerts).toEqual([]);
  });

  test('counts stats, flags venue conflicts and resource alerts', async () => {
    const org = await Organization.create({ name: 'Summary Org' });
    const venue = await Venue.create({ name: 'Hall', capacity: 100, organization: org._id });
    const resource = await Resource.create({
      name: 'Projector',
      category: 'audio_visual',
      quantityTotal: 10,
      quantityAvailable: 2, // 20% or less -> low stock alert
    });
    const inStock = await Resource.create({
      name: 'Chairs',
      category: 'furniture',
      quantityTotal: 100,
      quantityAvailable: 80,
    });

    const future = new Date(Date.now() + 7 * 86400000);
    const eventA = await Event.create({
      organization: org._id,
      venue: venue._id,
      name: 'Summit A',
      startDate: future,
      endDate: new Date(future.getTime() + 4 * 3600000),
      status: 'approved',
    });
    // Overlaps event A at the same venue -> venue conflict.
    await Event.create({
      organization: org._id,
      venue: venue._id,
      name: 'Summit B',
      startDate: new Date(future.getTime() + 2 * 3600000),
      endDate: new Date(future.getTime() + 6 * 3600000),
      status: 'pending',
    });
    // Completed event in the past -> not upcoming.
    await Event.create({
      organization: org._id,
      name: 'Past Event',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(),
      status: 'completed',
    });

    // Shortage: requirement 5, no reservations, only 10 total? -> ok.
    // Make a real shortage: requirement 15 > total 10.
    const requirement = await ResourceRequirement.create({
      event: eventA._id,
      resource: resource._id,
      quantity: 15,
      requiredDate: future,
    });
    const other = await Event.create({
      organization: org._id,
      name: 'Other Event',
      startDate: new Date(Date.now() + 3 * 86400000),
      endDate: new Date(Date.now() + 3 * 86400000 + 3600000),
      status: 'approved',
    });
    // Another event holds most of the chairs -> active reservation counted.
    const chairRequirement = await ResourceRequirement.create({
      event: other._id,
      resource: inStock._id,
      quantity: 50,
      requiredDate: other.startDate,
    });
    await ResourceReservation.create({
      event: other._id,
      requirement: chairRequirement._id,
      resource: inStock._id,
      quantity: 50,
      reservedFrom: other.startDate,
      reservedUntil: other.endDate,
      status: 'reserved',
    });

    const res = await request(app).get('/api/dashboard/summary').expect(200);
    const { stats, upcoming, recentConflicts, resourceAlerts } = res.body.data;

    expect(stats.totalEvents).toBe(4);
    expect(stats.upcomingEvents).toBe(3); // future, non-cancelled
    expect(stats.confirmedEvents).toBe(2); // approved A + approved other
    expect(stats.totalResources).toBe(2);
    expect(stats.activeReservations).toBe(1);
    // 1 venue conflict (A x B) + 1 resource shortage (projector 15 > 10)
    expect(stats.conflicts).toBe(2);

    expect(upcoming).toHaveLength(3);
    expect(upcoming.map((item) => item.venue)).toContain('Hall');

    const types = recentConflicts.map((conflict) => conflict.type).sort();
    expect(types).toEqual(['resource', 'venue']);

    const lowAlert = resourceAlerts.find((alert) => alert.name === 'Projector');
    expect(lowAlert).toBeDefined();
    expect(lowAlert.level).toBe('low');
    expect(resourceAlerts.some((alert) => alert.name === 'Chairs')).toBe(false);
    // requirement variable kept for clarity of the fixture
    expect(requirement.quantity).toBe(15);
  });
});

describe('GET /api/events/statistics', () => {
  test('groups events by status, organization and month', async () => {
    const orgA = await Organization.create({ name: 'Alpha Society' });
    const orgB = await Organization.create({ name: 'Beta Club' });

    await Event.create({
      organization: orgA._id,
      name: 'October Fest',
      startDate: new Date('2026-10-10T09:00:00Z'),
      endDate: new Date('2026-10-10T17:00:00Z'),
      status: 'approved',
    });
    await Event.create({
      organization: orgA._id,
      name: 'November Fair',
      startDate: new Date('2026-11-05T09:00:00Z'),
      endDate: new Date('2026-11-05T17:00:00Z'),
      status: 'pending',
    });
    await Event.create({
      organization: orgB._id,
      name: 'November Seminar',
      startDate: new Date('2026-11-20T09:00:00Z'),
      endDate: new Date('2026-11-20T17:00:00Z'),
      status: 'pending',
    });

    const res = await request(app).get('/api/events/statistics').expect(200);
    const { total, byStatus, byOrganization, monthly } = res.body.data;

    expect(total).toBe(3);

    const statusMap = Object.fromEntries(byStatus.map((item) => [item.status, item.count]));
    expect(statusMap.approved).toBe(1);
    expect(statusMap.pending).toBe(2);
    expect(statusMap.completed).toBe(0);
    expect(byStatus).toHaveLength(5); // every status present, zero-filled

    expect(byOrganization[0]).toEqual({ organization: 'Alpha Society', count: 2 });
    expect(byOrganization).toHaveLength(2);

    expect(monthly).toEqual([
      { month: '2026-10', count: 1 },
      { month: '2026-11', count: 2 },
    ]);
  });

  test('works on an empty database', async () => {
    const res = await request(app).get('/api/events/statistics').expect(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.byStatus.every((item) => item.count === 0)).toBe(true);
    expect(res.body.data.byOrganization).toEqual([]);
    expect(res.body.data.monthly).toEqual([]);
  });
});

describe('GET /api/resources/utilization', () => {
  test('computes reserved share per resource plus average', async () => {
    const org = await Organization.create({ name: 'Util Org' });
    const event = await Event.create({
      organization: org._id,
      name: 'Util Event',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 2 * 86400000),
    });

    const busy = await Resource.create({
      name: 'Speaker',
      category: 'audio_visual',
      quantityTotal: 10,
      quantityAvailable: 6,
    });
    const idle = await Resource.create({
      name: 'Table',
      category: 'furniture',
      quantityTotal: 20,
      quantityAvailable: 20,
    });

    await ResourceReservation.create({
      event: event._id,
      resource: busy._id,
      quantity: 4,
      reservedFrom: new Date(),
      reservedUntil: new Date(Date.now() + 3600000),
      status: 'reserved',
    });
    // Returned reservations must not count.
    await ResourceReservation.create({
      event: event._id,
      resource: idle._id,
      quantity: 20,
      reservedFrom: new Date(),
      reservedUntil: new Date(Date.now() + 3600000),
      status: 'returned',
    });

    const res = await request(app).get('/api/resources/utilization').expect(200);
    const { resources, averageUtilization } = res.body.data;

    expect(resources).toHaveLength(2);
    const speaker = resources.find((item) => item.name === 'Speaker');
    const table = resources.find((item) => item.name === 'Table');
    expect(speaker).toMatchObject({ total: 10, reserved: 4, available: 6, utilization: 40 });
    expect(table).toMatchObject({ total: 20, reserved: 0, utilization: 0 });
    expect(averageUtilization).toBe(20); // (40 + 0) / 2
    // Sorted by utilization desc.
    expect(resources[0].name).toBe('Speaker');
  });

  test('returns zero average on an empty database', async () => {
    const res = await request(app).get('/api/resources/utilization').expect(200);
    expect(res.body.data.resources).toEqual([]);
    expect(res.body.data.averageUtilization).toBe(0);
  });
});
