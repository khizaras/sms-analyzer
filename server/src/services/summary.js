const pool = require('../db');
const { iso, dateOnly, toMysqlDatetime } = require('../utils/dates');
const { inr } = require('../utils/money');
const { llmStatus, complete, narrativeFromModel, describeFailure } = require('./llm');

const SPEND_SKIP = new Set(['transfer', 'otp', 'promo']);

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function share(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function direction(current, previous) {
  const delta = roundMoney(current - previous);
  if (Math.abs(delta) < 0.01) return { current: roundMoney(current), previous: roundMoney(previous), delta: 0, direction: 'flat' };
  return {
    current: roundMoney(current),
    previous: roundMoney(previous),
    delta,
    direction: delta > 0 ? 'up' : 'down',
  };
}

function previousRange(range) {
  const length = range.to.getTime() - range.from.getTime();
  const to = new Date(range.from.getTime() - 1000);
  const from = new Date(to.getTime() - length);
  return { from, to };
}

function cadence(dates) {
  if (dates.length < 2) return 'irregular';
  const sorted = dates.map((value) => new Date(value).getTime()).filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) gaps.push((sorted[index] - sorted[index - 1]) / 86400000);
  if (!gaps.length) return 'irregular';
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 10) return 'weekly';
  if (median >= 12 && median <= 18) return 'fortnightly';
  if (median >= 25 && median <= 40) return 'monthly';
  return 'irregular';
}

function repeatedGroups(debits) {
  const byMerchant = new Map();
  debits.forEach((row) => {
    const key = String(row.merchant || 'Unknown').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() || 'unknown';
    const list = byMerchant.get(key) || [];
    list.push(row);
    byMerchant.set(key, list);
  });
  const groups = [];
  byMerchant.forEach((rows, key) => {
    const sorted = rows.filter((row) => row.amount != null).sort((a, b) => a.amount - b.amount);
    const clusters = [];
    sorted.forEach((row) => {
      const cluster = clusters.find((item) => {
        const base = Math.max(item.anchor, 1);
        return Math.abs(row.amount - item.anchor) / base <= 0.15;
      });
      if (cluster) cluster.items.push(row);
      else clusters.push({ anchor: Number(row.amount), items: [row] });
    });
    const emitted = clusters.filter((cluster) => cluster.items.length >= 2);
    const chosen = emitted.length ? emitted : (rows.length >= 2 ? [{ items: rows }] : []);
    chosen.forEach((cluster) => {
      const amounts = cluster.items.map((item) => Number(item.amount)).filter((amount) => Number.isFinite(amount));
      if (!amounts.length) return;
      const sortedAmounts = [...amounts].sort((a, b) => a - b);
      const typical = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
      const total = roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
      const dates = cluster.items.map((item) => item.txn_at);
      const last = dates.map((value) => new Date(value)).sort((a, b) => b - a)[0];
      const label = cluster.items.find((item) => item.merchant)?.merchant || key;
      const category = cluster.items[0].category_slug;
      const rhythm = cadence(dates);
      const subscription = rhythm === 'monthly' || rhythm === 'weekly' || category === 'emi' || /netflix|spotify|prime|hotstar|youtube|emi|sip/i.test(label);
      groups.push({
        merchant: label,
        category,
        count: cluster.items.length,
        typicalAmount: roundMoney(typical),
        total,
        cadence: rhythm,
        lastAt: iso(last),
        subscription,
      });
    });
  });
  return groups.sort((a, b) => b.total - a.total).slice(0, 8);
}

function rank(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const name = row[key] || 'Unknown';
    const current = map.get(name) || { name, amount: 0, count: 0, category: row.category_slug, label: row.label };
    current.amount += Number(row.amount) || 0;
    current.count += 1;
    map.set(name, current);
  });
  return [...map.values()].map((item) => ({ ...item, amount: roundMoney(item.amount) })).sort((a, b) => b.amount - a.amount);
}

async function loadRows(userId, range) {
  const [rows] = await pool.query(
    `SELECT t.txn_type, t.category_slug, c.label, t.amount, t.merchant, t.bank, t.txn_at
     FROM transactions t
     LEFT JOIN categories c ON c.slug = t.category_slug
     WHERE t.user_id = ? AND t.txn_at >= ? AND t.txn_at <= ? AND t.txn_type IN ('debit', 'credit')
     ORDER BY t.txn_at DESC
     LIMIT 8000`,
    [userId, range.fromSql, range.toSql],
  );
  return rows;
}

