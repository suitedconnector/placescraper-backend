const express = require('express');
const { Parser } = require('json2csv');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.post('/csv', authMiddleware, async (req, res) => {
  const { results } = req.body;

  if (!results || !Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'No results provided for export' });
  }

  try {
    const fields = [
      { label: 'Business Name', value: 'name' },
      { label: 'Address', value: 'address' },
      { label: 'Phone', value: 'phone' },
      { label: 'Website', value: 'website' },
      { label: 'Rating', value: 'rating' },
      { label: 'Review Count', value: 'reviewCount' },
      { label: 'Hours', value: row => (row.hours || []).join('; ') },
      { label: 'Photo URLs', value: row => (row.photoUrls || []).join('; ') },
      { label: 'Place ID', value: 'placeId' },
      { label: 'Latitude', value: 'latitude' },
      { label: 'Longitude', value: 'longitude' }
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(results);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=business-results.csv');
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Failed to generate CSV', details: error.message });
  }
});

module.exports = router;
