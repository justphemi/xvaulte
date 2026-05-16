'use strict';

const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { testConnection } = require('./config/database');
const transactionRepo = require('./repositories/transactionRepository');
const vendorRepo = require('./repositories/vendorRepository');
const squadService = require('./services/squadService');
const trustScoreService = require('./services/trustScoreService');

const server = http.createServer(app);

// Track cron health
let lastCronRun = null;
let lastCronStatus = 'pending';

// Socket.io for real-time Trust Score updates to vendor dashboard
const io = new Server(server, {
  cors: {
    origin: env.cors.origins,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  logger.info('Vendor dashboard connected via WebSocket', { socket_id: socket.id });

  socket.on('join_vendor_room', (vendorId) => {
    socket.join(`vendor:${vendorId}`);
    logger.debug('Vendor joined room', { vendor_id: vendorId, socket_id: socket.id });
  });

  socket.on('disconnect', () => {
    logger.debug('WebSocket disconnected', { socket_id: socket.id });
  });
});

app.emitTrustScoreUpdate = (vendorId, scoreData) => {
  io.to(`vendor:${vendorId}`).emit('trust_score_updated', {
    vendor_id: vendorId,
    ...scoreData,
    timestamp: new Date().toISOString(),
  });
};

// Add cron health endpoint
app.get('/health/cron', (req, res) => {
  res.json({
    last_run: lastCronRun,
    last_status: lastCronStatus,
  });
});

/**
 * Cron job: Auto-confirm expired escrows every 15 minutes
 * Releases funds to vendor if buyer did not respond within 72 hours
 */
cron.schedule('*/15 * * * *', async () => {
  const startTime = Date.now();
  logger.info('Auto-confirm cron tick started');

  try {
    const expired = await transactionRepo.getExpiredEscrows(env.escrow.auto_confirm_hours);
    
    if (expired.length === 0) {
      lastCronRun = new Date().toISOString();
      lastCronStatus = 'success';
      logger.debug('No expired escrows to auto-confirm');
      return;
    }

    logger.info('Auto-confirming expired escrows', { count: expired.length });

    let succeeded = 0;
    let failed = 0;

    for (const tx of expired) {
      try {
        const vendor = await vendorRepo.findById(tx.vendor_id);
        if (!vendor) {
          logger.warn('Vendor not found for expired escrow', { 
            transaction_id: tx.id, 
            vendor_id: tx.vendor_id 
          });
          failed++;
          continue;
        }

        if (!vendor.squad_payout_account || !vendor.squad_payout_bank_code) {
          logger.warn('Vendor has no payout account configured', { 
            vendor_id: vendor.id 
          });
          failed++;
          continue;
        }

        // Check if already released (idempotency guard)
        if (tx.escrow_status === 'released') {
          logger.debug('Transaction already released, skipping', { 
            transaction_id: tx.id 
          });
          continue;
        }

        await squadService.transferFunds({
          amount: tx.amount,
          account_number: vendor.squad_payout_account,
          bank_code: vendor.squad_payout_bank_code,
          account_name: vendor.business_name,
          narration: `Vaulte auto-release after ${env.escrow.auto_confirm_hours}h — ${tx.item_description}`,
          reference: `aut${tx.id.replace(/-/g, '').slice(0, 9)}`,
        });

        await transactionRepo.setDeliveryConfirmed(tx.id);
        await transactionRepo.setReleased(tx.id);
        await trustScoreService.recalculate(tx.vendor_id, 'auto_confirm');

        succeeded++;
        logger.info('Escrow auto-confirmed and released', {
          transaction_id: tx.id,
          vendor_id: tx.vendor_id,
          amount: tx.amount,
        });
      } catch (err) {
        failed++;
        // If Squad returns "duplicate reference", mark as released anyway
        if (err.message?.includes('duplicate') || err.message?.includes('already exists')) {
          logger.warn('Duplicate transfer detected, marking as released', {
            transaction_id: tx.id,
          });
          try {
            await transactionRepo.setReleased(tx.id);
          } catch (updateErr) {
            logger.error('Failed to update duplicate transaction status', {
              transaction_id: tx.id,
              error: updateErr.message,
            });
          }
        } else {
          logger.error('Auto-confirm failed for transaction', {
            transaction_id: tx.id,
            error: err.message,
          });
        }
      }
    }

    lastCronRun = new Date().toISOString();
    lastCronStatus = 'success';

    logger.info('Auto-confirm cron tick completed', {
      duration_ms: Date.now() - startTime,
      succeeded,
      failed,
      total: expired.length,
    });
  } catch (err) {
    lastCronRun = new Date().toISOString();
    lastCronStatus = 'failed';

    logger.error('Auto-confirm cron job failed', {
      error: err.message,
      duration_ms: Date.now() - startTime,
    });
  }
});

async function start() {
  try {
    await testConnection();

    server.listen(env.port, () => {
      logger.info('Vaulte backend started', {
        port: env.port,
        environment: env.node_env,
        squad_env: env.squad.base_url.includes('sandbox') ? 'sandbox' : 'production',
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

// Graceful shutdown helper
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully.`);
  server.close(() => {
    logger.info('HTTP server closed.');
    io.close(() => {
      logger.info('Socket.io server closed.');
      process.exit(0);
    });
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();