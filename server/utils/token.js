const crypto = require('crypto');

// Minimal JWT-format token (header.payload.signature, HS256) implemented
// with Node's built-in crypto - no jsonwebtoken dependency.
// Same wire format as a standard JWT, so clients can decode the payload
// (e.g. to read user.role) with any JWT decoder.

const DEFAULT_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days

const getSecret = () => process.env.JWT_SECRET || 'eventory-dev-secret-change-me';

const base64url = (value) => Buffer.from(value).toString('base64url');

const signatureFor = (data) =>
  crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');

// Sign a token for a user: claims are id + role (+ iat/exp).
const signToken = (user, expiresInSeconds = DEFAULT_EXPIRES_SECONDS) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      id: user._id,
      role: user.role,
      iat: issuedAt,
      exp: issuedAt + expiresInSeconds,
    }),
  );
  const data = `${header}.${payload}`;
  return `${data}.${signatureFor(data)}`;
};

// Verify signature and expiry; throws on any problem.
const verifyToken = (token) => {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [header, payload, signature] = parts;
  const expected = signatureFor(`${header}.${payload}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid token signature');
  }

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!claims.id) throw new Error('Token is missing an id claim');
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return claims;
};

module.exports = { signToken, verifyToken };
