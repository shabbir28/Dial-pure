'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');

const KEEP = new Set(['users', 'user_sessions', 'system_settings']);

async function reset() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });

  try {
    const [tables] = await conn.query(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [config.db.database]
    );

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DROP TRIGGER IF EXISTS audit_logs_no_delete');
    await conn.query('DROP TRIGGER IF EXISTS audit_logs_no_update');

    for (const table of tables) {
      const name = table.name || table.NAME;
      if (KEEP.has(name)) continue;
      await conn.query(`TRUNCATE TABLE \`${name}\``);
      console.log(`Cleared ${name}`);
    }

    await conn.query(`
      CREATE TRIGGER audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW
      BEGIN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
      END
    `);
    await conn.query(`
      CREATE TRIGGER audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW
      BEGIN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
      END
    `);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const storageDir = config.storage.dir;
    if (fs.existsSync(storageDir)) {
      for (const entry of fs.readdirSync(storageDir)) {
        fs.rmSync(path.join(storageDir, entry), { recursive: true, force: true });
        console.log(`Removed storage/${entry}`);
      }
    }

    const [users] = await conn.query('SELECT email, role FROM users ORDER BY role, email');
    console.log(`Kept ${users.length} user(s): ${users.map((u) => `${u.email} (${u.role})`).join(', ')}`);
    console.log('Reset complete. Users and settings were kept.');
  } finally {
    await conn.end();
  }
}

reset().catch((error) => {
  console.error('Reset failed:', error.message);
  process.exit(1);
});
