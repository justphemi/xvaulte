'use strict';

const { Pool } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: env.db.url,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
  max: 10,
  min: 2,
  idleTimeoutMillis: 30000,       
  connectionTimeoutMillis: 10000, 
  keepAlive: true,                 
  keepAliveInitialDelayMillis: 10000, 
});
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Database query executed', { duration_ms: duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('Database query failed', { error: err.message, query: text });
    throw err;
  }
}

async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);

  client.query = async (...args) => {
    const start = Date.now();
    try {
      const result = await originalQuery(...args);
      const duration = Date.now() - start;
      logger.debug('Database client query executed', { duration_ms: duration });
      return result;
    } catch (err) {
      logger.error('Database client query failed', { error: err.message });
      throw err;
    }
  };

  return client;
}

async function testConnection() {
  try {
    await pool.query('SELECT 1');
    logger.info('Database connection established');
  } catch (err) {
    logger.error('Database connection failed', { error: err.message });
    throw err;
  }
}

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

setInterval(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    logger.warn('Pool health check failed', { error: err.message });
  }
}, 4 * 60 * 1000); 

async function executeWithRetry(dbOperation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await dbOperation();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      
      logger.warn(`Database operation failed, retrying (${attempt}/${maxRetries})`, { 
        error: err.message 
      });
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

module.exports = { query, getClient, testConnection, pool, executeWithRetry };