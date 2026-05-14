/**
 * MIGRATION: Create verification_sessions table
 * Run: node scripts/create-verification-sessions-table.js
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
    console.log('Starting migration: create verification_sessions table...');
    
    await client.query(`
      CREATE TYPE verification_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'expired');
    `).catch(e => console.log('Type verification_status might already exist, skipping...'));

    await client.query(`
      ALTER TABLE b2b_partners 
      ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(255),
      ADD COLUMN IF NOT EXISTS callback_url TEXT;
    `).catch(e => console.log('Could not alter b2b_partners table, it might not exist yet.'));

    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_sessions (

        id UUID PRIMARY KEY,
        partner_id UUID REFERENCES b2b_partners(id),
        external_user_id VARCHAR(255),
        session_token VARCHAR(255) UNIQUE NOT NULL,
        status verification_status DEFAULT 'pending',
        verification_data JSONB DEFAULT '{}'::jsonb,
        callback_url TEXT,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_verification_sessions_token ON verification_sessions(session_token);
      CREATE INDEX IF NOT EXISTS idx_verification_sessions_partner ON verification_sessions(partner_id);
    `);

    console.log('Migration complete: verification_sessions table created.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
