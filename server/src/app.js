const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const pool = require('./db');
const { errorHandler } = require('./utils/http');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const importRoutes = require('./routes/imports');
const transactionRoutes = require('./routes/transactions');
const accountRoutes = require('./routes/accounts');
const statsRoutes = require('./routes/stats');
const insightRoutes = require('./routes/insights');
const reviewRoutes = require('./routes/review');
const metaRoutes = require('./routes/meta');

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: config.clientOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

app.get('/api/health', async (req, res) => {
  const body = { ok: true, db: false, uploadMaxMb: config.uploadMaxMb };
  try {
    await pool.query('SELECT 1');
    body.db = true;
  } catch {
    body.db = false;
  }
  res.json(body);
});

app.use('/api/fixtures', express.static(path.join(__dirname, '../../fixtures'), {
  index: false,
  dotfiles: 'deny',
  fallthrough: false,
}));

app.use('/api/auth', authRoutes);
app.use('/api/imports', requireAuth, importRoutes);
app.use('/api/transactions', requireAuth, transactionRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/stats', requireAuth, statsRoutes);
app.use('/api/insights', requireAuth, insightRoutes);
app.use('/api/review', requireAuth, reviewRoutes);
app.use('/api/meta', requireAuth, metaRoutes);

const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) next();
    });
  });
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
