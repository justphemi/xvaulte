'use strict';

require('dotenv').config();

const required = [
  'DATABASE_URL',
  'SQUAD_SECRET_KEY',
  'SQUAD_BASE_URL',
  'SQUAD_WEBHOOK_SECRET',
  'AI_SERVICE_URL',
  'JWT_SECRET',
  'APP_BASE_URL',
  'BUYER_PORTAL_URL',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  node_env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  db: {
    url: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true',
  },

  squad: {
    secret_key: process.env.SQUAD_SECRET_KEY,
    public_key: process.env.SQUAD_PUBLIC_KEY || '',
    base_url: process.env.SQUAD_BASE_URL,
    webhook_secret: process.env.SQUAD_WEBHOOK_SECRET,
    // Your GTBank account where VA funds settle (required for VA creation)
    beneficiary_account: process.env.SQUAD_BENEFICIARY_ACCOUNT || '',
    merchant_id: process.env.SQUAD_MERCHANT_ID || '',
    // DEV ONLY: Set to 'true' to skip Squad calls and use mock responses
    skip_bank_verification: process.env.SQUAD_SKIP_BANK_VERIFICATION === 'true',
  },

  // AI toggle — set AI_ENABLED=false to bypass AI calls and use mock responses
  // Safe to run without the Python service running (for testing the flow end-to-end)
  ai: {
    url: process.env.AI_SERVICE_URL || 'http://107.173.51.219:8000/api/v1',
    timeout_ms: parseInt(process.env.AI_SERVICE_TIMEOUT_MS || '5000', 10),
    enabled: process.env.AI_ENABLED !== 'false', // default ON; set AI_ENABLED=false to disable
  },

  cors: {
    // origins: process.env.CORS_ORIGIN === '*' ? '*' : (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
    origins: '*',
  },

  termii: {
    api_key: process.env.TERMII_API_KEY || '',
    from: process.env.TERMII_FROM || 'Vaulte',
    base_url: process.env.TERMII_BASE_URL || 'https://v3.api.termii.com',
  },

twilio: {
  account_sid: process.env.TWILIO_ACCOUNT_SID,
  auth_token: process.env.TWILIO_AUTH_TOKEN,
  phone_number: process.env.TWILIO_PHONE_NUMBER, 
  verify_service_sid: process.env.TWILIO_VERIFY_SERVICE_SID,
},

  jwt: {
    secret: process.env.JWT_SECRET,
    expires_in: process.env.JWT_EXPIRES_IN || '7d',
  },

  app: {
    base_url: process.env.APP_BASE_URL,
    buyer_portal_url: process.env.BUYER_PORTAL_URL,
  },

  escrow: {
    auto_confirm_hours: parseInt(process.env.ESCROW_AUTO_CONFIRM_HOURS || '72', 10),
    max_amount_basic: parseInt(process.env.ESCROW_MAX_AMOUNT_BASIC || '50000', 10),
    max_amount_trusted: parseInt(process.env.ESCROW_MAX_AMOUNT_TRUSTED || '500000', 10),
  },

  b2b: {
    free_call_limit: parseInt(process.env.B2B_API_FREE_CALL_LIMIT || '1000', 10),
  },

  rate_limit: {
    window_ms: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max_requests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
};