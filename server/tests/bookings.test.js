const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Booking = require('../models/Booking');
const { authedRequest, registerToken } = require('./helpers/authedRequest');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let alphaToken; // booker A
let betaToken; // booker B
let managementToken;
let orgId;

const createEvent = async (token, name) => {
  const res = await authedRequest(app, token)
    .post('/api/events')
    .send({
      organization: orgId,
      name,
      startDate: '2027-05-01T09:00:00.000Z',
      endDate: '2027-05-01T17:00:00.000Z',
    })
    .expect(201);
  return res.body.data;
};

const createBooking = async (token, eventId, extra = {}) => {
  const res = await authedRequest(app, token)
    .post('/api/bookings')
    .send({ eventId, ...extra })
    .expect(201);
  return res.body.data;
};

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  alphaToken = await registerToken(app, 'alpha@bookings.test', 'booker');
  betaToken = await registerToken(app, 'beta@bookings.test', 'booker');
  managementToken = await registerToken(app, 'boss@bookings.test', 'management');
});

// Recreated every test (wiped by afterEach); users are preserved for the tokens.
beforeEach(async () => {
  const org = await Organization.create({ name: 'Booking Org' });
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

describe('POST /api/bookings', () => {
  test('a booker submits a booking for their own event and it starts Pending', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id, { notes: 'Need projector' });

    expect(booking.status).toBe('Pending');
    expect(booking.notes).toBe('Need projector');
    expect(booking.eventId.name).toBe('Alpha Fest');
    expect(booking.bookerId.email).toBe('alpha@bookings.test');
    expect(booking.rejectionReason).toBeUndefined();
  });

  test('a booker cannot book another booker\'s event (403)', async () => {
    const event = await createEvent(betaToken, 'Beta Bash');
    await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(403);
  });

  test('a second booking for the same event is 409', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    await createBooking(alphaToken, event._id);
    const res = await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(409);
    expect(res.body.message).toMatch(/already exists/);
  });

  test('a booking for a cancelled event is 409', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    await authedRequest(app, alphaToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(409);
  });

  test('missing eventId is 400, unknown event is 404', async () => {
    await authedRequest(app, alphaToken).post('/api/bookings').send({}).expect(400);
    await authedRequest(app, alphaToken)
      .post('/api/bookings')
      .send({ eventId: '000000000000000000000000' })
      .expect(404);
  });

  test('no token means 401', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    await request(app).post('/api/bookings').send({ eventId: event._id }).expect(401);
  });
});

describe('GET /api/bookings', () => {
  test('a booker only sees their own bookings', async () => {
    const alphaEvent = await createEvent(alphaToken, 'Alpha Fest');
    const betaEvent = await createEvent(betaToken, 'Beta Bash');
    await createBooking(alphaToken, alphaEvent._id);
    await createBooking(betaToken, betaEvent._id);

    const alphaList = await authedRequest(app, alphaToken).get('/api/bookings').expect(200);
    expect(alphaList.body.count).toBe(1);
    expect(alphaList.body.data[0].eventId.name).toBe('Alpha Fest');

    const betaList = await authedRequest(app, betaToken).get('/api/bookings').expect(200);
    expect(betaList.body.count).toBe(1);
    expect(betaList.body.data[0].eventId.name).toBe('Beta Bash');
  });

  test('management sees every booking', async () => {
    const alphaEvent = await createEvent(alphaToken, 'Alpha Fest');
    const betaEvent = await createEvent(betaToken, 'Beta Bash');
    await createBooking(alphaToken, alphaEvent._id);
    await createBooking(betaToken, betaEvent._id);

    const list = await authedRequest(app, managementToken).get('/api/bookings').expect(200);
    expect(list.body.count).toBe(2);
  });

  test('supports ?status= filtering and rejects bad values', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    await createBooking(alphaToken, event._id);

    const pending = await authedRequest(app, alphaToken)
      .get('/api/bookings?status=Pending')
      .expect(200);
    expect(pending.body.count).toBe(1);

    const approved = await authedRequest(app, alphaToken)
      .get('/api/bookings?status=Approved')
      .expect(200);
    expect(approved.body.count).toBe(0);

    await authedRequest(app, alphaToken).get('/api/bookings?status=weird').expect(400);
  });

  test('no token means 401', async () => {
    await request(app).get('/api/bookings').expect(401);
  });
});

describe('GET /api/bookings/:id', () => {
  test('the owner and management can read it; another booker gets 403', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);

    await authedRequest(app, alphaToken).get(`/api/bookings/${booking._id}`).expect(200);
    await authedRequest(app, managementToken).get(`/api/bookings/${booking._id}`).expect(200);
    await authedRequest(app, betaToken).get(`/api/bookings/${booking._id}`).expect(403);
  });

  test('bad id is 400, unknown id is 404', async () => {
    await authedRequest(app, managementToken).get('/api/bookings/not-an-id').expect(400);
    await authedRequest(app, managementToken)
      .get('/api/bookings/000000000000000000000000')
      .expect(404);
  });
});

describe('PUT /api/bookings/:id/cancel', () => {
  test('the owner cancels their pending booking', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);

    const res = await authedRequest(app, alphaToken)
      .put(`/api/bookings/${booking._id}/cancel`)
      .send({})
      .expect(200);
    expect(res.body.data.status).toBe('Cancelled');
  });

  test('another booker cannot cancel someone else\'s booking', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);

    await authedRequest(app, betaToken)
      .put(`/api/bookings/${booking._id}/cancel`)
      .send({})
      .expect(403);
  });

  test('a non-pending booking cannot be cancelled (409)', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);
    await Booking.updateOne({ _id: booking._id }, { status: 'Approved' });

    await authedRequest(app, alphaToken)
      .put(`/api/bookings/${booking._id}/cancel`)
      .send({})
      .expect(409);
  });

  test('no token means 401', async () => {
    await request(app).put('/api/bookings/000000000000000000000000/cancel').send({}).expect(401);
  });
});

describe('PUT /api/bookings/:id/reject', () => {
  test('management rejects with a reason', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/reject`)
      .send({ rejectionReason: 'Venue unavailable that day.' })
      .expect(200);
    expect(res.body.data.status).toBe('Rejected');
    expect(res.body.data.rejectionReason).toBe('Venue unavailable that day.');
  });

  test('a booker cannot reject (403)', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);

    await authedRequest(app, alphaToken)
      .put(`/api/bookings/${booking._id}/reject`)
      .send({ rejectionReason: 'nope' })
      .expect(403);
  });

  test('rejecting without a reason is 400', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/reject`)
      .send({})
      .expect(400);
  });

  test('a non-pending booking cannot be rejected (409)', async () => {
    const event = await createEvent(alphaToken, 'Alpha Fest');
    const booking = await createBooking(alphaToken, event._id);
    await Booking.updateOne({ _id: booking._id }, { status: 'Cancelled' });

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/reject`)
      .send({ rejectionReason: 'late' })
      .expect(409);
  });
});
