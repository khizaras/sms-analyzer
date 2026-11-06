-- LedgerSMS schema. Safe to run with the mysql client:
--   mysql -u root -p < sql/schema.sql
-- Docker Compose also mounts this file on first database start.

CREATE DATABASE IF NOT EXISTS sms_analyzer
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sms_analyzer;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) NOT NULL,
  label VARCHAR(80) NOT NULL,
  kind ENUM('spend', 'income', 'transfer', 'info') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS imports (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  filename VARCHAR(255) NOT NULL,
  format ENUM('xml', 'csv', 'json') NOT NULL,
  status ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'processing',
  total_messages INT UNSIGNED NOT NULL DEFAULT 0,
  parsed_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_imports_user_created (user_id, created_at),
  CONSTRAINT fk_imports_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  import_id INT UNSIGNED NOT NULL,
  sender VARCHAR(80) NOT NULL,
  body TEXT NOT NULL,
  received_at DATETIME NULL,
  content_hash CHAR(64) NOT NULL,
  parse_status ENUM('parsed', 'failed', 'reviewed') NOT NULL DEFAULT 'failed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_messages_user_hash (user_id, content_hash),
  KEY idx_messages_user_status (user_id, parse_status),
  KEY idx_messages_user_received (user_id, received_at),
  CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_import FOREIGN KEY (import_id) REFERENCES imports (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accounts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  bank VARCHAR(80) NOT NULL,
  account_last4 VARCHAR(8) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  latest_balance DECIMAL(16, 2) NULL,
  balance_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_user_bank_last4 (user_id, bank, account_last4),
  KEY idx_accounts_user (user_id),
  CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NULL,
  category_id INT UNSIGNED NULL,
  txn_type ENUM('debit', 'credit', 'info') NOT NULL,
  category_slug VARCHAR(40) NOT NULL DEFAULT 'other',
  amount DECIMAL(16, 2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  balance DECIMAL(16, 2) NULL,
  merchant VARCHAR(160) NULL,
  bank VARCHAR(80) NULL,
  account_last4 VARCHAR(8) NULL,
  txn_at DATETIME NULL,
  manual_override TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_txn_user_date (user_id, txn_at),
  KEY idx_txn_user_category (user_id, category_slug),
  KEY idx_txn_user_type (user_id, txn_type),
  KEY idx_txn_user_bank (user_id, bank),
  KEY idx_txn_message (message_id),
  CONSTRAINT fk_txn_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT fk_txn_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  balance DECIMAL(16, 2) NOT NULL,
  captured_at DATETIME NOT NULL,
  transaction_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_balance_account_time (account_id, captured_at),
  KEY idx_balance_user (user_id, captured_at),
  CONSTRAINT fk_balance_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_balance_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_balance_txn FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS llm_summaries (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  source ENUM('llm', 'heuristic') NOT NULL,
  kind ENUM('brief', 'detailed') NOT NULL DEFAULT 'brief',
  model VARCHAR(80) NULL,
  summary MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_llm_user_period (user_id, period_start, period_end, id),
  CONSTRAINT fk_llm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

INSERT INTO categories (slug, label, kind) VALUES
  ('food', 'Food', 'spend'),
  ('travel', 'Travel', 'spend'),
  ('shopping', 'Shopping', 'spend'),
  ('utilities', 'Utilities', 'spend'),
  ('salary', 'Salary', 'income'),
  ('transfer', 'Transfer', 'transfer'),
  ('atm', 'ATM', 'spend'),
  ('emi', 'EMI', 'spend'),
  ('investment', 'Investment', 'spend'),
  ('otp', 'OTP', 'info'),
  ('promo', 'Promo', 'info'),
  ('other', 'Other', 'spend')
ON DUPLICATE KEY UPDATE label = VALUES(label), kind = VALUES(kind);
