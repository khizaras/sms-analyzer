const pool = require('../db');
const { iso } = require('../utils/dates');

const SPEND_SQL = "txn_type = 'debit' AND category_slug NOT IN ('transfer', 'otp', 'promo')";
const INFLOW_SQL = "txn_type = 'credit' AND category_slug NOT IN ('transfer', 'otp', 'promo')";

function mapTxn(row) {
  return {
    id: row.id,
    txnType: row.txn_type,
    category: row.category_slug,
    categoryLabel: row.category_label || row.category_slug,
    amount: row.amount,
    currency: row.currency,
    merchant: row.merchant,
    bank: row.bank,
    accountLast4: row.account_last4,
    balance: row.balance,
    txnAt: iso(row.txn_at),
    manual: Boolean(row.manual_override),
    sender: row.sender || null,
    body: row.body || null,
    filename: row.filename || null,
    review: row.review_id ? {
      id: row.review_id,
      source: row.review_source,
      summary: row.review_summary,
      category: row.review_category,
      merchant: row.review_merchant,
      recurring: Boolean(row.review_recurring),
      notes: row.review_notes,
      confidence: row.review_confidence == null ? null : Number(row.review_confidence),
      createdAt: iso(row.review_created_at),
    } : null,
  };
}

async function getOverview(userId, range) {
  const params = [userId, range.fromSql, range.toSql];
  const [[kpis]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ${SPEND_SQL} THEN amount END), 0) AS spend,
       COALESCE(SUM(CASE WHEN ${INFLOW_SQL} THEN amount END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN txn_type = 'debit' THEN 1 ELSE 0 END), 0) AS debits,
       COALESCE(SUM(CASE WHEN txn_type = 'credit' THEN 1 ELSE 0 END), 0) AS credits,
       COALESCE(SUM(CASE WHEN txn_type IN ('debit', 'credit') THEN 1 ELSE 0 END), 0) AS transactions
     FROM transactions
     WHERE user_id = ? AND txn_at >= ? AND txn_at <= ?`,
    params,
  );
  const [[balanceRow]] = await pool.query(
    `SELECT COALESCE(SUM(latest_balance), 0) AS balance
     FROM accounts WHERE user_id = ? AND latest_balance IS NOT NULL`,
    [userId],
  );
  const [[unparsedRow]] = await pool.query(
    `SELECT COUNT(*) AS unparsed FROM messages WHERE user_id = ? AND parse_status = 'failed'`,
    [userId],
  );
  const [trend] = await pool.query(
    `SELECT DATE_FORMAT(txn_at, '%Y-%m') AS month,
        COALESCE(SUM(CASE WHEN ${SPEND_SQL} THEN amount END), 0) AS spend,
        COALESCE(SUM(CASE WHEN ${INFLOW_SQL} THEN amount END), 0) AS inflow
     FROM transactions
     WHERE user_id = ? AND txn_at >= ? AND txn_at <= ? AND txn_type IN ('debit', 'credit')
     GROUP BY DATE_FORMAT(txn_at, '%Y-%m')
     ORDER BY month`,
    params,
  );
  const [categories] = await pool.query(
    `SELECT t.category_slug AS slug, COALESCE(c.label, t.category_slug) AS label, COALESCE(SUM(t.amount), 0) AS amount
     FROM transactions t
     LEFT JOIN categories c ON c.slug = t.category_slug
     WHERE t.user_id = ? AND t.txn_at >= ? AND t.txn_at <= ?
       AND t.txn_type = 'debit' AND t.category_slug NOT IN ('transfer', 'otp', 'promo')
     GROUP BY t.category_slug, c.label
     HAVING amount > 0
     ORDER BY amount DESC`,
    params,
  );
  const [merchants] = await pool.query(
    `SELECT merchant, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
     FROM transactions
     WHERE user_id = ? AND txn_at >= ? AND txn_at <= ?
       AND ${SPEND_SQL}
       AND merchant IS NOT NULL AND merchant <> ''
     GROUP BY merchant
     ORDER BY amount DESC
     LIMIT 6`,
    params,
  );
  const [recent] = await pool.query(
    `SELECT t.id, t.txn_type, t.category_slug, c.label AS category_label, t.amount, t.currency,
            t.merchant, t.bank, t.account_last4, t.balance, t.txn_at, t.manual_override
     FROM transactions t
     LEFT JOIN categories c ON c.slug = t.category_slug
     WHERE t.user_id = ? AND t.txn_at >= ? AND t.txn_at <= ? AND t.txn_type IN ('debit', 'credit')
     ORDER BY t.txn_at DESC, t.id DESC
     LIMIT 8`,
    params,
  );
  const accountBook = await listAccounts(userId);
  const spend = Number(kpis.spend) || 0;
  const inflow = Number(kpis.inflow) || 0;
  return {
    from: iso(range.from),
    to: iso(range.to),
    kpis: {
      spend,
      inflow,
      net: Math.round((inflow - spend) * 100) / 100,
      balance: Number(balanceRow.balance) || 0,
      unparsed: Number(unparsedRow.unparsed) || 0,
      transactions: Number(kpis.transactions) || 0,
      debits: Number(kpis.debits) || 0,
      credits: Number(kpis.credits) || 0,
    },
    trend: trend.map((row) => ({ month: row.month, spend: Number(row.spend) || 0, inflow: Number(row.inflow) || 0 })),
    categories: categories.map((row) => ({ slug: row.slug, label: row.label, amount: Number(row.amount) || 0 })),
    merchants: merchants.map((row) => ({ merchant: row.merchant, amount: Number(row.amount) || 0, count: Number(row.count) || 0 })),
    accounts: accountBook.accounts,
    recent: recent.map(mapTxn),
  };
}

async function listAccounts(userId) {
  const [accounts] = await pool.query(
    `SELECT id, bank, account_last4, currency, latest_balance, balance_at
     FROM accounts WHERE user_id = ? ORDER BY bank, account_last4`,
    [userId],
  );
  const [counts] = await pool.query(
    `SELECT account_id, COUNT(*) AS txn_count
     FROM transactions WHERE user_id = ? AND account_id IS NOT NULL
     GROUP BY account_id`,
    [userId],
  );
  const [points] = await pool.query(
    `SELECT account_id, balance, captured_at
     FROM balance_snapshots WHERE user_id = ? ORDER BY captured_at ASC, id ASC`,
    [userId],
  );
  const countMap = new Map(counts.map((row) => [row.account_id, Number(row.txn_count)]));
  const pointMap = new Map();
  points.forEach((row) => {
    const list = pointMap.get(row.account_id) || [];
    list.push({ balance: Number(row.balance), capturedAt: iso(row.captured_at) });
    pointMap.set(row.account_id, list);
  });
  const mapped = accounts.map((row) => ({
    id: row.id,
    bank: row.bank,
    accountLast4: row.account_last4,
    currency: row.currency,
    latestBalance: row.latest_balance == null ? null : Number(row.latest_balance),
    balanceAt: iso(row.balance_at),
    txnCount: countMap.get(row.id) || 0,
    points: pointMap.get(row.id) || [],
  }));
  const totalBalance = mapped.reduce((sum, account) => sum + (account.latestBalance || 0), 0);
  return { accounts: mapped, totalBalance: Math.round(totalBalance * 100) / 100 };
}

module.exports = { getOverview, listAccounts, mapTxn, SPEND_SQL, INFLOW_SQL };
