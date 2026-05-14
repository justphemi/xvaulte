'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const jwt = require('../utils/jwt');
const { hashApiKey } = require('../utils/crypto');
const { success, created, error, unauthorized } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Generate a new API key and its hash.
 * Returns { plainKey, hashedKey }
 */
async function generateNewApiKey() {
  const plainKey = `sk_${crypto.randomBytes(24).toString('hex')}`;
  const hashedKey = await hashApiKey(plainKey);
  return { plainKey, hashedKey };
}

/**
 * POST /v1/developer/auth/signup
 */
async function signup(req, res, next) {
  try {
    const { email, password, company_name } = req.body;

    // Check if email already exists
    const existing = await db.query('SELECT id FROM b2b_partners WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return error(res, 'Email already in use', 400);
    }

    const partnerId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const { plainKey, hashedKey } = await generateNewApiKey();

    await db.query(
      `INSERT INTO b2b_partners 
       (id, email, contact_email, password_hash, company_name, api_key, api_calls_made, api_calls_limit, tier) 
       VALUES ($1, $2, $3, $4, $5, $6, 0, 1000, 'free')`,
      [partnerId, email, email, passwordHash, company_name, hashedKey]
    );

    logger.info('New developer signed up', { partner_id: partnerId, email });

    // Generate JWT for dashboard session
    const token = jwt.sign({ partner_id: partnerId, role: 'developer' });

    // Return the plain API key EXACTLY ONCE
    return created(res, {
      token,
      partner: {
        id: partnerId,
        email,
        company_name,
        api_calls_limit: 1000,
        tier: 'free'
      },
      api_key: plainKey, // CAUTION: Only shown once
    }, 'Developer account created successfully');

  } catch (err) {
    next(err);
  }
}

/**
 * POST /v1/developer/auth/signin
 */
async function signin(req, res, next) {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      'SELECT id, email, password_hash, company_name, tier, api_calls_limit, api_calls_made FROM b2b_partners WHERE email = $1',
      [email]
    );

    if (result.rowCount === 0) {
      return unauthorized(res, 'Invalid credentials');
    }

    const partner = result.rows[0];

    const isMatch = await bcrypt.compare(password, partner.password_hash);
    if (!isMatch) {
      return unauthorized(res, 'Invalid credentials');
    }

    const token = jwt.sign({ partner_id: partner.id, role: 'developer' });

    delete partner.password_hash; // Don't send this back

    logger.info('Developer signed in', { partner_id: partner.id });

    return success(res, {
      token,
      partner
    }, 'Signed in successfully');

  } catch (err) {
    next(err);
  }
}

/**
 * POST /v1/developer/auth/api-keys/roll
 */
async function rollApiKey(req, res, next) {
  try {
    const partnerId = req.developer.id; // from authenticateDeveloperJWT middleware

    const { plainKey, hashedKey } = await generateNewApiKey();

    await db.query(
      'UPDATE b2b_partners SET api_key = $1 WHERE id = $2',
      [hashedKey, partnerId]
    );

    logger.info('Developer rolled API key', { partner_id: partnerId });

    return success(res, {
      api_key: plainKey // CAUTION: Only shown once
    }, 'New API key generated. Please save it securely.');

  } catch (err) {
    next(err);
  }
}

module.exports = {
  signup,
  signin,
  rollApiKey
};
