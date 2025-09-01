// backend/magicAuth.js
import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

/** pending codes: email -> { code, jti, expiresAt } (5 min TTL) */
const pending = new Map();

const make6 = () => String(Math.floor(100000 + Math.random() * 900000));
const now = () => Date.now();
const minutes = (n) => n * 60 * 1000;

function parseStaticMap() {
  try {
    const raw = process.env.STATIC_OTP_JSON || '{}';
    return JSON.parse(raw);
  } catch {
    console.warn('[magicAuth] Could not parse STATIC_OTP_JSON; using empty map.');
    return {};
  }
}

function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const port = Number(SMTP_PORT) || 587;
  const secure = String(port) === '465'; // 465 uses SSL

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[magicAuth] SMTP env missing; email sending will likely fail.');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // shared hosts sometimes have self-signed or odd TLS; don't block local dev
    tls: { rejectUnauthorized: false },
  });

  // Verify once at boot to surface configuration issues early
  transporter.verify((err, success) => {
    if (err) {
      console.warn('[magicAuth] SMTP verify failed:', err.message || err);
    } else {
      console.log('[magicAuth] SMTP ready:', success);
    }
  });

  return transporter;
}

export function magicAuthRouter({ jwtSecret, frontendOrigin, backendBaseUrl }) {
  if (!jwtSecret) throw new Error('JWT_SECRET is required');
  if (!frontendOrigin) throw new Error('FRONTEND_ORIGIN missing');
  if (!backendBaseUrl) throw new Error('BACKEND_URL missing');

  const router = express.Router();
  const transporter = buildTransport();
  const staticMap = parseStaticMap();
  const bypassEmail = String(process.env.DEV_BYPASS_EMAIL || '').toLowerCase() === 'true';
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;

  // --- send magic link + 6-digit code ---
  router.post('/send', async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      // 5-min JWT for the magic link
      const jti = crypto.randomUUID();
      const token = jwt.sign({ sub: email, jti, typ: 'magic' }, jwtSecret, { expiresIn: '5m' });

      // Code: predefined if available, otherwise random
      const code = staticMap[email] || make6();
      pending.set(email, { code, jti, expiresAt: now() + minutes(5) });

      const magicUrl = `${backendBaseUrl.replace(/\/$/, '')}/auth/magic?token=${encodeURIComponent(token)}`;

      const textBody =
        `Click to sign in (valid for 5 minutes):\n` +
        `${magicUrl}\n\n` +
        `Or enter this code: ${code}\n`;
      const htmlBody = `
        <div style="font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
          <h2>Your iShip login link</h2>
          <p>Click to sign in (valid for 5 minutes):</p>
          <p><a href="${magicUrl}" target="_blank">${magicUrl}</a></p>
          <p>Or enter this code: <strong style="font-size:18px">${code}</strong></p>
          <p style="color:#666">If you didn’t request this, you can ignore the email.</p>
        </div>
      `;

      // Always log for debugging/dev
      console.log('[magicAuth] Magic URL:', magicUrl);
      console.log('[magicAuth] Code for', email, '=>', code);

      // In dev or when you want to force predefined OTP, skip sending
      if (bypassEmail) {
        return res.json({ ok: true, dev: true });
      }

      await transporter.sendMail({
        from: fromEmail,
        to: email,
        subject: 'Your iShip login link',
        text: textBody,
        html: htmlBody,
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error('auth/send failed:', e);
      return res.status(500).json({ error: 'Failed to send login email' });
    }
  });

  // --- verify by visiting the magic link ---
  router.get('/magic', (req, res) => {
    const { token } = req.query || {};
    if (!token) return res.status(400).send('Missing token');

    try {
      const payload = jwt.verify(String(token), jwtSecret);
      const email = payload.sub;

      const rec = pending.get(email);
      if (!rec || rec.expiresAt < now() || rec.jti !== payload.jti) {
        return res.status(400).send('Invalid or expired token');
      }
      pending.delete(email);

      const session = jwt.sign({ sub: email, typ: 'session' }, jwtSecret, { expiresIn: '24h' });
      res.cookie('iship_session', session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // set true behind HTTPS
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.redirect(frontendOrigin);
    } catch (e) {
      console.error('auth/magic fail:', e);
      return res.status(400).send('Invalid or expired token');
    }
  });

  // --- verify by 6-digit code OR pasted token ---
  router.post('/verify', (req, res) => {
    const { email, code, token } = req.body || {};
    try {
      let authedEmail = null;

      if (token) {
        const payload = jwt.verify(String(token), jwtSecret);
        authedEmail = payload.sub;
        const rec = pending.get(authedEmail);
        if (!rec || rec.expiresAt < now() || rec.jti !== payload.jti) {
          return res.status(400).json({ error: 'Invalid or expired token' });
        }
        pending.delete(authedEmail);
      } else {
        if (!email || !code) {
          return res.status(400).json({ error: 'Email and code required' });
        }
        const rec = pending.get(email);
        if (!rec || rec.expiresAt < now() || rec.code !== String(code)) {
          return res.status(400).json({ error: 'Invalid or expired code' });
        }
        pending.delete(email);
        authedEmail = email;
      }

      const session = jwt.sign({ sub: authedEmail, typ: 'session' }, jwtSecret, { expiresIn: '24h' });
      res.cookie('iship_session', session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // true on HTTPS
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error('auth/verify fail:', e);
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie('iship_session', { httpOnly: true, sameSite: 'lax', secure: false });
    return res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    try {
      const raw = req.cookies?.iship_session;
      if (!raw) return res.json({ ok: false });
      const payload = jwt.verify(String(raw), jwtSecret);
      return res.json({ ok: true, user: payload.sub, exp: payload.exp });
    } catch {
      return res.json({ ok: false });
    }
  });

  return router;
}

export function requireSession(jwtSecret) {
  return (req, res, next) => {
    try {
      const raw = req.cookies?.iship_session;
      if (!raw) return res.status(401).json({ error: 'Not signed in' });
      const payload = jwt.verify(String(raw), jwtSecret);
      req.user = { email: payload.sub };
      next();
    } catch {
      return res.status(401).json({ error: 'Not signed in' });
    }
  };
}