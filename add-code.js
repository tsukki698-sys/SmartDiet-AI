const crypto = require('crypto');
const mysql = require('mysql2/promise');
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPHA[b % ALPHA.length]).join('');

(async () => {
  const db = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  for (const sql of ['ALTER TABLE users ADD COLUMN access_code VARCHAR(12) NULL',
                     'CREATE UNIQUE INDEX uq_access_code ON users (access_code)']) {
    try { await db.query(sql); console.log('ok:', sql); } catch (e) { console.log('skipped:', e.message); }
  }
  const [users] = await db.query('SELECT id, name FROM users WHERE access_code IS NULL');
  for (const u of users) {
    await db.query('UPDATE users SET access_code=? WHERE id=?', [newCode(), u.id]);
  }
  console.log(`Generated access codes for ${users.length} existing profiles.`);
  await db.end();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });