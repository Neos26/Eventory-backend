const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const Organization = require('../models/Organization');
const Event = require('../models/Event');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');

// A separate database so the real "eventory" data is never touched.
const TEST_URI = 'mongodb://127.0.0.1:27017/eventory_test';

jest.setTimeout(30000);

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
});

afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('database integration', () => {
  test('health reports connected while the DB is reachable', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.database).toBe('connected');
  });

  test('full event -> requirement -> reservation round-trip with populated refs', async () => {
    const org = await Organization.create({ name: 'Eventory Tests' });
    const venue = await Venue.create({ name: 'Main Hall', capacity: 200, organization: org._id });
    const event = await Event.create({
      organization: org._id,
      venue: venue._id,
      name: 'Integration Day',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
    });
    const resource = await Resource.create({
      organization: org._id,
      name: 'Chairs',
      category: 'furniture',
      quantityTotal: 100,
      quantityAvailable: 100,
    });
    const requirement = await ResourceRequirement.create({
      event: event._id,
      resource: resource._id,
      quantity: 20,
      requiredDate: new Date(),
    });
    const reservation = await ResourceReservation.create({
      event: event._id,
      requirement: requirement._id,
      resource: resource._id,
      quantity: 20,
      reservedFrom: new Date(),
      reservedUntil: new Date(Date.now() + 3600000),
    });

    expect(reservation.status).toBe('reserved');
    expect(reservation.quantity).toBe(20);

    const found = await Event.findById(event._id).populate('organization').populate('venue');
    expect(found.organization.name).toBe('Eventory Tests');
    expect(found.venue.name).toBe('Main Hall');

    const reservations = await ResourceReservation.find({ event: event._id });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].resource.toString()).toBe(resource._id.toString());
  });

  test('documents are persisted and can be cleaned up', async () => {
    await Organization.create({ name: 'Temp Org' });
    expect(await Organization.countDocuments()).toBe(1);

    await Organization.deleteMany({});
    expect(await Organization.countDocuments()).toBe(0);
  });

  test('validation errors surface from the database layer too', async () => {
    await expect(Event.create({ name: 'No dates' })).rejects.toThrow(
      mongoose.Error.ValidationError
    );
  });
});
