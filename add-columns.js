const mysql = require('mysql2/promise');

const columns = [
  'age INT NULL',
  'sex VARCHAR(10) NULL',
  'height_cm DECIMAL(5,1) NULL',
  'weight_kg DECIMAL(5,1) NULL',
  'activity VARCHAR(12) NULL',
];

(async () => {
  const db = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  for (const c of columns) {
    try {
      await db.query(`ALTER TABLE users ADD COLUMN ${c}`);
      console.log('added:', c);
    } catch (e) {
      console.log('skipped:', c, '->', e.message);
    }
  }
  const [rows] = await db.query('SHOW COLUMNS FROM users');
  console.log('users columns:', rows.map(r => r.Field).join(', '));
  await db.end();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });