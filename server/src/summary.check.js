const app = require('./app');
const pool = require('./db');
const migrate = require('./migrate');

function fail(message) {
  const error = new Error(message);
  error.summary = true;
  throw error;
}

async function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(port, urlPath, { method = 'GET', token, json } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
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
    console.log(`Summary proof skipped: MySQL is not available (${error.code || 'connection failed'}).`);
    await pool.end();
    return;
  }
  try {
    await migrate();
    server = await listen();
    const { port } = server.address();
    const stamp = Date.now();
    const emailA = `summary-a-${stamp}@ledgersms.test`;
    const emailB = `summary-b-${stamp}@ledgersms.test`;
    emails.push(emailA, emailB);
    const password = 'Summary1pass';
    const signupA = await request(port, '/api/auth/signup', { method: 'POST', json: { name: 'Summary A', email: emailA, password } });
    if (signupA.status === 503) {
      console.log(`Summary proof skipped: ${signupA.data && signupA.data.error}`);
      return;
    }
    if (signupA.status !== 201) fail(`signup A failed (${signupA.status})`);
    const signupB = await request(port, '/api/auth/signup', { method: 'POST', json: { name: 'Summary B', email: emailB, password } });
    if (signupB.status !== 201) fail(`signup B failed (${signupB.status})`);

    const userId = signupA.data.user.id;
    const [imp] = await pool.query(
      `INSERT INTO imports (user_id, filename, format, status, total_messages, parsed_count) VALUES (?, 'summary-check', 'json', 'completed', 1, 1)`,
      [userId],
    );
    const [message] = await pool.query(
      `INSERT INTO messages (user_id, import_id, sender, body, received_at, content_hash, parse_status) VALUES (?, ?, 'CHECK', 'summary check', NOW(), ?, 'parsed')`,
      [userId, imp.insertId, `summary-${stamp}`],
    );
    const [txn] = await pool.query(
      `INSERT INTO transactions (user_id, message_id, txn_type, category_slug, amount, currency, merchant, bank, txn_at)
       VALUES (?, ?, 'debit', 'food', 4242.42, 'INR', 'SUMMARYMARKER', 'HDFC Bank', NOW())`,
      [userId, message.insertId],
    );
    const from = new Date(Date.now() - 2 * 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    const own = await request(port, `/api/stats/summary?from=${from}&to=${to}`, { token: signupA.data.token });
    if (own.status !== 200) fail(`summary A failed (${own.status})`);
    const ownText = JSON.stringify(own.data);
    if (!ownText.includes('SUMMARYMARKER')) fail('owner summary missed their merchant');
    if (!(own.data.kpis && own.data.kpis.spend >= 4242)) fail('owner summary missed their spend');

    const other = await request(port, `/api/stats/summary?from=${from}&to=${to}&userId=${userId}`, { token: signupB.data.token });
    if (other.status !== 200) fail(`summary B failed (${other.status})`);
    if (JSON.stringify(other.data).includes('SUMMARYMARKER')) fail('other user saw the merchant');
    if (other.data.kpis.spend !== 0) fail('other user summary included spend');

    const cross = await request(port, `/api/transactions/${txn.insertId}/analyze`, { method: 'POST', token: signupB.data.token });
    if (cross.status !== 404) fail(`other user analyzed the transaction (${cross.status})`);

    const ownReview = await request(port, `/api/transactions/${txn.insertId}/analyze`, { method: 'POST', token: signupA.data.token });
    if (ownReview.status !== 200 || !ownReview.data.review) fail('owner analysis did not persist');
    const reread = await request(port, `/api/transactions/${txn.insertId}`, { token: signupA.data.token });
    if (!reread.data.review || reread.data.review.summary == null) fail('analysis did not reload');
    const hidden = await request(port, `/api/transactions/${txn.insertId}`, { token: signupB.data.token });
    if (hidden.status !== 404) fail('other user read the reviewed transaction');

    console.log('Summary proof passed: aggregates and reviews stay on the owning user.');
  } finally {
    if (emails.length === 2) {
      try { await pool.query('DELETE FROM users WHERE email IN (?, ?)', emails); } catch (error) {
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
    console.error(error.summary ? error.message : `Summary proof errored (${error.code || error.name || 'error'})`);
    process.exit(1);
  });
