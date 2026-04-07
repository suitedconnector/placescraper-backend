const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { Client } = require('@googlemaps/google-maps-services-js');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');

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

// Send verification email (dev: returns token). Requires auth
router.post('/send-verification', authMiddleware, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, email, email_verified FROM users WHERE id = $1', [req.userId]);
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userRes.rows[0].email_verified) {
      return res.json({ message: 'Email already verified' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

    await pool.query(
      `INSERT INTO verification_tokens (user_id, token, expires_at, used)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at, used = FALSE`,
      [req.userId, token, expiresAt]
    );

    const verifyUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/api/auth/verify-email?token=${token}`;
    await sendMail({
      to: userRes.rows[0].email,
      subject: 'Verify your email',
      text: `Please verify your email by visiting: ${verifyUrl}`,
      html: `<p>Please verify your email by clicking <a href="${verifyUrl}">this link</a>.</p>`
    });
    return res.json({ message: 'Verification email sent', verifyUrl });
  } catch (error) {
    console.error('Send verification error:', error);
    const showDebug = String(process.env.SMTP_DEBUG || 'false').toLowerCase() === 'true' ||
      !(process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() === 'production');
    if (!showDebug) {
      return res.status(500).json({ error: 'Failed to send verification email' });
    }
    const debug = {
      message: error && error.message,
      code: error && error.code,
      errno: error && error.errno,
      syscall: error && error.syscall,
      response: error && error.response,
      responseCode: error && error.responseCode,
      command: error && error.command,
      stack: error && error.stack,
      smtpConfig: {
        host: process.env.ZOHO_SMTP_HOST,
        port: process.env.ZOHO_SMTP_PORT,
        secure: process.env.ZOHO_SMTP_SECURE,
        from: process.env.FROM_EMAIL || process.env.ZOHO_SMTP_USER
      }
    };
    try { console.error('SMTP debug:', JSON.stringify(debug)); } catch(_) {}
    return res.status(500).json({ error: 'Failed to send verification email', debug });
  }
});

// Verify email via token
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }
  try {
    const tokRes = await pool.query(
      'SELECT user_id, expires_at, used FROM verification_tokens WHERE token = $1',
      [token]
    );
    if (!tokRes.rows.length) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    const row = tokRes.rows[0];
    if (row.used) {
      return res.status(400).json({ error: 'Token already used' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token expired' });
    }

    await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [row.user_id]);
    await pool.query('UPDATE verification_tokens SET used = TRUE WHERE token = $1', [token]);

    return res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).json({ error: 'Failed to verify email' });
  }
});

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
      const showDebug = String(process.env.SMTP_DEBUG || 'false').toLowerCase() === 'true' ||
        !(process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() === 'production');
      if (!showDebug) {
        return res.status(500).json({ error: 'Login failed' });
      }
      const debug = {
        message: error && error.message,
        code: error && error.code,
        errno: error && error.errno,
        syscall: error && error.syscall
      };
      return res.status(500).json({ error: 'Login failed', debug });
    }
  }
);

router.post('/logout', (req, res) => {
  res.json({ message: 'Logout successful' });
});

// Request password reset
router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    try {
      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);

      // Always respond with success to avoid leaking whether email exists
      if (!userRes.rows.length) {
        return res.json({ message: 'If that email exists, a reset link has been sent.' });
      }

      const userId = userRes.rows[0].id;
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at, used)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at, used = FALSE`,
        [userId, token, expiresAt]
      );

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;

      await sendMail({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password by visiting: ${resetUrl}\n\nThis link expires in 1 hour.`,
        html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`
      });

      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (error) {
      console.error('Forgot password error:', error);
      return res.status(500).json({ error: 'Failed to process request' });
    }
  }
);

// Reset password using token
router.post('/reset-password',
  [
    body('token').notEmpty(),
    body('password').isLength({ min: 6 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, password } = req.body;

    try {
      const tokenRes = await pool.query(
        'SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
        [token]
      );

      if (!tokenRes.rows.length) {
        return res.status(400).json({ error: 'Invalid or expired reset link' });
      }

      const row = tokenRes.rows[0];

      if (row.used) {
        return res.status(400).json({ error: 'Reset link has already been used' });
      }

      if (new Date(row.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Reset link has expired' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, row.user_id]);
      await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE token = $1', [token]);

      return res.json({ message: 'Password reset successfully' });
    } catch (error) {
      console.error('Reset password error:', error);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

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
