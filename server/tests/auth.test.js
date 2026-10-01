const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../app');
const User = require('../models/User');
const Organization = require('../models/Organization');

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

const register = (overrides = {}) =>
  request(app)
    .post('/api/auth/register')
    .send({
      name: 'Test Booker',
      email: 'booker@example.com',
      password: 'secret123',
      ...overrides,
    });

describe('POST /api/auth/register', () => {
  test('creates a booker account and returns a token', async () => {
    const res = await register().expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      name: 'Test Booker',
      email: 'booker@example.com',
      role: 'booker',
    });
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('creates a management account when role is provided', async () => {
    const res = await register({ email: 'boss@example.com', role: 'management' }).expect(201);
    expect(res.body.data.user.role).toBe('management');
  });

  test('rejects an admin role', async () => {
    const res = await register({ role: 'admin' }).expect(400);
    expect(res.body.message).toMatch(/booker or management/);
  });

  test('rejects a duplicate email with 409', async () => {
    await register().expect(201);
    const res = await register().expect(409);
    expect(res.body.message).toMatch(/already exists/);
  });

  test('rejects a short password', async () => {
    const res = await register({ password: 'abc' }).expect(400);
    expect(res.body.message).toMatch(/at least 6/);
  });

  test.each(['name', 'email', 'password'])('rejects missing %s', async (field) => {
    const res = await register({ [field]: undefined }).expect(400);
    expect(res.body.message).toMatch(new RegExp(field));
  });

  test('stores the password hashed, never in plain text', async () => {
    await register().expect(201);
    const user = await User.findOne({ email: 'booker@example.com' }).select('+password');
    expect(user.password).not.toBe('secret123');
    expect(user.password.length).toBeGreaterThan(40);
  });

  test('rejects a nonexistent organizationId', async () => {
    const res = await register({ organizationId: '000000000000000000000000' }).expect(400);
    expect(res.body.message).toMatch(/Organization not found/);
  });

  test('accepts a valid organizationId', async () => {
    const org = await Organization.create({ name: 'Science Club' });
    const res = await register({ organizationId: String(org._id) }).expect(201);
    expect(res.body.data.user.organizationId).toBe(String(org._id));
  });
});

describe('POST /api/auth/login', () => {
  test('returns a token and the user with role', async () => {
    await register({ email: 'boss@example.com', role: 'management' }).expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'boss@example.com', password: 'secret123' })
      .expect(200);

    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.role).toBe('management');
    expect(res.body.data.user.password).toBeUndefined();
  });

  test('rejects a wrong password with 401', async () => {
    await register().expect(201);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'booker@example.com', password: 'wrong-password' })
      .expect(401);
    expect(res.body.message).toMatch(/Invalid email or password/);
  });

  test('rejects an unknown email with 401 (same message)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'secret123' })
      .expect(401);
    expect(res.body.message).toMatch(/Invalid email or password/);
  });

  test('rejects missing credentials with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({}).expect(400);
    expect(res.body.message).toMatch(/email is required/);
  });

  test('login is case-insensitive on email', async () => {
    await register({ email: 'mixed@example.com' }).expect(201);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'MIXED@Example.com', password: 'secret123' })
      .expect(200);
    expect(res.body.data.user.email).toBe('mixed@example.com');
  });
});

describe('GET /api/auth/me', () => {
  test('returns the current user for a valid token', async () => {
    const { body } = await register({ role: 'management' }).expect(201);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.data.token}`)
      .expect(200);

    expect(res.body.data).toMatchObject({ email: 'booker@example.com', role: 'management' });
    expect(res.body.data.password).toBeUndefined();
  });

  test('rejects a missing token with 401', async () => {
    const res = await request(app).get('/api/auth/me').expect(401);
    expect(res.body.message).toMatch(/Authentication required/);
  });

  test('rejects a garbage token with 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(res.body.message).toMatch(/Invalid or expired/);
  });

  test('rejects a token whose account was deleted', async () => {
    const { body } = await register().expect(201);
    await User.deleteMany({});

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.data.token}`)
      .expect(401);
    expect(res.body.message).toMatch(/no longer exists/);
  });
});
