const express = require('express');
const pool = require('../config/database'); // make sure this is configured
const { body, validationResult } = require('express-validator');
const { encrypt } = require('../utils/encryption');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.put('/user/api-key', authMiddleware, 
  body('apiKey').exists().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const encrypted = encrypt(req.body.apiKey);

      await pool.query(
        'UPDATE users SET api_key_encrypted = $1 WHERE id = $2',
        [encrypted, req.userId]
      );

      res.json({ message: 'API key saved successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to save API key' });
    }
  }
);

module.exports = router;
