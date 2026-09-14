'use strict';

const crypto = require('crypto');
const config = require('../config');

const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Normalize US/NANP numbers from real lead files.
 * Sample master list uses 10-digit values like 2165988930 with no punctuation.
 * Also accepts (212) 555-1000, 212-555-1000, +1 212 555 1000, 12125551000.
 */
function normalizePhone(raw, country = 'US') {
  if (raw === null || raw === undefined) {
    return { valid: false, reason: 'missing' };
  }

  const original = String(raw).trim();
  if (!original) {
    return { valid: false, reason: 'missing' };
  }

  let digits = digitsOnly(original);
  if (!digits) {
    return { valid: false, reason: 'missing' };
  }

  if (/[a-zA-Z]/.test(original) && digits.length < 10) {
    return { valid: false, reason: 'alphabetic_garbage' };
  }

  if (country === 'US' || country === 'CA') {
    if (digits.length === 11 && digits.startsWith('1')) {
      digits = digits.slice(1);
    }
    if (digits.length !== 10) {
      return { valid: false, reason: 'invalid_length' };
    }
    if (!NANP.test(digits)) {
      return { valid: false, reason: 'invalid_nanp' };
    }
    const normalized = `1${digits}`;
    return {
      valid: true,
      original,
      normalized,
      national: digits,
      last4: digits.slice(-4),
      countryCode: 'US',
    };
  }

  return { valid: false, reason: 'unsupported_country' };
}

const phoneSecretKey = Buffer.from(config.phoneHmacSecret || 'dev-phone-hmac');

function hashPhone(normalized) {
  return crypto
    .createHmac('sha256', phoneSecretKey)
    .update(String(normalized))
    .digest('hex');
}

function processPhone(raw, country = 'US') {
  const result = normalizePhone(raw, country);
  if (!result.valid) return result;
  return {
    ...result,
    phoneHash: hashPhone(result.normalized),
  };
}

module.exports = {
  digitsOnly,
  normalizePhone,
  hashPhone,
  processPhone,
};
