const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { asyncHandler } = require('../utils/http');
const { pageQuery } = require('../utils/validate');
const { parseNum } = require('../services/parser');
const { applyReview } = require('../services/ledger');
const { iso } = require('../utils/dates');
const { suggestMessages, BATCH_CAP, mapSuggestion } = require('../services/analysis');

const suggestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many suggestion requests. Wait a few minutes and try again.' }),
});

const router = express.Router();
const TYPES = new Set(['debit', 'credit', 'info']);

const QUEUE = `(
  m.parse_status = 'failed'
  OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.message_id = m.id AND t.user_id = m.user_id
      AND t.manual_override = 0 AND t.category_slug = 'other'
      AND t.txn_type IN ('debit', 'credit')
  )
)`;

function mapQueue(row) {
  return {
    id: row.id,
    sender: row.sender,
    body: row.body,
    receivedAt: iso(row.received_at),
    createdAt: iso(row.created_at),
    manual: Boolean(row.manual_override),
    suggestion: row.suggestion_id ? mapSuggestion({
      suggestion_id: row.suggestion_id,
      suggestion_source: row.suggestion_source,
      suggestion_model: row.suggestion_model,
      suggestion_type: row.suggestion_type,
      suggestion_category: row.suggestion_category,
      suggestion_merchant: row.suggestion_merchant,
      suggestion_amount: row.suggestion_amount,
      suggestion_confidence: row.suggestion_confidence,
      suggestion_reason: row.suggestion_reason,
      suggestion_created_at: row.suggestion_created_at,
    }) : null,
  };
}

router.post('/suggest', suggestLimit, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const clean = [...new Set(ids.map(Number).filter((id) => id > 0))];
  if (!clean.length) return res.status(400).json({ error: 'Choose at least one message' });
  if (clean.length > BATCH_CAP) return res.status(400).json({ error: `Suggest up to ${BATCH_CAP} messages at a time` });
  res.json(await suggestMessages(req.user.id, clean));
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageQuery(req.query, 8);
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM messages m WHERE m.user_id = ? AND ${QUEUE}`,
    [req.user.id],
  );
  const [rows] = await pool.query(
    `SELECT m.id, m.sender, m.body, m.received_at, m.created_at, t.manual_override,
            s.id AS suggestion_id, s.source AS suggestion_source, s.model AS suggestion_model,
            s.txn_type AS suggestion_type, s.category_slug AS suggestion_category,
            s.merchant AS suggestion_merchant, s.amount AS suggestion_amount,
            s.confidence AS suggestion_confidence, s.reason AS suggestion_reason,
            s.created_at AS suggestion_created_at
     FROM messages m
     LEFT JOIN transactions t ON t.id = (
       SELECT t2.id FROM transactions t2
       WHERE t2.message_id = m.id AND t2.user_id = m.user_id
       ORDER BY t2.id DESC
       LIMIT 1
     )
     LEFT JOIN llm_suggestions s ON s.message_id = m.id AND s.user_id = m.user_id
     WHERE m.user_id = ? AND ${QUEUE}
     ORDER BY m.received_at IS NULL, m.received_at DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, pageSize, offset],
  );
  res.json({
    items: rows.map(mapQueue),
    total: Number(countRow.total) || 0,
    page,
    pageSize,
  });
}));

router.post('/:id/suggest', suggestLimit, asyncHandler(async (req, res) => {
  const result = await suggestMessages(req.user.id, [req.params.id]);
  if (!result.analyzed) return res.status(404).json({ error: 'Message not found' });
  res.json(result.items[0]);
}));

router.post('/:id/accept', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.txn_type, s.category_slug, s.merchant, s.amount, t.id AS txn_id, t.manual_override,
            t.bank, t.account_last4, t.balance, t.txn_at
     FROM llm_suggestions s
     LEFT JOIN transactions t ON t.message_id = s.message_id AND t.user_id = s.user_id
     WHERE s.user_id = ? AND s.message_id = ?`,
    [req.user.id, req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'No suggestion to accept yet' });
  const row = rows[0];
  if (row.manual_override) return res.status(409).json({ error: 'This classification was set by you' });
  if ((row.txn_type === 'debit' || row.txn_type === 'credit') && row.amount == null) {
    return res.status(400).json({ error: 'The suggestion has no amount. Enter one before filing it.' });
  }
  const saved = await applyReview(req.user.id, req.params.id, {
    txnType: row.txn_type,
    category: row.category_slug,
    amount: row.amount,
    merchant: row.merchant,
    bank: row.bank,
    accountLast4: row.account_last4,
    balance: row.balance,
    txnAt: row.txn_at,
  });
  res.json(saved);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const txnType = String(body.txnType || '');
  const category = String(body.category || '').slice(0, 40);
  if (!TYPES.has(txnType)) return res.status(400).json({ error: 'Choose debit, credit, or info' });
  if (!category) return res.status(400).json({ error: 'Choose a category' });
  const amount = body.amount === '' || body.amount == null ? null : parseNum(body.amount);
  if ((txnType === 'debit' || txnType === 'credit') && amount == null) {
    return res.status(400).json({ error: 'Amount is required to classify a payment' });
  }
  const balance = body.balance === '' || body.balance == null ? null : parseNum(body.balance);
  const accountLast4 = body.accountLast4 ? String(body.accountLast4).replace(/\D/g, '').slice(-4) : null;
  const bank = body.bank ? String(body.bank).trim().slice(0, 80) : null;
  const merchant = body.merchant ? String(body.merchant).trim().slice(0, 160) : null;
  const txnAt = body.txnAt ? new Date(body.txnAt) : null;
  if (txnAt && Number.isNaN(txnAt.getTime())) return res.status(400).json({ error: 'Enter a valid date' });
  const result = await applyReview(req.user.id, req.params.id, {
    txnType,
    category,
    amount,
    balance,
    accountLast4: accountLast4 || null,
    bank: bank || null,
    merchant,
    txnAt,
  });
  res.json(result);
}));

module.exports = router;
