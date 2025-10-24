const pool = require('./config/database');

async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('Database connected! Current time:', res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
}

testConnection();
