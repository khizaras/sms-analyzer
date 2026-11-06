function pad(n) {
  return String(n).padStart(2, '0');
}

function toMysqlDatetime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return { from, to };
}

function parseRange(fromValue, toValue) {
  if (!fromValue && !toValue) {
    const range = defaultRange();
    return { ...range, fromSql: toMysqlDatetime(range.from), toSql: toMysqlDatetime(range.to) };
  }
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    const error = new Error('Choose a valid date range');
    error.status = 400;
    throw error;
  }
  const max = 366 * 3 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > max) {
    const error = new Error('Date range cannot exceed 3 years');
    error.status = 400;
    throw error;
  }
  return { from, to, fromSql: toMysqlDatetime(from), toSql: toMysqlDatetime(to) };
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

module.exports = { toMysqlDatetime, dateOnly, parseRange, iso };
