'use strict';

const db = require('../config/database');

async function create({ id, partner_id, external_user_id, session_token, callback_url, expires_at }) {
  const result = await db.query(
    `INSERT INTO verification_sessions
      (id, partner_id, external_user_id, session_token, callback_url, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [id, partner_id, external_user_id, session_token, callback_url, expires_at]
  );
  return result.rows[0];
}

async function findByToken(token) {
  const result = await db.query(
    `SELECT * FROM verification_sessions WHERE session_token = $1`,
    [token]
  );
  return result.rows[0];
}

async function updateStatus(id, status, data = null) {
  let query = 'UPDATE verification_sessions SET status = $1, updated_at = NOW()';
  const params = [status];
  
  if (data) {
    query += ', verification_data = verification_data || $2';
    params.push(JSON.stringify(data));
    query += ' WHERE id = $3';
    params.push(id);
  } else {
    query += ' WHERE id = $2';
    params.push(id);
  }
  
  const result = await db.query(query + ' RETURNING *', params);
  return result.rows[0];
}

async function updateData(id, data) {
  const result = await db.query(
    `UPDATE verification_sessions 
     SET verification_data = verification_data || $1, updated_at = NOW() 
     WHERE id = $2 
     RETURNING *`,
    [JSON.stringify(data), id]
  );
  return result.rows[0];
}

module.exports = {
  create,
  findByToken,
  updateStatus,
  updateData
};
