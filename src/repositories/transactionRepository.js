'use strict';

const db = require('../config/database');

async function create({ id, vendor_id, squad_va_account, squad_payment_link_ref, amount, item_description, buyer_phone, buyer_email, confirmation_link_token, confirmation_link_expires_at }) {
  const result = await db.query(
    `INSERT INTO transactions
      (id, vendor_id, squad_va_account, squad_payment_link_ref, amount, item_description,
       buyer_phone, buyer_email, escrow_status, confirmation_link_token, confirmation_link_expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,NOW())
     RETURNING *`,
    [id, vendor_id, squad_va_account, squad_payment_link_ref, amount, item_description, buyer_phone, buyer_email || null, confirmation_link_token, confirmation_link_expires_at]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query('SELECT * FROM transactions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findByToken(token) {
  const result = await db.query('SELECT * FROM transactions WHERE confirmation_link_token = $1', [token]);
  return result.rows[0] || null;
}

async function findBySquadRef(ref) {
  const result = await db.query('SELECT * FROM transactions WHERE squad_transaction_ref = $1', [ref]);
  return result.rows[0] || null;
}

async function findByVaAccount(va_account) {
  const result = await db.query('SELECT * FROM transactions WHERE squad_va_account = $1 ORDER BY created_at DESC LIMIT 1', [va_account]);
  return result.rows[0] || null;
}

// Store both the Squad transaction ref AND the gateway_ref (needed for refunds)
async function setFunded(id, squad_transaction_ref, squad_gateway_ref) {
  const result = await db.query(
    `UPDATE transactions
     SET escrow_status = 'funded',
         squad_transaction_ref = $1,
         squad_gateway_ref = $2,
         funded_at = NOW()
     WHERE id = $3 AND escrow_status = 'pending'
     RETURNING *`,
    [squad_transaction_ref, squad_gateway_ref || null, id]
  );
  return result.rows[0] || null;
}

async function setDeliveryConfirmed(id) {
  const result = await db.query(
    `UPDATE transactions SET escrow_status = 'delivered', confirmed_at = NOW()
     WHERE id = $1 AND escrow_status = 'funded' RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function setReleased(id) {
  const result = await db.query(
    `UPDATE transactions SET escrow_status = 'released', released_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function setRefunded(id) {
  const result = await db.query(
    `UPDATE transactions SET escrow_status = 'refunded', released_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function setDisputed(id) {
  await db.query(
    `UPDATE transactions SET escrow_status = 'disputed' WHERE id = $1 AND escrow_status IN ('funded','delivered')`,
    [id]
  );
}

async function setAnomalyFlag(id, level, signals) {
  await db.query(
    `UPDATE transactions SET anomaly_flagged = TRUE, anomaly_level = $1, anomaly_signals = $2 WHERE id = $3`,
    [level, signals, id]
  );
}

async function getExpiredEscrows() {
  const result = await db.query(
    `SELECT * FROM transactions
     WHERE escrow_status = 'funded'
       AND confirmation_link_expires_at < NOW()
       AND anomaly_flagged = FALSE`,
    []
  );
  return result.rows;
}

async function listByVendor(vendor_id, { status, page = 1, limit = 20 }) {
  const conditions = ['vendor_id = $1'];
  const params = [vendor_id];
  let idx = 2;

  if (status) {
    conditions.push(`escrow_status = $${idx++}`);
    params.push(status);
  }

  params.push(limit, (page - 1) * limit);

  const result = await db.query(
    `SELECT id, squad_transaction_ref, amount, item_description, escrow_status,
            anomaly_flagged, created_at, funded_at, confirmed_at, released_at
     FROM transactions WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    params
  );
  return result.rows;
}

module.exports = {
  create, findById, findByToken, findBySquadRef, findByVaAccount,
  setFunded, setDeliveryConfirmed, setReleased, setRefunded, setDisputed,
  setAnomalyFlag, getExpiredEscrows, listByVendor,
};