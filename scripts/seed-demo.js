/**
 * VAULTE DEMO SEED SCRIPT
 * Pre-loads Ada, Chidi, and Temi vendor profiles for hackathon demo
 * Run: node scripts/seed-demo.js
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const DEMO_VENDORS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    business_name: 'Ada Fashion Store',
    category: 'Fashion',
    phone: '+2348001111111',
    nin: '12345678901',
    squad_payout_account: '0123456789',
    squad_payout_bank_code: '058',
    location_state: 'Lagos',
    trust_score: 78,
    score_tier: 'Trusted Seller',
    verification_status: 'passed',
    verification_confidence: 89.4,
    transactions_to_seed: 32,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    business_name: 'Chidi Electronics Hub',
    category: 'Electronics',
    phone: '+2348002222222',
    nin: '98765432109',
    squad_payout_account: '9876543210',
    squad_payout_bank_code: '011',
    location_state: 'Anambra',
    trust_score: 65,
    score_tier: 'Trusted Seller',
    verification_status: 'passed',
    verification_confidence: 82.1,
    transactions_to_seed: 18,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    business_name: 'Temi Skincare Brand',
    category: 'Beauty',
    phone: '+2348003333333',
    nin: '11223344556',
    squad_payout_account: '1122334455',
    squad_payout_bank_code: '033',
    location_state: 'Abuja',
    trust_score: 55,
    score_tier: 'Basic Verified',
    verification_status: 'passed',
    verification_confidence: 76.8,
    transactions_to_seed: 12,
  },
];

const ITEM_DESCRIPTIONS = [
  'Custom Ankara dress', 'Samsung Galaxy A54', 'Face serum 30ml',
  'Adire blouse size M', 'iPhone 13 case', 'Moisturizer set',
  'Lace fabric 3 yards', 'Laptop charger', 'Body butter 200g',
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Starting demo seed...');
    await client.query('BEGIN');

    for (const vendor of DEMO_VENDORS) {
      const plainKey = crypto.randomBytes(32).toString('hex');
      const hashedKey = await bcrypt.hash(plainKey, 12);

      await client.query(`
        INSERT INTO vendors (id, business_name, category, phone, nin, squad_payout_account,
          squad_payout_bank_code, payout_verified, trust_score, score_tier, verification_status,
          verification_confidence, api_key, location_state, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,$11,$12,$13,
          NOW() - INTERVAL '60 days', NOW())
        ON CONFLICT (id) DO UPDATE SET
          trust_score = EXCLUDED.trust_score,
          score_tier = EXCLUDED.score_tier,
          verification_status = EXCLUDED.verification_status,
          updated_at = NOW()
      `, [
        vendor.id, vendor.business_name, vendor.category, vendor.phone, vendor.nin,
        vendor.squad_payout_account, vendor.squad_payout_bank_code,
        vendor.trust_score, vendor.score_tier, vendor.verification_status,
        vendor.verification_confidence, hashedKey, vendor.location_state,
      ]);

      // Seed transaction history
      for (let i = 0; i < vendor.transactions_to_seed; i++) {
        const txId = crypto.randomUUID();
        const daysAgo = Math.floor(Math.random() * 55) + 1;
        const amount = Math.floor(Math.random() * 45000) + 5000;
        const item = ITEM_DESCRIPTIONS[Math.floor(Math.random() * ITEM_DESCRIPTIONS.length)];
        const status = Math.random() > 0.1 ? 'released' : 'disputed';

        await client.query(`
          INSERT INTO transactions (id, vendor_id, squad_va_account, squad_transaction_ref,
            amount, item_description, buyer_phone, escrow_status, confirmation_link_token,
            created_at, funded_at, confirmed_at, released_at)
          VALUES ($1,$2,'1234567890',$3,$4,$5,'+2348009999999',$6,$7,
            NOW()-($8 || ' days')::INTERVAL,
            NOW()-($8 || ' days')::INTERVAL + INTERVAL '5 minutes',
            NOW()-($8 || ' days')::INTERVAL + INTERVAL '2 hours',
            NOW()-($8 || ' days')::INTERVAL + INTERVAL '2 hours 1 minute')
          ON CONFLICT DO NOTHING
        `, [txId, vendor.id, `SQ-DEMO-${txId.slice(0,8)}`, amount, item, status,
            crypto.randomBytes(32).toString('hex'), daysAgo.toString()]);
      }

      // Seed score history
      await client.query(`
        INSERT INTO trust_score_history
          (id, vendor_id, score, identity_component, transaction_consistency_component,
           dispute_rate_component, completion_rate_component, account_age_component, trigger_event, calculated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'demo_seed', NOW())
      `, [vendor.id, vendor.trust_score, vendor.verification_confidence,
          vendor.trust_score - 10, vendor.trust_score - 5, vendor.trust_score, 60]);

      console.log(`Seeded vendor: ${vendor.business_name} (Score: ${vendor.trust_score})`);
    }

    await client.query('COMMIT');
    console.log('Demo seed complete. Ada, Chidi, and Temi are ready for the demo.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();