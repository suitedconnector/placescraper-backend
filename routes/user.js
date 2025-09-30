const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');

const router = express.Router();

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, tier, created_at, api_key_encrypted FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    res.json({
      id: user.id,
      email: user.email,
      tier: user.tier,
      createdAt: user.created_at,
      hasApiKey: !!user.api_key_encrypted
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/api-key',
  authMiddleware,
  [
    body('apiKey').exists().notEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { apiKey } = req.body;

    try {
      const encryptedKey = encrypt(apiKey);
      
      await pool.query(
        'UPDATE users SET api_key_encrypted = $1 WHERE id = $2',
        [encryptedKey, req.userId]
      );

      res.json({ message: 'API key saved successfully' });
    } catch (error) {
      console.error('Save API key error:', error);
      res.status(500).json({ error: 'Failed to save API key' });
    }
  }
);

router.get('/usage-stats', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_searches,
        SUM(api_calls_made) as total_api_calls,
        MAX(search_date) as last_search_date
       FROM api_usage 
       WHERE user_id = $1`,
      [req.userId]
    );

    const stats = result.rows[0];
    
    const recentUsage = await pool.query(
      `SELECT search_date, api_calls_made 
       FROM api_usage 
       WHERE user_id = $1 
       ORDER BY search_date DESC 
       LIMIT 10`,
      [req.userId]
    );

    res.json({
      totalSearches: parseInt(stats.total_searches) || 0,
      totalApiCalls: parseInt(stats.total_api_calls) || 0,
      lastSearchDate: stats.last_search_date,
      recentUsage: recentUsage.rows
    });
  } catch (error) {
    console.error('Get usage stats error:', error);
    res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
});

module.exports = router;
