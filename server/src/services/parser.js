const BANKS = [
  ['HDFC Bank', /hdfc/i],
  ['ICICI Bank', /icici/i],
  ['Axis Bank', /axis/i],
  ['Kotak', /kotak/i],
  ['Yes Bank', /yes\s*bank|yesbk/i],
  ['PNB', /\bpnb\b|punjab national/i],
  ['IndusInd Bank', /indusind/i],
  ['IDFC FIRST', /idfc/i],
  ['Bank of Baroda', /baroda/i],
  ['SBI', /sbi/i],
  ['Paytm', /paytm/i],
  ['PhonePe', /phonepe/i],
];

const BRANDS = [
  ['swiggy', 'Swiggy'],
  ['zomato', 'Zomato'],
  ['amazon', 'Amazon'],
  ['flipkart', 'Flipkart'],
  ['uber', 'Uber'],
  ['ola', 'Ola'],
  ['groww', 'Groww'],
  ['zerodha', 'Zerodha'],
  ['airtel', 'Airtel'],
  ['bescom', 'BESCOM'],
  ['hpcl', 'HPCL'],
  ['iocl', 'IOCL'],
  ['jio', 'Jio'],
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function matchBank(text) {
  if (!text) return null;
  const hit = BANKS.find(([, pattern]) => pattern.test(text));
  return hit ? hit[0] : null;
}

function parseNum(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return Math.round(n * 100) / 100;
}

const BALANCE_RE = /(?:available\s+balance|avl\.?\s*bal(?:ance)?|a\/c\s+bal(?:ance)?|(?:^|[\s.])bal(?:ance)?)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

function extractBalance(text) {
  const match = text.match(BALANCE_RE);
  return match ? parseNum(match[1]) : null;
}

function stripBalance(text) {
  return text.replace(/(?:available\s+balance|avl\.?\s*bal(?:ance)?|a\/c\s+bal(?:ance)?|(?:^|[\s.])bal(?:ance)?)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, ' ');
}

function extractAmount(text) {
  const match = stripBalance(text).match(/(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  return match ? parseNum(match[1]) : null;
}

function extractLast4(text) {
  const masked = text.match(/(?:\*{2,}|X{2,})(\d{3,6})/i);
  if (masked) return masked[1].slice(-4);
  const labeled = text.match(/(?:a\/c|acct|account|card)(?:\s*(?:no\.?|number))?\s*(?:ending\s*)?(\d{4})\b/i);
  return labeled ? labeled[1] : null;
}

function buildDate(day, month, year) {
  const d = Number(day);
  const y = Number(String(year).length === 2 ? `20${year}` : year);
  const mo = /^\d+$/.test(month) ? Number(month) : MONTHS[String(month).slice(0, 3).toLowerCase()];
  if (!mo || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(y, mo - 1, d, 12, 0, 0);
  if (date.getMonth() !== mo - 1) return null;
  return date;
}

function parseBodyDate(body) {
  let match = body.match(/\b(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2,4})\b/);
  if (match) return buildDate(match[1], match[2], match[3]);
  match = body.match(/\b(\d{2})([A-Za-z]{3})(\d{2,4})\b/);
  if (match) return buildDate(match[1], match[2], match[3]);
  return null;
}

function categorize(text) {
  const t = text.toLowerCase();
  if (/\bemi\b|loan emi|home loan/.test(t)) return 'emi';
  if (/\batm\b|cash withdrawal|withdrawn/.test(t)) return 'atm';
  if (/salary|payroll/.test(t)) return 'salary';
  if (/groww|zerodha|upstox|mutual fund|\bsip\b|\bnps\b/.test(t)) return 'investment';
  if (/rent|landlord|electric|bescom|airtel|\bjio\b|vodafone|\bbill\b|gas bill|water bill/.test(t)) return 'utilities';
  if (/swiggy|zomato|blinkit|starbucks|restaurant/.test(t)) return 'food';
  if (/uber|\bola\b|rapido|irctc|indigo|petrol|\bfuel\b|hpcl|iocl|bpcl/.test(t)) return 'travel';
  if (/amazon|flipkart|myntra|nykaa|meesho|ajio/.test(t)) return 'shopping';
  if (/\bneft\b|\bimps\b|\brtgs\b|\bupi\b|\bvpa\b/.test(t)) return 'transfer';
  return 'other';
}

function classify(text) {
  const movement = /debited|credited|spent|withdrawn|deposited|purchase/i.test(text);
  if (/otp|one[-\s]?time password|do not share/i.test(text) && !/debited|credited|spent|withdrawn/i.test(text)) {
    return { txnType: 'info', category: 'otp' };
  }
  if (/pre-approved|unsubscribe|limited period|t&c apply|cashback offer|offer!/i.test(text) && !movement) {
    return { txnType: 'info', category: 'promo' };
  }
  if (/debited|spent|withdrawn|purchase/i.test(text)) {
    return { txnType: 'debit', category: categorize(text) };
  }
  if (/credited|deposited/i.test(text)) {
    return { txnType: 'credit', category: categorize(text) };
  }
  return { txnType: null, category: 'other' };
}

function cleanMerchant(raw) {
  if (!raw) return null;
  let value = String(raw).replace(/\s+/g, ' ').trim();
  value = value.split(/\b(?:avl|available|bal|balance)\b/i)[0].trim();
  value = value.replace(/[.,;:]+$/g, '').trim();
  value = value.replace(/^(salary|sip|info)\s+/i, '').trim();
  if (value.length < 2) return null;
  return value.slice(0, 48).trim();
}

function titleCase(value) {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function prettyMerchant(text) {
  const patterns = [
    /vpa\s+([a-z0-9@._-]{2,48})/i,
    /(?:at|towards)\s+([A-Za-z0-9][A-Za-z0-9 @./&_-]{1,60})/i,
    /info\s*:\s*([A-Za-z0-9][A-Za-z0-9 &._-]{1,60})/i,
    /(?:neft|imps|rtgs|upi)\s+to\s+([A-Za-z][A-Za-z ]{1,40})/i,
  ];
  let raw = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      raw = match[1];
      break;
    }
  }
  const cleaned = cleanMerchant(raw);
  if (!cleaned) {
    if (/\batm\b|withdrawn/i.test(text)) return 'ATM';
    if (/\binterest\b/i.test(text)) return 'Interest';
    return null;
  }
  const lower = cleaned.toLowerCase();
  const brand = BRANDS.find(([key]) => lower.includes(key));
  if (brand) return brand[1];
  if (/rent|landlord/i.test(cleaned)) return 'Rent';
  if (/\batm\b/i.test(cleaned)) return 'ATM';
  if (/home loan/i.test(cleaned)) return 'Home loan';
  if (/\binterest\b/i.test(cleaned)) return 'Interest';
  return titleCase(cleaned);
}

function parseSms({ sender = '', body = '', receivedAt = null } = {}) {
  const text = String(body || '');
  const bank = matchBank(sender) || matchBank(text);
  const amount = extractAmount(text);
  const balance = extractBalance(text);
  const accountLast4 = extractLast4(text);
  const { txnType, category } = classify(text);
  const merchant = txnType === 'info' && category === 'otp' ? null : prettyMerchant(text);
  let txnAt = parseBodyDate(text);
  if (!txnAt && receivedAt) {
    const fallback = new Date(receivedAt);
    txnAt = Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const currency = /\bUSD\b|\$/i.test(text) && !/(?:INR|Rs\.?|₹)/i.test(text) ? 'USD' : 'INR';
  const ok = txnType === 'info' || ((txnType === 'debit' || txnType === 'credit') && amount != null);
  return {
    ok,
    reason: ok ? null : 'unclassified',
    txnType,
    category: txnType ? category : 'other',
    amount,
    currency,
    balance,
    accountLast4,
    bank,
    merchant,
    txnAt,
  };
}

module.exports = { parseSms, parseNum };
