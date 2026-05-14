'use strict';

const db = require('../config/database');

async function create({ id, business_name, category, phone, nin, squad_payout_account, squad_payout_bank_code, location_state, api_key_hash }) {
  const result = await db.query(
    `INSERT INTO vendors
      (id, business_name, category, phone, nin, squad_payout_account, squad_payout_bank_code,
       location_state, api_key, trust_score, score_tier, verification_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'Unverified', 'pending', NOW(), NOW())
     RETURNING id, business_name, category, trust_score, score_tier, verification_status`,
    [id, business_name, category, phone, nin, squad_payout_account, squad_payout_bank_code, location_state, api_key_hash]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query(
    `SELECT id, business_name, category, phone, squad_payout_account, squad_payout_bank_code,
            payout_verified, trust_score, score_tier, verification_status, verification_confidence,
            score_frozen, location_state, created_at, updated_at
     FROM vendors WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByPhone(phone) {
  const result = await db.query('SELECT id, business_name FROM vendors WHERE phone = $1', [phone]);
  return result.rows[0] || null;
}

async function updateVerification(vendorId, { verification_status, verification_confidence }) {
  const result = await db.query(
    `UPDATE vendors
     SET verification_status = $1, verification_confidence = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, trust_score, score_tier, verification_status`,
    [verification_status, verification_confidence, vendorId]
  );
  return result.rows[0];
}

async function setPayoutVerified(vendorId, verified) {
  await db.query(
    'UPDATE vendors SET payout_verified = $1, updated_at = NOW() WHERE id = $2',
    [verified, vendorId]
  );
}

async function freezeScore(vendorId, freeze) {
  await db.query(
    'UPDATE vendors SET score_frozen = $1, updated_at = NOW() WHERE id = $2',
    [freeze, vendorId]
  );
}

async function getScoreHistory(vendorId, limit = 30) {
  const result = await db.query(
    `SELECT score, identity_component, transaction_consistency_component, dispute_rate_component,
            completion_rate_component, account_age_component, trigger_event, calculated_at
     FROM trust_score_history
     WHERE vendor_id = $1
     ORDER BY calculated_at DESC LIMIT $2`,
    [vendorId, limit]
  );
  return result.rows;
}

async function listVerified({ badge, category, location_state, page = 1, limit = 20 }) {
  const conditions = ["verification_status = 'passed'"];
  const params = [];
  let idx = 1;

  if (badge) {
    conditions.push(`score_tier = $${idx++}`);
    params.push(badge);
  }
  if (category) {
    conditions.push(`category = $${idx++}`);
    params.push(category);
  }
  if (location_state) {
    conditions.push(`location_state = $${idx++}`);
    params.push(location_state);
  }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const where = conditions.join(' AND ');
  const result = await db.query(
    `SELECT id, business_name, category, trust_score, score_tier, location_state
     FROM vendors WHERE ${where}
     ORDER BY trust_score DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByPhone,
  updateVerification,
  setPayoutVerified,
  freezeScore,
  getScoreHistory,
  listVerified,
};