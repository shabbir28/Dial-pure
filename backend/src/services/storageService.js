'use strict';

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { uuid } = require('../utils/ids');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function safeKey(parts) {
  return parts
    .join('/')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

async function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function saveFromPath({ sourcePath, folder, extension, size }) {
  const id = uuid();
  const storedFilename = `${id}${extension ? `.${extension.replace(/^\./, '')}` : ''}`;

  const key = safeKey([folder, storedFilename]);
  const destDir = path.join(config.storage.dir, folder);
  await ensureDir(destDir);
  const dest = path.join(destDir, storedFilename);

  let checksum;

  try {
    // Try atomic rename first (same filesystem — instant).
    await fs.rename(sourcePath, dest);

    // After rename, read the file once to compute checksum.
    checksum = await checksumFile(dest);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;

    // Cross-device: pipe manually and hash simultaneously.
    checksum = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const src = fsSync.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 });
      const dst = fsSync.createWriteStream(dest);

      src.on('data', (chunk) => hash.update(chunk));
      src.on('error', reject);
      dst.on('error', reject);
      dst.on('finish', () => resolve(hash.digest('hex')));
      src.pipe(dst);
    });

    await fs.unlink(sourcePath).catch(() => {});
  }

  const stat = size || (await fs.stat(dest)).size;
  return {
    provider: 'local',
    bucket: null,
    key,
    storedFilename,
    size: stat,
    checksum,
  };
}

async function saveBuffer({ buffer, folder, extension }) {
  const id = uuid();
  const storedFilename = `${id}${extension ? `.${extension.replace(/^\./, '')}` : ''}`;
  const key = safeKey([folder, storedFilename]);

  if (config.storage.provider === 'local') {
    const destDir = path.join(config.storage.dir, folder);
    await ensureDir(destDir);
    const dest = path.join(destDir, storedFilename);
    await fs.writeFile(dest, buffer);
    return {
      provider: 'local',
      bucket: null,
      key,
      storedFilename,
      size: buffer.length,
    };
  }

  throw new Error('S3 storage is not configured in this environment.');
}

function absolutePath(storageKey) {
  return path.join(config.storage.dir, ...String(storageKey).split('/'));
}

async function readFile(storageKey) {
  return fs.readFile(absolutePath(storageKey));
}

function createReadStream(storageKey) {
  return fsSync.createReadStream(absolutePath(storageKey), { highWaterMark: 1024 * 1024 });
}

async function removePath(filePath) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  saveBuffer,
  saveFromPath,
  readFile,
  createReadStream,
  absolutePath,
  checksum,
  checksumFile,
  ensureDir,
  removePath,
};
