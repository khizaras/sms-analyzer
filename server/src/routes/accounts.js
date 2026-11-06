const express = require('express');
const { asyncHandler } = require('../utils/http');
const { listAccounts } = require('../services/stats');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json(await listAccounts(req.user.id));
}));

router.get('/:id/timeline', asyncHandler(async (req, res) => {
  const data = await listAccounts(req.user.id);
  const account = data.accounts.find((item) => String(item.id) === String(req.params.id));
  if (!account) return res.status(404).json({ error: 'Account not found' });
  return res.json(account);
}));

module.exports = router;
