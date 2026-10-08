const mongoose = require('mongoose');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const ResourceReservation = require('../models/ResourceReservation');
const Booking = require('../models/Booking');
const { authedRequest, registerToken } = require('./helpers/authedRequest');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let bookerToken;
let managementToken;
let orgId;
let venueId;
let resourceId;

// Booker creates an event with a resource requirement, then books it.
const setupEvent = async (overrides = {}, requirement = null) => {
  const eventRes = await authedRequest(app, bookerToken)
    .post('/api/events')
    .send({
      organization: orgId,
      venue: venueId,
      name: 'Lifecycle Event',
      startDate: '2027-05-10T13:00:00.000Z',
      endDate: '2027-05-10T16:00:00.000Z',
      ...overrides,
    })
    .expect(201);
  const event = eventRes.body.data;

  if (requirement !== null) {
    await authedRequest(app, bookerToken)
      .post(`/api/events/${event._id}/requirements`)
      .send({ resource: resourceId, quantity: requirement })
      .expect(201);
  }
  return event;
};

const submitBooking = async (eventId, token = bookerToken) => {
  const res = await authedRequest(app, token)
    .post('/api/bookings')
    .send({ eventId })
    .expect(201);
  return res.body.data;
};

const approveBooking = async (bookingId) => {
  await authedRequest(app, managementToken)
    .put(`/api/bookings/${bookingId}/approve`)
    .send({})
    .expect(200);
};

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  bookerToken = await registerToken(app, 'booker@lifecycle.test', 'booker');
  managementToken = await registerToken(app, 'boss@lifecycle.test', 'management');
});

beforeEach(async () => {
  const org = await Organization.create({ name: 'Lifecycle Org' });
  orgId = String(org._id);
  const venue = await Venue.create({ name: 'Hall', capacity: 120, isActive: true });
  venueId = String(venue._id);
  const resource = await Resource.create({
    organization: org._id,
    name: 'Chairs',
    category: 'furniture',
    quantityTotal: 100,
    quantityAvailable: 100,
  });
  resourceId = String(resource._id);
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

describe('completing an event', () => {
  test('management completing returns reservations and completes the booking', async () => {
    const event = await setupEvent({}, 4);
    const booking = await submitBooking(event._id);
    await approveBooking(booking._id);

    expect(await ResourceReservation.find({ event: event._id, status: 'reserved' })).toHaveLength(1);

    const res = await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);
    expect(res.body.data.status).toBe('completed');

    const reservations = await ResourceReservation.find({ event: event._id });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('returned');

    expect((await Booking.findById(booking._id)).status).toBe('Completed');
  });

  test('stock is available again after completion', async () => {
    const event = await setupEvent({}, 4);
    const booking = await submitBooking(event._id);
    await approveBooking(booking._id);

    const held = await authedRequest(app, managementToken)
      .get(`/api/resources/${resourceId}/availability`)
      .expect(200);
    expect(held.body.data.available).toBe(96);

    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);

    const free = await authedRequest(app, managementToken)
      .get(`/api/resources/${resourceId}/availability`)
      .expect(200);
    expect(free.body.data.available).toBe(100);
  });

  test('a booker cannot complete an event (403)', async () => {
    const event = await setupEvent();

    await authedRequest(app, bookerToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(403);

    const stored = await authedRequest(app, managementToken)
      .get(`/api/events/${event._id}`)
      .expect(200);
    expect(stored.body.data.status).toBe('pending');
  });

  test('completing an already completed event is a no-op', async () => {
    const event = await setupEvent({}, 2);
    const booking = await submitBooking(event._id);
    await approveBooking(booking._id);

    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);

    // Re-adding a manual hold on a completed event, then completing again,
    // must not flip anything back or error.
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);

    expect((await Booking.findById(booking._id)).status).toBe('Completed');
    const reservations = await ResourceReservation.find({ event: event._id });
    expect(reservations.every((reservation) => reservation.status === 'returned')).toBe(true);
  });
});

describe('cancelling an event', () => {
  test('cancelling drops reservations and closes the approved booking', async () => {
    const event = await setupEvent({}, 4);
    const booking = await submitBooking(event._id);
    await approveBooking(booking._id);

    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    const reservations = await ResourceReservation.find({ event: event._id });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('cancelled');

    expect((await Booking.findById(booking._id)).status).toBe('Cancelled');
  });

  test('the booker may cancel their own event and the pending booking closes', async () => {
    const event = await setupEvent();
    const booking = await submitBooking(event._id);

    await authedRequest(app, bookerToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    expect((await Booking.findById(booking._id)).status).toBe('Cancelled');
  });

  test('a reservation cannot be created for a cancelled event (409)', async () => {
    const event = await setupEvent();
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    await authedRequest(app, managementToken)
      .post('/api/reservations')
      .send({
        event: event._id,
        resource: resourceId,
        quantity: 5,
        reservedFrom: new Date('2027-05-10T13:00:00.000Z'),
        reservedUntil: new Date('2027-05-10T16:00:00.000Z'),
      })
      .expect(409);
  });

  test('an existing hold cannot be reactivated on a cancelled event (409)', async () => {
    const event = await setupEvent();
    const created = await authedRequest(app, managementToken)
      .post('/api/reservations')
      .send({
        event: event._id,
        resource: resourceId,
        quantity: 5,
        reservedFrom: new Date('2027-05-10T13:00:00.000Z'),
        reservedUntil: new Date('2027-05-10T16:00:00.000Z'),
      })
      .expect(201);

    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    await authedRequest(app, managementToken)
      .put(`/api/reservations/${created.body.data._id}`)
      .send({ status: 'reserved' })
      .expect(409);
  });

  test('cancelling an already cancelled event does not error', async () => {
    const event = await setupEvent();
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);
  });
});

describe('completed events hold nothing', () => {
  test('a completed event creates no venue conflict', async () => {
    const active = await setupEvent({ name: 'Still Active' });
    const done = await setupEvent({ name: 'Finished Concert' });
    await authedRequest(app, managementToken)
      .put(`/api/events/${done._id}`)
      .send({ status: 'completed' })
      .expect(200);

    const res = await authedRequest(app, managementToken)
      .get(`/api/events/${active._id}/conflicts`)
      .expect(200);
    expect(res.body.data.venueConflicts).toHaveLength(0);
    expect(res.body.data.scheduleConflicts).toHaveLength(0);
    expect(res.body.data.hasConflicts).toBe(false);
  });

  test('the venue is free again once the event is completed', async () => {
    const event = await setupEvent();
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);

    const res = await authedRequest(app, managementToken)
      .get(`/api/venues/${venueId}/availability`)
      .query({ start: '2027-05-10T13:00:00.000Z', end: '2027-05-10T16:00:00.000Z' })
      .expect(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.conflicts).toHaveLength(0);
  });

  test('a booking cannot be created for a completed event (409)', async () => {
    const event = await setupEvent();
    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);

    await authedRequest(app, bookerToken)
      .post('/api/bookings')
      .send({ eventId: event._id })
      .expect(409);
  });

  test('a pending booking cannot be approved after the event completes (409)', async () => {
    const event = await setupEvent({}, 2);
    const booking = await submitBooking(event._id);

    await authedRequest(app, managementToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'completed' })
      .expect(200);

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(409);
  });
});
