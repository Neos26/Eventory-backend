const mongoose = require('mongoose');
const { authedRequest, registerToken } = require('./helpers/authedRequest');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const Event = require('../models/Event');
const ResourceReservation = require('../models/ResourceReservation');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let token;

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  token = await registerToken(app, 'reservation-manager@eventory.test');
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections).filter((collection) => collection.collectionName !== 'users');
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
let event;

beforeEach(async () => {
  org = await Organization.create({ name: 'Reservation Org' });
  venue = await Venue.create({ name: 'Hall', capacity: 200, organization: org._id });
  resource = await Resource.create({
    organization: org._id,
    name: 'Chairs',
    category: 'furniture',
    quantityTotal: 100,
    quantityAvailable: 100,
    unit: 'unit',
  });
  event = await Event.create({
    organization: org._id,
    venue: venue._id,
    name: 'Test Event',
    startDate: new Date('2026-06-01T09:00:00Z'),
    endDate: new Date('2026-06-01T17:00:00Z'),
  });
});

const body = (overrides = {}) => ({
  event: event._id,
  resource: resource._id,
  quantity: 20,
  reservedFrom: new Date('2026-06-01T09:00:00Z'),
  reservedUntil: new Date('2026-06-01T17:00:00Z'),
  ...overrides,
});

describe('reservations CRUD', () => {
  test('create, list, get, update, delete with populated refs', async () => {
    const created = await authedRequest(app, token).post('/api/reservations').send(body()).expect(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data.status).toBe('reserved');
    expect(created.body.data.event.name).toBe('Test Event');
    expect(created.body.data.resource.name).toBe('Chairs');
    expect(created.body.data.resource.unit).toBe('unit');
    const id = created.body.data._id;

    const list = await authedRequest(app, token).get('/api/reservations').expect(200);
    expect(list.body.count).toBe(1);

    const single = await authedRequest(app, token).get(`/api/reservations/${id}`).expect(200);
    expect(single.body.data._id).toBe(id);

    const updated = await authedRequest(app, token)
      .put(`/api/reservations/${id}`)
      .send({ quantity: 25, notes: 'extra chairs' })
      .expect(200);
    expect(updated.body.data.quantity).toBe(25);
    expect(updated.body.data.notes).toBe('extra chairs');

    await authedRequest(app, token).delete(`/api/reservations/${id}`).expect(200);
    await authedRequest(app, token).get(`/api/reservations/${id}`).expect(404);
  });

  test('missing or unknown references return 400', async () => {
    await authedRequest(app, token).post('/api/reservations').send({}).expect(400);

    const ghostEvent = await authedRequest(app, token)
      .post('/api/reservations')
      .send(body({ event: new mongoose.Types.ObjectId() }))
      .expect(400);
    expect(ghostEvent.body.message).toMatch(/Event not found/);

    const ghostResource = await authedRequest(app, token)
      .post('/api/reservations')
      .send(body({ resource: new mongoose.Types.ObjectId() }))
      .expect(400);
    expect(ghostResource.body.message).toMatch(/Resource not found/);

    await authedRequest(app, token).get('/api/reservations/not-an-id').expect(400);
    await authedRequest(app, token).get(`/api/reservations/${new mongoose.Types.ObjectId()}`).expect(404);
    await authedRequest(app, token).put('/api/reservations/not-an-id').send({ quantity: 5 }).expect(400);
  });

  test('date ordering, quantity and status validators reject bad input', async () => {
    const badDates = await authedRequest(app, token)
      .post('/api/reservations')
      .send(
        body({
          reservedFrom: new Date('2026-06-01T17:00:00Z'),
          reservedUntil: new Date('2026-06-01T09:00:00Z'),
        }),
      )
      .expect(400);
    expect(badDates.body.message).toMatch(/Reserved until/i);

    const zeroQuantity = await authedRequest(app, token)
      .post('/api/reservations')
      .send(body({ quantity: 0 }))
      .expect(400);
    expect(zeroQuantity.body.message).toMatch(/whole number/i);

    const created = await authedRequest(app, token).post('/api/reservations').send(body()).expect(201);
    await authedRequest(app, token)
      .put(`/api/reservations/${created.body.data._id}`)
      .send({ status: 'bogus' })
      .expect(400);
  });
});

