const mysql = require('mysql2/promise');
(async () => {
  const db = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  await db.query(`CREATE TABLE IF NOT EXISTS meal_checks (
    user_id BIGINT NOT NULL, day TINYINT NOT NULL,
    meal_type ENUM('breakfast','lunch','dinner') NOT NULL,
    PRIMARY KEY (user_id, day, meal_type))`);
  console.log('meal_checks ready');
  await db.end();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });