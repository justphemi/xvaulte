'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { TRANSFER_BANKS } = require('../const/banks');

if (!env.squad?.secret_key) throw new Error('Missing Squad secret key');
if (!env.squad?.base_url) throw new Error('Missing Squad base URL');

const squadClient = axios.create({
  baseURL: env.squad.base_url,
  timeout: 20000,
  headers: {
    Authorization: `Bearer ${env.squad.secret_key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

logger.info('Squad client initialized', {
  base_url: env.squad.base_url,
  key_prefix: env.squad.secret_key.substring(0, 20) + '...',
});

squadClient.interceptors.request.use((config) => {
  logger.info('Squad API request', { method: config.method?.toUpperCase(), url: config.url, data: config.data });
  return config;
});

squadClient.interceptors.response.use(
  (response) => response,
  (err) => {
    const status = err.response?.status || 502;
    const squadError = err.response?.data?.message || err.response?.data?.error || err.message;
    logger.error('Squad API error', { status, url: err.config?.url, method: err.config?.method, request_data: err.config?.data, response: err.response?.data });
    throw new AppError(`Squad API error: ${squadError}`, status);
  }
);

/**
 * API 1 — VIRTUAL ACCOUNTS
 * POST /virtual-account (B2C model)
 * Docs: https://docs.squadco.com/Virtual-accounts/api-specifications
 * Creates a dedicated GTBank virtual account for receiving payments.
 * The beneficiary_account is the merchant GTBank account where funds settle.
 */
async function createVirtualAccount({ customer_identifier, first_name, last_name, mobile_num, email, transaction_ref }) {
  logger.info('Creating Squad virtual account', { customer_identifier: customer_identifier || transaction_ref, email });

  const response = await squadClient.post('/virtual-account', {
    customer_identifier: customer_identifier || transaction_ref,
    first_name: first_name || 'Vaulte',
    last_name: last_name || 'Buyer',
    middle_name: 'User',
    mobile_num: mobile_num || '08012345678',
    email: email || `${(customer_identifier || transaction_ref)}@vaulte.app`,
    bvn: '22343211654',          // Sandbox test BVN from Squad docs
    dob: '01/01/1990',
    address: 'Lagos, Nigeria',
    gender: '1',
    beneficiary_account: env.squad.beneficiary_account || '4920299492',
  });

  return response.data;
}

/**
 * API 2 — ACCOUNT LOOKUP
 * POST /payout/account/lookup
 * Docs: https://docs.squadco.com/Transfer-API/transfer-apis
 * Verify a beneficiary bank account before creating a vendor or transferring.
 */
async function verifyBankAccount({ account_number, bank_code }) {
  logger.info('Verifying payout bank account', { account_number, bank_code });

  const response = await squadClient.post('/payout/account/lookup', {
    bank_code,
    account_number,
  });

  return response.data;
}

/**
 * API 3 — INITIATE PAYMENT
 * POST /transaction/initiate
 * Docs: https://docs.squadco.com/Payments/Initiate-payment
 * Returns a checkout_url the buyer visits to complete payment.
 * amount must be in KOBO (multiply NGN by 100).
 */
async function createPaymentLink({ amount, email, reference, currency = 'NGN', callback_url, customer_name }) {
  logger.info('Initiating Squad payment transaction', { reference, amount });

  const response = await squadClient.post('/transaction/initiate', {
    amount: Math.round(amount * 100),  // NGN -> kobo
    email: email || 'buyer@vaulte.app',
    currency,
    initiate_type: 'inline',
    transaction_ref: reference,
    customer_name: customer_name || 'Vaulte Buyer',
    callback_url: callback_url || `${env.app.buyer_portal_url}/confirm`,
  });

  return response.data;
}

/**
 * API 4 — VERIFY TRANSACTION
 * GET /transaction/verify/:transaction_ref
 * Docs: https://docs.squadco.com/Payments/verify-transaction
 */
async function verifyTransaction(transaction_ref) {
  logger.info('Verifying Squad transaction', { transaction_ref });

  const response = await squadClient.get(`/transaction/verify/${transaction_ref}`);

  return response.data;
}

/**
 * API 5 — FUND TRANSFER (payout to vendor)
 * POST /payout/transfer
 * Docs: https://docs.squadco.com/Transfer-API/transfer-apis
 * amount: kobo as STRING — e.g. "500000" for NGN 5,000
 * transaction_reference: must be unique per transfer
 */
async function transferFunds({ amount, account_number, bank_code, account_name, narration, reference }) {
  logger.info('Initiating Squad payout transfer', { reference, amount, account_number, bank_code });

  const response = await squadClient.post('/payout/transfer', {
    remark: narration || 'Vaulte escrow release',
    bank_code,
    currency_id: 'NGN',
    amount: Math.round(amount * 100).toString(),  // Kobo as string per Squad docs
    account_number,
    transaction_reference: reference,
    account_name,
  });

  return response.data;
}

/**
 * API 6 — REQUERY TRANSFER
 * POST /payout/requery
 */
async function requeryTransfer(transaction_reference) {
  logger.info('Requerying Squad transfer', { transaction_reference });

  const response = await squadClient.post('/payout/requery', { transaction_reference });

  return response.data;
}

/**
 * API 7 — REFUND TRANSACTION
 * POST /transaction/refund
 * Docs: https://docs.squadco.com/Others/refund-api
 * refund_type: 'Full' or 'Partial' (capital first letter per Squad docs)
 * gateway_transaction_ref: from webhook Body.gateway_ref
 * transaction_ref: original transaction_ref
 */
async function refundTransaction({ gateway_transaction_ref, transaction_ref, refund_type = 'Full', reason_for_refund = 'Customer refund via Vaulte dispute', refund_amount }) {
  logger.info('Initiating Squad refund', { gateway_transaction_ref, transaction_ref, refund_type });

  const payload = {
    gateway_transaction_ref,
    transaction_ref,
    refund_type,
    reason_for_refund,
  };

  if (refund_type === 'Partial' && refund_amount) {
    payload.refund_amount = Math.round(refund_amount * 100).toString();
  }

  const response = await squadClient.post('/transaction/refund', payload);

  return response.data;
}

/**
 * API 8 — SIMULATE TEST PAYMENT (SANDBOX ONLY)
 * POST /virtual-account/simulate/payment
 * Docs: https://docs.squadco.com/Payments/Initiate-payment (simulate section)
 * Use this to simulate a buyer paying into a virtual account in sandbox.
 * Triggers a webhook charge_successful event to your registered URL.
 */
async function simulatePayment({ virtual_account_number, amount }) {
  if (!env.squad.base_url.includes('sandbox')) {
    throw new AppError('simulatePayment is only available in sandbox environment', 400);
  }

  logger.info('Simulating Squad payment into virtual account', { virtual_account_number, amount });

  const response = await squadClient.post('/virtual-account/simulate/payment', {
    virtual_account_number,
    amount: Math.round(amount).toString(),
  });

  return response.data;
}

/**
 * BANK LIST — static from Squad docs to avoid rate limits
 */
async function getBankList() {
  logger.info('Returning static bank list');
  return {
    status: 200,
    success: true,
    message: 'Success',
    data: TRANSFER_BANKS,
  }; 
}

/**
 * LEDGER BALANCE
 * GET /merchant/balance
 */
async function getBalance() {
  logger.info('Fetching Squad ledger balance');
  const response = await squadClient.get('/merchant/balance');
  return response.data;
}

// FIX THIS - in squadService.js

async function checkTransactionStatus(transactionRef) {
  logger.info('Verifying Squad transaction', { transaction_ref: transactionRef });

  try {
    // ✅ FIX: use squadClient.get, not the non-existent makeSquadRequest
    const response = await squadClient.get(`/transaction/verify/${transactionRef}`);

    logger.info('Squad verification response', {
      transaction_ref: transactionRef,
      status: response?.data?.data?.transaction_status,
    });

    return response.data;
  } catch (err) {
    logger.error('Squad verification failed', {
      transaction_ref: transactionRef,
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  createVirtualAccount,
  verifyBankAccount,
  createPaymentLink,
  verifyTransaction,
  transferFunds,
  requeryTransfer,
  refundTransaction,
  simulatePayment,
  getBankList,
  getBalance,
  checkTransactionStatus
};