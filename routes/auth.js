const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { Client } = require('@googlemaps/google-maps-services-js');

const router = express.Router();
const googleMapsClient = new Client({});

router.post('/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const userExists = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );

      if (userExists.rows.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await pool.query(
        'INSERT INTO users (email, password_hash, tier, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, email, tier',
        [email, hashedPassword, 'free']
      );

      const user = result.rows[0];

      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          tier: user.tier
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

router.post('/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').exists()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const result = await pool.query(
        'SELECT id, email, password_hash, tier FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);

      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          tier: user.tier
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful' });
});

router.post('/validate-api-key',
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
      const response = await googleMapsClient.placesNearby({
        params: {
          location: { lat: 40.7128, lng: -74.0060 },
          radius: 1,
          key: apiKey
        },
        timeout: 5000
      });

      if (response.data.status === 'OK' || response.data.status === 'ZERO_RESULTS') {
        res.json({ valid: true, message: 'API key is valid' });
      } else if (response.data.status === 'REQUEST_DENIED') {
        res.status(400).json({ 
          valid: false, 
          message: 'API key is invalid or Places API is not enabled',
          details: response.data.error_message 
        });
      } else {
        res.status(400).json({ 
          valid: false, 
          message: 'API key validation failed',
          status: response.data.status 
        });
      }
    } catch (error) {
      console.error('API key validation error:', error);
      res.status(500).json({ 
        valid: false, 
        message: 'Failed to validate API key',
        error: error.message 
      });
    }
  }
);

module.exports = router;
