'use strict';

const db = require('../config/database');

async function create({ id, transaction_id, vendor_id, buyer_claim_text, nlp_category, nlp_confidence, resolution_recommendation }) {
  const result = await db.query(
    `INSERT INTO disputes
      (id, transaction_id, vendor_id, buyer_claim_text, nlp_category, nlp_confidence,
       resolution_recommendation, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NOW())
     RETURNING *`,
    [id, transaction_id, vendor_id, buyer_claim_text, nlp_category, nlp_confidence, resolution_recommendation]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query('SELECT * FROM disputes WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByTransactionId(transaction_id) {
  const result = await db.query('SELECT * FROM disputes WHERE transaction_id = $1 ORDER BY created_at DESC', [transaction_id]);
  return result.rows;
}

async function resolve(id, { resolution_applied, status = 'resolved' }) {
  const result = await db.query(
    `UPDATE disputes SET status = $1, resolution_applied = $2, resolved_at = NOW()
     WHERE id = $3 RETURNING *`,
    [status, resolution_applied, id]
  );
  return result.rows[0];
}

async function addVendorEvidence(id, vendor_evidence_text) {
  await db.query(
    'UPDATE disputes SET vendor_evidence_text = $1 WHERE id = $2',
    [vendor_evidence_text, id]
  );
}

async function listByVendor(vendor_id, page = 1, limit = 20) {
  const result = await db.query(
    `SELECT d.*, t.amount, t.item_description
     FROM disputes d JOIN transactions t ON t.id = d.transaction_id
     WHERE d.vendor_id = $1
     ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`,
    [vendor_id, limit, (page - 1) * limit]
  );
  return result.rows;
}

module.exports = { create, findById, findByTransactionId, resolve, addVendorEvidence, listByVendor };