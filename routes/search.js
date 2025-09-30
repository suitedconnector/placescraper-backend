const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { decrypt } = require('../utils/encryption');
const { Client } = require('@googlemaps/google-maps-services-js');

const router = express.Router();
const googleMapsClient = new Client({});

router.post('/execute', 
  authMiddleware,
  [
    body('resultsLimit').optional().isInt({ min: 1, max: 500 }).withMessage('Results limit must be between 1 and 500'),
    body('keywordLogic').optional().isIn(['AND', 'OR']).withMessage('Keyword logic must be AND or OR'),
    body('zipCodes').optional().isArray().withMessage('Zip codes must be an array'),
    body('keywords').optional().isArray().withMessage('Keywords must be an array'),
    body('categories').optional().isArray().withMessage('Categories must be an array')
  ],
  async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { state, city, zipCodes, keywords, keywordLogic, categories, resultsLimit } = req.body;

  if (!state && !city && (!zipCodes || zipCodes.length === 0)) {
    return res.status(400).json({ error: 'At least one location parameter (state, city, or zipCodes) is required' });
  }

  if (!keywords || keywords.length === 0) {
    return res.status(400).json({ error: 'At least one keyword is required' });
  }

  try {
    const userResult = await pool.query(
      'SELECT api_key_encrypted FROM users WHERE id = $1',
      [req.userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].api_key_encrypted) {
      return res.status(400).json({ error: 'Google API key not configured' });
    }

    const apiKey = decrypt(userResult.rows[0].api_key_encrypted);
    const limit = Math.min(resultsLimit || 100, 500);
    
    const locations = [];
    if (zipCodes && zipCodes.length > 0) {
      locations.push(...zipCodes);
    } else if (city && state) {
      locations.push(`${city}, ${state}`);
    } else if (state) {
      locations.push(state);
    }

    let query = '';
    if (keywords && keywords.length > 0) {
      query = keywordLogic === 'AND' 
        ? keywords.join(' ')
        : keywords.join(' OR ');
    }

    if (categories && categories.length > 0) {
      query += ' ' + categories.join(' ');
    }

    const allResults = [];
    let totalApiCalls = 0;
    const searchErrors = [];

    for (const location of locations) {
      try {
        const searchQuery = `${query} in ${location}`.trim();
        
        const textSearchResponse = await googleMapsClient.textSearch({
          params: {
            query: searchQuery,
            key: apiKey
          },
          timeout: 10000
        });

        totalApiCalls++;

        if (textSearchResponse.data.status === 'OK') {
          const places = textSearchResponse.data.results.slice(0, Math.ceil(limit / locations.length));

          for (const place of places) {
            try {
              const detailsResponse = await googleMapsClient.placeDetails({
                params: {
                  place_id: place.place_id,
                  fields: [
                    'name',
                    'formatted_address',
                    'formatted_phone_number',
                    'website',
                    'rating',
                    'user_ratings_total',
                    'opening_hours',
                    'geometry',
                    'photos',
                    'place_id'
                  ],
                  key: apiKey
                },
                timeout: 10000
              });

              totalApiCalls++;

              if (detailsResponse.data.status === 'OK') {
                const details = detailsResponse.data.result;
                
                const photoUrls = details.photos ? details.photos.map(photo => 
                  `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photo.photo_reference}&key=${apiKey}`
                ) : [];

                allResults.push({
                  name: details.name || '',
                  address: details.formatted_address || '',
                  phone: details.formatted_phone_number || '',
                  website: details.website || '',
                  rating: details.rating || 0,
                  reviewCount: details.user_ratings_total || 0,
                  hours: details.opening_hours?.weekday_text || [],
                  photoUrls: photoUrls,
                  placeId: details.place_id || '',
                  latitude: details.geometry?.location?.lat || 0,
                  longitude: details.geometry?.location?.lng || 0
                });
              } else {
                searchErrors.push({
                  location,
                  type: 'place_details',
                  status: detailsResponse.data.status,
                  message: detailsResponse.data.error_message || 'Failed to fetch place details'
                });
              }
            } catch (detailError) {
              console.error('Place details error:', detailError);
              searchErrors.push({
                location,
                type: 'place_details',
                error: detailError.message || 'Unknown error fetching place details'
              });
            }
          }
        } else if (textSearchResponse.data.status === 'ZERO_RESULTS') {
          searchErrors.push({
            location,
            type: 'text_search',
            status: 'ZERO_RESULTS',
            message: `No results found for "${searchQuery}"`
          });
        } else {
          searchErrors.push({
            location,
            type: 'text_search',
            status: textSearchResponse.data.status,
            message: textSearchResponse.data.error_message || 'Search failed for this location'
          });
        }
      } catch (searchError) {
        console.error('Text search error:', searchError);
        searchErrors.push({
          location,
          type: 'text_search',
          error: searchError.message || 'Network error or timeout'
        });
      }
    }

    await pool.query(
      'INSERT INTO api_usage (user_id, api_calls_made, search_date) VALUES ($1, $2, NOW())',
      [req.userId, totalApiCalls]
    );

    res.json({
      results: allResults.slice(0, limit),
      totalResults: allResults.length,
      apiCallsUsed: totalApiCalls,
      estimatedCost: (totalApiCalls * 0.017).toFixed(2),
      errors: searchErrors.length > 0 ? searchErrors : undefined
    });
  } catch (error) {
    console.error('Search execution error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

router.post('/save', authMiddleware,
  [
    body('searchName').exists().notEmpty(),
    body('searchCriteria').exists()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { searchName, searchCriteria } = req.body;

    try {
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

      res.status(201).json({
        message: 'Search saved successfully',
        searchId: result.rows[0].id
      });
    } catch (error) {
      console.error('Save search error:', error);
      res.status(500).json({ error: 'Failed to save search' });
    }
  }
);

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
    console.error('Get saved searches error:', error);
    res.status(500).json({ error: 'Failed to fetch saved searches' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Search not found' });
    }

    res.json({ message: 'Search deleted successfully' });
  } catch (error) {
    console.error('Delete search error:', error);
    res.status(500).json({ error: 'Failed to delete search' });
  }
});

module.exports = router;
