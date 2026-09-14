'use strict';

const { v4: uuidv4 } = require('uuid');

function uuid() {
  return uuidv4();
}

function nextSequentialCode(existingCodes, prefix = 'CAMP') {
  let max = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  for (const code of existingCodes || []) {
    const match = String(code || '').match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${max + 1}`;
}

function roleCodePrefix(role) {
  return role === 'admin' ? 'ADM' : 'AGT';
}

function jobNumber() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rand = uuidv4().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `SCRUB-${ymd}-${rand}`;
}

module.exports = {
  uuid,
  nextSequentialCode,
  roleCodePrefix,
  jobNumber,
};
