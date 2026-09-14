'use strict';

function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@]/.test(str) || str.startsWith('\t')) {
    return `'${str}`;
  }
  return str;
}

function sanitizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    out[key] = sanitizeCsvCell(value);
  }
  return out;
}

module.exports = { sanitizeCsvCell, sanitizeRow };
