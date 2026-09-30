const express = require('express');
const request = require('supertest');

const notFound = require('../middleware/notFound');
const errorHandler = require('../middleware/errorHandler');
const Organization = require('../models/Organization');

// Rebuilds the same middleware order as app.js (routes -> 404 -> error handler)
// so we can trigger errors without touching the real application file.
const buildApp = () => {
  const app = express();
  app.use(express.json());

  app.get('/api/boom', (req, res, next) => next(new Error('boom')));
  app.get('/api/warned', (req, res, next) => {
    const err = new Error('bad input');
    err.statusCode = 400;
    next(err);
  });
  app.post('/api/invalid-org', async (req, res, next) => {
    try {
      await new Organization({ email: 'no-name@example.com' }).validate();
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
};

describe('global error handler', () => {
  const app = buildApp();

  test('unhandled errors return 500 with a message', async () => {
    const res = await request(app).get('/api/boom').expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('boom');
  });

  test('errors carrying a statusCode keep it', async () => {
    const res = await request(app).get('/api/warned').expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('bad input');
  });

  test('mongoose ValidationError becomes 400 with joined messages', async () => {
    const res = await request(app).post('/api/invalid-org').expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Organization name is required');
  });

  test('stack traces are hidden outside development', async () => {
    const res = await request(app).get('/api/boom');
    expect(res.body.stack).toBeUndefined();
  });
});
