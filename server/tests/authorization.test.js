const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let bookerToken;
let managementToken;

beforeAll(async () => {
  await mongoose.connect(TEST_URI);

  const booker = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Booker One', email: 'booker@auth.test', password: 'secret123' });
  bookerToken = booker.body.data.token;

  const management = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Manager One',
      email: 'manager@auth.test',
      password: 'secret123',
      role: 'management',
    });
  managementToken = management.body.data.token;
});

afterEach(async () => {
  // Keep the users collection: the tokens from beforeAll point at them.
  const collections = Object.values(mongoose.connection.collections).filter(
    (collection) => collection.collectionName !== 'users',
  );
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const asBooker = (req) => req.set('Authorization', `Bearer ${bookerToken}`);
const asManagement = (req) => req.set('Authorization', `Bearer ${managementToken}`);

describe('public reads stay open', () => {
  test('GET /api/events works without a token', async () => {
    await request(app).get('/api/events').expect(200);
  });

  test('GET /api/venues works without a token', async () => {
    await request(app).get('/api/venues').expect(200);
  });

  test('GET /api/resources works without a token', async () => {
    await request(app).get('/api/resources').expect(200);
  });
});

describe('mutations require authentication', () => {
  test('POST /api/events without a token is 401', async () => {
    const org = await Organization.create({ name: 'Org' });
    const res = await request(app)
      .post('/api/events')
      .send({
        organization: String(org._id),
        name: 'Nope',
        startDate: '2027-01-01T10:00:00.000Z',
        endDate: '2027-01-01T12:00:00.000Z',
      })
      .expect(401);
    expect(res.body.message).toMatch(/Authentication required/);
  });

  test('POST /api/venues without a token is 401', async () => {
    await request(app).post('/api/venues').send({ name: 'Hall' }).expect(401);
  });

  test('DELETE /api/resources/:id without a token is 401', async () => {
    const resource = await Resource.create({ name: 'Chairs', quantityTotal: 10 });
    await request(app).delete(`/api/resources/${resource._id}`).expect(401);
  });
});

describe('management-only operations', () => {
  test('a booker cannot create venues', async () => {
    const res = await asBooker(request(app).post('/api/venues')).send({ name: 'Hall' }).expect(403);
    expect(res.body.message).toMatch(/management/);
  });

  test('a booker cannot edit venues', async () => {
    const venue = await Venue.create({ name: 'Hall', capacity: 50 });
    await asBooker(request(app).put(`/api/venues/${venue._id}`))
      .send({ capacity: 99 })
      .expect(403);
  });

  test('a booker cannot delete venues', async () => {
    const venue = await Venue.create({ name: 'Hall', capacity: 50 });
    await asBooker(request(app).delete(`/api/venues/${venue._id}`)).expect(403);
  });

  test('a booker cannot create resources', async () => {
    await asBooker(request(app).post('/api/resources'))
      .send({ name: 'Projector', quantityTotal: 3 })
      .expect(403);
  });

  test('a booker cannot edit resources', async () => {
    const resource = await Resource.create({ name: 'Chairs', quantityTotal: 10 });
    await asBooker(request(app).put(`/api/resources/${resource._id}`))
      .send({ quantityTotal: 500 })
      .expect(403);
  });

  test('a booker cannot create organizations', async () => {
    await asBooker(request(app).post('/api/organizations'))
      .send({ name: 'Sneaky Org' })
      .expect(403);
  });

  test('a booker cannot create manual reservations', async () => {
    const org = await Organization.create({ name: 'Org' });
    const resource = await Resource.create({ name: 'Chairs', quantityTotal: 10 });
    const event = await (
      await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${bookerToken}`)
        .send({
          organization: String(org._id),
          name: 'Event',
          startDate: '2027-01-01T10:00:00.000Z',
          endDate: '2027-01-01T12:00:00.000Z',
        })
    ).body;

    await asBooker(request(app).post('/api/reservations'))
      .send({
        event: event.data._id,
        resource: String(resource._id),
        quantity: 1,
        reservedFrom: '2027-01-01T10:00:00.000Z',
        reservedUntil: '2027-01-01T12:00:00.000Z',
      })
      .expect(403);
  });

  test('management can create venues and resources', async () => {
    await asManagement(request(app).post('/api/venues'))
      .send({ name: 'Managed Hall', capacity: 80 })
      .expect(201);
    await asManagement(request(app).post('/api/resources'))
      .send({ name: 'Managed Projector', quantityTotal: 4 })
      .expect(201);
  });
});

describe('both roles can create events', () => {
  const eventBody = (orgId) => ({
    organization: orgId,
    name: 'Shared Event',
    startDate: '2027-01-01T10:00:00.000Z',
    endDate: '2027-01-01T12:00:00.000Z',
  });

  test('a booker can create an event', async () => {
    const org = await Organization.create({ name: 'Org' });
    await asBooker(request(app).post('/api/events'))
      .send(eventBody(String(org._id)))
      .expect(201);
  });

  test('management can create an event', async () => {
    const org = await Organization.create({ name: 'Org' });
    await asManagement(request(app).post('/api/events'))
      .send(eventBody(String(org._id)))
      .expect(201);
  });
});
