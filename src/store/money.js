'use strict';

/**
 * Money for the store — integers only.
 *
 * Every amount the store keeps is in MINOR units (agorot for ₪, cents for $):
 * 89.90 is stored as 8990. Floating point never touches a price, a total or
 * a VAT line, so 0.1 + 0.2 can never cost a customer an agora. Parsing takes
 * what a person types ("89.90", "₪89,90", "1,234.5", 89.9); formatting is one
 * deterministic function (no Intl, so the server, the static export and the
 * storefront script always print the same string).
 */

const CURRENCIES = {
  ILS: { symbol: '₪', label: 'שקל חדש' },
  USD: { symbol: '$', label: 'דולר' },
  EUR: { symbol: '€', label: 'אירו' },
  GBP: { symbol: '£', label: 'לירה שטרלינג' }
};

// One ceiling for any single amount — a mistyped extra zero must not
// become a checkout that overflows anything (≈ 10 million in major units).
const MAX_MINOR = 1000000000;

function currencyCode(c) {
  const code = String(c || '').toUpperCase();
  return CURRENCIES[code] ? code : 'ILS';
}

/**
 * A person's price → minor units, or NaN when it is not a price.
 * "89.90" · "89,90" · "₪ 89.9" · "1,234.50" · "1.234,50" · 89.9 → 8990 / 123450
 */
function toMinor(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return NaN;
    const n = Math.round(value * 100);
    return n <= MAX_MINOR ? n : NaN;
  }
  let s = String(value).replace(/[\s ₪$€£]|ILS|USD|EUR|GBP|ש"ח|ש״ח|שח/gi, '').trim();
  if (!s || /^-/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // both separators: the later one is the decimal point
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // one comma: decimal when 1–2 digits follow it ("89,90"), else thousands ("1,234")
    const tail = s.slice(lastComma + 1);
    s = /^\d{1,2}$/.test(tail) && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  const n = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  return n <= MAX_MINOR ? n : NaN;
}

/** Minor units → the canonical major string the BenTML document carries: 8990 → "89.90", 8900 → "89". */
function fromMinor(minor) {
  const n = Math.max(0, Math.round(Number(minor) || 0));
  const whole = Math.floor(n / 100);
  const cents = n % 100;
  return cents ? whole + '.' + String(cents).padStart(2, '0') : String(whole);
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Minor units → what a shopper reads: 8990 → "₪89.90", 150000 → "₪1,500", -1000 → "-₪10". */
function formatMoney(minor, currency) {
  const code = currencyCode(currency);
  const n = Math.round(Number(minor) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = groupThousands(String(Math.floor(abs / 100)));
  const cents = abs % 100;
  return (neg ? '-' : '') + CURRENCIES[code].symbol + whole + (cents ? '.' + String(cents).padStart(2, '0') : '');
}

/**
 * VAT carried inside a VAT-inclusive total (Israel's retail default):
 * total × rate / (100 + rate), rounded to the agora. 11800 at 18% → 1800.
 */
function vatInside(totalMinor, ratePercent) {
  const rate = Number(ratePercent) || 0;
  if (rate <= 0) return 0;
  return Math.round((Number(totalMinor) || 0) * rate / (100 + rate));
}

/** VAT added on top of a net amount: net × rate / 100. */
function vatOnTop(netMinor, ratePercent) {
  const rate = Number(ratePercent) || 0;
  if (rate <= 0) return 0;
  return Math.round((Number(netMinor) || 0) * rate / 100);
}

module.exports = {
  CURRENCIES,
  MAX_MINOR,
  currencyCode,
  toMinor,
  fromMinor,
  formatMoney,
  vatInside,
  vatOnTop
};
