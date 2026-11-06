function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && err.message === 'UNSUPPORTED_FILE') {
    return res.status(400).json({ error: 'Upload a .xml, .csv, or .json SMS export' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is larger than the upload limit' });
  }
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT')) {
    return res.status(503).json({ error: 'Database is unavailable. Check DB_* settings and that MySQL is running.' });
  }
  if (err && err.code === 'ER_ACCESS_DENIED_ERROR') {
    return res.status(503).json({ error: 'Database login failed. Check DB_USER and DB_PASSWORD.' });
  }
  if (err && (err.code === 'ER_BAD_DB_ERROR' || err.code === 'ER_NO_SUCH_TABLE')) {
    return res.status(503).json({ error: 'Database schema is missing. Load sql/schema.sql and try again.' });
  }
  const status = err.status || 500;
  if (status >= 500) {
    console.error('request failed', err.code || err.name || 'error');
  }
  return res.status(status).json({
    error: status >= 500 ? 'Something went wrong' : err.message,
  });
}

module.exports = { asyncHandler, httpError, errorHandler };
