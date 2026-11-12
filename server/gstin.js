// Indian GST number (GSTIN) validation: format + state code + mod-36 check digit.
// A made-up GSTIN on a fake bill fails the check digit about 35 times out of 36.
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function checkDigit(first14) {
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    let d = factor * CHARS.indexOf(first14[i]);
    factor = factor === 2 ? 1 : 2;
    d = Math.floor(d / 36) + (d % 36);
    sum += d;
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

function validateGstin(raw) {
  const g = String(raw || '').toUpperCase().replace(/\s/g, '');
  if (!FORMAT.test(g)) return { valid: false, gstin: g, reason: 'it does not have the 15-character GSTIN format' };
  const state = Number(g.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) {
    return { valid: false, gstin: g, reason: `"${g.slice(0, 2)}" is not a valid state code` };
  }
  if (checkDigit(g.slice(0, 14)) !== g[14]) return { valid: false, gstin: g, reason: 'the check digit is wrong (likely made up or mistyped)' };
  return { valid: true, gstin: g, state: g.slice(0, 2) };
}

module.exports = { validateGstin };
