const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parseRange } = require('../utils/dates');
const { summarize, listSummaries, explainTransaction, llmStatus } = require('../services/llm');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json(llmStatus());
});

router.get('/', asyncHandler(async (req, res) => {
  const range = parseRange(req.query.from, req.query.to);
  res.json(await listSummaries(req.user.id, range));
}));

router.post('/summary', asyncHandler(async (req, res) => {
  const range = parseRange(req.body && req.body.from, req.body && req.body.to);
  res.json(await summarize(req.user.id, range));
}));

router.post('/explain', asyncHandler(async (req, res) => {
  const transactionId = Number(req.body && req.body.transactionId);
  if (!transactionId) return res.status(400).json({ error: 'Choose a transaction to explain' });
  return res.json(await explainTransaction(req.user.id, transactionId));
}));

module.exports = router;
