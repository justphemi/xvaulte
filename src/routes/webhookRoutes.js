'use strict';

const express = require('express');
const router = express.Router();
const { webhookLimiter } = require('../middleware/rateLimiter');
const webhookController = require('../controllers/webhookController');

// POST /api/webhooks/squad
// Squad sends all payment events here.
// rawBody is captured in app.js via a custom middleware before JSON parsing.
router.post('/squad', webhookLimiter, webhookController.handleSquadWebhook);

module.exports = router;