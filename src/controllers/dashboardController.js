'use strict';

const db = require('../config/database');
const { success } = require('../utils/response');

/**
 * GET /v1/developer/dashboard/metrics
 */
async function getMetrics(req, res, next) {
  try {
    const partnerId = req.developer.id; // From JWT middleware

    // Get partner info
    const partnerQuery = await db.query(
      'SELECT api_calls_made, api_calls_limit, callback_url FROM b2b_partners WHERE id = $1',
      [partnerId]
    );
    const partner = partnerQuery.rows[0];

    // Get verification sessions counts
    const statsQuery = await db.query(
      `SELECT status, COUNT(*) as count 
       FROM verification_sessions 
       WHERE partner_id = $1 
       GROUP BY status`,
      [partnerId]
    );

    const verificationStats = {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      processing: 0,
      expired: 0
    };

    statsQuery.rows.forEach(row => {
      verificationStats[row.status] = parseInt(row.count, 10);
      verificationStats.total += parseInt(row.count, 10);
    });

    // In the future, we could add escrow volumes here by joining or querying transaction tables 
    // associated with this partner.

    return success(res, {
      api_usage: {
        made: partner.api_calls_made,
        limit: partner.api_calls_limit,
      },
      webhook: {
        callback_url: partner.callback_url || null
      },
      verifications: verificationStats
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /v1/developer/dashboard/webhook
 * Update the webhook callback URL
 */
async function updateWebhook(req, res, next) {
  try {
    const partnerId = req.developer.id;
    const { callback_url } = req.body;

    await db.query(
      'UPDATE b2b_partners SET callback_url = $1 WHERE id = $2',
      [callback_url, partnerId]
    );

    return success(res, null, 'Webhook URL updated successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMetrics,
  updateWebhook
};
