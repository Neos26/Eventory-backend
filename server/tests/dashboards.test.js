const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const { authedRequest, registerToken } = require('./helpers/authedRequest');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let alphaToken; // booker
let managementToken;
let orgId;

const createEvent = async (token, name, overrides = {}) => {
  const res = await authedRequest(app, token)
    .post('/api/events')
    .send({
      organization: orgId,
      name,
      startDate: '2027-08-10T10:00:00.000Z',
      endDate: '2027-08-10T12:00:00.000Z',
      ...overrides,
    })
    .expect(201);
  return res.body.data;
};

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  alphaToken = await registerToken(app, 'alpha@dash.test', 'booker');
  managementToken = await registerToken(app, 'boss@dash.test', 'management');
});

beforeEach(async () => {
  const org = await Organization.create({ name: 'Dash Org' });
  orgId = String(org._id);
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections).filter(
    (collection) => collection.collectionName !== 'users',
  );
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('GET /api/dashboard/booker', () => {
  test('requires the booker role', async () => {
    await request(app).get('/api/dashboard/booker').expect(401);
    await authedRequest(app, managementToken).get('/api/dashboard/booker').expect(403);
  });

  test('returns own upcoming events, booking counts and activity', async () => {
    const event = await createEvent(alphaToken, 'Alpha Summit');
    const bookingRes = await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(201);
    // Second booking, then rejected by management.
    const second = await createEvent(alphaToken, 'Alpha Party', {
      startDate: '2027-09-10T10:00:00.000Z',
      endDate: '2027-09-10T12:00:00.000Z',
    });
    const secondBooking = await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: second._id })
      .expect(201);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${secondBooking.body.data._id}/reject`)
      .send({ rejectionReason: 'Full house' })
      .expect(200);
    expect(bookingRes.body.data.status).toBe('Pending');

    const res = await authedRequest(app, alphaToken).get('/api/dashboard/booker').expect(200);
    const data = res.body.data;

    expect(data.upcomingEvents).toHaveLength(2);
    expect(data.upcomingEvents[0].name).toBe('Alpha Summit'); // sorted by date
    expect(data.pendingBookings).toBe(1);
    expect(data.approvedBookings).toBe(0);
    expect(data.rejectedBookings).toBe(1);
    expect(data.recentActivity.length).toBeGreaterThanOrEqual(3);
    expect(data.recentActivity[0]).toHaveProperty('type');
    expect(data.recentActivity[0]).toHaveProperty('label');
    expect(data.recentActivity[0]).toHaveProperty('date');
  });

  test('does not include other bookers events', async () => {
    const otherToken = await registerToken(app, 'other@dash.test', 'booker');
    await createEvent(otherToken, 'Other Guys Event');

    const res = await authedRequest(app, alphaToken).get('/api/dashboard/booker').expect(200);
    expect(res.body.data.upcomingEvents).toHaveLength(0);
    expect(res.body.data.pendingBookings).toBe(0);
  });
});

describe('GET /api/dashboard/management', () => {
  test('requires the management role', async () => {
    await request(app).get('/api/dashboard/management').expect(401);
    await authedRequest(app, alphaToken).get('/api/dashboard/management').expect(403);
  });

  test('returns system-wide counts, conflicts and utilization', async () => {
    // Two overlapping events in the same venue -> one venue conflict.
    const venue = await Venue.create({ name: 'Hall', capacity: 100, isActive: true });
    await createEvent(alphaToken, 'Event One', { venue: String(venue._id) });
    await createEvent(alphaToken, 'Event Two', {
      venue: String(venue._id),
      startDate: '2027-08-10T11:00:00.000Z',
      endDate: '2027-08-10T13:00:00.000Z',
    });
    await Resource.create({ name: 'Chairs', quantityTotal: 100, quantityAvailable: 100 });

    const res = await authedRequest(app, managementToken)
      .get('/api/dashboard/management')
      .expect(200);
    const data = res.body.data;

    expect(data.totalEvents).toBe(2);
    expect(data.upcomingEvents).toBe(2);
    expect(data.totalResources).toBe(1);
    expect(data.totalVenues).toBe(1);
    expect(data.pendingRequests).toBe(0);
    expect(data.approvedEvents).toBe(0);
    expect(data.activeConflicts).toBe(1);
    expect(data.resourceUtilization.average).toBe(0);
    expect(data.resourceUtilization.resources).toHaveLength(1);
  });

  test('reports zeros on an empty database', async () => {
    const res = await authedRequest(app, managementToken)
      .get('/api/dashboard/management')
      .expect(200);
    expect(res.body.data).toMatchObject({
      totalEvents: 0,
      pendingRequests: 0,
      approvedEvents: 0,
      upcomingEvents: 0,
      totalResources: 0,
      totalVenues: 0,
      activeConflicts: 0,
    });
    expect(res.body.data.resourceUtilization.average).toBe(0);
  });

  test('counts pending requests and approved events', async () => {
    const venue = await Venue.create({ name: 'Hall', capacity: 100, isActive: true });
    const first = await createEvent(alphaToken, 'Approve Me', { venue: String(venue._id) });
    const booking = await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: first._id })
      .expect(201);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking.body.data._id}/approve`)
      .send({})
      .expect(200);

    const second = await createEvent(alphaToken, 'Still Waiting', {
      venue: String(venue._id),
      startDate: '2027-12-01T10:00:00.000Z',
      endDate: '2027-12-01T12:00:00.000Z',
    });
    await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: second._id })
      .expect(201);

    const res = await authedRequest(app, managementToken)
      .get('/api/dashboard/management')
      .expect(200);
    expect(res.body.data.pendingRequests).toBe(1);
    expect(res.body.data.approvedEvents).toBe(1);
  });
});

describe('GET /api/dashboard/summary stays public', () => {
  test('works without a token', async () => {
    await request(app).get('/api/dashboard/summary').expect(200);
  });
});
