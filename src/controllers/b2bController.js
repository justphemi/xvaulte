'use strict';

const { success, notFound, error } = require('../utils/response');
const { v4: uuidv4 } = require('uuid');
const vendorRepo = require('../repositories/vendorRepository');
const escrowController = require('./escrowController');
const logger = require('../utils/logger');

/**
 * GET /v1/vendor/:id/score
 * B2B endpoint: return vendor trust score and badge
 */
async function getVendorScore(req, res, next) {
  try {
    const vendor = await vendorRepo.findById(req.params.id);
    if (!vendor) return notFound(res, 'Vendor');

    return success(res, {
      vendor_id: vendor.id,
      business_name: vendor.business_name,
      category: vendor.category,
      location_state: vendor.location_state,
      trust_score: vendor.trust_score,
      score_tier: vendor.score_tier,
      verification_status: vendor.verification_status,
      badge_label: vendor.score_tier,
      last_updated: vendor.updated_at,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /v1/vendor/:id/badge
 * B2B endpoint: return embeddable badge HTML for storefronts
 */
async function getVendorBadge(req, res, next) {
  try {
    const vendor = await vendorRepo.findById(req.params.id);
    if (!vendor) return notFound(res, 'Vendor');

    const colorMap = {
      'Elite Vendor': '#FFD700',
      'Premium Verified': '#7B2D8B',
      'Trusted Seller': '#1A6B3A',
      'Basic Verified': '#1565C0',
      'Unverified': '#9E9E9E',
    };

    const badgeColor = colorMap[vendor.score_tier] || '#9E9E9E';
    const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40">
  <rect width="160" height="40" rx="6" fill="${badgeColor}"/>
  <text x="50%" y="14" font-family="Arial,sans-serif" font-size="9" fill="white" text-anchor="middle" font-weight="bold">VAULTE VERIFIED</text>
  <text x="50%" y="28" font-family="Arial,sans-serif" font-size="10" fill="white" text-anchor="middle">${vendor.score_tier}</text>
  <text x="50%" y="38" font-family="Arial,sans-serif" font-size="8" fill="rgba(255,255,255,0.85)" text-anchor="middle">Score: ${vendor.trust_score}/100</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(badgeSvg);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /v1/escrow/create
 * B2B endpoint: platform partner creates escrow on behalf of their transaction
 */
async function b2bCreateEscrow(req, res, next) {
  // Delegate to escrow controller — same business logic, different auth context
  req.partner_request = true;
  return escrowController.createEscrow(req, res, next);
}

/**
 * POST /v1/escrow/:id/release
 * B2B endpoint: trigger delivery confirmation from logistics partner webhook
 */
async function b2bReleaseEscrow(req, res, next) {
  try {
    const { id } = req.params;
    const { confirmation_token } = req.body;
    if (!confirmation_token) {
      return error(res, 'confirmation_token is required', 422);
    }
    req.params.token = confirmation_token;
    return escrowController.confirmDelivery(req, res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /v1/escrow/:id/dispute
 * B2B endpoint: submit a dispute from a platform partner on buyer's behalf
 */
async function b2bSubmitDispute(req, res, next) {
  return escrowController.submitDispute(req, res, next);
}

/**
 * GET /v1/vendors
 * B2B directory: filterable list of verified vendors
 */
async function listVendors(req, res, next) {
  try {
    const { badge, category, location_state, page = 1, limit = 20 } = req.query;
    const vendors = await vendorRepo.listVerified({
      badge,
      category,
      location_state,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });
    return success(res, { vendors, page: parseInt(page), count: vendors.length });
  } catch (err) {
    next(err);
  }
}

module.exports = { getVendorScore, getVendorBadge, b2bCreateEscrow, b2bReleaseEscrow, b2bSubmitDispute, listVendors };