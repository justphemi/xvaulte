/**
 * MIGRATION: Create products table and seed Vaulte Internal B2B API Key
 * Run: node scripts/migrate-commerce.js
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// We use the same hashing function for API keys
async function hashApiKey(plainKey) {
  return await bcrypt.hash(plainKey, 10);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: commerce features...');
    
    // 1. Create products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY,
        vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('Table products created or already exists.');

    // 2. Seed Internal Vaulte B2B Partner
    const internalEmail = 'internal-commerce@vaulte.app';
    const existing = await client.query('SELECT id FROM b2b_partners WHERE email = $1', [internalEmail]);
    
    if (existing.rowCount === 0) {
      console.log('Seeding Internal Vaulte B2B Partner...');
      const partnerId = crypto.randomUUID();
      const plainApiKey = 'sk_live_vaulte_internal_commerce_api_key_v1'; // Hardcoded internal key
      const hashedKey = await hashApiKey(plainApiKey);
      const passwordHash = await bcrypt.hash('INTERNAL_SYSTEM_NO_LOGIN', 10);

      await client.query(`
        INSERT INTO b2b_partners 
        (id, email, password_hash, company_name, contact_email, api_key, api_calls_made, api_calls_limit, tier) 
        VALUES ($1, $2, $3, $4, $5, $6, 0, 9999999, 'enterprise')
      `, [partnerId, internalEmail, passwordHash, 'Vaulte Commerce (Internal)', internalEmail, hashedKey]);
      
      console.log('Seeded internal B2B partner.');
    } else {
      console.log('Internal B2B partner already exists.');
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
