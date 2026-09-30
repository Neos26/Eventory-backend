const request = require('supertest');
const app = require('../app');

describe('404 middleware', () => {
  test('unknown GET route returns 404 JSON', async () => {
    const res = await request(app).get('/api/no-such-route').expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('GET');
    expect(res.body.message).toContain('/api/no-such-route');
  });

  test('unknown POST route returns 404 JSON too', async () => {
    const res = await request(app).post('/api/nope').send({ anything: 1 }).expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('POST');
  });

  test('root path has no route yet', async () => {
    const res = await request(app).get('/').expect(404);
    expect(res.body.success).toBe(false);
  });
});
