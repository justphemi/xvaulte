'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { defaultLimiter } = require('./middleware/rateLimiter');

const vendorRoutes = require('./routes/vendorRoutes');
const escrowRoutes = require('./routes/escrowRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const b2bRoutes = require('./routes/b2bRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const testRoutes = require('./routes/testRoutes');

const app = express();

// Security headers
app.use(helmet());

// ✅ Enable trust proxy for rate limiting
app.set('trust proxy', 1);

// CORS
const corsOptions = {
  origin: env.cors.origins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['*'],
};
if (env.cors.origins !== '*') {
  corsOptions.credentials = true;
}
app.use(cors(corsOptions));

// ✅ FIXED: Capture rawBody BEFORE JSON parsing for webhook signature verification
app.use((req, res, next) => {
  if (req.path.includes('/webhooks/')) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { 
      data += chunk; 
    });
    req.on('end', () => {
      req.rawBody = data;
      try {
        req.body = JSON.parse(data);
      } catch (err) {
        logger.warn('Failed to parse webhook body as JSON', { error: err.message });
        req.body = {};
      }
      next(); // ✅ Only call next() after data is fully captured
    });
    req.on('error', (err) => {
      logger.error('Error reading webhook request body', { error: err.message });
      next(err);
    });
  } else {
    // ✅ For non-webhook routes, proceed immediately
    next();
  }
});

// JSON body parsing (for non-webhook routes only)
app.use((req, res, next) => {
  if (req.path.includes('/webhooks/')) return next(); // Skip - already parsed above
  express.json({ limit: '10mb' })(req, res, next);
});

// HTTP request logging
app.use(
  morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
    skip: (req) => req.path === '/health',
  })
);

// Global rate limiter
app.use(defaultLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'vaulte-backend', 
    environment: process.env.NODE_ENV, 
    ai_enabled: process.env.AI_ENABLED, 
    squad_mode: process.env.SQUAD_SKIP_BANK_VERIFICATION, 
    timestamp: new Date().toISOString() 
  });
});

// API routes
app.use('/api/vendors', vendorRoutes);
app.use('/api/commerce', require('./routes/commerceRoutes'));
app.use('/api/escrow', escrowRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/test', testRoutes);

// B2B API — versioned under /v1
app.use('/v1/developer', require('./routes/developerAuthRoutes'));
app.use('/v1/verify', verificationRoutes);
app.use('/v1', b2bRoutes);

// 404 handler
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

module.exports = app;