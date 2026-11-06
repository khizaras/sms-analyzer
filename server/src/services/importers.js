const MAX_MESSAGES = 5000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(chunk, name) {
  const double = chunk.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (double) return decodeXml(double[1]);
  const single = chunk.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return single ? decodeXml(single[1]) : '';
}

function coerceDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{12,}$/.test(raw)) return new Date(Number(raw));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeMessage(sender, body, date) {
  const cleanBody = String(body || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  const cleanSender = String(sender || '').trim().slice(0, 80) || 'unknown';
  return { sender: cleanSender, body: cleanBody, receivedAt: coerceDate(date) };
}

function parseXml(text) {
  const messages = [];
  const re = /<sms\b([^>]*)\/?>/gi;
  let match = re.exec(text);
  while (match) {
    const chunk = match[1] || '';
    messages.push(normalizeMessage(
      attr(chunk, 'address') || attr(chunk, 'sender') || attr(chunk, 'from'),
      attr(chunk, 'body') || attr(chunk, 'message') || attr(chunk, 'text'),
      attr(chunk, 'date') || attr(chunk, 'readable_date') || attr(chunk, 'timestamp'),
    ));
    match = re.exec(text);
  }
  return messages;
}

function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((columns) => columns.some((value) => String(value).trim() !== ''));
}

function parseCsv(text) {
  const rows = splitCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const indexOf = (names) => header.findIndex((value) => names.includes(value));
  const senderIndex = indexOf(['sender', 'address', 'from', 'number']);
  const bodyIndex = indexOf(['body', 'message', 'sms', 'text', 'content']);
  const dateIndex = indexOf(['date', 'timestamp', 'time', 'received_at', 'received']);
  if (bodyIndex === -1) throw httpError(400, 'CSV must include a body, message, or text column');
  return rows.slice(1).map((columns) => normalizeMessage(
    senderIndex >= 0 ? columns[senderIndex] : 'unknown',
    columns[bodyIndex],
    dateIndex >= 0 ? columns[dateIndex] : null,
  ));
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw httpError(400, 'That JSON file could not be read');
  }
  const list = Array.isArray(data) ? data : (data && (data.messages || data.smses || data.items || data.sms)) || null;
  if (!Array.isArray(list)) throw httpError(400, 'JSON must be an array of messages, or an object with a messages array');
  return list.map((item) => {
    if (!item || typeof item !== 'object') return normalizeMessage('unknown', '', null);
    return normalizeMessage(
      item.sender || item.address || item.from || 'unknown',
      item.body || item.message || item.text || item.sms || '',
      item.date || item.timestamp || item.receivedAt || item.received_at || item.time,
    );
  });
}

function parseByFormat(format, text) {
  let messages;
  if (format === 'xml') messages = parseXml(text);
  else if (format === 'csv') messages = parseCsv(text);
  else if (format === 'json') messages = parseJson(text);
  else throw httpError(400, 'Upload a .xml, .csv, or .json SMS export');

  if (messages.length > MAX_MESSAGES) {
    throw httpError(400, `Import limit is ${MAX_MESSAGES.toLocaleString('en-IN')} messages per file`);
  }
  if (!messages.length) throw httpError(400, 'No messages found in that file');
  return messages;
}

function formatFromName(filename) {
  const match = String(filename || '').toLowerCase().match(/\.(xml|csv|json)$/);
  return match ? match[1] : null;
}

module.exports = {
  parseByFormat,
  formatFromName,
  parseXml,
  parseCsv,
  parseJson,
  coerceDate,
};
