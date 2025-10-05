const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Configure your PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Or use user, host, database, password, port if needed
});

// Validate the incoming request body
function validateSearchInput(body) {
  const errors = [];
  if (!body.user_id) errors.push('user_id is required.');
  if (!body.search_name) errors.push('search_name is required.');
  // Add more validation as needed
  return errors;
}

// POST /api/search/save
router.post('/save', async (req, res) => {
  const errors = validateSearchInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const {
    user_id,
    search_name,
    state,
    city,
    zip_codes,
    keywords,
    keyword_logic,
    categories,
    results_limit
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO saved_searches
      (user_id, search_name, state, city, zip_codes, keywords, keyword_logic, categories, results_limit)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        user_id,
        search_name,
        state || null,
        city || null,
        zip_codes ? JSON.stringify(zip_codes) : null,
        keywords ? JSON.stringify(keywords) : null,
        keyword_logic || null,
        categories ? JSON.stringify(categories) : null,
        results_limit || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error saving search:', err);
    res.status(500).json({ error: 'Failed to save search.' });
  }
});

module.exports = router;