describe('reservation stock enforcement', () => {
  test('cannot reserve more than available; exact boundary passes', async () => {
    await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 60 })).expect(201);

    const over = await authedRequest(app, token)
      .post('/api/reservations')
      .send(body({ quantity: 50 }))
      .expect(400);
    expect(over.body.message).toMatch(/Only 40 available/);

    await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 40 })).expect(201);
  });

  test('cancelling frees stock for new reservations', async () => {
    const first = await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 100 })).expect(201);
    const id = first.body.data._id;

    const exhausted = await authedRequest(app, token)
      .post('/api/reservations')
      .send(body({ quantity: 1 }))
      .expect(400);
    expect(exhausted.body.message).toMatch(/No stock available/);

    let availability = await authedRequest(app, token)
      .get(`/api/resources/${resource._id}/availability`)
      .expect(200);
    expect(availability.body.data.reserved).toBe(100);
    expect(availability.body.data.available).toBe(0);

    const cancelled = await authedRequest(app, token)
      .put(`/api/reservations/${id}`)
      .send({ status: 'cancelled' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('cancelled');

    availability = await authedRequest(app, token)
      .get(`/api/resources/${resource._id}/availability`)
      .expect(200);
    expect(availability.body.data.reserved).toBe(0);
    expect(availability.body.data.available).toBe(100);

    await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 100 })).expect(201);
  });

  test('releasing issued stock (returned) frees it', async () => {
    const first = await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 100 })).expect(201);
    const id = first.body.data._id;

    const issued = await authedRequest(app, token)
      .put(`/api/reservations/${id}`)
      .send({ status: 'issued' })
      .expect(200);
    expect(issued.body.data.status).toBe('issued');
    await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 1 })).expect(400);

    const returned = await authedRequest(app, token)
      .put(`/api/reservations/${id}`)
      .send({ status: 'returned' })
      .expect(200);
    expect(returned.body.data.status).toBe('returned');

    await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 10 })).expect(201);
  });

  test('update guards count other reservations only, not the one being edited', async () => {
    const first = await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 60 })).expect(201);
    const second = await authedRequest(app, token).post('/api/reservations').send(body({ quantity: 40 })).expect(201);

    // Others hold 40, so 61 does not fit; keeping 60 stays valid.
    const tooBig = await authedRequest(app, token)
      .put(`/api/reservations/${first.body.data._id}`)
      .send({ quantity: 61 })
      .expect(400);
    expect(tooBig.body.message).toMatch(/Only 60 available/);

    await authedRequest(app, token)
      .put(`/api/reservations/${first.body.data._id}`)
      .send({ quantity: 60 })
      .expect(200);

    // Freeing the other reservation opens up the whole stock.
    await authedRequest(app, token)
      .put(`/api/reservations/${second.body.data._id}`)
      .send({ status: 'cancelled' })
      .expect(200);

    const grown = await authedRequest(app, token)
      .put(`/api/reservations/${first.body.data._id}`)
      .send({ quantity: 100 })
      .expect(200);
    expect(grown.body.data.quantity).toBe(100);
  });

  test('a cancelled reservation does not block edits to dates or notes', async () => {
    const created = await authedRequest(app, token).post('/api/reservations').send(body()).expect(201);
    const id = created.body.data._id;

    await authedRequest(app, token).put(`/api/reservations/${id}`).send({ status: 'cancelled' }).expect(200);

    // Status is inactive, so even an oversized quantity update is allowed -
    // stock checks only apply while the reservation holds stock.
    const updated = await authedRequest(app, token)
      .put(`/api/reservations/${id}`)
      .send({ notes: 'released early', quantity: 500 })
      .expect(200);
    expect(updated.body.data.notes).toBe('released early');
    expect(updated.body.data.quantity).toBe(500);
  });
});
