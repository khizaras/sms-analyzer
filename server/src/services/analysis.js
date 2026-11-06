const pool = require('../db');
const { llmStatus, complete, parseModelJson, describeFailure, explainLocal } = require('./llm');
const { parseSms } = require('./parser');
const { iso } = require('../utils/dates');

const BATCH_CAP = 25;
const TYPES = new Set(['debit', 'credit', 'info']);

function clampConfidence(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

async function allowedCategories() {
  const [rows] = await pool.query('SELECT slug, label FROM categories ORDER BY label');
  const slugs = new Set(rows.map((row) => row.slug));
  if (!slugs.size) {
    ['food', 'travel', 'shopping', 'utilities', 'salary', 'transfer', 'atm', 'emi', 'investment', 'otp', 'promo', 'other']
      .forEach((slug) => slugs.add(slug));
  }
  return { rows, slugs };
}

function mapReview(row) {
  if (!row || !row.review_id && !row.id) return null;
  const id = row.review_id || row.id;
  return {
    id,
    source: row.review_source || row.source,
    model: row.review_model || row.model || null,
    summary: row.review_summary || row.summary,
    category: row.review_category || row.category_suggestion || null,
    merchant: row.review_merchant != null ? row.review_merchant : row.merchant,
    recurring: Boolean(row.review_recurring != null ? row.review_recurring : row.recurring),
    notes: row.review_notes != null ? row.review_notes : row.notes,
    confidence: row.review_confidence != null ? Number(row.review_confidence) : (row.confidence != null ? Number(row.confidence) : null),
    createdAt: iso(row.review_created_at || row.created_at),
  };
}

function mapSuggestion(row) {
  if (!row || row.suggestion_id == null && row.category_slug == null) return null;
  if (row.suggestion_id == null && row.reason == null) return null;
  return {
    id: row.suggestion_id || row.id,
    source: row.suggestion_source || row.source,
    model: row.suggestion_model || row.model || null,
    txnType: row.suggestion_type || row.txn_type,
    category: row.suggestion_category || row.category_slug,
    merchant: row.suggestion_merchant != null ? row.suggestion_merchant : row.merchant,
    amount: row.suggestion_amount != null ? Number(row.suggestion_amount) : (row.amount != null ? Number(row.amount) : null),
    confidence: row.suggestion_confidence != null ? Number(row.suggestion_confidence) : (row.confidence != null ? Number(row.confidence) : null),
    reason: row.suggestion_reason || row.reason,
    createdAt: iso(row.suggestion_created_at || row.created_at),
  };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    id: raw.id,
    summary: raw.summary || raw.narrative || raw.text || raw.explanation || null,
    category: raw.category || raw.category_suggestion || raw.categorySlug || null,
    merchant: raw.merchant || raw.counterparty || null,
    recurring: raw.recurring != null ? raw.recurring : raw.is_recurring,
    notes: raw.notes || raw.reason || null,
    confidence: raw.confidence,
    txnType: raw.txnType || raw.txn_type || raw.type || null,
    amount: raw.amount,
    reason: raw.reason || raw.notes || raw.summary || null,
  };
}

function structuredItems(parsed, rows) {
  if (!parsed || typeof parsed !== 'object') return null;
  const list = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed.items) ? parsed.items
      : Array.isArray(parsed.results) ? parsed.results
        : Array.isArray(parsed.data) ? parsed.data
          : null;
  if (list) return list.map(normalizeItem).filter(Boolean);
  const one = normalizeItem(parsed);
  if (!one) return null;
  if (one.id == null && rows.length === 1) one.id = rows[0].id;
  if (one.id == null) return null;
  if (one.summary || one.category || one.txnType || one.reason || one.merchant) return [one];
  return null;
}

function indexItems(items, rows) {
  const byId = new Map();
  items.forEach((item) => {
    if (item && item.id != null) byId.set(Number(item.id), item);
  });
  if (!byId.size && rows.length === 1 && items[0]) byId.set(rows[0].id, items[0]);
  return byId;
}

const PLAIN_TEXT = {
  noticeTitle: 'Plain-text reply',
  notice: 'The model replied in plain text. That text is kept, and missing fields were filled locally.',
};

async function readModelFields(messages, maxTokens, rows) {
  const text = await complete(messages, maxTokens);
  try {
    const items = structuredItems(parseModelJson(text), rows);
    if (items && items.length) return { text, byId: indexItems(items, rows), plain: false };
  } catch (error) {
    console.error(`llm parse status=- name=${error.name || 'SyntaxError'} body=yes`);
  }
  return { text, byId: new Map(), plain: true };
}

function packet(row) {
  return {
    id: row.id,
    type: row.txn_type,
    category: row.category_slug,
    amount: row.amount,
    merchant: row.merchant,
    bank: row.bank,
    accountLast4: row.account_last4,
    at: row.txn_at,
    sms: String(row.body || '').slice(0, 500),
  };
}

