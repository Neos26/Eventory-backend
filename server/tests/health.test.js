const request = require('supertest');
const app = require('../app');

describe('GET /api/health', () => {
  test('returns 200 with a health payload', async () => {
    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ok');
    expect(res.body.message).toBe('Eventory API is running');
    expect(typeof res.body.database).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  test('is reachable over HTTP more than once', async () => {
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/health').expect(200);
  });
});
