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

// Shared fixtures, rebuilt before every test.
let org;
let venue;
let resource;
let baseEvent;

const makeEvent = (overrides = {}) =>
  Event.create({
    organization: org._id,
    name: 'Default Event',
    startDate: new Date('2026-06-01T09:00:00Z'),
    endDate: new Date('2026-06-01T17:00:00Z'),
    ...overrides,
  });

beforeEach(async () => {
  org = await Organization.create({ name: 'Logic Org' });
  venue = await Venue.create({ name: 'Main Hall', capacity: 200, organization: org._id });
  resource = await Resource.create({
    organization: org._id,
    name: 'Chairs',
    category: 'furniture',
    quantityTotal: 100,
    quantityAvailable: 100,
    unit: 'unit',
  });
  baseEvent = await makeEvent({ name: 'Base Event', venue: venue._id });
});

describe('venue availability', () => {
  test('free window on an active venue is available', async () => {
    const res = await request(app)
      .get(`/api/venues/${venue._id}/availability`)
      .query({ start: '2026-07-01T09:00:00Z', end: '2026-07-01T17:00:00Z' })
      .expect(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.conflicts).toHaveLength(0);
  });

  test('window overlapping an existing event reports the conflict', async () => {
    const res = await request(app)
      .get(`/api/venues/${venue._id}/availability`)
      .query({ start: '2026-06-01T12:00:00Z', end: '2026-06-01T14:00:00Z' })
      .expect(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0].name).toBe('Base Event');
  });

  test('adjacent (touching) windows do not overlap', async () => {
    const res = await request(app)
      .get(`/api/venues/${venue._id}/availability`)
      .query({ start: '2026-06-01T17:00:00Z', end: '2026-06-01T19:00:00Z' })
      .expect(200);
    expect(res.body.data.available).toBe(true);
  });

  test('inactive venue is never available', async () => {
    venue.isActive = false;
    await venue.save();

    const res = await request(app)
      .get(`/api/venues/${venue._id}/availability`)
      .query({ start: '2026-07-01T09:00:00Z', end: '2026-07-01T17:00:00Z' })
      .expect(200);
    expect(res.body.data.available).toBe(false);
  });

  test('date-only query covers the whole day', async () => {
    const res = await request(app)
      .get(`/api/venues/${venue._id}/availability`)
      .query({ date: '2026-06-01' })
      .expect(200);
    expect(res.body.data.available).toBe(false); // Base Event sits on that day
  });

  test('missing query params return 400', async () => {
    await request(app).get(`/api/venues/${venue._id}/availability`).expect(400);
  });
});

describe('resource availability', () => {
  test('all stock is available when nothing is reserved', async () => {
    const res = await request(app)
      .get(`/api/resources/${resource._id}/availability`)
      .expect(200);
    expect(res.body.data.total).toBe(100);
    expect(res.body.data.reserved).toBe(0);
    expect(res.body.data.available).toBe(100);
  });

  test('active reservations reduce availability', async () => {
    const other = await makeEvent({ name: 'Other Event' });
    await ResourceReservation.create({
      event: other._id,
      resource: resource._id,
      quantity: 40,
      reservedFrom: new Date('2026-06-01T09:00:00Z'),
      reservedUntil: new Date('2026-06-01T17:00:00Z'),
      status: 'reserved',
    });

    const res = await request(app)
      .get(`/api/resources/${resource._id}/availability`)
      .expect(200);
    expect(res.body.data.reserved).toBe(40);
    expect(res.body.data.available).toBe(60);
  });

  test('returned and cancelled reservations do not count', async () => {
    const other = await makeEvent({ name: 'Returned Event' });
    await ResourceReservation.create({
      event: other._id,
      resource: resource._id,
      quantity: 30,
      reservedFrom: new Date('2026-06-01T09:00:00Z'),
      reservedUntil: new Date('2026-06-01T17:00:00Z'),
      status: 'returned',
    });

    const res = await request(app)
      .get(`/api/resources/${resource._id}/availability`)
      .expect(200);
    expect(res.body.data.reserved).toBe(0);
    expect(res.body.data.available).toBe(100);
  });
});

describe('resource requirements CRUD', () => {
  test('create defaults requiredDate to the event start, list shows populated resource', async () => {
    const created = await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: resource._id, quantity: 50 })
      .expect(201);
    expect(created.body.data.requiredDate).toBe(baseEvent.startDate.toISOString());
    expect(created.body.data.resource.name).toBe('Chairs');

    const list = await request(app)
      .get(`/api/events/${baseEvent._id}/requirements`)
      .expect(200);
    expect(list.body.count).toBe(1);

    const updated = await request(app)
      .put(`/api/events/${baseEvent._id}/requirements/${created.body.data._id}`)
      .send({ quantity: 60, priority: 'high' })
      .expect(200);
    expect(updated.body.data.quantity).toBe(60);
    expect(updated.body.data.priority).toBe('high');

    await request(app)
      .delete(`/api/events/${baseEvent._id}/requirements/${created.body.data._id}`)
      .expect(200);

    const afterDelete = await request(app)
      .get(`/api/events/${baseEvent._id}/requirements`)
      .expect(200);
    expect(afterDelete.body.count).toBe(0);
  });

  test('unknown resource reference is rejected with 400', async () => {
    await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: new mongoose.Types.ObjectId(), quantity: 10 })
      .expect(400);
  });

  test('requirement of one event cannot be edited through another event', async () => {
    const created = await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: resource._id, quantity: 10 })
      .expect(201);

    const otherEvent = await makeEvent({ name: 'Intruder' });
    await request(app)
      .put(`/api/events/${otherEvent._id}/requirements/${created.body.data._id}`)
      .send({ quantity: 99 })
      .expect(404);
  });
});

