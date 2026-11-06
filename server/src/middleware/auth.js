const jwt = require('jsonwebtoken');
const config = require('../config');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const id = Number(payload.sub);
    if (!id) return res.status(401).json({ error: 'Session expired. Sign in again.' });
    // Identity comes only from the verified token. A client-supplied userId is discarded.
    if (req.query) delete req.query.userId;
    if (req.body && typeof req.body === 'object') delete req.body.userId;
    req.user = { id, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

module.exports = { requireAuth, signToken };
