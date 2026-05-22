const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');

const router = express.Router();

// Save search (dual mode):
// - If body has { searchName, searchCriteria }, save named search to saved_searches
// - If body has { searchParams, resultsCount }, log activity to search_activity and increment monthly usage
router.post(
  '/save',
  authMiddleware,
  async (req, res) => {
    try {
      const { searchName, searchCriteria, searchParams, resultsCount } = req.body || {};

      // Mode A: Save named search criteria
      if (searchName && searchCriteria && typeof searchCriteria === 'object') {
        const result = await pool.query(
          `INSERT INTO saved_searches 
            (user_id, search_name, state, city, zip_codes, keywords, keyword_logic, categories, results_limit, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           RETURNING id`,
          [
            req.userId,
            searchName,
            searchCriteria.state || null,
            searchCriteria.city || null,
            searchCriteria.zipCodes ? JSON.stringify(searchCriteria.zipCodes) : null,
            searchCriteria.keywords ? JSON.stringify(searchCriteria.keywords) : null,
            searchCriteria.keywordLogic || 'OR',
            searchCriteria.categories ? JSON.stringify(searchCriteria.categories) : null,
            searchCriteria.resultsLimit || 100
          ]
        );

        return res.status(201).json({
          message: 'Search saved successfully',
          searchId: result.rows[0].id
        });
      }

      // Mode B: Log search activity (enforce monthly usage limits)
      if (searchParams && typeof searchParams === 'object' && Number.isInteger(resultsCount) && resultsCount >= 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Lock user row for update
          const userRes = await client.query(
            `SELECT id, tier, api_calls_used, api_calls_reset_date, monthly_api_limit
             FROM users WHERE id = $1 FOR UPDATE`,
            [req.userId]
          );
          if (!userRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
          }

          const user = userRes.rows[0];
          const tier = user.tier || 'free';
          const defaultLimits = { free: 100, pro: 1000, enterprise: 10000 };
          let monthlyLimit = user.monthly_api_limit || defaultLimits[tier] || 100;

          // Determine current month start (UTC)
          const now = new Date();
          const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

          // Reset if api_calls_reset_date is before this month's start
          let apiCallsUsed = user.api_calls_used || 0;
          const resetDate = user.api_calls_reset_date ? new Date(user.api_calls_reset_date) : null;
          const needsReset = !resetDate || resetDate < monthStart;

          if (needsReset) {
            apiCallsUsed = 0;
          }

          // Check limit before increment
          if (apiCallsUsed + 1 > monthlyLimit) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Monthly API limit reached' });
          }

          // Persist updates to users table
          if (needsReset && user.monthly_api_limit == null) {
            await client.query(
              `UPDATE users SET api_calls_used = $1, api_calls_reset_date = $2, monthly_api_limit = $3 WHERE id = $4`,
              [0, monthStart, monthlyLimit, req.userId]
            );
          } else if (needsReset) {
            await client.query(
              `UPDATE users SET api_calls_used = $1, api_calls_reset_date = $2 WHERE id = $3`,
              [0, monthStart, req.userId]
            );
          } else if (user.monthly_api_limit == null) {
            await client.query(
              `UPDATE users SET monthly_api_limit = $1 WHERE id = $2`,
              [monthlyLimit, req.userId]
            );
          }

          // Increment
          await client.query(
            `UPDATE users SET api_calls_used = api_calls_used + 1 WHERE id = $1`,
            [req.userId]
          );

          // Insert activity
          const activityRes = await client.query(
            `INSERT INTO search_activity (user_id, search_params, results_count, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id`,
            [req.userId, JSON.stringify(searchParams), resultsCount]
          );

          // Increment monthly summary table (optional analytics)
          const monthYear = new Date().toISOString().slice(0, 7); // YYYY-MM
          await client.query(
            `INSERT INTO api_usage_monthly (user_id, month_year, calls_used)
             VALUES ($1, $2, 1)
             ON CONFLICT (user_id, month_year)
             DO UPDATE SET calls_used = api_usage_monthly.calls_used + 1`,
            [req.userId, monthYear]
          );

          await client.query('COMMIT');

          return res.status(201).json({
            message: 'Search activity saved',
            id: activityRes.rows[0].id
          });
        } catch (txErr) {
          try { await pool.query('ROLLBACK'); } catch (_) {}
          console.error('Failed to save search activity (tx):', txErr);
          return res.status(500).json({ error: 'Failed to save search activity', details: txErr.message });
        } finally {
          try { client.release(); } catch (_) {}
        }
      }

      return res.status(400).json({ error: 'Invalid request body. Provide either { searchName, searchCriteria } or { searchParams, resultsCount }.' });
    } catch (error) {
      console.error('Failed to save search:', error);
      return res.status(500).json({ error: 'Failed to save search', details: error.message });
    }
  }
);


