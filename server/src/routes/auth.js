const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { asyncHandler } = require('../utils/http');
const { cleanEmail, validEmail, cleanName, validName, validPassword } = require('../utils/validate');
const { requireAuth, signToken } = require('../middleware/auth');
const { llmStatus } = require('../services/llm');

const router = express.Router();
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' }),
});

let dummyHashPromise;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('ledger-sms-dummy-password', 10);
  return dummyHashPromise;
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

router.post('/signup', authLimit, asyncHandler(async (req, res) => {
  const name = cleanName(req.body && req.body.name);
  const email = cleanEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!validName(name)) return res.status(400).json({ error: 'Enter your name (at least 2 characters)' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Use 8–72 characters with at least one letter and one number' });
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: 'An account with that email already exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, passwordHash],
  );
  const user = { id: result.insertId, name, email };
  return res.status(201).json({ token: signToken(user), user, llmConfigured: llmStatus().configured });
}));

router.post('/login', authLimit, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');
  if (!validEmail(email) || !password) {
    return res.status(400).json({ error: 'Enter your email and password' });
  }
  const [rows] = await pool.query(
    'SELECT id, name, email, password_hash, created_at FROM users WHERE email = ?',
    [email],
  );
  const user = rows[0];
  const hash = user ? user.password_hash : await dummyHash();
  const match = await bcrypt.compare(password, hash);
  if (!user || !match) return res.status(401).json({ error: 'Email or password is incorrect' });
  return res.json({
    token: signToken(user),
    user: publicUser(user),
    llmConfigured: llmStatus().configured,
  });
}));

router.post('/logout', (req, res) => res.status(204).end());

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE id = ?',
    [req.user.id],
  );
  if (!rows.length) return res.status(401).json({ error: 'Session expired. Sign in again.' });
  const status = llmStatus();
  return res.json({ user: publicUser(rows[0]), llmConfigured: status.configured, llm: status });
}));

router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const name = cleanName(req.body && req.body.name);
  const email = cleanEmail(req.body && req.body.email);
  if (!validName(name)) return res.status(400).json({ error: 'Enter your name (at least 2 characters)' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const [dupes] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ?', [email, req.user.id]);
  if (dupes.length) return res.status(409).json({ error: 'That email is already in use' });
  await pool.query('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, req.user.id]);
  const user = { id: req.user.id, name, email };
  return res.json({ user, token: signToken(user) });
}));

router.put('/password', requireAuth, authLimit, asyncHandler(async (req, res) => {
  const currentPassword = String((req.body && req.body.currentPassword) || '');
  const nextPassword = String((req.body && req.body.newPassword) || '');
  if (!validPassword(nextPassword)) {
    return res.status(400).json({ error: 'Use 8–72 characters with at least one letter and one number' });
  }
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!rows.length) return res.status(401).json({ error: 'Session expired. Sign in again.' });
  const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
  if (currentPassword === nextPassword) return res.status(400).json({ error: 'Choose a different password' });
  const passwordHash = await bcrypt.hash(nextPassword, 10);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);
  return res.json({ ok: true });
}));

module.exports = router;
