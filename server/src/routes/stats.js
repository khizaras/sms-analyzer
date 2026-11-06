const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parseRange } = require('../utils/dates');
const rateLimit = require('express-rate-limit');
const { getOverview } = require('../services/stats');
const { summaryForUser, writeNarrative } = require('../services/summary');

const narrativeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many summary requests. Wait a few minutes and try again.' }),
});

const router = express.Router();

router.get('/overview', asyncHandler(async (req, res) => {
  const range = parseRange(req.query.from, req.query.to);
  res.json(await getOverview(req.user.id, range));
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const range = parseRange(req.query.from, req.query.to);
  res.json(await summaryForUser(req.user.id, range));
}));

router.post('/summary/narrative', narrativeLimit, asyncHandler(async (req, res) => {
  const range = parseRange(req.body && req.body.from, req.body && req.body.to);
  res.json(await writeNarrative(req.user.id, range));
}));

module.exports = router;
