import * as XLSX from 'xlsx';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

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
];

function guessPhoneColumn(headers = []) {
  const normalized = headers.map((h) => String(h || '').trim().toLowerCase());
  for (const hint of PHONE_HINTS) {
    const i = normalized.findIndex((h) => h === hint);
    if (i >= 0) return headers[i];
  }
  for (const hint of PHONE_HINTS) {
    const i = normalized.findIndex((h) => h.includes(hint));
    if (i >= 0) return headers[i];
  }
  return headers[0] || '';
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

export function isCsvFile(file) {
  return /\.csv$/i.test(file?.name || '');
}

export function isXlsxFile(file) {
  return /\.(xlsx|xls)$/i.test(file?.name || '');
}

export async function previewXlsxFile(file, maxRows = 8) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', sheetRows: maxRows + 1 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], sampleRows: [], suggestedPhoneColumn: '' };
  const sheet = workbook.Sheets[sheetName];
  // header:1 returns arrays; first array is headers row
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) return { headers: [], sampleRows: [], suggestedPhoneColumn: '' };
  const headers = rows[0].map((h) => String(h ?? '').trim()).filter(Boolean);
  const sampleRows = [];
  for (let i = 1; i < rows.length && sampleRows.length < maxRows; i += 1) {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = String(rows[i][idx] ?? '');
    });
    sampleRows.push(obj);
  }
  return {
    headers,
    sampleRows,
    suggestedPhoneColumn: guessPhoneColumn(headers),
  };
}

export async function previewCsvFile(file, maxRows = 8) {
  const text = await file.slice(0, 256 * 1024).text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) return { headers: [], sampleRows: [], suggestedPhoneColumn: '' };
  const headers = splitCsvLine(lines[0]).filter(Boolean);
  const sampleRows = [];
  for (let i = 1; i < lines.length && sampleRows.length < maxRows; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    sampleRows.push(row);
  }
  return {
    headers,
    sampleRows,
    suggestedPhoneColumn: guessPhoneColumn(headers),
  };
}
