const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { asyncHandler } = require('../utils/http');
const { pageQuery } = require('../utils/validate');
const { parseRange } = require('../utils/dates');
const { mapTxn } = require('../services/stats');
const { analyzeTransactions, BATCH_CAP } = require('../services/analysis');

const analyzeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many analysis requests. Wait a few minutes and try again.' }),
});

const router = express.Router();

const SORTS = {
  date: 't.txn_at',
  amount: 't.amount',
  merchant: 't.merchant',
  bank: 't.bank',
  category: 't.category_slug',
};

function like(value) {
  return `%${String(value).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function filters(userId, query) {
  const where = ['t.user_id = ?'];
  const params = [userId];
  if (query.from || query.to) {
    const range = parseRange(query.from, query.to);
    where.push('t.txn_at >= ? AND t.txn_at <= ?');
    params.push(range.fromSql, range.toSql);
  }
  if (query.bank) {
    where.push('t.bank = ?');
    params.push(String(query.bank).slice(0, 80));
  }
  if (query.category) {
    where.push('t.category_slug = ?');
    params.push(String(query.category).slice(0, 40));
  }
  if (query.type && ['debit', 'credit', 'info'].includes(query.type)) {
    where.push('t.txn_type = ?');
    params.push(query.type);
  }
  if (query.search) {
    const term = like(String(query.search).slice(0, 80));
    where.push("(t.merchant LIKE ? ESCAPE '\\\\' OR t.bank LIKE ? ESCAPE '\\\\' OR m.body LIKE ? ESCAPE '\\\\')");
    params.push(term, term, term);
  }
  return { where: where.join(' AND '), params };
}

function orderBy(query) {
  const column = SORTS[query.sort] || 't.txn_at';
  const direction = query.order === 'asc' ? 'ASC' : 'DESC';
  return `${column} IS NULL, ${column} ${direction}, t.id DESC`;
}

const SELECT = `SELECT t.id, t.txn_type, t.category_slug, c.label AS category_label, t.amount, t.currency,
  t.merchant, t.bank, t.account_last4, t.balance, t.txn_at, t.manual_override,
  m.sender, m.body, i.filename,
  r.id AS review_id, r.source AS review_source, r.summary AS review_summary,
  r.category_suggestion AS review_category, r.merchant AS review_merchant,
  r.recurring AS review_recurring, r.notes AS review_notes, r.confidence AS review_confidence,
  r.created_at AS review_created_at
  FROM transactions t
  JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id
  JOIN imports i ON i.id = m.import_id
  LEFT JOIN categories c ON c.slug = t.category_slug
  LEFT JOIN llm_reviews r ON r.transaction_id = t.id AND r.user_id = t.user_id`;

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageQuery(req.query);
  const { where, params } = filters(req.user.id, req.query);
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM transactions t JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id WHERE ${where}`,
    params,
  );
  const [rows] = await pool.query(
    `${SELECT} WHERE ${where} ORDER BY ${orderBy(req.query)} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  res.json({
    items: rows.map(mapTxn),
    total: Number(countRow.total) || 0,
    page,
    pageSize,
  });
}));

router.get('/export', asyncHandler(async (req, res) => {
  const { where, params } = filters(req.user.id, req.query);
  const [rows] = await pool.query(
    `${SELECT} WHERE ${where} ORDER BY ${orderBy(req.query)} LIMIT 10000`,
    params,
  );
  const header = ['date', 'type', 'category', 'amount', 'currency', 'merchant', 'bank', 'account', 'balance', 'sender', 'body'];
  const lines = [header.join(',')];
  rows.forEach((row) => {
    const txn = mapTxn(row);
    lines.push([
      txn.txnAt, txn.txnType, txn.category, txn.amount, txn.currency, txn.merchant,
      txn.bank, txn.accountLast4, txn.balance, txn.sender, txn.body,
    ].map(csvCell).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ledgersms-transactions.csv"');
  res.send(`\uFEFF${lines.join('\n')}`);
}));

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => id > 0))];
}

router.post('/analyze', analyzeLimit, asyncHandler(async (req, res) => {
  const ids = cleanIds(req.body && req.body.ids);
  if (!ids.length) return res.status(400).json({ error: 'Select at least one transaction' });
  if (ids.length > BATCH_CAP) return res.status(400).json({ error: `Analyze up to ${BATCH_CAP} transactions at a time` });
  res.json(await analyzeTransactions(req.user.id, ids));
}));

router.post('/analyze-filtered', analyzeLimit, asyncHandler(async (req, res) => {
  const { where, params } = filters(req.user.id, req.body || {});
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM transactions t JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id WHERE ${where}`,
    params,
  );
  const [rows] = await pool.query(
    `SELECT t.id FROM transactions t
     JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id
     WHERE ${where}
     ORDER BY t.txn_at DESC, t.id DESC
     LIMIT ?`,
    [...params, BATCH_CAP],
  );
  const result = await analyzeTransactions(req.user.id, rows.map((row) => row.id));
  res.json({ ...result, matched: Number(countRow.total) || 0 });
}));

router.post('/:id/analyze', analyzeLimit, asyncHandler(async (req, res) => {
  const result = await analyzeTransactions(req.user.id, [req.params.id]);
  if (!result.analyzed) return res.status(404).json({ error: 'Transaction not found' });
  const [rows] = await pool.query(`${SELECT} WHERE t.id = ? AND t.user_id = ?`, [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Transaction not found' });
  res.json({
    ...mapTxn(rows[0]),
    notice: result.notice,
    noticeTitle: result.noticeTitle,
    llmConfigured: result.llmConfigured,
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`${SELECT} WHERE t.id = ? AND t.user_id = ?`, [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Transaction not found' });
  return res.json(mapTxn(rows[0]));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const slug = String((req.body && req.body.category) || '').slice(0, 40);
  const [cats] = await pool.query('SELECT id, label FROM categories WHERE slug = ?', [slug]);
  if (!cats.length) return res.status(400).json({ error: 'Choose a known category' });
  const [result] = await pool.query(
    `UPDATE transactions SET category_slug = ?, category_id = ?, manual_override = 1 WHERE id = ? AND user_id = ?`,
    [slug, cats[0].id, req.params.id, req.user.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Transaction not found' });
  const [rows] = await pool.query(`${SELECT} WHERE t.id = ? AND t.user_id = ?`, [req.params.id, req.user.id]);
  return res.json(mapTxn(rows[0]));
}));

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

module.exports = router;
