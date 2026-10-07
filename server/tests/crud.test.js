const mongoose = require('mongoose');
const { authedRequest, registerToken } = require('./helpers/authedRequest');

const app = require('../app');
const Organization = require('../models/Organization');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const Event = require('../models/Event');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');

const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

let token;

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  token = await registerToken(app, 'crud-manager@eventory.test');
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections).filter((collection) => collection.collectionName !== 'users');
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('organizations CRUD', () => {
  test('create, list, get, update, delete', async () => {
    const created = await authedRequest(app, token)
      .post('/api/organizations')
      .send({ name: 'Acme Events', email: 'info@acme.test' })
      .expect(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data.name).toBe('Acme Events');
    const id = created.body.data._id;

    const list = await authedRequest(app, token).get('/api/organizations').expect(200);
    expect(list.body.count).toBe(1);

    const single = await authedRequest(app, token).get(`/api/organizations/${id}`).expect(200);
    expect(single.body.data._id).toBe(id);

    const updated = await authedRequest(app, token)
      .put(`/api/organizations/${id}`)
      .send({ name: 'Acme Renamed' })
      .expect(200);
    expect(updated.body.data.name).toBe('Acme Renamed');

    await authedRequest(app, token).delete(`/api/organizations/${id}`).expect(200);
    const afterDelete = await authedRequest(app, token).get(`/api/organizations/${id}`).expect(404);
    expect(afterDelete.body.success).toBe(false);
  });

  test('missing name returns 400 via validation error', async () => {
    const res = await authedRequest(app, token).post('/api/organizations').send({}).expect(400);
    expect(res.body.success).toBe(false);
  });

  test('malformed id returns 400, unknown id returns 404', async () => {
    await authedRequest(app, token).get('/api/organizations/not-an-id').expect(400);
    await authedRequest(app, token)
      .get(`/api/organizations/${new mongoose.Types.ObjectId()}`)
      .expect(404);
  });

  test('array request bodies are rejected with 400', async () => {
    await authedRequest(app, token).post('/api/organizations').send([{ name: 'A' }]).expect(400);
    const list = await authedRequest(app, token).get('/api/organizations').expect(200);
    expect(list.body.count).toBe(0);
  });

  test('a body _id is stripped - the id comes from the URL', async () => {
    const created = await authedRequest(app, token)
      .post('/api/organizations')
      .send({ name: 'Original' })
      .expect(201);
    const id = created.body.data._id;
    const forgedId = new mongoose.Types.ObjectId().toString();

    const updated = await authedRequest(app, token)
      .put(`/api/organizations/${id}`)
      .send({ _id: forgedId, name: 'Renamed' })
      .expect(200);
    expect(updated.body.data._id).toBe(id);
    expect(updated.body.data.name).toBe('Renamed');
  });
});

describe('venues CRUD', () => {
  test('create, update, delete with nested address', async () => {
    const created = await authedRequest(app, token)
      .post('/api/venues')
      .send({
        name: 'Grand Hall',
        capacity: 300,
        venueType: 'indoor',
        address: { street: '1 Main St', city: 'Manila' },
      })
      .expect(201);
    expect(created.body.data.address.city).toBe('Manila');
    const id = created.body.data._id;

    const updated = await authedRequest(app, token)
      .put(`/api/venues/${id}`)
      .send({ capacity: 400, isActive: false })
      .expect(200);
    expect(updated.body.data.capacity).toBe(400);
    expect(updated.body.data.isActive).toBe(false);

    await authedRequest(app, token).delete(`/api/venues/${id}`).expect(200);
    await authedRequest(app, token).get(`/api/venues/${id}`).expect(404);
  });
});

describe('resources CRUD', () => {
  test('create defaults availability to total, update enforces validators', async () => {
    const created = await authedRequest(app, token)
      .post('/api/resources')
      .send({ name: 'Chairs', category: 'furniture', quantityTotal: 100 })
      .expect(201);
    expect(created.body.data.quantityAvailable).toBe(100);
    const id = created.body.data._id;

    const bad = await authedRequest(app, token)
      .put(`/api/resources/${id}`)
      .send({ quantityAvailable: 500 })
      .expect(400);
    expect(bad.body.success).toBe(false);

    const updated = await authedRequest(app, token)
      .put(`/api/resources/${id}`)
      .send({ quantityTotal: 120 })
      .expect(200);
    expect(updated.body.data.quantityTotal).toBe(120);

    await authedRequest(app, token).delete(`/api/resources/${id}`).expect(200);
  });

  test('total cannot be lowered below what active reservations hold', async () => {
    const org = await Organization.create({ name: 'Guard Org' });
    const event = await Event.create({
      organization: org._id,
      name: 'Guard Event',
      startDate: new Date('2026-07-01T09:00:00Z'),
      endDate: new Date('2026-07-01T17:00:00Z'),
    });
    const resource = await Resource.create({ name: 'Projector', quantityTotal: 10 });
    await ResourceReservation.create({
      event: event._id,
      resource: resource._id,
      quantity: 6,
      reservedFrom: new Date('2026-07-01T09:00:00Z'),
      reservedUntil: new Date('2026-07-01T17:00:00Z'),
      status: 'reserved',
    });

    const rejected = await authedRequest(app, token)
      .put(`/api/resources/${resource._id}`)
      .send({ quantityTotal: 4 })
      .expect(400);
    expect(rejected.body.message).toMatch(/held by active reservations/);

    const allowed = await authedRequest(app, token)
      .put(`/api/resources/${resource._id}`)
      .send({ quantityTotal: 8 })
      .expect(200);
    expect(allowed.body.data.quantityTotal).toBe(8);
  });

  test('deleting a resource removes its requirements and reservations', async () => {
    const org = await Organization.create({ name: 'Res Org' });
    const event = await Event.create({
      organization: org._id,
      name: 'Res Event',
      startDate: new Date('2026-07-01T09:00:00Z'),
      endDate: new Date('2026-07-01T17:00:00Z'),
    });
    const resource = await Resource.create({ name: 'Speakers', quantityTotal: 6 });
    await ResourceRequirement.create({
      event: event._id,
      resource: resource._id,
      quantity: 2,
      requiredDate: new Date('2026-07-01T09:00:00Z'),
    });
    await ResourceReservation.create({
      event: event._id,
      resource: resource._id,
      quantity: 2,
      reservedFrom: new Date('2026-07-01T09:00:00Z'),
      reservedUntil: new Date('2026-07-01T17:00:00Z'),
    });

    await authedRequest(app, token).delete(`/api/resources/${resource._id}`).expect(200);

    expect(await ResourceRequirement.countDocuments({ resource: resource._id })).toBe(0);
    expect(await ResourceReservation.countDocuments({ resource: resource._id })).toBe(0);
  });
});

