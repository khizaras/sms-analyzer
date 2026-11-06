function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 190;
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function validName(value) {
  return value.length >= 2 && value.length <= 120;
}

function validPassword(value) {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= 72
    && /[A-Za-z]/.test(value)
    && /\d/.test(value);
}

function pageQuery(query, fallbackSize = 20) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || fallbackSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = {
  cleanEmail,
  validEmail,
  cleanName,
  validName,
  validPassword,
  pageQuery,
};
