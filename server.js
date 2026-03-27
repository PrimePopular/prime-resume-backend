// server.js — Prime Resume Backend
// Handles Flutterwave payments + Gemini AI endpoints

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({
  origin: ['https://primepopular.github.io', 'http://localhost:3000', 'http://127.0.0.1:5500'],
  methods: ['GET', 'POST'],
  credentials: false
}));

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================
const {
  FLW_SECRET_KEY,
  FLW_SECRET_HASH,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  GEMINI_API_KEY,
  PORT = 3000
} = process.env;

// Groq API key (read directly from env since added after destructuring)
// process.env.GROQ_API_KEY is used directly in callAI()

// ============================================================
// RATE LIMITING
// ============================================================
const requestCounts = {};

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const maxRequests = 20;

  if (!requestCounts[ip]) {
    requestCounts[ip] = { count: 1, resetAt: now + windowMs };
    return true;
  }
  if (now > requestCounts[ip].resetAt) {
    requestCounts[ip] = { count: 1, resetAt: now + windowMs };
    return true;
  }
  if (requestCounts[ip].count >= maxRequests) return false;
  requestCounts[ip].count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  Object.keys(requestCounts).forEach(ip => {
    if (now > requestCounts[ip].resetAt) delete requestCounts[ip];
  });
}, 60 * 60 * 1000);

// ============================================================
// ACTIVATION CODE GENERATOR
// ============================================================
function generateActivationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PR-';
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  const timestamp = Date.now().toString(36).toUpperCase();
  return code + '-' + timestamp;
}

// ============================================================
// SEND ACTIVATION EMAIL
// ============================================================
async function sendActivationEmail(toEmail, toName, code) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });

  await transporter.sendMail({
    from: `Prime Resume <${GMAIL_USER}>`,
    to: toEmail,
    subject: '✅ Your Prime Resume Activation Code',
    html: `
      <!DOCTYPE html><html><head>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;margin:0;padding:0;}
        .container{max-width:520px;margin:2rem auto;background:white;border-radius:4px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);}
        .header{background:#0a0a0a;padding:2rem;text-align:center;}
        .logo{color:#c9a84c;font-size:1.2rem;font-weight:800;letter-spacing:0.1em;}
        .body{padding:2rem 2.5rem;}
        .code-box{background:#0a0a0a;border:2px solid #c9a84c;border-radius:4px;padding:1.5rem;text-align:center;margin:1.5rem 0;}
        .code-label{color:#888;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.5rem;}
        .code{color:#c9a84c;font-size:1.6rem;font-weight:800;letter-spacing:0.15em;font-family:monospace;}
        .instructions{background:#f9f9f9;border-left:3px solid #c9a84c;padding:1rem 1.2rem;margin:1.5rem 0;font-size:0.85rem;color:#555;line-height:1.7;}
        .footer{padding:1.5rem 2.5rem;border-top:1px solid #eee;font-size:0.75rem;color:#aaa;line-height:1.6;}
      </style></head><body>
      <div class="container">
        <div class="header"><div class="logo">PRIME RESUME</div></div>
        <div class="body">
          <p style="color:#333">Hi ${toName || 'there'},</p>
          <p style="color:#555;font-size:0.9rem;line-height:1.7">Thank you for upgrading! Your payment was successful. Here is your activation code:</p>
          <div class="code-box">
            <div class="code-label">Your Activation Code</div>
            <div class="code">${code}</div>
          </div>
          <div class="instructions">
            <strong>How to activate:</strong><br/>
            1. Go to your Prime Resume builder<br/>
            2. Click the <strong>⭐ Premium</strong> button in the top bar<br/>
            3. Enter your code and click <strong>Activate</strong><br/>
            4. Enjoy 40 days of Premium access!
          </div>
          <p style="color:#aaa;font-size:0.78rem;margin-top:1.5rem;line-height:1.6">
            Valid for <strong>40 days</strong>. Keep this email safe — your code is stored only on the end where you activate it.
          </p>
        </div>
        <div class="footer">
          <p>© Prime Resume. Built for privacy.</p>
          <p>If you did not make this purchase, reply to this email immediately.</p>
        </div>
      </div>
      </body></html>`
  });
}

// ============================================================
// AI HELPER — Groq primary, Gemini fallback
// ============================================================
async function callAI(prompt, maxTokens = 1000) {

  // ── GROQ (primary) ────────────────────────────────────────
  if (process.env.GROQ_API_KEY) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.4
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim()) {
          console.log(`✅ Groq success, chars: ${text.length}`);
          return text;
        }
      } else {
        const err = await response.text();
        console.error(`Groq HTTP ${response.status}:`, err.substring(0, 200));
      }
    } catch (err) {
      console.error('Groq error:', err.message);
    }
  }

  // ── GEMINI fallback ───────────────────────────────────────
  if (GEMINI_API_KEY) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens }
          })
        }
      );
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          console.log(`✅ Gemini fallback success, chars: ${text.length}`);
          return text;
        }
      } else {
        const err = await response.text();
        console.error(`Gemini HTTP ${response.status}:`, err.substring(0, 200));
      }
    } catch (err) {
      console.error('Gemini error:', err.message);
    }
  }

  throw new Error('AI service unavailable. Please try again in a moment.');
}

