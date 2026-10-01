const crypto = require('crypto');
const { promisify } = require('util');

// scrypt is Node's built-in password hashing algorithm (memory-hard,
// purpose-designed for passwords) - no external dependency needed.
const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

// Stored format: "scrypt:<salt hex>:<derived key hex>"
const hashPassword = async (password) => {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt:${salt}:${derived.toString('hex')}`;
};

const verifyPassword = async (password, stored) => {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;

  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const expected = Buffer.from(hash, 'hex');
  // Constant-time comparison so the check itself leaks no information.
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
};

module.exports = { hashPassword, verifyPassword };
