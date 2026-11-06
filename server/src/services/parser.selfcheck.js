const fs = require('fs');
const path = require('path');
const { parseSms } = require('./parser');
const { parseByFormat } = require('./importers');

const root = path.join(__dirname, '../../..');
const fixturePath = path.join(root, 'fixtures', 'sample-sms.json');
const sample = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const csv = [
  'sender,body,receivedAt',
  ...sample.messages.map((message) => [message.sender, message.body, message.receivedAt].map(csvCell).join(',')),
].join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<smses count="${sample.messages.length}">\n${sample.messages.map((message) => {
  const date = new Date(message.receivedAt).getTime();
  return `  <sms address="${xmlEscape(message.sender)}" date="${date}" body="${xmlEscape(message.body)}" />`;
}).join('\n')}\n</smses>\n`;
fs.writeFileSync(path.join(root, 'fixtures', 'sample-sms.csv'), csv);
fs.writeFileSync(path.join(root, 'fixtures', 'sample-sms.xml'), xml);

const expect = [
  { ok: true, txnType: 'debit', category: 'utilities', amount: 25000, bank: 'HDFC Bank', accountLast4: '4412', balance: 70210.25, merchant: 'Rent', y: 2026, m: 9, d: 1 },
  { ok: true, txnType: 'debit', category: 'emi', amount: 12500, bank: 'ICICI Bank', accountLast4: '7781', balance: 48900, merchant: 'Home loan', y: 2026, m: 9, d: 5 },
  { ok: true, txnType: 'debit', category: 'utilities', amount: 599, bank: 'ICICI Bank', accountLast4: '7781', balance: 48301, merchant: 'Airtel', y: 2026, m: 9, d: 11 },
  { ok: true, txnType: 'debit', category: 'investment', amount: 5000, bank: 'Kotak', accountLast4: '2290', balance: 20440, merchant: 'Groww', y: 2026, m: 9, d: 15 },
  { ok: true, txnType: 'debit', category: 'transfer', amount: 2000, bank: 'Kotak', accountLast4: '2290', balance: 18440, merchant: 'Rahul Sharma', y: 2026, m: 9, d: 16 },
  { ok: true, txnType: 'debit', category: 'food', amount: 640, bank: 'ICICI Bank', accountLast4: '7781', balance: 47661, merchant: 'Zomato', y: 2026, m: 9, d: 18 },
  { ok: true, txnType: 'debit', category: 'travel', amount: 1800, bank: 'SBI', accountLast4: '1008', balance: 24200, merchant: 'HPCL', y: 2026, m: 9, d: 20 },
  { ok: true, txnType: 'credit', category: 'shopping', amount: 499, bank: 'Axis Bank', accountLast4: '6620', balance: 40499, merchant: 'Amazon', y: 2026, m: 9, d: 22 },
  { ok: true, txnType: 'debit', category: 'atm', amount: 5000, bank: 'SBI', accountLast4: '1008', balance: 19200, merchant: 'ATM', y: 2026, m: 9, d: 28 },
  { ok: true, txnType: 'debit', category: 'food', amount: 560, bank: 'HDFC Bank', accountLast4: '4412', balance: 69650.25, merchant: 'Zomato', y: 2026, m: 9, d: 29 },
  { ok: true, txnType: 'credit', category: 'other', amount: 240, bank: 'SBI', accountLast4: '1008', balance: 19440, merchant: 'Interest', y: 2026, m: 9, d: 31 },
  { ok: true, txnType: 'credit', category: 'salary', amount: 85000, bank: 'ICICI Bank', accountLast4: '7781', balance: 132661, merchant: 'Acme', y: 2026, m: 10, d: 1 },
  { ok: true, txnType: 'debit', category: 'food', amount: 842.5, bank: 'HDFC Bank', accountLast4: '4412', balance: 68807.75, merchant: 'Swiggy', y: 2026, m: 10, d: 2 },
  { ok: true, txnType: 'debit', category: 'shopping', amount: 2199, bank: 'Axis Bank', accountLast4: '6620', balance: 38300, merchant: 'Amazon', y: 2026, m: 10, d: 3 },
  { ok: true, txnType: 'debit', category: 'utilities', amount: 1450, bank: 'Kotak', accountLast4: '2290', balance: 16990, merchant: 'BESCOM', y: 2026, m: 10, d: 4 },
  { ok: true, txnType: 'debit', category: 'travel', amount: 312, bank: 'HDFC Bank', accountLast4: '4412', balance: 68495.75, merchant: 'Uber', y: 2026, m: 10, d: 5 },
  { ok: true, txnType: 'info', category: 'otp', amount: 500, bank: 'HDFC Bank', accountLast4: null, balance: null, merchant: null },
  { ok: true, txnType: 'info', category: 'promo', amount: null, bank: 'Axis Bank', accountLast4: null, balance: null, merchant: null },
  { ok: false },
  { ok: false },
  { ok: false },
];

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exitCode = 1;
  }
}

if (sample.messages.length !== expect.length) {
  console.error(`fixture count ${sample.messages.length} != expectations ${expect.length}`);
  process.exit(1);
}

sample.messages.forEach((message, index) => {
  const parsed = parseSms(message);
  const wanted = expect[index];
  const label = `message ${index + 1}`;
  assert(parsed.ok === wanted.ok, `${label} ok ${parsed.ok} != ${wanted.ok} (${parsed.reason})`);
  if (!wanted.ok) return;
  assert(parsed.txnType === wanted.txnType, `${label} type ${parsed.txnType} != ${wanted.txnType}`);
  assert(parsed.category === wanted.category, `${label} category ${parsed.category} != ${wanted.category}`);
  assert(parsed.amount === wanted.amount, `${label} amount ${parsed.amount} != ${wanted.amount}`);
  assert(parsed.bank === wanted.bank, `${label} bank ${parsed.bank} != ${wanted.bank}`);
  assert(parsed.accountLast4 === wanted.accountLast4, `${label} last4 ${parsed.accountLast4} != ${wanted.accountLast4}`);
  assert(parsed.balance === wanted.balance, `${label} balance ${parsed.balance} != ${wanted.balance}`);
  assert(parsed.merchant === wanted.merchant, `${label} merchant ${parsed.merchant} != ${wanted.merchant}`);
  if (wanted.y) {
    assert(parsed.txnAt && parsed.txnAt.getFullYear() === wanted.y && parsed.txnAt.getMonth() === wanted.m && parsed.txnAt.getDate() === wanted.d,
      `${label} date ${parsed.txnAt}`);
  }
});

const fromJson = parseByFormat('json', JSON.stringify(sample));
const fromCsv = parseByFormat('csv', csv);
const fromXml = parseByFormat('xml', xml);
assert(fromJson.length === 21, `json count ${fromJson.length}`);
assert(fromCsv.length === 21, `csv count ${fromCsv.length}`);
assert(fromXml.length === 21, `xml count ${fromXml.length}`);
assert(fromCsv[0].body === sample.messages[0].body, 'csv body drifted');
assert(fromXml[4].body === sample.messages[4].body, 'xml body drifted');
assert(parseSms(fromXml[12]).merchant === 'Swiggy', 'xml swiggy parse');

if (process.exitCode) {
  console.error('Parser self-check failed');
  process.exit(process.exitCode);
}
console.log('Parser self-check passed (21 messages, json/csv/xml)');
