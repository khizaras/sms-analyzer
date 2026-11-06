const path = require('path');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const config = require('../config');
const { asyncHandler } = require('../utils/http');
const { pageQuery } = require('../utils/validate');
const { iso } = require('../utils/dates');
const { formatFromName, parseByFormat } = require('../services/importers');
const { importMessages } = require('../services/ledger');

const router = express.Router();
const uploadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many uploads. Wait a few minutes and try again.' }),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!formatFromName(file.originalname || '')) return cb(new Error('UNSUPPORTED_FILE'));
    return cb(null, true);
  },
});

function mapImport(row) {
  return {
    id: row.id,
    filename: row.filename,
    format: row.format,
    status: row.status,
    total: row.total_messages,
    parsed: row.parsed_count,
    failed: row.failed_count,
    duplicates: row.duplicate_count,
    error: row.error_message,
    createdAt: iso(row.created_at),
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageQuery(req.query);
  const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM imports WHERE user_id = ?', [req.user.id]);
  const [rows] = await pool.query(
    `SELECT id, filename, format, status, total_messages, parsed_count, failed_count, duplicate_count, error_message, created_at
     FROM imports WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [req.user.id, pageSize, offset],
  );
  res.json({ items: rows.map(mapImport), total: Number(countRow.total) || 0, page, pageSize });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, filename, format, status, total_messages, parsed_count, failed_count, duplicate_count, error_message, created_at
     FROM imports WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Import not found' });
  return res.json(mapImport(rows[0]));
}));

router.post('/', uploadLimit, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'Choose a file to import' });
  }
  const format = formatFromName(req.file.originalname);
  if (!format) return res.status(400).json({ error: 'Upload a .xml, .csv, or .json SMS export' });
  const text = req.file.buffer.toString('utf8');
  if (text.includes('\u0000')) return res.status(400).json({ error: 'That file does not look like a text export' });
  const filename = path.basename(req.file.originalname).replace(/[^\w.\- ()[\]]+/g, '').slice(0, 180) || 'import';
  const messages = parseByFormat(format, text);
  const summary = await importMessages(req.user.id, { filename, format, messages });
  return res.status(201).json(summary);
}));

module.exports = router;
