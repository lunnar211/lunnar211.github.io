'use strict';
const nodemailer = require('nodemailer');

// Create Gmail transporter with App Password
// IMPORTANT: Use port 587 with TLS not 465 with SSL
function createTransporter() {
  return nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,       // true for 465, false for 587
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: true,
    },
  });
}

// Test connection on startup
async function verifyEmail() {
  try {
    const t = createTransporter();
    await t.verify();
    console.log('[Email] Gmail SMTP ready');
    return true;
  } catch (err) {
    console.error('[Email] Gmail SMTP error:', err.message);
    console.error('[Email] Check GMAIL_USER and GMAIL_APP_PASSWORD in Render env');
    return false;
  }
}

// Generate 6-digit code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000)
    .toString();
}

// Send verification email
async function sendVerificationEmail(toEmail, code) {
  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: `"DK Portfolio" <${process.env.GMAIL_USER}>`,
      to:   toEmail,
      subject: 'Your verification code — DK Portfolio',
      html: `
        <div style="font-family:sans-serif;
                    max-width:480px;margin:0 auto;
                    background:#060614;padding:40px;
                    border-radius:16px;color:#fff;">
          <h2 style="color:#a78bfa;margin-bottom:8px;">
            DK Portfolio
          </h2>
          <p style="color:#94a3b8;margin-bottom:24px;">
            Your verification code:
          </p>
          <div style="background:#1a1a2e;
                      border-radius:12px;
                      padding:24px;
                      text-align:center;
                      margin-bottom:24px;">
            <span style="font-size:48px;
                         font-weight:900;
                         letter-spacing:12px;
                         color:#38bdf8;">
              ${code}
            </span>
          </div>
          <p style="color:#64748b;font-size:13px;">
            This code expires in 10 minutes.
            If you did not request this, ignore this email.
          </p>
        </div>
      `,
    });
    console.log('[Email] Verification code sent to:', toEmail);
    return true;
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    throw err;
  }
}

// Send password reset email
async function sendPasswordResetEmail(toEmail, code) {
  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: `"DK Portfolio" <${process.env.GMAIL_USER}>`,
      to:   toEmail,
      subject: 'Reset your password — DK Portfolio',
      html: `
        <div style="font-family:sans-serif;
                    max-width:480px;margin:0 auto;
                    background:#060614;padding:40px;
                    border-radius:16px;color:#fff;">
          <h2 style="color:#ec4899;">Password Reset</h2>
          <p style="color:#94a3b8;">Your reset code:</p>
          <div style="background:#1a1a2e;
                      border-radius:12px;
                      padding:24px;text-align:center;">
            <span style="font-size:48px;font-weight:900;
                         letter-spacing:12px;color:#ec4899;">
              ${code}
            </span>
          </div>
          <p style="color:#64748b;font-size:13px;
                    margin-top:16px;">
            Expires in 10 minutes.
          </p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[Email] Reset email failed:', err.message);
    throw err;
  }
}

// Send payment notification to Dipesh
async function sendPaymentNotification(details) {
  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: `"Portfolio Payments" <${process.env.GMAIL_USER}>`,
      to:   'dipeshkarki6612@gmail.com',
      subject: `💰 New Payment — ${details.productName} $${details.amount}`,
      html: `
        <div style="font-family:sans-serif;padding:30px;">
          <h2 style="color:green">New Payment!</h2>
          <p>Product: <b>${details.productName}</b></p>
          <p>Amount: <b>$${details.amount}</b></p>
          <p>Buyer: <b>${details.buyerName}</b></p>
          <p>Email: <b>${details.buyerEmail}</b></p>
          <p style="color:green">Contact within 24 hours!</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Email] Payment notify failed:', err.message);
  }
}

module.exports = {
  generateCode,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPaymentNotification,
  verifyEmail,
};
