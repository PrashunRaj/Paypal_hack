// Business logic shared by the REST routes and the AI agent.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const paypal = require('../paypal');
const ai = require('../ai');
const { evaluate, round2 } = require('../rules');
const config = require('../config');

const newId = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const money = (n, c) => `${Number(n).toFixed(2)} ${c}`;

function event(em, type, text) {
  em.events.push({ at: new Date().toISOString(), type, text });
}

function remaining(em) {
  return em.status === 'funded' ? round2(em.amount - em.spent) : 0;
}

// Rejected bills from this recipient across all earmarks (closing an earmark doesn't count against them).
function recipientRejectedCount(email) {
  const mine = new Set(store.earmarks().filter((e) => e.recipientEmail === email).map((e) => e.id));
  return store.findAllReceipts((r) => mine.has(r.earmarkId) && r.status === 'rejected' && r.reviewNote !== 'Earmark closed').length;
}

function view(em) {
  const receipts = store.receiptsFor(em.id);
  return {
    ...em,
    remaining: em.status === 'draft' ? em.amount : remaining(em),
    receiptCount: receipts.length,
    pendingReviews: receipts.filter((r) => ['needs_review', 'payout_failed'].includes(r.status)).length,
    highRiskBills: receipts.filter((r) => r.riskLevel === 'high').length,
    recipientRejected: recipientRejectedCount(em.recipientEmail),
    recipientLink: `${config.baseUrl}/r/${em.id}`,
  };
}

function mustGet(id) {
  const em = store.getEarmark(id);
  if (!em) throw httpError(404, `No earmark with id ${id}`);
  return em;
}

function list() {
  return store.earmarks().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(view);
}

function detail(id) {
  const em = mustGet(id);
  const receipts = store.receiptsFor(id).slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return { earmark: view(em), receipts };
}

function publicView(id) {
  const em = mustGet(id);
  return {
    id: em.id, title: em.title, purpose: em.purpose, senderName: em.senderName, recipientName: em.recipientName,
    currency: em.currency, amount: em.amount, spent: em.spent, remaining: view(em).remaining, status: em.status,
    rulesSummary: em.rules?.summary, aiMock: config.aiMock,
    receipts: store.receiptsFor(id).slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map((r) => ({
      id: r.id, uploadedAt: r.uploadedAt, status: r.status, merchant: r.extraction?.merchant, total: r.extraction?.total,
      paidAmount: r.paidAmount || 0, checks: r.checks, excludedItems: r.excludedItems, reviewNote: r.reviewNote,
    })),
  };
}

