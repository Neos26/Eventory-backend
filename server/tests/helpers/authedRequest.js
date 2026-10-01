const request = require('supertest');

// Registers a throwaway management user and returns a token for it.
const registerToken = async (app, email, role = 'management') => {
  const res = await request(app).post('/api/auth/register').send({
    name: 'Test Manager',
    email,
    password: 'secret123',
    role,
  });
  return res.body.data.token;
};

// Wraps supertest so every request automatically carries the given Bearer
// token. (Public GET routes ignore the header; authenticated ones pass.)
const authedRequest = (app, token) => {
  const req = request(app);
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    const original = req[method].bind(req);
    req[method] = (...args) => original(...args).set('Authorization', `Bearer ${token}`);
  }
  return req;
};

module.exports = { authedRequest, registerToken };
