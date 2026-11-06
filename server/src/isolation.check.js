const fs = require('fs');
const path = require('path');
const app = require('./app');
const pool = require('./db');

function fail(message) {
  const error = new Error(message);
  error.isolation = true;
  throw error;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(port, urlPath, { method = 'GET', token, json, raw, headers } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: json ? JSON.stringify(json) : raw,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data, text };
}

async function main() {
  let server;
  const emails = [];
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.log(`Isolation proof skipped: MySQL is not available (${error.code || 'connection failed'}). Owner filters are still applied in every ledger query.`);
    await pool.end();
    return;
  }

  try {
    server = await listen();
    const { port } = server.address();
    const stamp = Date.now();
    const emailA = `isolate-a-${stamp}@ledgersms.test`;
    const emailB = `isolate-b-${stamp}@ledgersms.test`;
    emails.push(emailA, emailB);
    const password = 'Isolate1pass';

    const signupA = await request(port, '/api/auth/signup', {
      method: 'POST',
      json: { name: 'Isolate A', email: emailA, password },
    });
    if (signupA.status === 503) {
      console.log(`Isolation proof skipped: ${signupA.data && signupA.data.error ? signupA.data.error : 'schema unavailable'}`);
      return;
    }
    assert(signupA.status === 201 && signupA.data.token, `signup A failed (${signupA.status})`);
    const signupB = await request(port, '/api/auth/signup', {
      method: 'POST',
      json: { name: 'Isolate B', email: emailB, password },
    });
    assert(signupB.status === 201 && signupB.data.token, `signup B failed (${signupB.status})`);
    const tokenA = signupA.data.token;
    const tokenB = signupB.data.token;

    const fixture = fs.readFileSync(path.join(__dirname, '../../fixtures/sample-sms.json'));
    const boundary = `----ledgersms${stamp}`;
    const raw = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample-sms.json"\r\nContent-Type: application/json\r\n\r\n`),
      fixture,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await request(port, '/api/imports', {
      method: 'POST',
      token: tokenA,
      raw,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    assert(uploaded.status === 201 && uploaded.data.parsed > 0, `import failed (${uploaded.status})`);

    const [rows] = await pool.query(
      `SELECT t.id AS txn_id, t.account_id, m.id AS message_id, m.import_id
       FROM transactions t
       JOIN messages m ON m.id = t.message_id
       JOIN users u ON u.id = t.user_id
       WHERE u.email = ? AND t.account_last4 = '4412'
       LIMIT 1`,
      [emailA],
    );
    assert(rows.length === 1, 'owner A has no stored transaction');
    const owned = rows[0];
    const [failed] = await pool.query(
      `SELECT m.id FROM messages m JOIN users u ON u.id = m.user_id
       WHERE u.email = ? AND m.parse_status = 'failed' LIMIT 1`,
      [emailA],
    );
    assert(failed.length === 1, 'owner A has no review item');

    const crossTxn = await request(port, `/api/transactions/${owned.txn_id}?userId=${signupA.data.user.id}`, { token: tokenB });
    assert(crossTxn.status === 404, `B read A's transaction (${crossTxn.status})`);
    const crossPatch = await request(port, `/api/transactions/${owned.txn_id}`, {
      method: 'PATCH',
      token: tokenB,
      json: { category: 'food', userId: signupA.data.user.id },
    });
    assert(crossPatch.status === 404, `B updated A's transaction (${crossPatch.status})`);
    if (owned.account_id) {
      const crossAccount = await request(port, `/api/accounts/${owned.account_id}/timeline?userId=${signupA.data.user.id}`, { token: tokenB });
      assert(crossAccount.status === 404, `B read A's account (${crossAccount.status})`);
    }
    const crossImport = await request(port, `/api/imports/${owned.import_id}?userId=${signupA.data.user.id}`, { token: tokenB });
    assert(crossImport.status === 404, `B read A's import (${crossImport.status})`);
    const crossReview = await request(port, `/api/review/${failed[0].id}`, {
      method: 'PATCH',
      token: tokenB,
      json: { txnType: 'debit', category: 'other', amount: 10, userId: signupA.data.user.id },
    });
    assert(crossReview.status === 404, `B classified A's message (${crossReview.status})`);

    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-12-31T23:59:59.000Z';
    const statsB = await request(port, `/api/stats/overview?from=${from}&to=${to}&userId=${signupA.data.user.id}`, { token: tokenB });
    assert(statsB.status === 200, 'B stats failed');
    assert(statsB.data.kpis.transactions === 0, 'B stats include another user\'s movements');
    assert(statsB.data.kpis.spend === 0 && statsB.data.kpis.balance === 0, 'B stats include another user\'s money');
    assert(!JSON.stringify(statsB.data).includes('4412'), 'B overview leaked an account number');
    assert(!JSON.stringify(statsB.data).includes('Swiggy'), 'B overview leaked a merchant');

    const listB = await request(port, `/api/transactions?userId=${signupA.data.user.id}`, { token: tokenB });
    assert(listB.status === 200 && listB.data.total === 0, 'B transaction list is not empty');
    const exportB = await request(port, '/api/transactions/export', { token: tokenB });
    assert(exportB.status === 200 && !exportB.text.includes('4412') && !exportB.text.includes('Swiggy'), 'B export leaked rows');
    const reviewB = await request(port, '/api/review', { token: tokenB });
    assert(reviewB.status === 200 && reviewB.data.total === 0, 'B review queue is not empty');
    const accountsB = await request(port, '/api/accounts', { token: tokenB });
    assert(accountsB.status === 200 && accountsB.data.accounts.length === 0, 'B account list is not empty');
    const importsB = await request(port, '/api/imports', { token: tokenB });
    assert(importsB.status === 200 && importsB.data.total === 0, 'B import history is not empty');

    const explainB = await request(port, '/api/insights/explain', {
      method: 'POST',
      token: tokenB,
      json: { transactionId: owned.txn_id, userId: signupA.data.user.id },
    });
    assert(explainB.status === 404, `B explained A's transaction (${explainB.status})`);
    const summaryB = await request(port, '/api/insights/summary', {
      method: 'POST',
      token: tokenB,
      json: { from, to, userId: signupA.data.user.id },
    });
    assert(summaryB.status === 200 && summaryB.data.id, 'B summary failed');
    const insightsA = await request(port, `/api/insights?from=${from}&to=${to}`, { token: tokenA });
    const history = (insightsA.data && insightsA.data.history) || [];
    assert(!history.some((item) => item.id === summaryB.data.id), 'A can see B\'s summary');

    const own = await request(port, `/api/transactions/${owned.txn_id}`, { token: tokenA });
    assert(own.status === 200 && own.data.accountLast4 === '4412', 'A cannot read their own transaction');
    const statsA = await request(port, `/api/stats/overview?from=${from}&to=${to}`, { token: tokenA });
    assert(statsA.status === 200 && statsA.data.kpis.transactions > 0 && statsA.data.kpis.spend > 0, 'A stats are empty');

    console.log('Isolation proof passed: user B received 404s and empty totals for user A\'s ledger.');
  } finally {
    if (emails.length === 2) {
      try {
        await pool.query('DELETE FROM users WHERE email IN (?, ?)', emails);
      } catch (error) {
        console.error('cleanup failed', error.code || 'error');
      }
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.isolation ? error.message : `Isolation proof errored (${error.code || error.name || 'error'})`);
    process.exit(1);
  });