function totals(rows) {
  const spendRows = rows.filter((row) => row.txn_type === 'debit' && !SPEND_SKIP.has(row.category_slug));
  const incomeRows = rows.filter((row) => row.txn_type === 'credit' && !SPEND_SKIP.has(row.category_slug));
  const spend = roundMoney(spendRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const income = roundMoney(incomeRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  return { spendRows, incomeRows, spend, income, net: roundMoney(income - spend) };
}

function localNarrative(report) {
  const lines = [];
  const { kpis, spending, income, repeated, comparison } = report;
  lines.push(`In this window the ledger records ${inr(kpis.spend)} of classified spending and ${inr(kpis.income)} of income across ${kpis.debitCount} debits and ${kpis.creditCount} credits. Net cashflow is ${inr(kpis.net)}${kpis.savingsRate != null ? `, a savings rate of ${kpis.savingsRate}%` : ''}.`);
  if (spending.topCategory) {
    lines.push(`${spending.topCategory.label} is where most spending went: ${inr(spending.topCategory.amount)}, ${spending.topCategory.share}% of outflow.${spending.topMerchant ? ` ${spending.topMerchant.name} is the largest merchant at ${inr(spending.topMerchant.amount)} (${spending.topMerchant.share}%).` : ''}${spending.topBank ? ` ${spending.topBank.name} carried the most debit value, ${inr(spending.topBank.amount)}.` : ''}`);
  } else {
    lines.push('No classified spending landed in this window.');
  }
  if (income.topSource) {
    lines.push(`Income is led by ${income.topSource.name} at ${inr(income.topSource.amount)}. Salary credits total ${inr(income.salary)} and other credits total ${inr(income.other)}.${income.largest ? ` The single largest credit is ${inr(income.largest.amount)} from ${income.largest.merchant || income.largest.category}.` : ''}`);
  } else {
    lines.push('No classified income landed in this window.');
  }
  if (repeated.length) {
    const first = repeated[0];
    lines.push(`${repeated.length} repeated charge${repeated.length === 1 ? '' : 's'} show up, led by ${first.merchant}: ${first.count} times, typically ${inr(first.typicalAmount)}, ${first.cadence}. ${first.subscription ? 'That pattern looks like a subscription or EMI.' : 'The spacing looks irregular.'}`);
  } else {
    lines.push('No merchant repeats at a similar amount often enough to call it a habit yet.');
  }
  if (comparison) {
    lines.push(`Against the previous window of the same length, spending is ${comparison.spend.direction} by ${inr(Math.abs(comparison.spend.delta))} and income is ${comparison.income.direction} by ${inr(Math.abs(comparison.income.delta))}.`);
  }
  if (kpis.uncategorizedAmount) {
    lines.push(`${inr(kpis.uncategorizedAmount)} across ${kpis.uncategorizedCount} debit${kpis.uncategorizedCount === 1 ? '' : 's'} is still filed as Other.`);
  }
  return lines.join('\n\n');
}

async function buildSummary(userId, range) {
  const rows = await loadRows(userId, range);
  const current = totals(rows);
  const prev = previousRange(range);
  const prevRows = await loadRows(userId, {
    fromSql: toMysqlDatetime(prev.from),
    toSql: toMysqlDatetime(prev.to),
  });
  const earlier = totals(prevRows);
  const categories = rank(current.spendRows.map((row) => ({ ...row, label: row.label || row.category_slug })), 'category_slug')
    .map((item) => ({
      slug: item.name,
      label: item.label || item.name,
      amount: item.amount,
      count: item.count,
      share: share(item.amount, current.spend),
    }));
  const merchants = rank(current.spendRows, 'merchant').slice(0, 6).map((item) => ({
    name: item.name,
    amount: item.amount,
    count: item.count,
    share: share(item.amount, current.spend),
  }));
  const banks = rank(current.spendRows.filter((row) => row.bank), 'bank').slice(0, 5).map((item) => ({
    name: item.name,
    amount: item.amount,
    count: item.count,
    share: share(item.amount, current.spend),
  }));
  const incomeSources = rank(current.incomeRows, 'merchant').slice(0, 5).map((item) => ({
    name: item.name,
    amount: item.amount,
    count: item.count,
    share: share(item.amount, current.income),
    category: item.category,
  }));
  const salary = roundMoney(current.incomeRows.filter((row) => row.category_slug === 'salary').reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const otherIncome = roundMoney(current.income - salary);
  const largest = current.incomeRows.reduce((best, row) => (!best || Number(row.amount) > Number(best.amount) ? row : best), null);
  const uncategorized = current.spendRows.filter((row) => row.category_slug === 'other');
  const debitCount = current.spendRows.length;
  const report = {
    from: iso(range.from),
    to: iso(range.to),
    kpis: {
      spend: current.spend,
      income: current.income,
      net: current.net,
      savingsRate: current.income > 0 ? share(current.net, current.income) : null,
      averageDebit: debitCount ? roundMoney(current.spend / debitCount) : 0,
      debitCount,
      creditCount: current.incomeRows.length,
      uncategorizedAmount: roundMoney(uncategorized.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
      uncategorizedCount: uncategorized.length,
    },
    comparison: {
      spend: direction(current.spend, earlier.spend),
      income: direction(current.income, earlier.income),
      label: 'Previous period of the same length',
    },
    spending: {
      categories,
      merchants,
      banks,
      topCategory: categories[0] || null,
      topMerchant: merchants[0] || null,
      topBank: banks[0] || null,
    },
    income: {
      sources: incomeSources,
      topSource: incomeSources[0] || null,
      salary,
      other: otherIncome,
      largest: largest ? {
        amount: roundMoney(largest.amount),
        merchant: largest.merchant,
        category: largest.label || largest.category_slug,
        at: iso(largest.txn_at),
      } : null,
    },
    repeated: repeatedGroups(current.spendRows),
  };
  report.localNarrative = localNarrative(report);
  return report;
}

async function summaryForUser(userId, range) {
  const report = await buildSummary(userId, range);
  const status = llmStatus();
  const [stored] = await pool.query(
    `SELECT id, source, model, summary, created_at
     FROM llm_summaries
     WHERE user_id = ? AND period_start = ? AND period_end = ? AND kind = 'detailed'
     ORDER BY id DESC LIMIT 1`,
    [userId, dateOnly(range.from), dateOnly(range.to)],
  );
  const saved = stored[0];
  return {
    ...report,
    narrative: saved ? saved.summary : report.localNarrative,
    narrativeSource: saved ? saved.source : 'heuristic',
    narrativeModel: saved ? saved.model : null,
    narrativeAt: saved ? iso(saved.created_at) : null,
    llmConfigured: status.configured,
    notice: saved && saved.source === 'llm' ? null : (status.configured ? null : 'LLM not configured'),
    noticeTitle: saved && saved.source === 'llm' ? null : (status.configured ? null : 'LLM not configured'),
  };
}

async function writeNarrative(userId, range) {
  const report = await buildSummary(userId, range);
  const status = llmStatus();
  let source = 'heuristic';
  let model = null;
  let summary = report.localNarrative;
  let notice = status.configured ? null : 'LLM not configured';
  let noticeTitle = status.configured ? null : 'LLM not configured';
  if (status.configured) {
    const packet = {
      kpis: report.kpis,
      comparison: report.comparison,
      topCategory: report.spending.topCategory,
      categories: report.spending.categories.slice(0, 6),
      merchants: report.spending.merchants,
      banks: report.spending.banks,
      income: report.income,
      repeated: report.repeated,
    };
    try {
      summary = narrativeFromModel(await complete([
        {
          role: 'system',
          content: 'Write a detailed personal cashflow narrative from aggregates only. Use INR. Use only the numbers provided. Four short paragraphs: where spending went, where income came from, repeated charges, and the change versus the previous period. Do not invent merchants or amounts. Do not give investment advice.',
        },
        { role: 'user', content: JSON.stringify(packet) },
      ], 800));
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
  await pool.query(
    `INSERT INTO llm_summaries (user_id, period_start, period_end, source, kind, model, summary)
     VALUES (?, ?, ?, ?, 'detailed', ?, ?)`,
    [userId, dateOnly(range.from), dateOnly(range.to), source, model, summary],
  );
  return {
    narrative: summary,
    narrativeSource: source,
    narrativeModel: model,
    llmConfigured: status.configured,
    notice,
    noticeTitle,
  };
}

module.exports = { buildSummary, summaryForUser, writeNarrative };
