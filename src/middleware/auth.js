'use strict';

const jwt = require('../utils/jwt');
const { verifyApiKey } = require('../utils/crypto');
const { unauthorized, forbidden } = require('../utils/response');
const { AppError } = require('./errorHandler');
const db = require('../config/database');
const logger = require('../utils/logger');

async function authenticateVendor(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'Authentication token required');
    }
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token);
    const result = await db.query(
      'SELECT id, business_name, trust_score, score_tier, verification_status FROM vendors WHERE id = $1',
      [payload.vendor_id]
    );
    if (result.rowCount === 0) {
      return unauthorized(res, 'Vendor account not found');
    }
    req.vendor = result.rows[0];
    next();
  } catch (err) {
    if (err.message === 'Token expired') {
      return unauthorized(res, 'Session expired. Please log in again.');
    }
    return unauthorized(res, 'Invalid authentication token');
  }
}

async function authenticateB2B(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return unauthorized(res, 'API key required. Pass X-Api-Key header.');
    }

    const result = await db.query(
      'SELECT id, company_name, api_key, api_calls_made, api_calls_limit, tier FROM b2b_partners WHERE api_calls_limit > api_calls_made',
      []
    );

    let partner = null;
    for (const row of result.rows) {
      const match = await verifyApiKey(apiKey, row.api_key);
      if (match) {
        partner = row;
        break;
      }
    }

    if (!partner) {
      logger.warn('B2B API key rejected', { ip: req.ip });
      return unauthorized(res, 'Invalid or expired API key');
    }

    if (partner.api_calls_made >= partner.api_calls_limit) {
      return forbidden(res, 'API call limit reached. Please upgrade your plan.');
    }

    await db.query(
      'UPDATE b2b_partners SET api_calls_made = api_calls_made + 1 WHERE id = $1',
      [partner.id]
    );

    req.partner = partner;
    next();
  } catch (err) {
    logger.error('B2B auth error', { error: err.message });
    next(new AppError('Authentication error', 500));
  }
}

async function authenticateDeveloperJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'Authentication token required');
    }
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token);

    if (payload.role !== 'developer') {
      return forbidden(res, 'Access denied');
    }

    const result = await db.query(
      'SELECT id, email, company_name FROM b2b_partners WHERE id = $1',
      [payload.partner_id]
    );

    if (result.rowCount === 0) {
      return unauthorized(res, 'Developer account not found');
    }

    req.developer = result.rows[0];
    next();
  } catch (err) {
    if (err.message === 'Token expired') {
      return unauthorized(res, 'Session expired. Please log in again.');
    }
    return unauthorized(res, 'Invalid authentication token');
  }
}

module.exports = { authenticateVendor, authenticateB2B, authenticateDeveloperJWT };