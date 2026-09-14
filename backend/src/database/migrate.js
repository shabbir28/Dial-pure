'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../config');
const statements = require('./schema');

const triggers = [
  `DROP TRIGGER IF EXISTS audit_logs_no_update`,
  `CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    BEGIN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
    END`,
  `DROP TRIGGER IF EXISTS audit_logs_no_delete`,
  `CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    BEGIN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
    END`,
];

async function migrate() {
  const admin = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });

  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.query(`USE \`${config.db.database}\``);

    for (const sql of statements) {
      await admin.query(sql);
    }
    for (const sql of triggers) {
      await admin.query(sql);
    }

    const extraIndexes = [
      ['campaign_numbers', 'idx_campaign_numbers_hash', 'CREATE INDEX idx_campaign_numbers_hash ON campaign_numbers (phone_hash)'],
      ['scrub_rows', 'idx_scrub_rows_hash', 'CREATE INDEX idx_scrub_rows_hash ON scrub_rows (phone_hash)'],
    ];
    for (const [table, indexName, sql] of extraIndexes) {
      const [found] = await admin.query(
        `SELECT 1 FROM information_schema.statistics
         WHERE table_schema = ? AND table_name = ? AND index_name = ?
         LIMIT 1`,
        [config.db.database, table, indexName]
      );
      if (!found.length) await admin.query(sql);
    }

    console.log(`MySQL database '${config.db.database}' is ready.`);
  } finally {
    await admin.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Migration failed:', error.message);
    process.exit(1);
  });
}

module.exports = { migrate };
