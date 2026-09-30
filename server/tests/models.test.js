const mongoose = require('mongoose');

const Organization = require('../models/Organization');
const Event = require('../models/Event');
const Venue = require('../models/Venue');
const Resource = require('../models/Resource');
const ResourceRequirement = require('../models/ResourceRequirement');
const ResourceReservation = require('../models/ResourceReservation');

// Validation runs offline - no database write happens here.
const validationError = async (doc) => {
  try {
    await doc.validate();
    return null;
  } catch (err) {
    return err;
  }
};

const tomorrow = () => new Date(Date.now() + 86400000);
const inAnHour = () => new Date(Date.now() + 3600000);

describe('Organization model', () => {
  test('name is required', async () => {
    const err = await validationError(new Organization({ email: 'x@example.com' }));
    expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(err.errors.name).toBeDefined();
  });

  test('a minimal valid organization passes', async () => {
    await expect(new Organization({ name: 'Acme Events' }).validate()).resolves.toBeUndefined();
  });
});

describe('Event model', () => {
  const base = {
    organization: new mongoose.Types.ObjectId(),
    name: 'Tech Conference',
    startDate: new Date(),
    endDate: tomorrow(),
  };

  test('name, startDate and endDate are required', async () => {
    const err = await validationError(new Event({}));
    expect(err.errors.name).toBeDefined();
    expect(err.errors.startDate).toBeDefined();
    expect(err.errors.endDate).toBeDefined();
  });

  test('endDate cannot be before startDate', async () => {
    const err = await validationError(
      new Event({ ...base, startDate: tomorrow(), endDate: new Date() })
    );
    expect(err.errors.endDate).toBeDefined();
  });

  test('unsupported category is rejected', async () => {
    const err = await validationError(new Event({ ...base, category: 'wedding' }));
    expect(err.errors.category).toBeDefined();
  });

  test('a valid event passes', async () => {
    await expect(new Event(base).validate()).resolves.toBeUndefined();
  });
});

describe('Venue model', () => {
  test('name is required', async () => {
    const err = await validationError(new Venue({ capacity: 50 }));
    expect(err.errors.name).toBeDefined();
  });

  test('negative capacity is rejected', async () => {
    const err = await validationError(new Venue({ name: 'Hall', capacity: -1 }));
    expect(err.errors.capacity).toBeDefined();
  });

  test('unsupported venueType is rejected', async () => {
    const err = await validationError(new Venue({ name: 'Hall', venueType: 'underwater' }));
    expect(err.errors.venueType).toBeDefined();
  });
});

describe('Resource model', () => {
  test('name is required', async () => {
    const err = await validationError(new Resource({}));
    expect(err.errors.name).toBeDefined();
  });

  test('quantityTotal is required (null is not accepted)', async () => {
    const err = await validationError(new Resource({ name: 'Chairs', quantityTotal: null }));
    expect(err.errors.quantityTotal).toBeDefined();
  });

  test('negative quantityTotal is rejected', async () => {
    const err = await validationError(new Resource({ name: 'Chairs', quantityTotal: -5 }));
    expect(err.errors.quantityTotal).toBeDefined();
  });

  test('available quantity cannot exceed total', async () => {
    const err = await validationError(
      new Resource({ name: 'Chairs', quantityTotal: 10, quantityAvailable: 11 })
    );
    expect(err.errors.quantityAvailable).toBeDefined();
  });

  test('unsupported category is rejected', async () => {
    const err = await validationError(new Resource({ name: 'X', category: 'animals' }));
    expect(err.errors.category).toBeDefined();
  });

  test('a valid resource passes', async () => {
    await expect(
      new Resource({ name: 'Chairs', quantityTotal: 50, quantityAvailable: 50 }).validate()
    ).resolves.toBeUndefined();
  });
});

describe('ResourceRequirement model', () => {
  test('event, resource, quantity and requiredDate are required', async () => {
    const err = await validationError(new ResourceRequirement({}));
    expect(err.errors.event).toBeDefined();
    expect(err.errors.resource).toBeDefined();
    expect(err.errors.quantity).toBeDefined();
    expect(err.errors.requiredDate).toBeDefined();
  });

  test('quantity must be at least 1', async () => {
    const err = await validationError(
      new ResourceRequirement({
        event: new mongoose.Types.ObjectId(),
        resource: new mongoose.Types.ObjectId(),
        quantity: 0,
        requiredDate: new Date(),
      })
    );
    expect(err.errors.quantity).toBeDefined();
  });

  test('unsupported priority is rejected', async () => {
    const err = await validationError(
      new ResourceRequirement({
        event: new mongoose.Types.ObjectId(),
        resource: new mongoose.Types.ObjectId(),
        quantity: 5,
        requiredDate: new Date(),
        priority: 'asap',
      })
    );
    expect(err.errors.priority).toBeDefined();
  });
});

describe('ResourceReservation model', () => {
  const base = {
    event: new mongoose.Types.ObjectId(),
    resource: new mongoose.Types.ObjectId(),
    quantity: 5,
    reservedFrom: new Date(),
    reservedUntil: inAnHour(),
  };

  test('event, resource, quantity and dates are required', async () => {
    const err = await validationError(new ResourceReservation({}));
    expect(err.errors.event).toBeDefined();
    expect(err.errors.resource).toBeDefined();
    expect(err.errors.quantity).toBeDefined();
    expect(err.errors.reservedFrom).toBeDefined();
    expect(err.errors.reservedUntil).toBeDefined();
  });

  test('reservedUntil cannot be before reservedFrom', async () => {
    const err = await validationError(
      new ResourceReservation({ ...base, reservedFrom: inAnHour(), reservedUntil: new Date() })
    );
    expect(err.errors.reservedUntil).toBeDefined();
  });

  test('unsupported status is rejected', async () => {
    const err = await validationError(new ResourceReservation({ ...base, status: 'lost' }));
    expect(err.errors.status).toBeDefined();
  });

  test('a valid reservation passes', async () => {
    await expect(new ResourceReservation(base).validate()).resolves.toBeUndefined();
  });
});
