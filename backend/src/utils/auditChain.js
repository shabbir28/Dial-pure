'use strict';

const { hmacSha256 } = require('./crypto');

function chainHash({ previousEventHash, payload }) {
  const body = JSON.stringify(payload);
  const eventHash = hmacSha256(`${previousEventHash || ''}|${body}`);
  return eventHash;
}

module.exports = { chainHash };
