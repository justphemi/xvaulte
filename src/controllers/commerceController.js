'use strict';

const db = require('../config/database');
const { success, error } = require('../utils/response');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/commerce/products
 * Create a new product for a logged in vendor
 */
async function createProduct(req, res, next) {
  try {
    const vendorId = req.vendor.id;
    const { name, description, price } = req.body;

    const productId = uuidv4();
    await db.query(
      'INSERT INTO products (id, vendor_id, name, description, price) VALUES ($1, $2, $3, $4, $5)',
      [productId, vendorId, name, description, price]
    );

    return success(res, { id: productId, name, description, price }, 'Product created successfully', 201);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/commerce/products
 * Get products for the logged in vendor
 */
async function getMyProducts(req, res, next) {
  try {
    const vendorId = req.vendor.id;
    const result = await db.query(
      'SELECT id, name, description, price, created_at FROM products WHERE vendor_id = $1 ORDER BY created_at DESC',
      [vendorId]
    );
    return success(res, result.rows);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/commerce/store/:vendor_id
 * Public storefront - Get products for a specific vendor + trust score
 */
async function getStorefront(req, res, next) {
  try {
    const { vendor_id } = req.params;

    const vendorResult = await db.query(
      'SELECT id, business_name, trust_score, score_tier, verification_status FROM vendors WHERE id = $1',
      [vendor_id]
    );

    if (vendorResult.rowCount === 0) {
      return error(res, 'Vendor not found', 404);
    }

    const productsResult = await db.query(
      'SELECT id, name, description, price, created_at FROM products WHERE vendor_id = $1 ORDER BY created_at DESC',
      [vendor_id]
    );

    return success(res, {
      vendor: vendorResult.rows[0],
      products: productsResult.rows
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createProduct,
  getMyProducts,
  getStorefront
};