async function createEarmark(input = {}) {
  const title = String(input.title || '').trim();
  const purpose = String(input.purpose || '').trim();
  const recipientEmail = String(input.recipientEmail || '').trim();
  const amount = round2(Number(input.amount));
  if (!title) throw httpError(400, 'Title is required');
  if (!purpose) throw httpError(400, 'Purpose is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw httpError(400, 'A valid recipient PayPal email is required');
  if (!(amount > 0 && amount <= 10000)) throw httpError(400, 'Amount must be between 0.01 and 10000');

  const rulesText = String(input.rulesText || '').slice(0, 1000);
  const rules = await ai.parseRules({ rulesText, purpose, amount, currency: config.currency });
  const em = {
    id: newId('em'),
    title: title.slice(0, 80),
    purpose: purpose.slice(0, 200),
    senderName: String(input.senderName || 'Sender').slice(0, 60),
    recipientName: String(input.recipientName || 'Recipient').slice(0, 60),
    recipientEmail,
    amount,
    currency: config.currency,
    rulesText,
    rules,
    language: String(input.language || 'English').slice(0, 30),
    status: 'draft',
    spent: 0,
    orderId: null,
    authorizationId: null,
    createdAt: new Date().toISOString(),
    events: [],
  };
  event(em, 'created', `Earmark created: ${money(amount, em.currency)} for "${purpose}". AI policy: ${rules.summary}`);
  store.insertEarmark(em);
  return view(em);
}

async function createOrder(id) {
  const em = mustGet(id);
  if (em.status !== 'draft') throw httpError(409, 'This earmark is already funded');
  const order = await paypal.createAuthorizeOrder({
    amount: em.amount, currency: em.currency, referenceId: em.id,
    description: `EarmarkPay: ${em.purpose} for ${em.recipientName}`,
  });
  em.orderId = order.id;
  store.save();
  return { orderId: order.id };
}

async function authorize(id, orderId) {
  const em = mustGet(id);
  if (em.status !== 'draft') throw httpError(409, 'This earmark is already funded');
  if (!orderId || orderId !== em.orderId) throw httpError(400, 'Order does not belong to this earmark');
  const auth = await paypal.authorizeOrder(orderId);
  Object.assign(em, {
    status: 'funded',
    authorizationId: auth.authorizationId,
    authExpiresAt: auth.expiresAt,
    payerEmail: auth.payerEmail,
    fundedAt: new Date().toISOString(),
  });
  event(em, 'funded', `PayPal authorization ${auth.authorizationId} is holding ${money(em.amount, em.currency)}. Nothing has been sent yet.`);
  store.save();
  return view(em);
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' };

async function submitReceipt(id, file, manual = {}) {
  const em = mustGet(id);
  if (em.status !== 'funded') throw httpError(409, 'This earmark is not accepting bills (not funded, closed, or used up)');
  if (!file) throw httpError(400, 'Attach a photo of the bill');

  const receiptId = newId('rc');
  const imageHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const fileName = `${receiptId}${EXT[file.mimetype] || ''}`;
  fs.writeFileSync(path.join(store.uploadsDir, fileName), file.buffer);

  let extraction = null;
  let aiError = null;
  try {
    extraction = await ai.verifyReceipt({ buffer: file.buffer, mimeType: file.mimetype, earmark: em, manual });
  } catch (e) {
    aiError = e.message;
    console.warn('verifyReceipt failed:', e.message);
  }

  // Duplicate detection: identical file, or same merchant + date + total as an earlier bill.
  const fingerprint = extraction?.total
    ? `${(extraction.merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${extraction.date || ''}|${extraction.total.toFixed(2)}`
    : null;
  const duplicate =
    store.findReceipt((r) => r.imageHash === imageHash) ||
    (fingerprint && store.findReceipt((r) => r.fingerprint === fingerprint && r.status !== 'rejected'));

  // Behaviour history for velocity, bill-splitting and trust checks.
  const now = Date.now();
  const earlier = store.receiptsFor(em.id);
  const age = (r) => now - new Date(r.uploadedAt).getTime();
  const limit = em.rules?.review_threshold || em.rules?.max_per_bill;
  const history = {
    last24h: earlier.filter((r) => age(r) < 864e5).length,
    nearLimitThisWeek: limit
      ? earlier.filter((r) => r.status !== 'rejected' && age(r) < 7 * 864e5 && r.payableAmount >= limit * 0.8 && r.payableAmount < limit).length
      : 0,
    recipientRejected: recipientRejectedCount(em.recipientEmail),
  };

  const result = evaluate({ extraction, earmark: em, remaining: remaining(em), duplicate, history });
  const receipt = {
    id: receiptId,
    earmarkId: em.id,
    uploadedAt: new Date().toISOString(),
    file: `/uploads/${fileName}`,
    mimeType: file.mimetype,
    imageHash,
    fingerprint,
    extraction,
    aiError,
    checks: result.checks,
    verdict: result.verdict,
    payableAmount: result.payable,
    excludedItems: result.excluded,
    riskScore: result.risk.score,
    riskLevel: result.risk.level,
    source: manual.source === 'camera' ? 'camera' : 'file',
    status: result.verdict === 'approve' ? 'processing' : result.verdict === 'review' ? 'needs_review' : 'rejected',
    paidAmount: 0,
  };
  store.insertReceipt(receipt);

  const label = extraction?.merchant || 'a bill';
  if (result.verdict === 'approve') {
    event(em, 'verified', `AI verified ${label}; releasing ${money(result.payable, em.currency)}.`);
    await settle(em, receipt, result.payable);
  } else if (result.verdict === 'review') {
    event(em, 'review', `${label} needs your review (risk ${result.risk.score}/100): ${result.checks.filter((c) => c.status === 'warn').map((c) => c.label).join(', ')}.`);
  } else {
    event(em, 'rejected', `${label} was rejected: ${result.checks.filter((c) => c.status === 'fail').map((c) => c.detail).join(' ')}`);
  }
  store.save();
  return receipt;
}

// Capture just this bill's amount from the authorization, then pay it out to the recipient.
async function settle(em, receipt, requested) {
  const amount = round2(Math.min(requested, remaining(em)));
  if (!(amount > 0)) {
    receipt.status = 'rejected';
    receipt.reviewNote = 'Nothing left to release.';
    store.save();
    return receipt;
  }
  const isFinal = round2(remaining(em) - amount) <= 0;
  try {
    const cap = await paypal.captureAuthorization(em.authorizationId, {
      amount, currency: em.currency, finalCapture: isFinal, invoiceId: receipt.id,
      note: `EarmarkPay: ${em.purpose} (${receipt.extraction?.merchant || 'verified bill'})`,
    });
    receipt.captureId = cap.id;
    receipt.paidAmount = amount;
    em.spent = round2(em.spent + amount);
  } catch (e) {
    receipt.status = 'error';
    receipt.error = `PayPal capture failed: ${e.message}`;
    event(em, 'error', receipt.error);
    store.save();
    return receipt;
  }
  await payout(em, receipt);
  if (isFinal) {
    em.status = 'completed';
    event(em, 'completed', 'The full amount has been released against verified bills.');
  }
  store.save();
  return receipt;
}

async function payout(em, receipt) {
  try {
    const po = await paypal.createPayout({
      email: em.recipientEmail, amount: receipt.paidAmount, currency: em.currency, senderItemId: receipt.id,
      note: `${em.senderName} sent this for ${em.purpose} (bill from ${receipt.extraction?.merchant || 'a merchant'}).`,
    });
    receipt.payoutBatchId = po.batchId;
    receipt.payoutStatus = po.status;
    receipt.status = 'paid';
    receipt.error = null;
    event(em, 'paid', `Sent ${money(receipt.paidAmount, em.currency)} to ${em.recipientName} via PayPal Payouts (batch ${po.batchId}).`);
  } catch (e) {
    receipt.status = 'payout_failed';
    receipt.error = `Money was captured but the payout failed: ${e.message}`;
    event(em, 'error', receipt.error);
  }
}

async function reviewReceipt(receiptId, decision, amountOverride, note) {
  const receipt = store.getReceipt(receiptId);
  if (!receipt) throw httpError(404, `No receipt with id ${receiptId}`);
  const em = mustGet(receipt.earmarkId);

  if (receipt.status === 'payout_failed') {
    if (decision !== 'approve') throw httpError(400, 'Captured funds can only be retried, not rejected');
    await payout(em, receipt);
    store.save();
    return receipt;
  }
  if (receipt.status !== 'needs_review') throw httpError(409, `This bill is already ${receipt.status}`);

  if (decision === 'reject') {
    receipt.status = 'rejected';
    receipt.reviewNote = String(note || 'Rejected by sender').slice(0, 300);
    event(em, 'rejected', `You rejected ${receipt.extraction?.merchant || 'a bill'}.`);
    store.save();
    return receipt;
  }
  if (decision !== 'approve') throw httpError(400, 'decision must be "approve" or "reject"');
  if (em.status !== 'funded') throw httpError(409, 'This earmark is no longer funded');
  const amount = amountOverride !== undefined && amountOverride !== null && amountOverride !== ''
    ? round2(Number(amountOverride)) : receipt.payableAmount;
  if (!(amount > 0)) throw httpError(400, 'Enter an amount to release');
  receipt.reviewNote = String(note || 'Approved by sender').slice(0, 300);
  event(em, 'approved', `You approved ${receipt.extraction?.merchant || 'a bill'} for ${money(amount, em.currency)}.`);
  await settle(em, receipt, amount);
  return receipt;
}

async function closeEarmark(id) {
  const em = mustGet(id);
  if (em.status !== 'funded') throw httpError(409, 'Only an active (funded) earmark can be closed');
  const left = remaining(em);
  await paypal.voidAuthorization(em.authorizationId);
  em.status = 'closed';
  em.returnedAmount = left;
  em.closedAt = new Date().toISOString();
  for (const r of store.receiptsFor(id)) {
    if (r.status === 'needs_review') { r.status = 'rejected'; r.reviewNote = 'Earmark closed'; }
  }
  event(em, 'closed', `Authorization voided. ${money(left, em.currency)} was never taken from your PayPal account.`);
  store.save();
  return view(em);
}

async function summary(id, language) {
  const em = mustGet(id);
  return ai.summarize(em, store.receiptsFor(id), language || em.language);
}

module.exports = {
  list, detail, publicView, createEarmark, createOrder, authorize, submitReceipt, reviewReceipt, closeEarmark, summary,
};
