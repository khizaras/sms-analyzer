import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function inr(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function compactInr(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

export function signedInr(value, type) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  const formatted = inr(Math.abs(Number(value)));
  if (type === 'debit') return `−${formatted}`;
  if (type === 'credit') return `+${formatted}`;
  return formatted;
}

export function when(value) {
  if (!value) return '—';
  const date = dayjs(value);
  if (!date.isValid()) return '—';
  return date.format('DD MMM YYYY');
}

export function whenTime(value) {
  if (!value) return '—';
  const date = dayjs(value);
  if (!date.isValid()) return '—';
  return date.format('DD MMM YYYY · HH:mm');
}

export function ago(value) {
  if (!value) return '';
  const date = dayjs(value);
  if (!date.isValid()) return '';
  return date.fromNow();
}

export function monthLabel(key) {
  if (!key) return '';
  const date = dayjs(`${key}-01`);
  return date.isValid() ? date.format('MMM YY') : key;
}

export function initials(name) {
  const parts = String(name || 'L').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0] || '').join('').toUpperCase() || 'L';
}

export function errText(error) {
  return error?.data?.error || error?.error || 'Something went wrong. Please try again.';
}

export function passwordScore(password) {
  const value = password || '';
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, score);
}

export const PASSWORD_LABELS = ['Too short', 'Fair', 'Good', 'Strong', 'Excellent'];
