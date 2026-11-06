const express = require('express');
const pool = require('../db');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const [categories] = await pool.query('SELECT slug, label, kind FROM categories ORDER BY label');
  const [banks] = await pool.query(
    `SELECT DISTINCT bank FROM transactions WHERE user_id = ? AND bank IS NOT NULL AND bank <> '' ORDER BY bank`,
    [req.user.id],
  );
  res.json({
    categories,
    banks: banks.map((row) => row.bank),
  });
}));

module.exports = router;
