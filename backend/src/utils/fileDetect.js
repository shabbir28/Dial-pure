'use strict';

const PHONE_HINTS = [
  'phone no',
  'phone_no',
  'phoneno',
  'phone number',
  'phone_number',
  'phonenumber',
  'phone',
  'mobile',
  'cell',
  'cellphone',
  'cell phone',
  'land line',
  'landline',
  'tn',
  'ani',
];

function guessPhoneColumn(headers = []) {
  const normalized = headers.map((h) => ({
    original: h,
    key: String(h || '').trim().toLowerCase(),
  }));
  for (const hint of PHONE_HINTS) {
    const match = normalized.find((h) => h.key === hint);
    if (match) return match.original;
  }
  for (const hint of PHONE_HINTS) {
    const match = normalized.find((h) => h.key.includes(hint));
    if (match) return match.original;
  }
  return headers[0] || null;
}

function detectExtension(filename = '') {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.csv')) return 'csv';
  return '';
}

function allowedMime(ext, mime) {
  const map = {
    csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
    xlsx: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      'application/zip',
    ],
    xls: ['application/vnd.ms-excel', 'application/octet-stream'],
  };
  if (!map[ext]) return false;
  if (!mime) return true;
  return map[ext].includes(mime) || mime === 'application/octet-stream';
}

module.exports = {
  guessPhoneColumn,
  detectExtension,
  allowedMime,
};