function heuristicReview(row) {
  const text = `${row.merchant || ''} ${row.body || ''}`;
  const recurring = row.category_slug === 'emi' || /subscription|monthly|netflix|spotify|prime|hotstar|youtube|emi|sip/i.test(text);
  const view = {
    txnAt: row.txn_at,
    amount: row.amount,
    merchant: row.merchant,
    txnType: row.txn_type,
    bank: row.bank,
    accountLast4: row.account_last4,
    balance: row.balance,
    category: row.category_slug,
    categoryLabel: row.category_label,
  };
  return {
    summary: explainLocal(view).slice(0, 500),
    category: row.category_slug || 'other',
    merchant: row.merchant || null,
    recurring,
    notes: recurring ? 'The wording looks like a repeating charge.' : 'Local reading of this SMS.',
    confidence: 0.35,
  };
}

function sanitizeReview(raw, row, slugs) {
  const fallback = heuristicReview(row);
  const category = slugs.has(raw && raw.category) ? raw.category : fallback.category;
  return {
    summary: String((raw && raw.summary) || fallback.summary).slice(0, 500),
    category,
    merchant: raw && raw.merchant ? String(raw.merchant).slice(0, 160) : fallback.merchant,
    recurring: Boolean(raw && raw.recurring),
    notes: String((raw && raw.notes) || '').slice(0, 800),
    confidence: clampConfidence(raw && raw.confidence, 0.5),
  };
}

async function loadTransactions(userId, ids) {
  if (!ids.length) return [];
  const [rows] = await pool.query(
    `SELECT t.id, t.txn_type, t.category_slug, c.label AS category_label, t.amount, t.merchant,
            t.bank, t.account_last4, t.balance, t.txn_at, m.body, m.sender
     FROM transactions t
     JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id
     LEFT JOIN categories c ON c.slug = t.category_slug
     WHERE t.user_id = ? AND t.id IN (?)`,
    [userId, ids],
  );
  return rows;
}

async function saveReview(userId, transactionId, source, model, review) {
  await pool.query(
    `INSERT INTO llm_reviews
      (user_id, transaction_id, source, model, summary, category_suggestion, merchant, recurring, notes, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source = VALUES(source), model = VALUES(model), summary = VALUES(summary),
       category_suggestion = VALUES(category_suggestion), merchant = VALUES(merchant),
       recurring = VALUES(recurring), notes = VALUES(notes), confidence = VALUES(confidence),
       created_at = CURRENT_TIMESTAMP`,
    [
      userId, transactionId, source, model, review.summary, review.category, review.merchant,
      review.recurring ? 1 : 0, review.notes, review.confidence,
    ],
  );
  const [rows] = await pool.query(
    `SELECT id, source, model, summary, category_suggestion, merchant, recurring, notes, confidence, created_at
     FROM llm_reviews WHERE user_id = ? AND transaction_id = ?`,
    [userId, transactionId],
  );
  return mapReview(rows[0]);
}

async function analyzeTransactions(userId, ids) {
  const unique = [...new Set(ids.map(Number).filter((id) => id > 0))].slice(0, BATCH_CAP);
  const status = llmStatus();
  const rows = await loadTransactions(userId, unique);
  const { slugs } = await allowedCategories();
  let byId = new Map();
  let model = null;
  let notice = status.configured ? null : 'LLM not configured';
  let noticeTitle = status.configured ? null : 'LLM not configured';
  let plain = false;

  if (status.configured && rows.length) {
    try {
      const read = await readModelFields([
        {
          role: 'system',
          content: `Review bank SMS transactions. Reply with JSON only: {"items":[{"id":number,"summary":string,"category":string,"merchant":string,"recurring":boolean,"notes":string,"confidence":number}]}. category must be one of ${[...slugs].join(', ')}. One item per input id. Do not invent amounts. confidence is between 0 and 1.`,
        },
        { role: 'user', content: JSON.stringify(rows.map(packet)) },
      ], 1400, rows);
      byId = read.byId;
      plain = read.plain;
      model = status.model;
      if (plain) {
        rows.forEach((row) => byId.set(row.id, { id: row.id, summary: read.text, notes: read.text }));
        notice = PLAIN_TEXT.notice;
        noticeTitle = PLAIN_TEXT.noticeTitle;
      }
    } catch (error) {
      const described = describeFailure(error, 'reading');
      notice = described.notice;
      noticeTitle = described.noticeTitle;
      model = null;
    }
  }

  const items = [];
  for (const row of rows) {
    const raw = byId.get(row.id);
    const review = raw ? sanitizeReview(raw, row, slugs) : heuristicReview(row);
    const saved = await saveReview(userId, row.id, raw ? 'llm' : 'heuristic', raw ? model : null, review);
    items.push({ transactionId: row.id, review: saved });
  }
  return {
    cap: BATCH_CAP,
    requested: unique.length,
    analyzed: items.length,
    skipped: unique.length - items.length,
    llmConfigured: status.configured,
    notice,
    noticeTitle,
    items,
  };
}

