const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (nodeEnv === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  jwtSecret = 'dev-only-ledgersms-secret-change-me';
  console.warn('JWT_SECRET is not set. Using a development-only default.');
}

module.exports = {
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:8080',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadMaxMb: Number(process.env.UPLOAD_MAX_MB || 8),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sms_analyzer',
  },
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    timeoutMs: readLlmTimeout(process.env.LLM_TIMEOUT_MS),
  },
};

function readLlmTimeout(raw) {
  if (raw == null || raw === '') return 120000;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 120000;
  return Math.min(Math.max(value, 60000), 600000);
}
