'use strict';

const fs = require('fs');
const { parse } = require('csv-parse');
const ExcelJS = require('exceljs');
const { guessPhoneColumn } = require('../utils/fileDetect');

function rowToObject(headers, values) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = values[i] ?? '';
  });
  return obj;
}

async function previewCsv(filePath, maxRows = 8) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers = [];
    let finished = false;

    const stream = fs.createReadStream(filePath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
      trim: true,
    });

    const done = () => {
      if (finished) return;
      finished = true;
      try { stream.destroy(); } catch {}
      try { parser.destroy(); } catch {}
      resolve({
        headers,
        sampleRows: rows,
        suggestedPhoneColumn: guessPhoneColumn(headers),
      });
    };

    parser.on('headers', (h) => {
      headers = h;
    });

    parser.on('data', (row) => {
      if (!headers.length) headers = Object.keys(row);
      if (rows.length < maxRows) rows.push(row);
      if (rows.length >= maxRows) {
        done();
      }
    });

    parser.on('error', (err) => {
      if (!finished) reject(err);
    });

    stream.on('error', (err) => {
      if (!finished) reject(err);
    });

    parser.on('close', done);
    parser.on('end', done);

    stream.pipe(parser);
  });
}

async function previewXlsx(filePath, maxRows = 8) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], sampleRows: [], suggestedPhoneColumn: null };
  const headers = [];
  const sampleRows = [];
  sheet.eachRow((row, rowNumber) => {
    const values = row.values.slice(1).map((v) => (v == null ? '' : String(v)));
    if (rowNumber === 1) {
      headers.push(...values);
      return;
    }
    if (sampleRows.length < maxRows) {
      sampleRows.push(rowToObject(headers, values));
    }
  });
  return {
    headers,
    sampleRows,
    suggestedPhoneColumn: guessPhoneColumn(headers),
  };
}

async function previewFile(filePath, extension) {
  if (extension === 'xlsx' || extension === 'xls') return previewXlsx(filePath);
  return previewCsv(filePath);
}

async function streamCsvRows(filePath, onRow, onMeta) {
  // Ultra-fast first pass on raw buffer chunks so the UI knows the real CSV total instantly.
  let newlines = 0;
  let lastByte = 10;

  const counter = fs.createReadStream(filePath, {
    highWaterMark: 1024 * 1024,
  });

  for await (const chunk of counter) {
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 10) newlines += 1;
    }
    if (chunk.length > 0) {
      lastByte = chunk[chunk.length - 1];
    }
  }

  if (lastByte !== 10 && lastByte !== 13 && newlines > 0) {
    newlines += 1;
  }

  // First line is header.
  const totalRows = Math.max(0, newlines - 1);

  if (onMeta) {
    await onMeta({ totalRows });
  }

  let index = 0;

  const parser = fs.createReadStream(filePath, {
    highWaterMark: 1024 * 1024,
  }).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
      trim: true,
    })
  );

  for await (const row of parser) {
    index += 1;
    const maybe = onRow(row, index);
    if (maybe) await maybe;
  }

  return index;
}

async function streamXlsxRows(filePath, onRow, onMeta) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return 0;

  // ExcelJS already knows the populated row count after loading workbook.
  // Subtract header row so UI gets the real data-row total immediately.
  const totalRows = Math.max(
    0,
    Number(sheet.actualRowCount || sheet.rowCount || 0) - 1
  );

  if (onMeta) {
    await onMeta({ totalRows });
  }

  let headers = [];
  let count = 0;
  for (let i = 1; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    const values = row.values.slice(1).map((v) => (v == null ? '' : String(v)));
    if (i === 1) {
      headers = values;
      continue;
    }
    if (values.every((v) => v === '')) continue;
    count += 1;
    await onRow(rowToObject(headers, values), count);
  }
  return count;
}

async function streamRows(filePath, extension, onRow, onMeta) {
  if (extension === 'xlsx' || extension === 'xls') {
    return streamXlsxRows(filePath, onRow, onMeta);
  }
  return streamCsvRows(filePath, onRow, onMeta);
}

module.exports = {
  previewFile,
  streamRows,
};
