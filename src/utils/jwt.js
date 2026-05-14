'use strict';

// Manual JWT implementation to avoid adding jsonwebtoken as dependency
// Uses crypto module already present in Node.js
const crypto = require('crypto');
const env = require('../config/env');

function base64urlEncode(str) {
  return Buffer.from(str).toString('base64url');
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function sign(payload) {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  const body = base64urlEncode(JSON.stringify({ ...payload, exp: expiresAt, iat: Math.floor(Date.now() / 1000) }));
  const signature = crypto
    .createHmac('sha256', env.jwt.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token) {
  if (!token) throw new Error('No token provided');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', env.jwt.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (expectedSig !== signature) throw new Error('Invalid token signature');
  const payload = JSON.parse(base64urlDecode(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return payload;
}

module.exports = { sign, verify };