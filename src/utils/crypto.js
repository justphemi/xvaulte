'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;

async function hashApiKey(plainKey) {
  return bcrypt.hash(plainKey, BCRYPT_ROUNDS);
}

async function verifyApiKey(plainKey, hash) {
  return bcrypt.compare(plainKey, hash);
}

function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function hmacSha512(payload, secret) {
  return crypto.createHmac('sha512', secret).update(payload).digest('hex');
}

function hmacSha256(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  hashApiKey,
  verifyApiKey,
  generateApiKey,
  generateToken,
  hmacSha512,
  hmacSha256,
  timingSafeEqual,
};