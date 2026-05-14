'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticateVendor } = require('../middleware/auth');
const commerceController = require('../controllers/commerceController');

// POST /api/commerce/products
router.post(
  '/products',
  authenticateVendor,
  [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('description').trim().optional(),
    body('price').isFloat({ min: 0 }).withMessage('Valid price is required'),
  ],
  validate,
  commerceController.createProduct
);

// GET /api/commerce/products
router.get(
  '/products',
  authenticateVendor,
  commerceController.getMyProducts
);

// GET /api/commerce/store/:vendor_id
router.get(
  '/store/:vendor_id',
  commerceController.getStorefront
);

module.exports = router;
