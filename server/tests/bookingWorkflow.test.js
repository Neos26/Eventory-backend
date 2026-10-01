const mongoose = require('mongoose');
const request = require('supertest');

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
let projectorId;

// Booker creates an event, assigns the venue and a resource requirement.
const setupEvent = async (overrides = {}, requirement = null) => {
  const eventRes = await authedRequest(app, bookerToken)
    .post('/api/events')
    .send({
      organization: orgId,
      venue: venueId,
      name: 'Approval Event',
      startDate: '2027-04-10T13:00:00.000Z',
      endDate: '2027-04-10T16:00:00.000Z',
      ...overrides,
    })
    .expect(201);
  const event = eventRes.body.data;

  if (requirement !== null) {
    await authedRequest(app, bookerToken)
      .post(`/api/events/${event._id}/requirements`)
      .send({ resource: projectorId, quantity: requirement })
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

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  bookerToken = await registerToken(app, 'booker@workflow.test', 'booker');
  managementToken = await registerToken(app, 'boss@workflow.test', 'management');
});

beforeEach(async () => {
  const org = await Organization.create({ name: 'Workflow Org' });
  orgId = String(org._id);
  const venue = await Venue.create({ name: 'AVR', capacity: 80, isActive: true });
  venueId = String(venue._id);
  const projector = await Resource.create({
    name: 'Projector',
    category: 'audio_visual',
    quantityTotal: 3,
    quantityAvailable: 3,
  });
  projectorId = String(projector._id);
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

describe('approve happy path', () => {
  test('management approves: booking Approved and reservations created', async () => {
    const event = await setupEvent({}, 2);
    const booking = await submitBooking(event._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(200);
    expect(res.body.data.status).toBe('Approved');

    const reservations = await ResourceReservation.find({ event: event._id });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].quantity).toBe(2);
    expect(reservations[0].status).toBe('reserved');
    expect(reservations[0].reservedFrom.toISOString()).toBe(event.startDate);
    expect(reservations[0].reservedUntil.toISOString()).toBe(event.endDate);

    const stored = await Booking.findById(booking._id);
    expect(stored.status).toBe('Approved');
  });

  test('an event without requirements still approves (venue only)', async () => {
    const event = await setupEvent();
    const booking = await submitBooking(event._id);

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(200);
    expect(await ResourceReservation.find({ event: event._id })).toHaveLength(0);
  });
});

describe('approve is refused on conflicts', () => {
  test('venue double-booking: 409 VENUE_CONFLICT, no reservations, stays Pending', async () => {
    const first = await setupEvent();
    const firstBooking = await submitBooking(first._id);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${firstBooking._id}/approve`)
      .send({})
      .expect(200);

    // Second event: same venue, overlapping time.
    const second = await setupEvent({
      name: 'Clashing Event',
      startDate: '2027-04-10T14:00:00.000Z',
      endDate: '2027-04-10T17:00:00.000Z',
    });
    const secondBooking = await submitBooking(second._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${secondBooking._id}/approve`)
      .send({})
      .expect(409);
    expect(res.body.message).toMatch(/venue is already booked/i);
    expect(res.body.conflicts[0].type).toBe('VENUE_CONFLICT');
    expect(res.body.conflicts[0].venue).toBe('AVR');

    expect((await Booking.findById(secondBooking._id)).status).toBe('Pending');
    expect((await ResourceReservation.find({ event: second._id }))).toHaveLength(0);
  });

  test('resource shortage: 409 with required/available/shortage numbers', async () => {
    const event = await setupEvent({}, 5); // needs 5, only 3 exist
    const booking = await submitBooking(event._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(409);
    expect(res.body.message).toMatch(/not enough resources/i);

    const shortage = res.body.conflicts.find((c) => c.type === 'RESOURCE_SHORTAGE');
    expect(shortage).toMatchObject({
      resource: 'Projector',
      required: 5,
      available: 3,
      shortage: 2,
    });
    expect((await Booking.findById(booking._id)).status).toBe('Pending');
    expect(await ResourceReservation.find({ event: event._id })).toHaveLength(0);
  });

  test('stock already held by another approved booking reduces availability', async () => {
    // First booking takes all 3 projectors.
    const first = await setupEvent({ name: 'First Grab' }, 3);
    const firstBooking = await submitBooking(first._id);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${firstBooking._id}/approve`)
      .send({})
      .expect(200);

    // Second event at a different time needs just 1 more projector.
    const second = await setupEvent({
      name: 'Second Grab',
      startDate: '2027-04-11T09:00:00.000Z',
      endDate: '2027-04-11T12:00:00.000Z',
    }, 1);
    const secondBooking = await submitBooking(second._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${secondBooking._id}/approve`)
      .send({})
      .expect(409);
    const shortage = res.body.conflicts.find((c) => c.type === 'RESOURCE_SHORTAGE');
    expect(shortage).toMatchObject({ required: 1, available: 0, shortage: 1 });
  });

  test('same-organization schedule overlap is reported', async () => {
    const first = await setupEvent();
    const firstBooking = await submitBooking(first._id);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${firstBooking._id}/approve`)
      .send({})
      .expect(200);

    // Different venue (get one), same org, overlapping time.
    const otherVenue = await Venue.create({ name: 'Gym', capacity: 300, isActive: true });
    const second = await setupEvent({
      name: 'Parallel Event',
      venue: String(otherVenue._id),
      startDate: '2027-04-10T15:00:00.000Z',
      endDate: '2027-04-10T18:00:00.000Z',
    });
    const secondBooking = await submitBooking(second._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${secondBooking._id}/approve`)
      .send({})
      .expect(409);
    expect(res.body.conflicts.some((c) => c.type === 'SCHEDULE_CONFLICT')).toBe(true);
  });

  test('inactive venue blocks approval', async () => {
    await Venue.updateOne({ _id: venueId }, { isActive: false });
    const event = await setupEvent();
    const booking = await submitBooking(event._id);

    const res = await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(409);
    expect(res.body.message).toMatch(/inactive/);
  });

  test('cancelled event blocks approval', async () => {
    const event = await setupEvent();
    const booking = await submitBooking(event._id);
    await authedRequest(app, bookerToken)
      .put(`/api/events/${event._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(409);
  });
});

describe('approve guards', () => {
  test('a booker cannot approve (403)', async () => {
    const event = await setupEvent();
    const booking = await submitBooking(event._id);
    await authedRequest(app, bookerToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(403);
  });

  test('no token is 401', async () => {
    await request(app).put('/api/bookings/000000000000000000000000/approve').send({}).expect(401);
  });

  test('approving twice is 409 the second time', async () => {
    const event = await setupEvent();
    const booking = await submitBooking(event._id);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(200);
    await authedRequest(app, managementToken)
      .put(`/api/bookings/${booking._id}/approve`)
      .send({})
      .expect(409);
  });

  test('unknown booking id is 404, bad id is 400', async () => {
    await authedRequest(app, managementToken)
      .put('/api/bookings/000000000000000000000000/approve')
      .send({})
      .expect(404);
    await authedRequest(app, managementToken)
      .put('/api/bookings/nope/approve')
      .send({})
      .expect(400);
  });
});
