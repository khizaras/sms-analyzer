const pool = require('../db');
const config = require('../config');
const { getOverview } = require('./stats');
const { dateOnly, iso } = require('../utils/dates');
const { inr } = require('../utils/money');

function llmStatus() {
  let host = null;
  try {
    host = new URL(config.llm.baseUrl).host;
  } catch {
    host = null;
  }
  return {
    configured: Boolean(config.llm.apiKey),
    model: config.llm.model,
    host,
  };
}

function heuristicSummary(overview) {
  const { kpis, categories, merchants } = overview;
  const top = categories[0];
  const merchant = merchants[0];
  const paragraphs = [];
  paragraphs.push(`Across this period the ledger shows ${inr(kpis.spend)} leaving your accounts and ${inr(kpis.inflow)} coming in. Net cashflow is ${inr(kpis.net)} across ${kpis.transactions} classified movements.`);
  if (top) {
    const share = kpis.spend ? Math.round((top.amount / kpis.spend) * 100) : 0;
    paragraphs.push(`${top.label} leads spending at ${inr(top.amount)}${share ? `, about ${share}% of classified outflow` : ''}.`);
  } else {
    paragraphs.push('No classified spending landed in this window.');
  }
  if (merchant) {
    paragraphs.push(`${merchant.merchant} is the largest merchant, with ${merchant.count} debit${merchant.count === 1 ? '' : 's'} totalling ${inr(merchant.amount)}.`);
  }
  if (kpis.unparsed) {
    paragraphs.push(`${kpis.unparsed} message${kpis.unparsed === 1 ? '' : 's'} still wait in the review queue. Classifying them will tighten these totals.`);
  }
  paragraphs.push('Balances above are the latest figures printed in SMS, summed across accounts that reported one.');
  return paragraphs.join('\n\n');
}

function explainLocal(txn) {
  const when = txn.txnAt ? new Date(txn.txnAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'an unknown date';
  const amount = txn.amount != null ? inr(txn.amount) : 'an unstated amount';
  const who = txn.merchant || 'an unnamed counterparty';
  const direction = txn.txnType === 'credit' ? 'credited' : txn.txnType === 'debit' ? 'debited' : 'noted';
  const where = [txn.bank, txn.accountLast4 ? `account ending ${txn.accountLast4}` : null].filter(Boolean).join(', ');
  const balance = txn.balance != null ? ` The SMS listed a balance of ${inr(txn.balance)}.` : '';
  return `${amount} was ${direction} on ${when} for ${who}${where ? ` via ${where}` : ''}. It is filed under ${txn.categoryLabel || txn.category}.${balance}`;
}

function chatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function resolveTimeout() {
  const override = Number(config.llm.timeoutMs);
  if (Number.isFinite(override) && override >= 200) return override;
  return 120000;
}

function flattenContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.refusal === 'string') return part.refusal;
      return '';
    }).join('');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function visibleAnswer(text) {
  let value = String(text || '').replace(/^\uFEFF/, '');
  const final = value.match(/<\|channel\|>\s*final\s*<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|return\|>|$)/i);
  if (final) value = final[1];
  value = value.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const unclosed = value.search(/<think>/i);
  if (unclosed >= 0) value = value.slice(0, unclosed);
  return value.trim();
}

function unwrapFence(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json|markdown|text|md)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

