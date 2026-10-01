const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const Event = require('../models/Event');
const ResourceRequirement = require('../models/ResourceRequirement');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let org;
let venue;

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
});

beforeEach(async () => {
  org = await Organization.create({ name: 'Conflict Org' });
  venue = await Venue.create({ name: 'AVR', capacity: 80, isActive: true });
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const makeEvent = (overrides = {}) =>
  Event.create({
    organization: org._id,
    name: 'Base Event',
    startDate: new Date('2027-06-10T13:00:00.000Z'),
    endDate: new Date('2027-06-10T16:00:00.000Z'),
    ...overrides,
  });

describe('GET /api/events/:id/conflicts', () => {
  test('returns the grouped arrays AND the flat spec conflicts list', async () => {
    const first = await makeEvent({ venue: venue._id });
    await makeEvent({
      name: 'Rival Event',
      venue: venue._id,
      startDate: new Date('2027-06-10T14:00:00.000Z'),
      endDate: new Date('2027-06-10T17:00:00.000Z'),
    });

    const res = await request(app).get(`/api/events/${first._id}/conflicts`).expect(200);
    const data = res.body.data;

    // Legacy grouped shape (used by the existing frontend) stays intact.
    expect(data.venueConflicts).toHaveLength(1);
    expect(data.scheduleConflicts).toHaveLength(1); // same org too, but deduped below
    expect(data.hasConflicts).toBe(true);

    // Spec shape: flat conflicts[] with uppercase types.
    const venueConflict = data.conflicts.find((c) => c.type === 'VENUE_CONFLICT');
    expect(venueConflict).toMatchObject({ venue: 'AVR', event: 'Rival Event' });
    // The overlapping pair must not be double-reported as a schedule conflict.
    expect(data.conflicts.filter((c) => c.type === 'SCHEDULE_CONFLICT')).toHaveLength(0);
    expect(data.conflicts).toHaveLength(1);
  });

  test('reports RESOURCE_SHORTAGE with required/available/shortage numbers', async () => {
    const projector = await Resource.create({
      name: 'Projector',
      quantityTotal: 3,
      quantityAvailable: 3,
    });
    const event = await makeEvent({ venue: venue._id });
    await ResourceRequirement.create({
      event: event._id,
      resource: projector._id,
      quantity: 5,
      requiredDate: event.startDate,
    });

    const res = await request(app).get(`/api/events/${event._id}/conflicts`).expect(200);
    const shortage = res.body.data.conflicts.find((c) => c.type === 'RESOURCE_SHORTAGE');
    expect(shortage).toMatchObject({
      resource: 'Projector',
      required: 5,
      available: 3,
      shortage: 2,
    });
    expect(res.body.data.resourceConflicts).toHaveLength(1);
  });

  test('reports SCHEDULE_CONFLICT for same-org overlaps in different venues', async () => {
    const otherVenue = await Venue.create({ name: 'Gym', capacity: 300 });
    const first = await makeEvent({ venue: venue._id });
    await makeEvent({
      name: 'Parallel',
      venue: otherVenue._id,
      startDate: new Date('2027-06-10T15:00:00.000Z'),
      endDate: new Date('2027-06-10T18:00:00.000Z'),
    });

    const res = await request(app).get(`/api/events/${first._id}/conflicts`).expect(200);
    const schedule = res.body.data.conflicts.find((c) => c.type === 'SCHEDULE_CONFLICT');
    expect(schedule).toMatchObject({ event: 'Parallel' });
    expect(res.body.data.conflicts.filter((c) => c.type === 'VENUE_CONFLICT')).toHaveLength(0);
  });

  test('a clear event returns an empty conflicts list', async () => {
    const event = await makeEvent({ venue: venue._id });
    const res = await request(app).get(`/api/events/${event._id}/conflicts`).expect(200);
    expect(res.body.data.conflicts).toEqual([]);
    expect(res.body.data.hasConflicts).toBe(false);
  });

  test('unknown id is 404, bad id is 400', async () => {
    await request(app).get('/api/events/000000000000000000000000/conflicts').expect(404);
    await request(app).get('/api/events/nope/conflicts').expect(400);
  });
});

describe('GET /api/events/:id/readiness (spec contract)', () => {
  test('returns ready, venueAvailable, resourceIssues and conflicts keys', async () => {
    const event = await makeEvent({ venue: venue._id });
    const res = await request(app).get(`/api/events/${event._id}/readiness`).expect(200);

    const data = res.body.data;
    expect(data).toHaveProperty('ready');
    expect(data).toHaveProperty('venueAvailable');
    expect(data).toHaveProperty('resourceIssues');
    expect(data).toHaveProperty('conflicts');
    expect(data.ready).toBe(true);
    expect(data.venueAvailable).toBe(true);
    expect(Array.isArray(data.resourceIssues)).toBe(true);
    expect(Array.isArray(data.conflicts)).toBe(true);
  });

  test('is not ready when a venue conflict exists', async () => {
    const first = await makeEvent({ venue: venue._id });
    await makeEvent({
      name: 'Rival',
      venue: venue._id,
      startDate: new Date('2027-06-10T14:00:00.000Z'),
      endDate: new Date('2027-06-10T17:00:00.000Z'),
    });

    const res = await request(app).get(`/api/events/${first._id}/readiness`).expect(200);
    expect(res.body.data.ready).toBe(false);
    expect(res.body.data.venueAvailable).toBe(false);
  });
});