// Get saved searches
router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, search_name, state, city, zip_codes, keywords, keyword_logic, categories, results_limit, created_at
       FROM saved_searches
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    );

    const searches = result.rows.map(row => ({
      id: row.id,
      searchName: row.search_name,
      state: row.state,
      city: row.city,
      zipCodes: row.zip_codes ? JSON.parse(row.zip_codes) : [],
      keywords: row.keywords ? JSON.parse(row.keywords) : [],
      keywordLogic: row.keyword_logic,
      categories: row.categories ? JSON.parse(row.categories) : [],
      resultsLimit: row.results_limit,
      createdAt: row.created_at
    }));

    res.json({ searches });
  } catch (error) {
    console.error('Failed to fetch saved searches:', error);
    res.status(500).json({ error: 'Failed to fetch saved searches', details: error.message });
  }
});

// Execute a live Google Places search (Places API v1)
router.post('/execute', authMiddleware, async (req, res) => {
  const { state, city, zipCodes, keywords, keywordLogic, category, resultsLimit } = req.body;
  console.log('Using Places API v1');

  try {
    // Fetch and decrypt user's Google API key
    const userRes = await pool.query('SELECT api_key_encrypted FROM users WHERE id = $1', [req.userId]);
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!userRes.rows[0].api_key_encrypted) {
      return res.status(400).json({ error: 'No Google API key saved. Add your API key in settings.' });
    }
    const apiKey = decrypt(userRes.rows[0].api_key_encrypted);

    const limit = Math.min(resultsLimit || 20, 20);

    // Build keyword portion of query
    const keywordList = Array.isArray(keywords) && keywords.length > 0 ? keywords : [];
    let keywordStr;
    if (keywordList.length === 0) {
      keywordStr = category || '';
    } else if (keywordLogic === 'AND') {
      keywordStr = [...keywordList, category].filter(Boolean).join(' ');
    } else {
      // OR: one query per keyword — handled below
      keywordStr = null;
    }

    // Build location targets: one per zip code, or a single city+state string
    const locationTargets = Array.isArray(zipCodes) && zipCodes.length > 0
      ? zipCodes.map(z => String(z))
      : [[city, state].filter(Boolean).join(', ')];

    // Build list of text queries to execute
    const queries = [];
    for (const location of locationTargets) {
      if (keywordStr !== null) {
        queries.push([keywordStr, location].filter(Boolean).join(' '));
      } else {
        for (const kw of keywordList) {
          queries.push([kw, category, location].filter(Boolean).join(' '));
        }
      }
    }

    const seenIds = new Set();
    const allResults = [];

    for (const textQuery of queries) {
      if (allResults.length >= limit) break;

      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.types,places.googleMapsUri'
        },
        body: JSON.stringify({ textQuery, maxResultCount: limit })
      });

      const responseText = await response.text();

      if (!response.ok) {
        console.error('Places API v1 error:', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseText
        });
        let errorMessage = response.statusText;
        try { errorMessage = JSON.parse(responseText)?.error?.message || errorMessage; } catch (_) {}
        return res.status(400).json({ error: 'Google API error', details: errorMessage });
      }

      const data = JSON.parse(responseText);

      for (const place of data.places || []) {
        if (allResults.length >= limit) break;
        if (seenIds.has(place.id)) continue;
        seenIds.add(place.id);

        allResults.push({
          id: place.id || null,
          name: place.displayName?.text || null,
          address: place.formattedAddress || null,
          phone: place.nationalPhoneNumber || null,
          website: place.websiteUri || null,
          googleMapsUri: place.googleMapsUri || null,
          rating: place.rating ?? null,
          types: place.types || []
        });
      }
    }

    await pool.query('UPDATE users SET api_calls_used = api_calls_used + 1 WHERE id = $1', [req.userId]);

    return res.json({ results: allResults, count: allResults.length });
  } catch (error) {
    console.error('Execute search error:', error);
    return res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// Delete a saved search
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM searches WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Search not found' });
    }

    res.json({ message: 'Search deleted successfully' });
  } catch (error) {
    console.error('Failed to delete search:', error);
    res.status(500).json({ error: 'Failed to delete search', details: error.message });
  }
});

module.exports = router;