function heuristicSuggestion(row, slugs) {
  const parsed = parseSms({ sender: row.sender, body: row.body, receivedAt: row.received_at });
  const category = slugs.has(parsed.category) ? parsed.category : 'other';
  const txnType = TYPES.has(parsed.txnType) ? parsed.txnType : 'info';
  return {
    txnType: parsed.ok ? txnType : 'info',
    category: parsed.ok ? category : 'other',
    merchant: parsed.merchant,
    amount: parsed.amount,
    confidence: parsed.ok ? 0.45 : 0.2,
    reason: parsed.ok
      ? 'Rules already see a direction in this SMS. Confirm before filing it.'
      : 'Rules could not classify this SMS. A person should confirm the fields.',
  };
}

function sanitizeSuggestion(raw, row, slugs) {
  const fallback = heuristicSuggestion(row, slugs);
  const txnType = TYPES.has(raw && raw.txnType) ? raw.txnType : fallback.txnType;
  const category = slugs.has(raw && raw.category) ? raw.category : fallback.category;
  const amount = raw && raw.amount != null && Number.isFinite(Number(raw.amount)) ? Math.round(Number(raw.amount) * 100) / 100 : fallback.amount;
  return {
    txnType,
    category,
    merchant: raw && raw.merchant ? String(raw.merchant).slice(0, 160) : fallback.merchant,
    amount: amount != null && amount >= 0 && amount < 1e12 ? amount : null,
    confidence: clampConfidence(raw && raw.confidence, fallback.confidence),
    reason: String((raw && raw.reason) || fallback.reason).slice(0, 500),
  };
}

async function loadMessages(userId, ids) {
  if (!ids.length) return [];
  const [rows] = await pool.query(
    `SELECT m.id, m.sender, m.body, m.received_at, t.manual_override
     FROM messages m
     LEFT JOIN transactions t ON t.message_id = m.id AND t.user_id = m.user_id
     WHERE m.user_id = ? AND m.id IN (?)`,
    [userId, ids],
  );
  return rows;
}

async function saveSuggestion(userId, messageId, source, model, suggestion) {
  await pool.query(
    `INSERT INTO llm_suggestions
      (user_id, message_id, source, model, txn_type, category_slug, merchant, amount, confidence, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source = VALUES(source), model = VALUES(model), txn_type = VALUES(txn_type),
       category_slug = VALUES(category_slug), merchant = VALUES(merchant), amount = VALUES(amount),
       confidence = VALUES(confidence), reason = VALUES(reason), created_at = CURRENT_TIMESTAMP`,
    [
      userId, messageId, source, model, suggestion.txnType, suggestion.category,
      suggestion.merchant, suggestion.amount, suggestion.confidence, suggestion.reason,
    ],
  );
  const [rows] = await pool.query(
    `SELECT id, source, model, txn_type, category_slug, merchant, amount, confidence, reason, created_at
     FROM llm_suggestions WHERE user_id = ? AND message_id = ?`,
    [userId, messageId],
  );
  return mapSuggestion(rows[0]);
}

async function suggestMessages(userId, ids) {
  const unique = [...new Set(ids.map(Number).filter((id) => id > 0))].slice(0, BATCH_CAP);
  const status = llmStatus();
  const rows = await loadMessages(userId, unique);
  const { slugs } = await allowedCategories();
  let byId = new Map();
  let notice = status.configured ? null : 'LLM not configured';
  let noticeTitle = status.configured ? null : 'LLM not configured';
  let model = null;

  if (status.configured && rows.length) {
    try {
      const read = await readModelFields([
        {
          role: 'system',
          content: `Classify bank SMS that a rules parser left open. Reply with JSON only: {"items":[{"id":number,"txnType":"debit|credit|info","category":string,"merchant":string|null,"amount":number|null,"confidence":number,"reason":string}]}. category must be one of ${[...slugs].join(', ')}. Copy amount only when the SMS states one. Do not invent payments.`,
        },
        {
          role: 'user',
          content: JSON.stringify(rows.map((row) => ({
            id: row.id,
            sender: row.sender,
            sms: String(row.body || '').slice(0, 500),
          }))),
        },
      ], 1400, rows);
      byId = read.byId;
      model = status.model;
      if (read.plain) {
        rows.forEach((row) => byId.set(row.id, { id: row.id, reason: read.text }));
        notice = PLAIN_TEXT.notice;
        noticeTitle = PLAIN_TEXT.noticeTitle;
      }
    } catch (error) {
      const described = describeFailure(error, 'suggestion');
      notice = described.notice;
      noticeTitle = described.noticeTitle;
      model = null;
    }
  }

  const items = [];
  for (const row of rows) {
    const raw = byId.get(row.id);
    const suggestion = raw ? sanitizeSuggestion(raw, row, slugs) : heuristicSuggestion(row, slugs);
    const saved = await saveSuggestion(userId, row.id, raw ? 'llm' : 'heuristic', raw ? model : null, suggestion);
    items.push({ messageId: row.id, suggestion: saved, locked: Boolean(row.manual_override) });
  }
  return {
    cap: BATCH_CAP,
    requested: unique.length,
    analyzed: items.length,
    skipped: unique.length - items.length,
    llmConfigured: status.configured,
    notice,
    noticeTitle,
    items,
  };
}

module.exports = {
  BATCH_CAP,
  mapReview,
  mapSuggestion,
  analyzeTransactions,
  suggestMessages,
};