function textFromPayload(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  if (Array.isArray(payload.output)) {
    const chunks = [];
    payload.output.forEach((item) => {
      if (!item) return;
      if (typeof item === 'string') chunks.push(item);
      else if (typeof item.text === 'string') chunks.push(item.text);
      else chunks.push(flattenContent(item.content));
    });
    const joined = chunks.join('').trim();
    if (joined) return joined;
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (choice) {
    const message = choice.message || {};
    const content = flattenContent(message.content);
    if (content.trim()) return content;
    if (typeof choice.text === 'string' && choice.text.trim()) return choice.text;
    if (typeof message.refusal === 'string' && message.refusal.trim()) return message.refusal;
    const reasoning = flattenContent(message.reasoning_content || message.reasoning || choice.reasoning_content || choice.reasoning);
    if (reasoning.trim()) return reasoning;
  }
  if (payload.message) {
    const content = flattenContent(payload.message.content);
    if (content.trim()) return content;
  }
  if (typeof payload.content === 'string') return payload.content;
  return '';
}

function textFromTransport(raw) {
  const trimmed = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { text: '', payload: null, parsed: false };
  const looksSse = trimmed.startsWith('data:') || /\n\s*data:/.test(trimmed);
  if (looksSse) {
    let assembled = '';
    let reasoning = '';
    let last = null;
    trimmed.split(/\r?\n/).forEach((line) => {
      const row = line.trim();
      if (!row.startsWith('data:')) return;
      const data = row.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        last = json;
        const choice = json.choices && json.choices[0];
        const delta = choice && (choice.delta || choice.message);
        if (delta) {
          assembled += flattenContent(delta.content);
          reasoning += flattenContent(delta.reasoning_content || delta.reasoning);
        } else if (typeof json.output_text === 'string') assembled += json.output_text;
      } catch {
        assembled += data;
      }
    });
    return { text: assembled.trim() || reasoning.trim(), payload: last, parsed: true };
  }
  try {
    const payload = JSON.parse(trimmed);
    return { text: textFromPayload(payload), payload, parsed: true };
  } catch {
    return { text: trimmed, payload: null, parsed: false };
  }
}

function logLlm(kind, info) {
  const status = info.statusCode == null ? '-' : info.statusCode;
  const name = info.name || '-';
  const body = info.bodyReceived ? 'yes' : 'no';
  console.error(`llm ${kind} status=${status} name=${name} body=${body}`);
}

function failLlm(kind, message, info) {
  logLlm(kind, info || {});
  const error = new Error(message);
  error.kind = kind;
  if (info && info.statusCode != null) error.statusCode = info.statusCode;
  if (info && info.name) error.causeName = info.name;
  return error;
}

function parseModelJson(text) {
  const trimmed = unwrapFence(visibleAnswer(text));
  const loose = (value) => JSON.parse(String(value).replace(/,\s*([}\]])/g, '$1'));
  try {
    return loose(trimmed);
  } catch {
    const objectAt = trimmed.indexOf('{');
    const arrayAt = trimmed.indexOf('[');
    const asArray = arrayAt >= 0 && (objectAt < 0 || arrayAt < objectAt);
    const open = asArray ? arrayAt : objectAt;
    const close = asArray ? trimmed.lastIndexOf(']') : trimmed.lastIndexOf('}');
    if (open < 0 || close <= open) {
      const error = new Error('unreadable model json');
      error.kind = 'parse';
      throw error;
    }
    return loose(trimmed.slice(open, close + 1));
  }
}

function narrativeFromModel(text) {
  const visible = unwrapFence(visibleAnswer(text));
  try {
    const parsed = parseModelJson(visible);
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const field = [parsed.summary, parsed.narrative, parsed.text, parsed.explanation, parsed.content]
        .find((item) => typeof item === 'string' && item.trim());
      if (field) return field.trim();
    }
  } catch {
    /* Prose is the narrative. */
  }
  return visible;
}

function describeFailure(error, noun) {
  const kind = (error && error.kind) || 'unreachable';
  const showing = `Showing a local ${noun}.`;
  if (kind === 'timeout') {
    return { noticeTitle: 'Timed out', notice: `The model timed out before a reply arrived. ${showing}` };
  }
  if (kind === 'http') {
    const status = error.statusCode ? `HTTP ${error.statusCode}` : 'an error';
    return { noticeTitle: 'Model error', notice: `The model returned ${status}. ${showing}` };
  }
  if (kind === 'empty') {
    return { noticeTitle: 'Empty reply', notice: `The model responded without text. ${showing}` };
  }
  if (kind === 'parse') {
    return { noticeTitle: 'Unreadable reply', notice: `The model replied, but the text could not be used. ${showing}` };
  }
  return { noticeTitle: 'Unreachable', notice: `The model could not be reached. ${showing}` };
}

