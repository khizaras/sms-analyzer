const crypto = require('crypto');
const pool = require('../db');
const { parseSms } = require('./parser');
const { toMysqlDatetime } = require('../utils/dates');

function messageHash(sender, body, receivedAt) {
  const stamp = receivedAt ? toMysqlDatetime(receivedAt) : '';
  return crypto.createHash('sha256').update(`${sender}\n${body}\n${stamp}`).digest('hex');
}

async function loadCategories(conn) {
  const [rows] = await conn.query('SELECT id, slug FROM categories');
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function upsertAccount(conn, userId, parsed, txnAtSql) {
  if (!parsed.bank || !parsed.accountLast4) return null;
  const balanceAt = parsed.balance != null ? txnAtSql : null;
  await conn.query(
    `INSERT INTO accounts (user_id, bank, account_last4, currency, latest_balance, balance_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       currency = VALUES(currency),
       latest_balance = IF(VALUES(balance_at) IS NOT NULL AND (balance_at IS NULL OR VALUES(balance_at) >= balance_at), VALUES(latest_balance), latest_balance),
       balance_at = IF(VALUES(balance_at) IS NOT NULL AND (balance_at IS NULL OR VALUES(balance_at) >= balance_at), VALUES(balance_at), balance_at)`,
    [userId, parsed.bank, parsed.accountLast4, parsed.currency || 'INR', parsed.balance, balanceAt],
  );
  const [rows] = await conn.query(
    'SELECT id FROM accounts WHERE user_id = ? AND bank = ? AND account_last4 = ?',
    [userId, parsed.bank, parsed.accountLast4],
  );
  return rows[0] ? rows[0].id : null;
}

async function insertTransaction(conn, { userId, messageId, accountId, categories, parsed, txnAtSql, manual }) {
  const categoryId = categories.get(parsed.category) || categories.get('other') || null;
  const [result] = await conn.query(
    `INSERT INTO transactions
      (user_id, message_id, account_id, category_id, txn_type, category_slug, amount, currency, balance, merchant, bank, account_last4, txn_at, manual_override)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      messageId,
      accountId,
      categoryId,
      parsed.txnType,
      parsed.category || 'other',
      parsed.amount,
      parsed.currency || 'INR',
      parsed.balance,
      parsed.merchant,
      parsed.bank,
      parsed.accountLast4,
      txnAtSql,
      manual ? 1 : 0,
    ],
  );
  if (parsed.balance != null && accountId && txnAtSql) {
    await conn.query(
      `INSERT INTO balance_snapshots (user_id, account_id, balance, captured_at, transaction_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, accountId, parsed.balance, txnAtSql, result.insertId],
    );
  }
  return result.insertId;
}

async function importMessages(userId, { filename, format, messages }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [created] = await conn.query(
      `INSERT INTO imports (user_id, filename, format, status) VALUES (?, ?, ?, 'processing')`,
      [userId, filename, format],
    );
    const importId = created.insertId;
    const categories = await loadCategories(conn);
    let parsedCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;

    for (const message of messages) {
      if (!message.body) {
        failedCount += 1;
        continue;
      }
      const hash = messageHash(message.sender, message.body, message.receivedAt);
      try {
        const [inserted] = await conn.query(
          `INSERT INTO messages (user_id, import_id, sender, body, received_at, content_hash, parse_status)
           VALUES (?, ?, ?, ?, ?, ?, 'failed')`,
          [userId, importId, message.sender, message.body, toMysqlDatetime(message.receivedAt), hash],
        );
        const parsed = parseSms(message);
        if (!parsed.ok) {
          failedCount += 1;
          continue;
        }
        const txnAtSql = toMysqlDatetime(parsed.txnAt);
        const accountId = await upsertAccount(conn, userId, parsed, txnAtSql);
        await insertTransaction(conn, {
          userId,
          messageId: inserted.insertId,
          accountId,
          categories,
          parsed,
          txnAtSql,
          manual: false,
        });
        await conn.query(
          `UPDATE messages SET parse_status = 'parsed' WHERE id = ? AND user_id = ?`,
          [inserted.insertId, userId],
        );
        parsedCount += 1;
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          duplicateCount += 1;
          continue;
        }
        throw error;
      }
    }

    await conn.query(
      `UPDATE imports
       SET status = 'completed', total_messages = ?, parsed_count = ?, failed_count = ?, duplicate_count = ?
       WHERE id = ? AND user_id = ?`,
      [messages.length, parsedCount, failedCount, duplicateCount, importId, userId],
    );
    await conn.commit();
    return {
      id: importId,
      filename,
      format,
      total: messages.length,
      parsed: parsedCount,
      failed: failedCount,
      duplicates: duplicateCount,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* connection already closed */ }
    const safe = error.status ? String(error.message).slice(0, 500) : 'Import failed';
    try {
      await pool.query(
        `INSERT INTO imports (user_id, filename, format, status, error_message)
         VALUES (?, ?, ?, 'failed', ?)`,
        [userId, filename, format, safe],
      );
    } catch { /* keep the original failure */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function applyReview(userId, messageId, input) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [messages] = await conn.query(
      'SELECT id, sender, body, received_at FROM messages WHERE id = ? AND user_id = ?',
      [messageId, userId],
    );
    if (!messages.length) {
      const error = new Error('Message not found');
      error.status = 404;
      throw error;
    }
    const categories = await loadCategories(conn);
    if (!categories.has(input.category)) {
      const error = new Error('Choose a known category');
      error.status = 400;
      throw error;
    }
    const parsed = {
      ok: true,
      txnType: input.txnType,
      category: input.category,
      amount: input.amount,
      currency: 'INR',
      balance: input.balance,
      accountLast4: input.accountLast4,
      bank: input.bank,
      merchant: input.merchant,
      txnAt: input.txnAt || messages[0].received_at || new Date(),
    };
    const txnAtSql = toMysqlDatetime(parsed.txnAt);
    const accountId = await upsertAccount(conn, userId, parsed, txnAtSql);
    const [existing] = await conn.query(
      'SELECT id FROM transactions WHERE message_id = ? AND user_id = ?',
      [messageId, userId],
    );
    let transactionId;
    if (existing.length) {
      transactionId = existing[0].id;
      await conn.query(
        `UPDATE transactions
         SET account_id = ?, category_id = ?, txn_type = ?, category_slug = ?, amount = ?, balance = ?,
             merchant = ?, bank = ?, account_last4 = ?, txn_at = ?, manual_override = 1
         WHERE id = ? AND user_id = ?`,
        [
          accountId,
          categories.get(parsed.category),
          parsed.txnType,
          parsed.category,
          parsed.amount,
          parsed.balance,
          parsed.merchant,
          parsed.bank,
          parsed.accountLast4,
          txnAtSql,
          transactionId,
          userId,
        ],
      );
    } else {
      transactionId = await insertTransaction(conn, {
        userId,
        messageId,
        accountId,
        categories,
        parsed,
        txnAtSql,
        manual: true,
      });
    }
    await conn.query(
      `UPDATE messages SET parse_status = 'reviewed' WHERE id = ? AND user_id = ?`,
      [messageId, userId],
    );
    await conn.commit();
    return { id: transactionId };
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { importMessages, applyReview, upsertAccount, messageHash };
