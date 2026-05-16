'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { success, notFound, error } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /test/webhook/simulate-payment
 * Development helper: simulates Squad webhook for funded payment
 */
router.post('/webhook/simulate-payment', async (req, res, next) => {
  try {
    const { transaction_id } = req.body;
    
    if (!transaction_id) {
      return error(res, 'transaction_id is required', 400);
    }
    
    // Fetch transaction
    const txResult = await db.query('SELECT * FROM transactions WHERE id = $1', [transaction_id]);
    const transaction = txResult.rows[0];
    
    if (!transaction) {
      return notFound(res, 'Transaction');
    }
    
    if (transaction.escrow_status !== 'pending') {
      return success(res, { 
        message: 'Transaction already processed',
        status: transaction.escrow_status 
      });
    }
    
    // Update transaction to funded - directly with SQL to avoid column issues
    await db.query(
      `UPDATE transactions 
       SET escrow_status = 'funded', 
           squad_transaction_ref = $2,
           squad_gateway_ref = $3,
           funded_at = NOW()
       WHERE id = $1`,
      [transaction.id, `TEST_${transaction.id}`, `GATEWAY_${transaction.id}`]
    );
    
    // Fetch vendor for SMS
    const vendorResult = await db.query('SELECT * FROM vendors WHERE id = $1', [transaction.vendor_id]);
    const vendor = vendorResult.rows[0];
    
    // Send SMS to buyer
    if (transaction.buyer_phone && vendor) {
      try {
        const smsService = require('../services/smsService');
        await smsService.sendDeliveryConfirmationLink(
          transaction.buyer_phone,
          transaction.confirmation_link_token,
          transaction.amount,
          vendor.business_name
        );
      } catch (smsErr) {
        logger.warn('Failed to send confirmation SMS', { 
          transaction_id: transaction.id, 
          error: smsErr.message 
        });
      }
    }
    
    logger.info('Test webhook simulated - transaction funded', { 
      transaction_id: transaction.id 
    });
    
    return success(res, {
      transaction_id: transaction.id,
      escrow_status: 'funded',
      message: 'Payment simulated successfully'
    });
    
  } catch (err) {
    next(err);
  }
});

module.exports = router;