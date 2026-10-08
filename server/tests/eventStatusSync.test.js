const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Event = require('../models/Event');
const Venue = require('../models/Venue');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { authedRequest, registerToken } = require('./helpers/authedRequest');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let bookerToken;
let managementToken;
let orgId;
let venueId;

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  bookerToken = await registerToken(app, 'booker@status.test', 'booker');
  managementToken = await registerToken(app, 'boss@status.test', 'management');
});

beforeEach(async () => {
  const org = await Organization.create({ name: 'Status Org' });
  orgId = String(org._id);
  // Approving verifies the venue, so every fixture event gets one.
  const venue = await Venue.create({ name: 'Sync Hall', capacity: 200, venueType: 'indoor' });
  venueId = String(venue._id);
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

const createEvent = async (overrides = {}) => {
  const res = await authedRequest(app, bookerToken)
    .post('/api/events')
    .send({
      organization: orgId,
      venue: venueId,
      name: 'Status Sync Event',
      startDate: '2027-04-01T09:00:00.000Z',
      endDate: '2027-04-01T17:00:00.000Z',
      ...overrides,
    })
    .expect(201);
  return res.body.data;
};

const getStatus = async (eventId) => {
  const res = await authedRequest(app, managementToken).get(`/api/events/${eventId}`).expect(200);
  return res.body.data.status;
};

describe('event status follows the booking', () => {
  test('a new event starts pending; submitting keeps it pending', async () => {
    const event = await createEvent();
    expect(event.status).toBe('pending');

    await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(201);

    expect(await getStatus(event._id)).toBe('pending');
  });

  test('approving the booking marks the event approved', async () => {
    const event = await createEvent();
    const booking = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(201);

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking.body.data._id}/approve`)
      .send({})
      .expect(200);

    expect(await getStatus(event._id)).toBe('approved');
  });

  test('rejecting marks the event rejected; resubmitting returns it to pending', async () => {
    const event = await createEvent();
    const booking = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(201);

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking.body.data._id}/reject`)
      .send({ rejectionReason: 'Needs a smaller room' })
      .expect(200);
    expect(await getStatus(event._id)).toBe('rejected');

    // Resubmit reuses the original row - no duplicate booking is created.
    const resubmitted = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(200);
    expect(resubmitted.body.data._id).toBe(booking.body.data._id);
    expect(resubmitted.body.data.status).toBe('Pending');
    expect(resubmitted.body.data.rejectionReason).toBeUndefined();
    expect(await getStatus(event._id)).toBe('pending');

    const list = await authedRequest(app, bookerToken).get('/api/bookings').expect(200);
    expect(list.body.count).toBe(1);
  });

  test('withdrawing a pending booking sends the event back to pending, not cancelled', async () => {
    const event = await createEvent();
    const booking = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(201);

    await authedRequest(app, bookerToken)
      .put(`/api/bookings/${booking.body.data._id}/cancel`)
      .send({})
      .expect(200);

    expect(await getStatus(event._id)).toBe('pending');

    // Resubmitting after a withdraw also reuses the cancelled row.
    const resubmitted = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(200);
    expect(resubmitted.body.data._id).toBe(booking.body.data._id);
    expect(resubmitted.body.data.status).toBe('Pending');
    expect(await getStatus(event._id)).toBe('pending');
  });

  test('manual lifecycle status writes are rejected; completed/cancelled stay allowed', async () => {
    const event = await createEvent();
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'approved' })
      .expect(400);

    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);
    expect(await getStatus(event._id)).toBe('completed');
  });

  test('booking an event that already ended is refused', async () => {
    const event = await createEvent({
      startDate: '2025-05-01T09:00:00.000Z',
      endDate: '2025-05-01T17:00:00.000Z',
    });

    const res = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(409);
    expect(res.body.message).toMatch(/already ended/i);
  });

  test('rejected + ended: update the dates, then resubmit (OJT flow)', async () => {
    const event = await createEvent({ name: 'OJT Flow' });
    const booking = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(201);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking.body.data._id}/reject`)
      .send({ rejectionReason: 'Budget exceeded' })
      .expect(200);
    expect(await getStatus(event._id)).toBe('rejected');

    // The dates move into the past (the event happened without approval).
    await authedRequest(app, bookerToken)
      .put(`/api/events/${event._id}`)
      .send({ startDate: '2025-05-01T09:00:00.000Z', endDate: '2025-05-01T17:00:00.000Z' })
      .expect(200);

    // Resubmitting is refused until the dates are updated...
    const blocked = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(409);
    expect(blocked.body.message).toMatch(/already ended/i);

    // ...the booker changes the dates and other details, then resubmits.
    await authedRequest(app, bookerToken)
      .put(`/api/events/${event._id}`)
      .send({ startDate: '2027-05-01T09:00:00.000Z', endDate: '2027-05-01T17:00:00.000Z' })
      .expect(200);

    // Resubmit reuses the same booking row.
    const resubmitted = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(200);
    expect(resubmitted.body.data._id).toBe(booking.body.data._id);
    expect(await getStatus(event._id)).toBe('pending');
  });

  test('resubmitting collapses old rejected duplicates into a single pending row', async () => {
    const event = await createEvent({ name: 'Duplicate Cleanup' });
    const booker = await User.findOne({ email: 'booker@status.test' });
    // Duplicates created by older versions of the app.
    const old = await Booking.create({
      eventId: event._id,
      bookerId: booker._id,
      status: 'Rejected',
      rejectionReason: 'old reason',
    });
    const newest = await Booking.create({
      eventId: event._id,
      bookerId: booker._id,
      status: 'Rejected',
    });

    const resubmitted = await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(200);
    expect(resubmitted.body.data._id).toBe(String(newest._id));
    expect(resubmitted.body.data.status).toBe('Pending');

    expect(await Booking.countDocuments({ eventId: event._id })).toBe(1);
    expect(await Booking.findById(old._id)).toBeNull();
    expect(await getStatus(event._id)).toBe('pending');
  });
});
