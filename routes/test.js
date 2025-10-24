const express = require('express');
const pool = require('../config/database'); // Make sure this path matches your setup

const router = express.Router();

router.post('/test-db', async (req, res) => {
  try {
    // Minimal insert just to test DB connection
    const result = await pool.query(
      'INSERT INTO saved_searches (user_id, search_name, created_at) VALUES ($1, $2, NOW()) RETURNING id',
      [1, 'Test Insert']
    );

    res.json({
      message: '✅ DB insert works!',
      insertedId: result.rows[0].id
    });
  } catch (error) {
    console.error('DB test error:', error);
    res.status(500).json({ error: 'DB insert failed', details: error.message });
  }
});

module.exports = router;
