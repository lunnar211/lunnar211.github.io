'use strict';
const express      = require('express');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const crypto       = require('crypto');
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

// Generate API key
function generateApiKey() {
  return 'dk_live_' + crypto.randomBytes(24).toString('hex');
}

// POST /api/users/register
// Step 1: Create account and send verification code
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if already registered and verified
    const existing = await pool.query(
      'SELECT id, email_verified FROM portfolio_users WHERE email = $1',
      [cleanEmail]
    );

    if (existing.rows.length > 0 && existing.rows[0].email_verified) {
      return res.status(400).json({
        error: 'Email already registered. Please login.',
      });
    }

    const hashed  = await bcrypt.hash(password, 12);
    const code    = generateCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const apiKey  = generateApiKey();

    const ip = (
      req.headers['x-forwarded-for'] || req.ip || ''
    ).split(',')[0].trim();

    // Upsert user (re-register resets code if not yet verified)
    await pool.query(
      `INSERT INTO portfolio_users
         (name, email, password, verify_code,
          verify_expires, api_key, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET
         name           = EXCLUDED.name,
         password       = EXCLUDED.password,
         verify_code    = EXCLUDED.verify_code,
         verify_expires = EXCLUDED.verify_expires`,
      [name || 'User', cleanEmail, hashed, code, expires, apiKey, ip]
    );

    // Send verification email
    await sendVerificationEmail(cleanEmail, code);

    res.json({
      success: true,
      message: 'Account created! Check your email for verification code.',
      email:   cleanEmail,
    });

  } catch (err) {
    console.error('[register]', err.message);
    if (err.code === '23505') {
      return res.status(400).json({
        error: 'Email already registered.',
      });
    }
    res.status(500).json({
      error: 'Registration failed: ' + err.message,
    });
  }
});

// POST /api/users/send-code
// Resend verification code
router.post('/send-code', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        error: 'Email required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const code       = generateCode();
    const expires    = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO portfolio_users
         (email, verify_code, verify_expires)
       VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET
         verify_code    = $2,
         verify_expires = $3`,
      [cleanEmail, code, expires]
    );

    await sendVerificationEmail(cleanEmail, code);

    res.json({
      success: true,
      message: 'Code sent to ' + cleanEmail,
    });

  } catch (err) {
    console.error('[send-code]', err.message);
    res.status(500).json({
      error: 'Failed to send code: ' + err.message,
    });
  }
});

// POST /api/users/verify-code
// Verify 6-digit code and return API key
router.post('/verify-code', authLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        error: 'Email and code are required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const { rows } = await pool.query(
      `SELECT id, verify_code, verify_expires, api_key, plan
       FROM portfolio_users WHERE email = $1`,
      [cleanEmail]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: 'Email not found. Please register first.',
      });
    }

    const user = rows[0];

    if (user.verify_code !== code.toString()) {
      return res.status(400).json({
        error: 'Invalid code. Please check and try again.',
      });
    }

    if (new Date() > new Date(user.verify_expires)) {
      return res.status(400).json({
        error: 'Code expired. Click resend to get a new one.',
      });
    }

    // If no API key exists, generate one
    let apiKey = user.api_key;
    if (!apiKey) {
      apiKey = generateApiKey();
    }

    // Mark verified and save API key
    await pool.query(
      `UPDATE portfolio_users
       SET email_verified = TRUE,
           verify_code    = NULL,
           verify_expires = NULL,
           api_key        = $2
       WHERE email = $1`,
      [cleanEmail, apiKey]
    );

    const token = jwt.sign(
      { id: user.id, email: cleanEmail, plan: user.plan || 'free' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success:  true,
      verified: true,
      apiKey,
      token,
      plan: user.plan || 'free',
    });

  } catch (err) {
    console.error('[verify-code]', err.message);
    res.status(500).json({
      error: 'Verification failed: ' + err.message,
    });
  }
});

// POST /api/users/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const { rows } = await pool.query(
      `SELECT id, email, password, email_verified,
              api_key, plan, is_admin, name
       FROM portfolio_users WHERE email = $1`,
      [cleanEmail]
    );

    if (!rows.length) {
      return res.status(401).json({
        error: 'Email not found. Please register.',
      });
    }

    const user = rows[0];

    if (!user.email_verified) {
      return res.status(401).json({
        error: 'Please verify your email first.',
        needsVerification: true,
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({
        error: 'Wrong password.',
      });
    }

    await pool.query(
      `UPDATE portfolio_users
       SET last_login  = NOW(),
           login_count = COALESCE(login_count, 0) + 1
       WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      {
        id:       user.id,
        email:    user.email,
        plan:     user.plan || 'free',
        is_admin: user.is_admin,
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      apiKey:  user.api_key,
      plan:    user.plan || 'free',
      user: {
        id:    user.id,
        email: user.email,
        name:  user.name,
        plan:  user.plan || 'free',
      },
    });

  } catch (err) {
    console.error('[login]', err.message);
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
