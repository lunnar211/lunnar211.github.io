'use strict';
require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const { Pool }  = require('pg');
const { verifyEmail } = require('./services/emailService');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Database schema ──────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

async function initSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portfolio_users (
        id              SERIAL PRIMARY KEY,
        email           TEXT UNIQUE NOT NULL,
        password        TEXT,
        email_verified  BOOLEAN DEFAULT FALSE,
        verify_code     TEXT,
        verify_expires  TIMESTAMPTZ,
        reset_code      TEXT,
        reset_expires   TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[DB] Schema ready');
  } catch (err) {
    console.error('[DB] Schema error:', err.message);
  }
}

// ── Routes ───────────────────────────────────
// debug: test email route
app.get('/test-email', async (req, res) => {
  try {
    const {
      sendVerificationEmail,
      generateCode,
    } = require('./services/emailService');

    const code = generateCode();
    await sendVerificationEmail(
      'dipeshkarki6612@gmail.com',
      code
    );

    res.json({
      success: true,
      message: 'Test email sent to dipeshkarki6612@gmail.com',
      code,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  }
});

app.use('/api/assistant', require('./routes/assistant'));
app.use('/api/users',     require('./routes/users'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Start ────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[Server] Running on port ${PORT}`);
  await initSchema();
  await verifyEmail(); // Test Gmail on startup
});