describe('events CRUD', () => {
  let orgId;
  let venueId;

  beforeEach(async () => {
    const org = await Organization.create({ name: 'Host Org' });
    const venue = await Venue.create({ name: 'Hall', capacity: 100, organization: org._id });
    orgId = org._id;
    venueId = venue._id;
  });

  test('create rejects unknown organization/venue references', async () => {
    await authedRequest(app, token)
      .post('/api/events')
      .send({
        organization: new mongoose.Types.ObjectId(),
        name: 'Ghost',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-02'),
      })
      .expect(400);

    await authedRequest(app, token)
      .post('/api/events')
      .send({
        organization: orgId,
        venue: new mongoose.Types.ObjectId(),
        name: 'Ghost Venue',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-02'),
      })
      .expect(400);
  });

  test('create, list, update (date validator), delete', async () => {
    const created = await authedRequest(app, token)
      .post('/api/events')
      .send({
        organization: orgId,
        venue: venueId,
        name: 'Tech Summit',
        category: 'conference',
        startDate: new Date('2026-06-01T09:00:00Z'),
        endDate: new Date('2026-06-01T17:00:00Z'),
        expectedAttendees: 150,
      })
      .expect(201);
    expect(created.body.data.status).toBe('draft');
    const id = created.body.data._id;

    const list = await authedRequest(app, token).get('/api/events').expect(200);
    expect(list.body.count).toBe(1);

    const renamed = await authedRequest(app, token)
      .put(`/api/events/${id}`)
      .send({ name: 'Tech Summit 2026', status: 'planned' })
      .expect(200);
    expect(renamed.body.data.name).toBe('Tech Summit 2026');
    expect(renamed.body.data.status).toBe('planned');

    // endDate before startDate must be rejected by the model validator.
    const badDates = await authedRequest(app, token)
      .put(`/api/events/${id}`)
      .send({ startDate: new Date('2026-06-05'), endDate: new Date('2026-06-01') })
      .expect(400);
    expect(badDates.body.message).toMatch(/End date/i);

    await authedRequest(app, token).delete(`/api/events/${id}`).expect(200);
    await authedRequest(app, token).get(`/api/events/${id}`).expect(404);
  });

  test('deleting an event removes its requirements and reservations', async () => {
    const resource = await Resource.create({ name: 'Mics', quantityTotal: 10 });
    const created = await authedRequest(app, token)
      .post('/api/events')
      .send({
        organization: orgId,
        name: 'Cleanup Event',
        startDate: new Date('2026-06-01T09:00:00Z'),
        endDate: new Date('2026-06-01T17:00:00Z'),
      })
      .expect(201);
    const eventId = created.body.data._id;

    await authedRequest(app, token)
      .post(`/api/events/${eventId}/requirements`)
      .send({ resource: resource._id, quantity: 4 })
      .expect(201);
    await authedRequest(app, token)
      .post('/api/reservations')
      .send({
        event: eventId,
        resource: resource._id,
        quantity: 4,
        reservedFrom: new Date('2026-06-01T09:00:00Z'),
        reservedUntil: new Date('2026-06-01T17:00:00Z'),
      })
      .expect(201);

    await authedRequest(app, token).delete(`/api/events/${eventId}`).expect(200);

    expect(await ResourceRequirement.countDocuments({ event: eventId })).toBe(0);
    expect(await ResourceReservation.countDocuments({ event: eventId })).toBe(0);

    // The stock the deleted event held must be free again.
    const avail = await authedRequest(app, token)
      .get(`/api/resources/${resource._id}/availability`)
      .expect(200);
    expect(avail.body.data.available).toBe(10);
    expect(avail.body.data.reserved).toBe(0);
  });

  test('missing required fields return 400', async () => {
    const res = await authedRequest(app, token)
      .post('/api/events')
      .send({ organization: orgId, name: 'No dates' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});
