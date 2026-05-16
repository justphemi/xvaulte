sim/**
 * MIGRATION: Add auth columns to b2b_partners
 * Run: node scripts/migrate-b2b-auth.js
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: adding auth columns to b2b_partners table...');
    
    await client.query(`
      ALTER TABLE b2b_partners 
      ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE,
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    `);

    console.log('Migration complete: auth columns added to b2b_partners.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
