'use strict';
const express      = require('express');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcryptjs');
const router       = express.Router();
const { Pool }     = require('pg');
const {
  generateCode,
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/emailService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// Rate limiter: max 5 requests per IP per 15 minutes
// for email-sending / verification endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// POST /api/users/send-code
// Sends verification code to email
router.post('/send-code', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        error: 'Email required',
      });
    }

    const code    = generateCode();
    const expires = new Date(
      Date.now() + 10 * 60 * 1000
    ); // 10 minutes

    // Save code to database
    await pool.query(
      `INSERT INTO portfolio_users
         (email, verify_code, verify_expires)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
       SET verify_code=$2, verify_expires=$3`,
      [email.toLowerCase(), code, expires]
    );

    // Send email
    await sendVerificationEmail(email, code);

    res.json({
      success: true,
      message: 'Verification code sent to ' + email,
    });
  } catch (err) {
    console.error('[send-code]', err.message);
    res.status(500).json({
      error: 'Failed to send code. Check email address.',
    });
  }
});

// POST /api/users/verify-code
router.post('/verify-code', authLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    const { rows } = await pool.query(
      `SELECT verify_code, verify_expires
       FROM portfolio_users
       WHERE email=$1`,
      [email.toLowerCase()]
    );
    if (!rows.length) {
      return res.status(404).json({
        error: 'Email not found',
      });
    }
    const user = rows[0];
    if (user.verify_code !== code) {
      return res.status(400).json({
        error: 'Invalid code',
      });
    }
    if (new Date() > new Date(user.verify_expires)) {
      return res.status(400).json({
        error: 'Code expired. Request a new one.',
      });
    }
    await pool.query(
      `UPDATE portfolio_users
       SET email_verified=TRUE,
           verify_code=NULL,
           verify_expires=NULL
       WHERE email=$1`,
      [email.toLowerCase()]
    );
    res.json({ success: true, verified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/forgot-password
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const code    = generateCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const result  = await pool.query(
      `UPDATE portfolio_users
       SET reset_code=$1, reset_expires=$2
       WHERE email=$3`,
      [code, expires, email.toLowerCase()]
    );
    // Only send email if user exists; always return same response
    // to prevent user enumeration
    if (result.rowCount > 0) {
      await sendPasswordResetEmail(email, code);
    }
    res.json({
      success: true,
      message: 'If that email is registered, a reset code has been sent.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/reset-password
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const { rows } = await pool.query(
      `SELECT reset_code, reset_expires
       FROM portfolio_users WHERE email=$1`,
      [email.toLowerCase()]
    );
    if (!rows.length || rows[0].reset_code !== code) {
      return res.status(400).json({
        error: 'Invalid or expired code',
      });
    }
    if (new Date() > new Date(rows[0].reset_expires)) {
      return res.status(400).json({
        error: 'Code expired',
      });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE portfolio_users
       SET password=$1, reset_code=NULL,
           reset_expires=NULL
       WHERE email=$2`,
      [hashed, email.toLowerCase()]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