// Safe JSON parser — strips markdown code fences
function parseAIJSON(text) {
  if (!text || text.trim() === '') {
    throw new Error('Empty response from AI');
  }
  // Strip ```json ... ``` or ``` ... ``` fences
  let clean = text.trim();
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');
  clean = clean.trim();

  // Find the first { and last } to extract JSON object
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.error('No JSON object found in:', clean.substring(0, 200));
    throw new Error('AI response did not contain valid JSON');
  }
  clean = clean.substring(start, end + 1);

  return JSON.parse(clean);
}

// ============================================================
// ROUTES
// ============================================================

app.get('/', (req, res) => {
  res.json({ status: 'Prime Resume server is running', version: '2.0' });
});

// ── FLUTTERWAVE WEBHOOK ──────────────────────────────────────
app.post('/webhook/flutterwave', async (req, res) => {
  try {
    const hash = req.headers['verif-hash'];
    if (!hash || hash !== FLW_SECRET_HASH) {
      console.log('Invalid webhook hash — rejected');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = req.body;
    if (payload.event !== 'charge.completed') {
      return res.status(200).json({ message: 'Event ignored' });
    }

    const data = payload.data;
    if (data.status !== 'successful') {
      return res.status(200).json({ message: 'Payment not successful' });
    }
    if (data.amount < 3) {
      console.log(`Amount too low: ${data.amount}`);
      return res.status(200).json({ message: 'Amount mismatch' });
    }

    // Verify with Flutterwave directly
    const verifyResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${data.id}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, 'Content-Type': 'application/json' } }
    );
    const verifyData = await verifyResponse.json();
    if (verifyData.data.status !== 'successful') {
      console.log('Verification failed');
      return res.status(200).json({ message: 'Verification failed' });
    }

    const code = generateActivationCode();
    const customerEmail = data.customer.email;
    const customerName = data.customer.name || '';

    console.log(`Payment verified for ${customerEmail} — Code: ${code}`);
    await sendActivationEmail(customerEmail, customerName, code);
    console.log(`Activation email sent to ${customerEmail}`);

    res.status(200).json({ message: 'Success' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── AI: JOB MATCH ANALYZER ──────────────────────────────────
app.post('/ai/job-match', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }

  const { resume, jobDescription } = req.body;

  if (!resume || typeof resume !== 'string' || resume.trim().length < 10) {
    return res.status(400).json({ error: 'Missing or invalid resume text' });
  }
  if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length < 10) {
    return res.status(400).json({ error: 'Missing or invalid job description' });
  }

  try {
    const prompt = `You are an expert ATS resume coach. Analyze how well this resume matches the job description.

RESUME:
${resume.substring(0, 3000)}

JOB DESCRIPTION:
${jobDescription.substring(0, 2000)}

Respond ONLY with this exact JSON format, no other text:
{
  "score": <integer 0-100>,
  "verdict": "<one clear sentence about the match quality>",
  "matching": ["<keyword1>", "<keyword2>", "<keyword3>", "<keyword4>", "<keyword5>"],
  "missing": ["<keyword1>", "<keyword2>", "<keyword3>", "<keyword4>", "<keyword5>"],
  "suggestions": ["<actionable tip 1>", "<actionable tip 2>", "<actionable tip 3>"]
}`;

    const rawText = await callAI(prompt, 800);
    const parsed = parseAIJSON(rawText);

    // Validate and sanitise the response
    const result = {
      score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      verdict: String(parsed.verdict || 'Analysis complete.').substring(0, 200),
      matching: Array.isArray(parsed.matching) ? parsed.matching.slice(0, 10).map(String) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 10).map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5).map(String) : []
    };

    res.json(result);
  } catch (error) {
    console.error('Job match error:', error.message);
    if (error.message === 'RATE_LIMITED') {
      return res.status(429).json({ error: 'The AI is busy right now. Please wait 30 seconds and try again.' });
    }
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// ── AI: QUICK RESUME FROM TEXT ───────────────────────────────
app.post('/ai/quick-resume', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'Missing text' });
  }

  try {
    const prompt = `Extract resume information from this text and return ONLY JSON, no other text.

TEXT:
${text.substring(0, 3000)}

Return ONLY this JSON:
{
  "fullName": "",
  "jobTitle": "",
  "email": "",
  "phone": "",
  "city": "",
  "state": "",
  "summary": "",
  "skills": [],
  "experiences": [{"title": "", "company": "", "start": "", "end": "", "desc": ""}],
  "educations": [{"degree": "", "school": "", "start": "", "end": ""}]
}`;

    const rawText = await callAI(prompt, 1000);
    const parsed = parseAIJSON(rawText);
    res.json(parsed);
  } catch (error) {
    console.error('Quick resume error:', error.message);
    res.status(500).json({ error: 'Could not process text: ' + error.message });
  }
});

