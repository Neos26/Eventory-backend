const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Resource = require('../models/Resource');
const Event = require('../models/Event');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let orgId;
let alphaToken; // booker A
let betaToken; // booker B
let managementToken;

const register = async (email, role) => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: email.split('@')[0], email, password: 'secret123', role });
  return res.body.data.token;
};

const createEvent = async (token, name) => {
  const res = await request(app)
    .post('/api/events')
    .set('Authorization', `Bearer ${token}`)
    .send({
      organization: orgId,
      name,
      startDate: '2027-03-01T10:00:00.000Z',
      endDate: '2027-03-01T12:00:00.000Z',
    })
    .expect(201);
  return res.body.data;
};

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  alphaToken = await register('alpha@ownership.test', 'booker');
  betaToken = await register('beta@ownership.test', 'booker');
  managementToken = await register('boss@ownership.test', 'management');
});

// The organization is wiped with the other data after every test,
// so recreate it each time.
beforeEach(async () => {
  const org = await Organization.create({ name: 'Ownership Org' });
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

const as = (token, method, url) =>
  request(app)[method](url).set('Authorization', `Bearer ${token}`);

describe('event ownership on create', () => {
  test('stamps bookerId from the token', async () => {
    const event = await createEvent(alphaToken, 'Alpha Event');
    const stored = await Event.findById(event._id);
    const alpha = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${alphaToken}`);
    expect(String(stored.bookerId)).toBe(alpha.body.data._id);
  });

  test('ignores a bookerId supplied in the body', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${alphaToken}`)
      .send({
        organization: orgId,
        name: 'Forged Owner',
        startDate: '2027-03-01T10:00:00.000Z',
        endDate: '2027-03-01T12:00:00.000Z',
        bookerId: '000000000000000000000000',
      })
      .expect(201);

    const alpha = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${alphaToken}`);
    expect(String(res.body.data.bookerId)).toBe(alpha.body.data._id);
  });
});

describe("a booker cannot touch another booker's event", () => {
  let betaEvent;

  beforeEach(async () => {
    betaEvent = await createEvent(betaToken, 'Beta Event');
  });

  test('PUT is 403', async () => {
    const res = await as(alphaToken, 'put', `/api/events/${betaEvent._id}`)
      .send({ name: 'Hijacked' })
      .expect(403);
    expect(res.body.message).toMatch(/not allowed to modify/);
  });

  test('DELETE is 403', async () => {
    await as(alphaToken, 'delete', `/api/events/${betaEvent._id}`).expect(403);
    // The event must still exist.
    const still = await Event.findById(betaEvent._id);
    expect(still).not.toBeNull();
  });

  test('adding a requirement is 403', async () => {
    const resource = await Resource.create({ name: 'Chairs', quantityTotal: 10 });
    await as(alphaToken, 'post', `/api/events/${betaEvent._id}/requirements`)
      .send({ resource: String(resource._id), quantity: 5 })
      .expect(403);
  });

  test('reading the event detail is 403', async () => {
    await as(alphaToken, 'get', `/api/events/${betaEvent._id}`).expect(403);
  });

  test('the list endpoint hides other bookers events', async () => {
    await createEvent(alphaToken, 'Alpha Event');

    const res = await as(alphaToken, 'get', '/api/events').expect(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].name).toBe('Alpha Event');
  });
});

describe('owner and management keep access', () => {
  test('the owner can edit their own event', async () => {
    const event = await createEvent(alphaToken, 'My Event');
    await as(alphaToken, 'put', `/api/events/${event._id}`)
      .send({ name: 'My Event Renamed' })
      .expect(200);
  });

  test('the owner can delete their own event', async () => {
    const event = await createEvent(alphaToken, 'My Event');
    await as(alphaToken, 'delete', `/api/events/${event._id}`).expect(200);
  });

  test('management can edit any event', async () => {
    const event = await createEvent(betaToken, 'Beta Event');
    await as(managementToken, 'put', `/api/events/${event._id}`)
      .send({ name: 'Reviewed by Management' })
      .expect(200);
  });

  test('management sees every event in the list', async () => {
    await createEvent(alphaToken, 'Alpha Event');
    await createEvent(betaToken, 'Beta Event');

    const res = await as(managementToken, 'get', '/api/events').expect(200);
    expect(res.body.count).toBe(2);
  });
});

describe('anonymous compatibility', () => {
  test('unauthenticated reads still see all events', async () => {
    await createEvent(alphaToken, 'Alpha Event');
    await createEvent(betaToken, 'Beta Event');

    const res = await request(app).get('/api/events').expect(200);
    expect(res.body.count).toBe(2);
  });

  test('unauthenticated writes are still rejected', async () => {
    await request(app)
      .put('/api/events/000000000000000000000000')
      .send({ name: 'Nope' })
      .expect(401);
  });
});
