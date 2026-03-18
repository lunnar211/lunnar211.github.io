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
  const client = await pool.connect();
  try {
    await client.query(`
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

    // Add columns that may be missing from earlier schema versions
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='api_key'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN api_key VARCHAR(100) UNIQUE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='name'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN name TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='ip_address'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN ip_address TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='plan'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN plan TEXT DEFAULT 'free';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='is_admin'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='login_count'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN login_count INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='portfolio_users' AND column_name='last_login'
        ) THEN
          ALTER TABLE portfolio_users ADD COLUMN last_login TIMESTAMPTZ;
        END IF;
      END $$;
    `);

    console.log('[DB] Schema ready');
  } catch (err) {
    console.error('[DB] Schema error:', err.message);
  } finally {
    client.release();
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
      success:      true,
      message:      'Test email sent to dipeshkarki6612@gmail.com',
      code,
      gmail_user:   process.env.GMAIL_USER || 'NOT SET',
      smtp_ok:      true,
    });
  } catch (err) {
    res.status(500).json({
      success:    false,
      error:      err.message,
      gmail_user: process.env.GMAIL_USER || 'NOT SET',
      smtp_ok:    false,
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
