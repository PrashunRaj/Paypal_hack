// Deterministic policy engine. The AI reads the bill; this code decides what happens to the money.
// Every check is pass | warn | fail.  Any fail -> reject.  Any warn -> sender review.  Otherwise -> auto-release.
// A 0-100 risk score summarises how suspicious the bill looks.
const { validateGstin } = require('./gstin');

const round2 = (n) => Math.round(n * 100) / 100;

// How much each failed/warned check adds to the risk score.
const RISK_WEIGHT = {
  duplicate: 100, readable: 60, tamper: 35, totals: 35, gstin: 35, split: 30, trust: 25, purpose: 25,
  velocity: 20, confidence: 15, date: 15, currency: 10, limit: 10, threshold: 5, budget: 0,
};

function riskOf(checks) {
  let score = 0;
  for (const c of checks) {
    if (c.status === 'pass') continue;
    const w = RISK_WEIGHT[c.id] ?? 10;
    score += c.status === 'fail' && w > 0 ? Math.max(w, 60) : w;
  }
  score = Math.min(100, score);
  return { score, level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low' };
}

/**
 * @param x         normalized AI extraction (or null if the AI failed)
 * @param em        the earmark (with .rules)
 * @param remaining money still held
 * @param duplicate earlier receipt that matches this one, if any
 * @param history   { last24h, nearLimitThisWeek, recipientRejected } counts of earlier bills
 */
function evaluate({ extraction: x, earmark: em, remaining, duplicate, history = {} }) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const r = em.rules || {};
  let payable = 0;
  const excluded = [];

  if (duplicate) {
    add('duplicate', 'Not a reused bill', 'fail',
      `Same bill as one uploaded on ${new Date(duplicate.uploadedAt).toLocaleDateString()} (${duplicate.id}).`);
  } else {
    add('duplicate', 'Not a reused bill', 'pass', 'No earlier upload matches this bill.');
  }

  if (remaining <= 0) add('budget', 'Money left', 'fail', 'Nothing is left in this earmark.');

  // Behaviour checks: they apply even if the bill itself looks fine.
  if (history.recipientRejected >= 2) {
    add('trust', 'Recipient history', 'warn',
      `${history.recipientRejected} earlier bills from this recipient were rejected, so every bill now needs your approval.`);
  }
  const maxPerDay = r.max_bills_per_day || 5;
  if (history.last24h >= maxPerDay) {
    add('velocity', 'Normal number of bills', 'warn', `This is bill number ${history.last24h + 1} in the last 24 hours.`);
  }

  if (!x) {
    add('readable', 'Bill is readable', 'warn', 'The AI could not read this bill, so it needs your review.');
    return finish();
  }
  if (!x.is_receipt) {
    add('readable', 'Looks like a real bill', 'fail', x.reasoning || 'This does not look like a bill or receipt.');
    return finish();
  }
  const total = Number(x.total) || 0;
  if (total <= 0) {
    add('readable', 'Has a total', 'warn', 'No total amount was found on the bill.');
    return finish();
  }
  add('readable', 'Looks like a real bill', 'pass', `${x.merchant || 'Unknown merchant'} · total ${total.toFixed(2)}${x.currency ? ' ' + x.currency : ''}`);

  if (x.currency && x.currency !== em.currency) {
    add('currency', 'Currency matches', 'warn', `Bill is in ${x.currency}, the earmark is in ${em.currency}.`);
  }

  // Arithmetic is checked by code, not by the AI: items + tax - discount must equal the total.
  const items = x.items || [];
  if (items.length) {
    const itemSum = round2(items.reduce((s, i) => s + (Number(i.price) || 0), 0));
    const expected = round2(itemSum + (x.tax || 0) - (x.discount || 0));
    const tolerance = Math.max(1, total * 0.03);
    if (Math.abs(expected - total) > tolerance) {
      add('totals', 'Items add up to the total', 'warn',
        `Items${x.tax ? ' + tax' : ''}${x.discount ? ' − discount' : ''} add up to ${expected.toFixed(2)}, but the bill total says ${total.toFixed(2)}.`);
    } else {
      add('totals', 'Items add up to the total', 'pass', `Items add up to ${expected.toFixed(2)}.`);
    }
  }

  if (x.gstin) {
    const g = validateGstin(x.gstin);
    if (g.valid) add('gstin', 'GST number is valid', 'pass', `GSTIN ${g.gstin} passes the government check-digit test.`);
    else add('gstin', 'GST number is valid', 'warn', `GSTIN ${g.gstin} is invalid: ${g.reason}.`);
  }

  // Item-level filtering: pay for what fits the purpose, exclude the rest.
  const blocked = r.blocked_keywords || [];
  const allowed = r.allowed_categories || [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    const cat = (item.category || 'other').toLowerCase();
    const hit = blocked.find((k) => name.includes(k) || cat.includes(k));
    const catOk = !allowed.length || allowed.some((a) => cat === a || cat.includes(a) || a.includes(cat));
    if (hit) excluded.push({ name: item.name, price: item.price, reason: `blocked item ("${hit}")` });
    else if (!catOk) excluded.push({ name: item.name, price: item.price, reason: `"${cat}" is not an allowed category` });
  }
  const excludedSum = round2(excluded.reduce((s, i) => s + (Number(i.price) || 0), 0));
  payable = round2(total - excludedSum);

  if (payable <= 0) {
    add('purpose', 'Matches the purpose', 'fail', 'Nothing on this bill matches what the money is for.');
  } else if (excluded.length) {
    add('purpose', 'Matches the purpose', 'pass',
      `Paying ${payable.toFixed(2)} and leaving out ${excluded.map((i) => i.name).join(', ')} (${excludedSum.toFixed(2)}).`);
  } else if (x.purpose_match === 'mismatch') {
    add('purpose', 'Matches the purpose', 'warn', x.reasoning || 'The AI thinks this bill does not fit the purpose.');
  } else {
    add('purpose', 'Matches the purpose', 'pass', x.reasoning || 'Items fit the purpose.');
  }

  if (x.tamper_signals?.length) add('tamper', 'No signs of editing', 'warn', x.tamper_signals.join('; '));
  else add('tamper', 'No signs of editing', 'pass', 'No signs of editing found.');
  if (x.confidence < 0.6) {
    add('confidence', 'AI is confident', 'warn', `The AI is only ${Math.round(x.confidence * 100)}% sure of the numbers.`);
  }

  if (x.date) {
    const ageDays = (Date.now() - new Date(x.date + 'T00:00:00Z').getTime()) / 864e5;
    if (ageDays < -1) add('date', 'Date makes sense', 'warn', `The bill is dated in the future (${x.date}).`);
    else if (ageDays > (r.max_age_days || 60)) add('date', 'Date makes sense', 'warn', `The bill is ${Math.round(ageDays)} days old.`);
    else add('date', 'Date makes sense', 'pass', `Dated ${x.date}.`);
  } else {
    add('date', 'Date makes sense', 'warn', 'No date was found on the bill.');
  }

  // Bill splitting: several bills just under the review limit in one week.
  const limit = r.review_threshold || r.max_per_bill;
  if (limit && payable >= limit * 0.8 && payable < limit && history.nearLimitThisWeek >= 2) {
    add('split', 'Not a split bill', 'warn',
      `This is bill number ${history.nearLimitThisWeek + 1} this week just under your ${limit} limit. This looks like one big bill split into smaller ones.`);
  }

  if (r.max_per_bill && payable > r.max_per_bill) {
    add('limit', 'Within per-bill limit', 'warn', `${payable.toFixed(2)} is over your ${r.max_per_bill} limit per bill.`);
  }
  if (r.review_threshold && payable >= r.review_threshold) {
    add('threshold', 'Below your review amount', 'warn', `You asked to approve bills of ${r.review_threshold} or more yourself.`);
  }
  if (remaining > 0 && payable > remaining) {
    add('budget', 'Money left', 'pass', `Only ${remaining.toFixed(2)} is left, so the payment is capped at that.`);
    payable = remaining;
  }

  return finish();

  function finish() {
    const verdict = checks.some((c) => c.status === 'fail') ? 'reject' : checks.some((c) => c.status === 'warn') ? 'review' : 'approve';
    return { verdict, checks, payable: round2(Math.max(0, payable)), excluded, risk: riskOf(checks) };
  }
}

module.exports = { evaluate, round2 };