// ── AI: IMPROVE SUMMARY ──────────────────────────────────────
app.post('/ai/improve-summary', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }
  const { summary, jobTitle, skills } = req.body;
  if (!summary || typeof summary !== 'string' || summary.trim().length < 10) {
    return res.status(400).json({ error: 'Missing summary' });
  }
  try {
    const prompt = `You are an expert resume writer. Improve this professional summary to be more compelling and ATS-friendly.

CURRENT SUMMARY:
${summary}

CONTEXT:
Job Title: ${jobTitle || 'Not specified'}
Key Skills: ${skills || 'Not specified'}

RULES:
- Keep the person's authentic voice and specific details — do NOT genericise
- Remove clichés: "passionate", "results-driven", "team player", "dynamic", "go-getter", "detail-oriented", "hard worker"
- Start with the job title or a strong action/achievement statement
- Include specific numbers or impact if present in the original
- Make it ATS-friendly: use industry-standard terms naturally
- Keep it 2-4 sentences, 50-100 words
- Sound human, not like a bot wrote it
- Return ONLY the improved summary. No explanation. No quotes.`;

    const result = await callAI(prompt, 300);
    res.json({ improved: result.trim().replace(/^["']|["']$/g, '') });
  } catch (error) {
    console.error('Improve summary error:', error.message);
    res.status(500).json({ error: 'Could not improve summary: ' + error.message });
  }
});

// ── AI: IMPROVE ACHIEVEMENT ──────────────────────────────────
app.post('/ai/improve-achievement', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }

  const { achievement, jobTitle } = req.body;
  if (!achievement || typeof achievement !== 'string') {
    return res.status(400).json({ error: 'Missing achievement' });
  }

  try {
    const prompt = `Rewrite this resume bullet point to be more impactful. Start with a strong action verb. Add metrics if possible. Return ONLY the improved bullet point, nothing else.

Job title: ${jobTitle || 'Professional'}
Original: ${achievement}`;

    const result = await callAI(prompt, 200);
    res.json({ improved: result.trim().replace(/^["']|["']$/g, '') });
  } catch (error) {
    console.error('Improve achievement error:', error.message);
    res.status(500).json({ error: 'Could not improve: ' + error.message });
  }
});

// ── AI: COVER LETTER ─────────────────────────────────────────
app.post('/ai/cover-letter', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }
  const { prompt, maxTokens } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  try {
    const text = await callAI(prompt, maxTokens || 600);
    res.json({ text: text.trim() });
  } catch (error) {
    console.error('Cover letter error:', error.message);
    res.status(500).json({ error: 'Could not generate cover letter: ' + error.message });
  }
});

// ── AI: GENERATE SUMMARY ─────────────────────────────────────
app.post('/ai/generate-summary', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
  }

  const { name, jobTitle, skills, experience } = req.body;
  if (!jobTitle) return res.status(400).json({ error: 'Missing job title' });

  try {
    const prompt = `Write a 2-3 sentence professional resume summary. No first person. Start with the job title. Return ONLY the summary text.

Job Title: ${jobTitle}
Skills: ${Array.isArray(skills) ? skills.join(', ') : (skills || '')}
Experience context: ${experience || 'Not provided'}`;

    const result = await callAI(prompt, 300);
    res.json({ summary: result.trim() });
  } catch (error) {
    console.error('Generate summary error:', error.message);
    res.status(500).json({ error: 'Could not generate summary: ' + error.message });
  }
});

// ── PUBLIC TEST — diagnose Gemini connection ─────────────────
app.get('/ping-gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.json({ ok: false, reason: 'GEMINI_API_KEY not set in environment' });
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say the word OK and nothing else.' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      }
    );
    const status = response.status;
    const body = await response.text();
    res.json({ ok: response.ok, status, body: body.substring(0, 500) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});
app.get('/list-models', async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });
  const results = {};
  for (const api of ['v1', 'v1beta']) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/${api}/models?key=${GEMINI_API_KEY}`);
      const data = await r.json();
      if (data.error) { results[api] = { error: data.error.message }; continue; }
      results[api] = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name);
    } catch (err) {
      results[api] = { error: err.message };
    }
  }
  res.json(results);
});

// ── TEST ENDPOINT ─────────────────────────────────────────────
app.get('/test-gemini', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Disabled in production' });
  }
  try {
    const result = await callAI('Say hello in one word. Return only that word.');
    res.json({ success: true, response: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/generate-test-code', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Disabled in production' });
  }
  res.json({ code: generateActivationCode() });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`Prime Resume server running on port ${PORT}`);
  console.log(`Gemini API key configured: ${GEMINI_API_KEY ? 'YES' : 'NO — AI features will fail'}`);
});
