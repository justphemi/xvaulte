'use strict';

const { v4: uuidv4 } = require('uuid');
const { success, created, error, notFound } = require('../utils/response');
const transactionRepo = require('../repositories/transactionRepository');
const disputeRepo = require('../repositories/disputeRepository');
const vendorRepo = require('../repositories/vendorRepository');
const squadService = require('../services/squadService');
const aiService = require('../services/aiService');
const trustScoreService = require('../services/trustScoreService');
const smsService = require('../services/smsService');
const { generateToken } = require('../utils/crypto');
const env = require('../config/env');
const logger = require('../utils/logger');

async function createEscrow(req, res, next) {
  try {
    const { vendor_id: targetVendorId, amount, item_description, buyer_phone, buyer_email } = req.body;

    const actualVendorId = req.vendor ? req.vendor.id : targetVendorId;
    const vendor = await vendorRepo.findById(actualVendorId);

    if (!vendor) return notFound(res, 'Vendor');
    if (vendor.verification_status !== 'passed') {
      return error(res, 'Vendor must complete AI verification before accepting payments.', 403);
    }
    if (vendor.trust_score < 40 && amount > env.escrow.max_amount_basic) {
      return error(res, `Transaction limit exceeded. Basic Verified vendors are limited to NGN ${env.escrow.max_amount_basic.toLocaleString()} per transaction.`, 422);
    }
    if (vendor.trust_score < 60 && amount > env.escrow.max_amount_trusted) {
      return error(res, `Transaction limit exceeded. Trusted Seller tier required for amounts above NGN ${env.escrow.max_amount_trusted.toLocaleString()}.`, 422);
    }

    const transactionId = uuidv4();
    const confirmationToken = generateToken(32);
    const expiresAt = new Date(Date.now() + env.escrow.auto_confirm_hours * 60 * 60 * 1000);

    let vaAccountNumber = '';
    let checkoutUrl = '';

    if (env.squad.skip_bank_verification) {
      // DEV MODE — mock Squad calls
      logger.warn('DEV MODE: Mocking Squad VA and Payment Link creation', { transaction_id: transactionId });
      vaAccountNumber = `DEV${Date.now().toString().slice(-8)}`;
      checkoutUrl = `${env.app.buyer_portal_url}/checkout/${transactionId}`;
    } else {
      // PRODUCTION — real Squad API calls
      let vaData;
      try {
        vaData = await squadService.createVirtualAccount({
          customer_identifier: transactionId,
          email: buyer_email,
          mobile_num: buyer_phone,
          transaction_ref: transactionId,
        });
        // Squad VA response: data.virtual_account_number
        vaAccountNumber = vaData?.data?.virtual_account_number || vaData?.virtual_account_number || '';
      } catch (err) {
        logger.error('Squad VA creation failed', { transaction_id: transactionId, error: err.message });
        return error(res, 'Failed to create escrow account. Please try again.', 502);
      }

      let paymentData;
      try {
        paymentData = await squadService.createPaymentLink({
          amount,
          email: buyer_email,
          reference: transactionId,
          customer_name: 'Vaulte Buyer',
        });
        // Squad initiate response: data.checkout_url
        checkoutUrl = paymentData?.data?.checkout_url || paymentData?.checkout_url || '';
      } catch (err) {
        logger.error('Squad payment initiation failed', { transaction_id: transactionId, error: err.message });
        return error(res, 'Failed to create payment link. Please try again.', 502);
      }
    }

    const transaction = await transactionRepo.create({
      id: transactionId,
      vendor_id: actualVendorId,
      squad_va_account: vaAccountNumber,
      squad_payment_link_ref: checkoutUrl,
      amount,
      item_description,
      buyer_phone,
      buyer_email: buyer_email || null,
      confirmation_link_token: confirmationToken,
      confirmation_link_expires_at: expiresAt,
    });

    if (buyer_phone) {
      try {
        await smsService.sendEscrowCreatedNotification(buyer_phone, vendor.business_name, amount);
      } catch (smsErr) {
        logger.warn('Failed to send escrow SMS', { transaction_id: transactionId, error: smsErr.message });
      }
    }

    logger.info('Escrow created', { transaction_id: transactionId, vendor_id: actualVendorId, amount, dev_mode: !!env.squad.skip_bank_verification });

    return created(res, {
      transaction_id: transactionId,
      escrow_status: 'pending',
      amount,
      item_description,
      squad_va_account: vaAccountNumber,
      checkout_url: checkoutUrl,
      confirmation_token: confirmationToken,
      confirmation_expires_at: expiresAt,
      // Sandbox helper: link to simulate payment
      sandbox_simulate_url: env.squad.base_url.includes('sandbox')
        ? `POST ${env.squad.base_url}/virtual-account/simulate/payment { virtual_account_number: "${vaAccountNumber}", amount: "${Math.round(amount)}" }`
        : undefined,
    }, 'Escrow created. Share the checkout URL with your buyer.');

  } catch (err) {
    next(err);
  }
}

