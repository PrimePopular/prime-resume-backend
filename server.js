// server.js — Prime Resume Payment Backend
// Handles Flutterwave payment verification and activation code delivery

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*', // Replace with your actual domain when live
  methods: ['GET', 'POST']
}));

// ============================================================
// ENVIRONMENT VARIABLES
// Set these in Render dashboard — NEVER hardcode them here
// ============================================================
const {
  FLW_SECRET_KEY,        // Your Flutterwave secret key
  FLW_SECRET_HASH,       // Your Flutterwave webhook secret hash
  GMAIL_USER,            // Your Gmail address e.g. primeresume.app@gmail.com
  GMAIL_APP_PASSWORD,    // Your Gmail app password (16 chars)
  PORT = 3000
} = process.env;

// ============================================================
// GENERATE ACTIVATION CODE
// Creates a unique 16-character code for each payment
// ============================================================
function generateActivationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PR-';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code; // Format: PR-XXXX-XXXX-XXXX
}

// ============================================================
// SEND ACTIVATION CODE EMAIL
// ============================================================
async function sendActivationEmail(toEmail, toName, code) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD
    }
  });

  const mailOptions = {
    from: `Prime Resume <${GMAIL_USER}>`,
    to: toEmail,
    subject: '✅ Your Prime Resume Activation Code',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
          .container { max-width: 520px; margin: 2rem auto; background: white; border-radius: 4px; overflow: hidden; box-shadow: 0 2px 20px rgba(0,0,0,0.08); }
          .header { background: #0a0a0a; padding: 2rem; text-align: center; }
          .logo { color: #c9a84c; font-size: 1.2rem; font-weight: 800; letter-spacing: 0.1em; }
          .body { padding: 2rem 2.5rem; }
          .greeting { font-size: 1rem; color: #333; margin-bottom: 1rem; }
          .code-box { background: #0a0a0a; border: 2px solid #c9a84c; border-radius: 4px; padding: 1.5rem; text-align: center; margin: 1.5rem 0; }
          .code-label { color: #888; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 0.5rem; }
          .code { color: #c9a84c; font-size: 1.6rem; font-weight: 800; letter-spacing: 0.15em; font-family: monospace; }
          .instructions { background: #f9f9f9; border-left: 3px solid #c9a84c; padding: 1rem 1.2rem; margin: 1.5rem 0; font-size: 0.85rem; color: #555; line-height: 1.7; }
          .instructions ol { margin: 0.5rem 0 0 1rem; padding: 0; }
          .instructions li { margin-bottom: 0.3rem; }
          .btn { display: block; text-align: center; background: #c9a84c; color: #000; padding: 0.9rem; border-radius: 2px; text-decoration: none; font-weight: 700; font-size: 0.88rem; letter-spacing: 0.08em; text-transform: uppercase; margin: 1.5rem 0; }
          .footer { padding: 1.5rem 2.5rem; border-top: 1px solid #eee; font-size: 0.75rem; color: #aaa; line-height: 1.6; }
          .validity { color: #888; font-size: 0.78rem; text-align: center; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">PRIME RESUME</div>
          </div>
          <div class="body">
            <p class="greeting">Hi ${toName || 'there'},</p>
            <p style="color:#555;font-size:0.9rem;line-height:1.7">
              Thank you for upgrading to Prime Resume Premium! Your payment was successful.
              Here is your activation code:
            </p>
            <div class="code-box">
              <div class="code-label">Your Activation Code</div>
              <div class="code">${code}</div>
            </div>
            <div class="instructions">
              <strong>How to activate:</strong>
              <ol>
                <li>Go to <strong>primeresume.app/pricing.html</strong></li>
                <li>Scroll down to <strong>"Already paid? Activate here"</strong></li>
                <li>Enter your code and click <strong>Activate</strong></li>
                <li>Enjoy 40 days of Premium access!</li>
              </ol>
            </div>
            <p class="validity">⏱ Valid for <strong>40 days</strong> from activation. One-time use.</p>
            <p style="color:#aaa;font-size:0.78rem;margin-top:1.5rem;line-height:1.6">
              Keep this email safe — your code is stored only on the device where you activate it.
              If you need help, reply to this email.
            </p>
          </div>
          <div class="footer">
            <p>© Prime Resume. Built for privacy.</p>
            <p>If you did not make this purchase, please reply to this email immediately.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
}

// ============================================================
// ROUTES
// ============================================================

// Health check — Render uses this to confirm server is alive
app.get('/', (req, res) => {
  res.json({ status: 'Prime Resume server is running' });
});

// Flutterwave webhook — called automatically when payment succeeds
app.post('/webhook/flutterwave', async (req, res) => {
  try {
    // Step 1: Verify the webhook is genuinely from Flutterwave
    const hash = req.headers['verif-hash'];
    if (!hash || hash !== FLW_SECRET_HASH) {
      console.log('Invalid webhook hash — rejected');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = req.body;

    // Step 2: Only process successful charge events
    if (payload.event !== 'charge.completed') {
      return res.status(200).json({ message: 'Event ignored' });
    }

    const data = payload.data;

    // Step 3: Verify payment status and amount
    if (data.status !== 'successful') {
      return res.status(200).json({ message: 'Payment not successful' });
    }

    // Step 4: Verify amount is correct ($3 USD or equivalent)
    const expectedAmount = 3;
    if (data.amount < expectedAmount) {
      console.log(`Amount too low: ${data.amount}`);
      return res.status(200).json({ message: 'Amount mismatch' });
    }

    // Step 5: Verify with Flutterwave API directly (double check)
    const verifyResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${data.id}/verify`,
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const verifyData = await verifyResponse.json();

    if (verifyData.data.status !== 'successful') {
      console.log('Verification failed');
      return res.status(200).json({ message: 'Verification failed' });
    }

    // Step 6: Generate activation code
    const code = generateActivationCode();
    const customerEmail = data.customer.email;
    const customerName = data.customer.name || '';

    console.log(`Payment verified for ${customerEmail} — Code: ${code}`);

    // Step 7: Send activation code email
    await sendActivationEmail(customerEmail, customerName, code);
    console.log(`Activation email sent to ${customerEmail}`);

    res.status(200).json({ message: 'Success' });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Manual code generation endpoint (for testing only — disable in production)
app.get('/generate-test-code', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Disabled in production' });
  }
  const code = generateActivationCode();
  res.json({ code });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`Prime Resume server running on port ${PORT}`);
});