describe('event conflicts', () => {
  test('overlapping event at the same venue is a venue conflict', async () => {
    await makeEvent({
      name: 'Clashing Concert',
      venue: venue._id,
      startDate: new Date('2026-06-01T12:00:00Z'),
      endDate: new Date('2026-06-01T20:00:00Z'),
    });

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/conflicts`)
      .expect(200);
    expect(res.body.data.venueConflicts).toHaveLength(1);
    expect(res.body.data.venueConflicts[0].name).toBe('Clashing Concert');
    expect(res.body.data.hasConflicts).toBe(true);
  });

  test('same-org overlapping event elsewhere is a schedule conflict only', async () => {
    await makeEvent({
      name: 'Remote Workshop',
      startDate: new Date('2026-06-01T10:00:00Z'),
      endDate: new Date('2026-06-01T12:00:00Z'),
      // no venue
    });

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/conflicts`)
      .expect(200);
    expect(res.body.data.venueConflicts).toHaveLength(0);
    expect(res.body.data.scheduleConflicts).toHaveLength(1);
    expect(res.body.data.hasConflicts).toBe(true);
  });

  test('cancelled events do not create conflicts', async () => {
    await makeEvent({
      name: 'Cancelled Clash',
      venue: venue._id,
      status: 'cancelled',
      startDate: new Date('2026-06-01T12:00:00Z'),
      endDate: new Date('2026-06-01T20:00:00Z'),
    });

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/conflicts`)
      .expect(200);
    expect(res.body.data.venueConflicts).toHaveLength(0);
    expect(res.body.data.hasConflicts).toBe(false);
  });

  test('non-overlapping events have no conflicts', async () => {
    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/conflicts`)
      .expect(200);
    expect(res.body.data.venueConflicts).toHaveLength(0);
    expect(res.body.data.scheduleConflicts).toHaveLength(0);
    expect(res.body.data.resourceConflicts).toHaveLength(0);
    expect(res.body.data.hasConflicts).toBe(false);
  });
});

describe('event readiness', () => {
  test('not ready without a venue', async () => {
    const noVenue = await makeEvent({ name: 'No Venue Yet' });

    const res = await request(app)
      .get(`/api/events/${noVenue._id}/readiness`)
      .expect(200);
    expect(res.body.data.ready).toBe(false);
    expect(res.body.data.venueAvailable).toBe(false);
  });

  test('not ready when venue is inactive', async () => {
    venue.isActive = false;
    await venue.save();

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/readiness`)
      .expect(200);
    expect(res.body.data.ready).toBe(false);
    expect(res.body.data.venueAvailable).toBe(false);
  });

  test('not ready when another event holds the same venue', async () => {
    await makeEvent({
      name: 'Double Booked',
      venue: venue._id,
      startDate: new Date('2026-06-01T12:00:00Z'),
      endDate: new Date('2026-06-01T20:00:00Z'),
    });

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/readiness`)
      .expect(200);
    expect(res.body.data.ready).toBe(false);
    expect(res.body.data.venueAvailable).toBe(false);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0].type).toBe('venue');
  });

  test('not ready when requirements exceed available stock', async () => {
    await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: resource._id, quantity: 150 }) // only 100 chairs exist
      .expect(201);

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/readiness`)
      .expect(200);
    expect(res.body.data.ready).toBe(false);
    expect(res.body.data.resourceIssues).toHaveLength(1);
    expect(res.body.data.resourceIssues[0].shortage).toBe(50);
  });

  test('another event reservations shrink what this event can claim', async () => {
    const other = await makeEvent({ name: 'Chair Hog' });
    await ResourceReservation.create({
      event: other._id,
      resource: resource._id,
      quantity: 70,
      reservedFrom: new Date('2026-06-01T09:00:00Z'),
      reservedUntil: new Date('2026-06-01T17:00:00Z'),
      status: 'reserved',
    });

    // 100 total - 70 reserved by others = 30 available, requirement is 50.
    await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: resource._id, quantity: 50 })
      .expect(201);

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/readiness`)
      .expect(200);
    expect(res.body.data.resourceIssues[0].available).toBe(30);
    expect(res.body.data.resourceIssues[0].shortage).toBe(20);
  });

  test('this event\'s own reservations do not count against itself', async () => {
    await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: resource._id, quantity: 50 })
      .expect(201);

    const requirement = await ResourceRequirement.findOne({ event: baseEvent._id });
    await ResourceReservation.create({
      event: baseEvent._id,
      requirement: requirement._id,
      resource: resource._id,
      quantity: 50,
      reservedFrom: new Date('2026-06-01T09:00:00Z'),
      reservedUntil: new Date('2026-06-01T17:00:00Z'),
      status: 'reserved',
    });

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/readiness`)
      .expect(200);
    expect(res.body.data.resourceIssues).toHaveLength(0);
    expect(res.body.data.ready).toBe(true);
  });

  test('ready when venue is active, free, and requirements are covered', async () => {
    await request(app)
      .post(`/api/events/${baseEvent._id}/requirements`)
      .send({ resource: resource._id, quantity: 40 })
      .expect(201);

    const res = await request(app)
      .get(`/api/events/${baseEvent._id}/readiness`)
      .expect(200);
    expect(res.body.data.ready).toBe(true);
    expect(res.body.data.venueAvailable).toBe(true);
    expect(res.body.data.resourceIssues).toHaveLength(0);
    expect(res.body.data.conflicts).toHaveLength(0);
  });
});
