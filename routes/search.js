const express = require('express');
const { body, validationResult } = require('express-validator');
const { Client } = require('@googlemaps/google-maps-services-js');
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

// Execute a live Google Places search
router.post('/execute', authMiddleware, async (req, res) => {
  const { state, city, zipCodes, keywords, keywordLogic, category, resultsLimit } = req.body;

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

    const googleMapsClient = new Client({});
    const limit = resultsLimit || 20;

    // Build keyword query string
    const keywordList = Array.isArray(keywords) && keywords.length > 0 ? keywords : [];
    let keywordQuery;
    if (keywordList.length === 0) {
      keywordQuery = category || '';
    } else if (keywordLogic === 'AND') {
      keywordQuery = keywordList.join(' ');
      if (category) keywordQuery += ' ' + category;
    } else {
      // OR: will run one query per keyword
      keywordQuery = null;
    }

    // Build location targets: one per zip code, or city+state as a single target
    const locationTargets = Array.isArray(zipCodes) && zipCodes.length > 0
      ? zipCodes.map(z => String(z))
      : [[city, state].filter(Boolean).join(', ')];

    // Build the list of (query, location) pairs to execute
    const searches = [];
    for (const location of locationTargets) {
      if (keywordQuery !== null) {
        searches.push(`${keywordQuery} ${location}`.trim());
      } else {
        // OR logic: one search per keyword
        for (const kw of keywordList) {
          const q = [kw, category, location].filter(Boolean).join(' ');
          searches.push(q);
        }
      }
    }

    const seenPlaceIds = new Set();
    const allResults = [];

    for (const query of searches) {
      if (allResults.length >= limit) break;

      let pageToken;
      do {
        const params = { query, key: apiKey };
        if (pageToken) params.pagetoken = pageToken;

        const response = await googleMapsClient.textSearch({ params });
        const { status, error_message, results = [], next_page_token } = response.data;

        if (status !== 'OK' && status !== 'ZERO_RESULTS') {
          return res.status(400).json({ error: `Google API error: ${status}`, details: error_message });
        }

        for (const place of results) {
          if (allResults.length >= limit) break;
          if (seenPlaceIds.has(place.place_id)) continue;
          seenPlaceIds.add(place.place_id);

          // Fetch phone and website via Place Details
          let phone = null;
          let website = null;
          try {
            const detailsRes = await googleMapsClient.placeDetails({
              params: { place_id: place.place_id, fields: 'formatted_phone_number,website', key: apiKey }
            });
            phone = detailsRes.data.result?.formatted_phone_number || null;
            website = detailsRes.data.result?.website || null;
          } catch (_) {}

          allResults.push({
            name: place.name || null,
            address: place.formatted_address || null,
            phone,
            website,
            rating: place.rating ?? null,
            types: place.types || []
          });
        }

        pageToken = next_page_token;
        // Google requires ~2s before next_page_token is valid
        if (pageToken && allResults.length < limit) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } while (pageToken && allResults.length < limit);
    }

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
