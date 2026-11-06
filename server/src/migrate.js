const pool = require('./db');

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function migrate() {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.warn(`schema migrate skipped (${error.code || 'unavailable'})`);
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS llm_reviews (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      transaction_id BIGINT UNSIGNED NOT NULL,
      source ENUM('llm', 'heuristic') NOT NULL,
      model VARCHAR(80) NULL,
      summary VARCHAR(500) NOT NULL,
      category_suggestion VARCHAR(40) NULL,
      merchant VARCHAR(160) NULL,
      recurring TINYINT(1) NOT NULL DEFAULT 0,
      notes VARCHAR(800) NULL,
      confidence DECIMAL(4, 3) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_llm_reviews_user_txn (user_id, transaction_id),
      KEY idx_llm_reviews_user (user_id),
      CONSTRAINT fk_llm_reviews_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_llm_reviews_txn FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS llm_suggestions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      message_id BIGINT UNSIGNED NOT NULL,
      source ENUM('llm', 'heuristic') NOT NULL,
      model VARCHAR(80) NULL,
      txn_type ENUM('debit', 'credit', 'info') NOT NULL,
      category_slug VARCHAR(40) NOT NULL,
      merchant VARCHAR(160) NULL,
      amount DECIMAL(16, 2) NULL,
      confidence DECIMAL(4, 3) NULL,
      reason VARCHAR(500) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_llm_suggestions_user_msg (user_id, message_id),
      KEY idx_llm_suggestions_user (user_id),
      CONSTRAINT fk_llm_suggestions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_llm_suggestions_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  if (!(await columnExists('llm_summaries', 'kind'))) {
    await pool.query(`ALTER TABLE llm_summaries ADD COLUMN kind ENUM('brief', 'detailed') NOT NULL DEFAULT 'brief' AFTER source`);
  }
}

module.exports = migrate;
