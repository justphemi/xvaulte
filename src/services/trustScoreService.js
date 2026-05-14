'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

const COMPONENT_WEIGHTS = {
  identity: 0.30,
  transaction_consistency: 0.25,
  dispute_rate: 0.20,
  completion_rate: 0.15,
  account_age: 0.10,
};

const SCORE_TIERS = [
  { min: 90, tier: 'Elite Vendor' },
  { min: 75, tier: 'Premium Verified' },
  { min: 60, tier: 'Trusted Seller' },
  { min: 40, tier: 'Basic Verified' },
  { min: 0, tier: 'Unverified' },
];

function getTier(score) {
  for (const { min, tier } of SCORE_TIERS) {
    if (score >= min) return tier;
  }
  return 'Unverified';
}

/**
 * Calculate and persist updated trust score for a vendor.
 * triggerEvent is a short string describing what caused recalculation.
 */
async function recalculate(vendorId, triggerEvent = 'manual') {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const vendorResult = await client.query(
      'SELECT id, verification_confidence, verification_status, created_at, score_frozen FROM vendors WHERE id = $1',
      [vendorId]
    );
    if (vendorResult.rowCount === 0) throw new Error(`Vendor ${vendorId} not found`);
    const vendor = vendorResult.rows[0];

    if (vendor.score_frozen) {
      logger.info('Trust score recalculation skipped - score frozen', { vendor_id: vendorId });
      await client.query('ROLLBACK');
      return null;
    }

    const txResult = await client.query(
      `SELECT
        COUNT(*) FILTER (WHERE escrow_status = 'released') AS completed,
        COUNT(*) FILTER (WHERE escrow_status = 'refunded') AS refunded,
        COUNT(*) FILTER (WHERE escrow_status = 'disputed') AS disputed,
        COUNT(*) AS total,
        COALESCE(AVG(EXTRACT(EPOCH FROM (confirmed_at - funded_at))), 0) AS avg_confirm_secs
       FROM transactions
       WHERE vendor_id = $1 AND created_at > NOW() - INTERVAL '90 days'`,
      [vendorId]
    );
    const tx = txResult.rows[0];
    const total = parseInt(tx.total, 10);
    const completed = parseInt(tx.completed, 10);
    const refunded = parseInt(tx.refunded, 10);
    const disputed = parseInt(tx.disputed, 10);

    // Component 1 — Identity Verification (0-100)
    const identityRaw = parseFloat(vendor.verification_confidence || 0);
    const identityScore = vendor.verification_status === 'passed' ? Math.min(identityRaw, 100) : 0;

    // Component 2 — Transaction Consistency (0-100)
    let txConsistencyScore = 0;
    if (total > 0) {
      const completionRatio = completed / total;
      const volumeBonus = Math.min(total / 50, 1) * 20;
      txConsistencyScore = Math.min(completionRatio * 80 + volumeBonus, 100);
    }

    // Component 3 — Dispute Rate (0-100, higher is better)
    let disputeScore = 100;
    if (total > 0) {
      const disputeRatio = disputed / total;
      disputeScore = Math.max(0, 100 - disputeRatio * 300);
    }

    // Component 4 — Order Completion Rate (0-100)
    let completionScore = 0;
    if (total > 0) {
      completionScore = Math.min((completed / total) * 100, 100);
    }

    // Component 5 — Account Age & Consistency (0-100)
    const ageInDays = (Date.now() - new Date(vendor.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const ageScore = Math.min((ageInDays / 180) * 100, 100);

    const finalScore = Math.round(
      identityScore * COMPONENT_WEIGHTS.identity +
      txConsistencyScore * COMPONENT_WEIGHTS.transaction_consistency +
      disputeScore * COMPONENT_WEIGHTS.dispute_rate +
      completionScore * COMPONENT_WEIGHTS.completion_rate +
      ageScore * COMPONENT_WEIGHTS.account_age
    );

    const scoreTier = getTier(finalScore);

    await client.query(
      `UPDATE vendors SET trust_score = $1, score_tier = $2, updated_at = NOW() WHERE id = $3`,
      [finalScore, scoreTier, vendorId]
    );

    await client.query(
      `INSERT INTO trust_score_history
        (id, vendor_id, score, identity_component, transaction_consistency_component,
         dispute_rate_component, completion_rate_component, account_age_component, trigger_event, calculated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [vendorId, finalScore, identityScore, txConsistencyScore, disputeScore, completionScore, ageScore, triggerEvent]
    );

    await client.query('COMMIT');

    logger.info('Trust score recalculated', { vendor_id: vendorId, score: finalScore, tier: scoreTier, trigger: triggerEvent });

    return {
      trust_score: finalScore,
      score_tier: scoreTier,
      components: {
        identity: Math.round(identityScore),
        transaction_consistency: Math.round(txConsistencyScore),
        dispute_rate: Math.round(disputeScore),
        completion_rate: Math.round(completionScore),
        account_age: Math.round(ageScore),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Trust score recalculation failed', { vendor_id: vendorId, error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recalculate, getTier };