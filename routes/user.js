const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');

const router = express.Router();

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, tier FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Determine current month in YYYY-MM
    const monthYear = new Date().toISOString().slice(0, 7);

    // Get calls used for current month (default 0 if no row yet)
    const usageRes = await pool.query(
      'SELECT calls_used FROM api_usage_monthly WHERE user_id = $1 AND month_year = $2',
      [req.userId, monthYear]
    );
    const apiCallsUsed = usageRes.rows.length ? parseInt(usageRes.rows[0].calls_used, 10) : 0;

    // Monthly limits per tier (default to 1000 for unknown tiers)
    const tier = user.tier || 'free';
    const tierMonthlyLimits = {
      free: 1000
      // add other tiers here as needed, e.g., pro: 10000, enterprise: 100000
    };
    const monthlyApiLimit = tierMonthlyLimits[tier] || 1000;

    return res.json({
      email: user.email,
      tier,
      monthlyApiLimit,
      apiCallsUsed
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
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
