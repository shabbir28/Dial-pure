'use strict';

const BASE_URL = 'https://enrollppi.tldcrm.com';
const FPG = 'CLIENTS,ECLIENTS,BLOCK,EBLOCK';

const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  const national =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits;

  if (national.length !== 10) {
    throw new Error(`TLDCRM invalid phone: ${phone}`);
  }

  const url =
    `${BASE_URL}/api/public/dialer/ready/` +
    `${encodeURIComponent(national)}` +
    `?fpg=${encodeURIComponent(FPG)}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DialPure/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429) {
        throw new Error('TLDCRM rate limited request');
      }

      if (!response.ok) {
        throw new Error(`TLDCRM HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.ready !== 0 && data.ready !== 1) {
        throw new Error(
          `Unexpected TLDCRM response: ${JSON.stringify(data)}`
        );
      }

      return {
        ready: Number(data.ready),
        raw: data,
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 1000);
      }
    }
  }

  throw lastError || new Error('TLDCRM request failed');
}

module.exports = {
  checkPhone,
};