async function confirmDelivery(req, res, next) {
  try {
    const { token } = req.params;
    const transaction = await transactionRepo.findByToken(token);

    if (!transaction) return notFound(res, 'Transaction');
    if (transaction.escrow_status !== 'funded') {
      return error(res, `Cannot confirm delivery. Escrow status is: ${transaction.escrow_status}`, 422);
    }
    if (new Date(transaction.confirmation_link_expires_at) < new Date()) {
      return error(res, 'Confirmation link has expired. Funds will be auto-released.', 410);
    }

    const vendor = await vendorRepo.findById(transaction.vendor_id);
    if (!vendor) return notFound(res, 'Vendor');

    if (env.squad.skip_bank_verification) {
      logger.warn('DEV MODE: Mocking fund release', { transaction_id: transaction.id });
      await transactionRepo.setDeliveryConfirmed(transaction.id);
      await transactionRepo.setReleased(transaction.id);
    } else {
      try {
        // ✅ FIX 1: Transfer FIRST — don't mutate status until it succeeds
        // ✅ FIX 2: Strip hyphens — Squad rejects them in transaction_reference
        await squadService.transferFunds({
          amount: transaction.amount,
          account_number: vendor.squad_payout_account,
          bank_code: vendor.squad_payout_bank_code,
          account_name: vendor.business_name,
          narration: `Vaulte escrow release - ${transaction.item_description}`,
          reference: `REL${Date.now()}${Math.floor(Math.random() * 1000)}`
        });
        // Only update status after Squad confirms success
        await transactionRepo.setDeliveryConfirmed(transaction.id);
        await transactionRepo.setReleased(transaction.id);
      } catch (err) {
        logger.error('Fund release failed', { transaction_id: transaction.id, error: err.message });
        // Status remains 'funded' — buyer can retry
        return error(res, 'Fund release failed. Please try again.', 502);
      }
    }

    await trustScoreService.recalculate(vendor.id, 'delivery_confirmed');

    if (vendor.phone) {
      try {
        await smsService.sendFundsReleasedNotification(vendor.phone, transaction.amount);
      } catch (smsErr) {
        logger.warn('Failed to send release SMS', { transaction_id: transaction.id, error: smsErr.message });
      }
    }

    logger.info('Delivery confirmed and funds released', { transaction_id: transaction.id });

    return success(res, {
      transaction_id: transaction.id,
      escrow_status: 'released',
      amount: transaction.amount,
    }, 'Delivery confirmed. Funds released to vendor.');

  } catch (err) {
    next(err);
  }
}

async function submitDispute(req, res, next) {
  try {
    const { id } = req.params;
    const { dispute_text } = req.body;

    const transaction = await transactionRepo.findById(id);
    if (!transaction) return notFound(res, 'Transaction');
    if (!['funded', 'delivered'].includes(transaction.escrow_status)) {
      return error(res, `Cannot raise a dispute on a transaction with status: ${transaction.escrow_status}`, 422);
    }

    const classifyResult = await aiService.classifyDispute(dispute_text);
    let nlpCategory = 'non-delivery';
    let nlpConfidence = 0;
    let resolutionRecommendation = 'manual-review';

    if (classifyResult.success && classifyResult.data) {
      nlpCategory = classifyResult.data.category;
      nlpConfidence = classifyResult.data.confidence;
      resolutionRecommendation = classifyResult.data.resolution_recommendation;
    }

    await transactionRepo.setDisputed(transaction.id);

    const dispute = await disputeRepo.create({
      id: uuidv4(),
      transaction_id: transaction.id,
      vendor_id: transaction.vendor_id,
      buyer_claim_text: dispute_text,
      nlp_category: nlpCategory,
      nlp_confidence: nlpConfidence,
      resolution_recommendation: resolutionRecommendation,
    });

    // Auto-resolve on high confidence full-refund cases
    if (nlpConfidence >= 0.85 && resolutionRecommendation === 'full-refund') {
      if (!env.squad.skip_bank_verification) {
        try {
          // Need both gateway_ref and transaction_ref for Squad refund
          await squadService.refundTransaction({
            gateway_transaction_ref: transaction.squad_gateway_ref || transaction.squad_transaction_ref,
            transaction_ref: transaction.squad_transaction_ref,
            refund_type: 'Full',
            reason_for_refund: `Dispute auto-resolved: ${nlpCategory}`,
          });
        } catch (err) {
          logger.error('Auto-refund Squad call failed', { dispute_id: dispute.id, error: err.message });
        }
      } else {
        logger.warn('DEV MODE: Skipping Squad refund call');
      }

      await transactionRepo.setRefunded(transaction.id);
      await disputeRepo.resolve(dispute.id, { resolution_applied: 'full-refund', status: 'resolved' });
      await trustScoreService.recalculate(transaction.vendor_id, 'dispute_resolved_refund');

      return success(res, {
        dispute_id: dispute.id,
        category: nlpCategory,
        confidence: nlpConfidence,
        resolution: 'full-refund',
        status: 'auto-resolved',
      }, 'Dispute resolved. Full refund processed.');
    }

    if (nlpCategory === 'buyer-fraud-attempt') {
      await disputeRepo.resolve(dispute.id, { resolution_applied: 'rejected', status: 'resolved' });
      await transactionRepo.setReleased(transaction.id);

      return success(res, {
        dispute_id: dispute.id,
        category: 'buyer-fraud-attempt',
        resolution: 'rejected',
        status: 'resolved',
      }, 'Dispute rejected. Inconsistent with transaction records.');
    }

    return success(res, {
      dispute_id: dispute.id,
      category: nlpCategory,
      confidence: nlpConfidence,
      resolution_recommendation: resolutionRecommendation,
      status: 'open',
      expected_resolution_hours: 24,
    }, 'Dispute received. Our team will review within 24 hours.');

  } catch (err) {
    next(err);
  }
}