async function complete(messages, maxTokens = 500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeout());
  let response;
  try {
    response = await fetch(chatCompletionsUrl(config.llm.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'LedgerSMS/1.0',
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
        messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw failLlm(aborted ? 'timeout' : 'unreachable', aborted ? 'model timeout' : 'model unreachable', {
      name: error && error.name,
      bodyReceived: false,
    });
  }
  clearTimeout(timer);
  let raw = '';
  try {
    raw = await response.text();
  } catch (error) {
    throw failLlm('unreachable', 'model body unread', {
      statusCode: response.status,
      name: error && error.name,
      bodyReceived: false,
    });
  }
  const bodyReceived = raw.trim().length > 0;
  if (!response.ok) {
    throw failLlm('http', 'model request failed', {
      statusCode: response.status,
      name: 'HTTPError',
      bodyReceived,
    });
  }
  const extracted = textFromTransport(raw);
  if (!extracted.parsed && /^<!doctype html|<html/i.test(extracted.text)) {
    throw failLlm('http', 'model returned html', {
      statusCode: response.status,
      name: 'HTMLBody',
      bodyReceived,
    });
  }
  if (extracted.payload && extracted.payload.error && !String(extracted.text || '').trim()) {
    throw failLlm('http', 'model error payload', {
      statusCode: response.status,
      name: 'ModelError',
      bodyReceived,
    });
  }
  let text = unwrapFence(visibleAnswer(extracted.text));
  if (!text && extracted.payload) {
    const choice = Array.isArray(extracted.payload.choices) ? extracted.payload.choices[0] : null;
    const message = (choice && choice.message) || extracted.payload.message || {};
    text = unwrapFence(visibleAnswer(flattenContent(message.reasoning_content || message.reasoning || (choice && choice.reasoning_content))));
  }
  if (!text) {
    throw failLlm(bodyReceived && !extracted.parsed ? 'parse' : 'empty', 'empty model response', {
      statusCode: response.status,
      name: extracted.parsed ? 'EmptyContent' : 'UnparsedBody',
      bodyReceived,
    });
  }
  return text;
}

function mapSummary(row, status) {
  const local = row.source !== 'llm';
  return {
    id: row.id,
    source: row.source,
    model: row.model,
    summary: row.summary,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    createdAt: iso(row.created_at),
    llmConfigured: status.configured,
    noticeTitle: local ? (status.configured ? 'Saved locally' : 'LLM not configured') : null,
    notice: local
      ? (status.configured ? 'This reading was produced locally.' : 'LLM not configured')
      : null,
  };
}

async function summarize(userId, range) {
  const status = llmStatus();
  const overview = await getOverview(userId, range);
  const packet = {
    spend: overview.kpis.spend,
    inflow: overview.kpis.inflow,
    net: overview.kpis.net,
    balance: overview.kpis.balance,
    transactions: overview.kpis.transactions,
    categories: overview.categories,
    merchants: overview.merchants,
    trend: overview.trend,
  };
  let source = 'heuristic';
  let model = null;
  let summary = heuristicSummary(overview);
  let notice = status.configured ? null : 'LLM not configured';
  let noticeTitle = status.configured ? null : 'LLM not configured';
  if (status.configured) {
    try {
      summary = narrativeFromModel(await complete([
        {
          role: 'system',
          content: 'You write concise personal-finance narratives from SMS-derived totals. Use INR. Use only the numbers provided. Write 3 short paragraphs in plain prose. Do not give investment advice. Do not invent merchants or amounts.',
        },
        { role: 'user', content: JSON.stringify(packet) },
      ]));
      source = 'llm';
      model = status.model;
      notice = null;
      noticeTitle = null;
    } catch (error) {
      const described = describeFailure(error, 'summary');
      notice = described.notice;
      noticeTitle = described.noticeTitle;
    }
  }
  const periodStart = dateOnly(range.from);
  const periodEnd = dateOnly(range.to);
  const [result] = await pool.query(
    `INSERT INTO llm_summaries (user_id, period_start, period_end, source, kind, model, summary)
     VALUES (?, ?, ?, ?, 'brief', ?, ?)`,
    [userId, periodStart, periodEnd, source, model, summary],
  );
  return {
    id: result.insertId,
    source,
    model,
    summary,
    periodStart,
    periodEnd,
    createdAt: new Date().toISOString(),
    llmConfigured: status.configured,
    notice,
    noticeTitle,
  };
}

async function listSummaries(userId, range) {
  const status = llmStatus();
  const periodStart = dateOnly(range.from);
  const periodEnd = dateOnly(range.to);
  const [latestRows] = await pool.query(
    `SELECT id, period_start, period_end, source, model, summary, created_at
     FROM llm_summaries
     WHERE user_id = ? AND period_start = ? AND period_end = ? AND kind = 'brief'
     ORDER BY id DESC LIMIT 1`,
    [userId, periodStart, periodEnd],
  );
  const [history] = await pool.query(
    `SELECT id, period_start, period_end, source, model, summary, created_at
     FROM llm_summaries WHERE user_id = ? AND kind = 'brief' ORDER BY id DESC LIMIT 8`,
    [userId],
  );
  return {
    status,
    latest: latestRows[0] ? mapSummary(latestRows[0], status) : null,
    history: history.map((row) => mapSummary(row, status)),
  };
}

async function explainTransaction(userId, transactionId) {
  const status = llmStatus();
  const [rows] = await pool.query(
    `SELECT t.id, t.txn_type, t.category_slug, c.label AS category_label, t.amount, t.currency,
            t.merchant, t.bank, t.account_last4, t.balance, t.txn_at, m.body, m.sender
     FROM transactions t
     JOIN messages m ON m.id = t.message_id
     LEFT JOIN categories c ON c.slug = t.category_slug
     WHERE t.id = ? AND t.user_id = ?`,
    [transactionId, userId],
  );
  if (!rows.length) {
    const error = new Error('Transaction not found');
    error.status = 404;
    throw error;
  }
  const row = rows[0];
  const txn = {
    id: row.id,
    txnType: row.txn_type,
    category: row.category_slug,
    categoryLabel: row.category_label,
    amount: row.amount,
    merchant: row.merchant,
    bank: row.bank,
    accountLast4: row.account_last4,
    balance: row.balance,
    txnAt: iso(row.txn_at),
    sender: row.sender,
  };
  if (!status.configured) {
    return {
      source: 'heuristic',
      text: explainLocal(txn),
      notice: 'LLM not configured',
      noticeTitle: 'LLM not configured',
      llmConfigured: false,
    };
  }
  try {
    const text = narrativeFromModel(await complete([
      {
        role: 'system',
        content: 'Explain this single bank SMS in 2-4 sentences for the account holder. Use only the provided fields. Mention amount, direction, counterparty, and balance when present. Do not invent facts.',
      },
      {
        role: 'user',
        content: JSON.stringify({ ...txn, body: String(row.body || '').slice(0, 500) }),
      },
    ]));
    return { source: 'llm', text, notice: null, noticeTitle: null, llmConfigured: true, model: status.model };
  } catch (error) {
    const described = describeFailure(error, 'explanation');
    return {
      source: 'heuristic',
      text: explainLocal(txn),
      notice: described.notice,
      noticeTitle: described.noticeTitle,
      llmConfigured: true,
    };
  }
}

module.exports = {
  llmStatus,
  summarize,
  listSummaries,
  explainTransaction,
  heuristicSummary,
  complete,
  parseModelJson,
  narrativeFromModel,
  describeFailure,
  explainLocal,
};