async function getTransactionByToken(req, res, next) {
  try {
    const { token } = req.params;
    const transaction = await transactionRepo.findByToken(token);
    if (!transaction) return notFound(res, 'Transaction');

    const vendor = await vendorRepo.findById(transaction.vendor_id);

    return success(res, {
      transaction_id: transaction.id,
      escrow_status: transaction.escrow_status,
      amount: transaction.amount,
      item_description: transaction.item_description,
      confirmation_expires_at: transaction.confirmation_link_expires_at,
      vendor: vendor ? {
        business_name: vendor.business_name,
        trust_score: vendor.trust_score,
        score_tier: vendor.score_tier,
        category: vendor.category,
      } : null,
    });
  } catch (err) {
    next(err);
  }
}

async function getTransactionById(req, res, next) {
  try {
    const { id } = req.params;
    const transaction = await transactionRepo.findById(id);
    if (!transaction) return notFound(res, 'Transaction');

    const vendor = await vendorRepo.findById(transaction.vendor_id);

    return success(res, {
      transaction_id: transaction.id,
      escrow_status: transaction.escrow_status,
      amount: transaction.amount,
      item_description: transaction.item_description,
      confirmation_token: transaction.confirmation_link_token,
      confirmation_expires_at: transaction.confirmation_link_expires_at,
      vendor: vendor ? {
        business_name: vendor.business_name,
        trust_score: vendor.trust_score,
        score_tier: vendor.score_tier,
        category: vendor.category,
      } : null,
    });
  } catch (err) {
    next(err);
  }
}
// Add to escrowController.js
async function checkPaymentStatus(req, res, next) {
  try {
    const { transaction_id } = req.params;
    const transaction = await transactionRepo.findById(transaction_id);
    
    if (!transaction) return notFound(res, 'Transaction');
    
    // If already funded, just return current status
    if (transaction.escrow_status !== 'pending') {
      return success(res, { escrow_status: transaction.escrow_status });
    }
    
    // Query Squad to check if payment was actually made
    try {
      const squadResponse = await squadService.checkTransactionStatus(transaction.squad_transaction_ref);
      
      if (squadResponse?.data?.status === 'success') {
        // Payment was successful - update our DB
        
// ✅ CORRECT - single call with all three params
await transactionRepo.setFunded(
  transaction.id,
  squadResponse.data.transaction_ref,
  squadResponse.data.gateway_ref
);
        
        // Send confirmation SMS to buyer
        const vendor = await vendorRepo.findById(transaction.vendor_id);
        await smsService.sendDeliveryConfirmationLink(
          transaction.buyer_phone,
          transaction.confirmation_link_token,
          transaction.amount,
          vendor.business_name
        );
        
        return success(res, { escrow_status: 'funded', updated: true });
      }
    } catch (err) {
      logger.warn('Failed to check Squad status', { transaction_id, error: err.message });
    }
    
    return success(res, { escrow_status: transaction.escrow_status });
  } catch (err) {
    next(err);
  }
}



module.exports = { createEscrow, confirmDelivery, submitDispute, getTransactionByToken, getTransactionById, checkPaymentStatus };