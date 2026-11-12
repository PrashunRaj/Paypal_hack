// End-to-end check in demo mode (no keys needed): npm run check
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'earmarkpay-'));
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', GEMINI_API_KEY: '', BASE_URL: BASE },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`  ok  ${msg}`); };
const j = async (method, url, body) => {
  const res = await fetch(BASE + url, body instanceof FormData ? { method, body } : {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${data.error}`);
  return data;
};
const bill = (fields, bytes) => {
  const fd = new FormData();
  fd.append('receipt', new Blob([bytes], { type: 'image/png' }), 'bill.png');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

async function run() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/config`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const today = new Date().toISOString().slice(0, 10);

  const { earmark } = await j('POST', '/api/earmarks', {
    title: "Mom's medicine", purpose: 'Diabetes medicine and groceries', recipientName: 'Mom',
    recipientEmail: 'mom@example.com', amount: 300, senderName: 'Raj',
    rulesText: 'Only medicine and groceries. No alcohol or cigarettes. Ask me before paying any bill over $100.',
  });
  assert(earmark.status === 'draft', 'earmark created as draft');
  assert(earmark.rules.blocked_keywords.includes('alcohol'), 'rules parsed: alcohol blocked');
  assert(earmark.rules.review_threshold === 100, 'rules parsed: review threshold 100');

  const { orderId } = await j('POST', `/api/earmarks/${earmark.id}/order`);
  const funded = (await j('POST', `/api/earmarks/${earmark.id}/authorize`, { orderId })).earmark;
  assert(funded.status === 'funded' && funded.authorizationId, 'PayPal authorization holds the money');

  let { receipt } = await j('POST', `/api/earmarks/${earmark.id}/receipts`,
    bill({ merchant: 'City Pharmacy', date: today, total: '50', items: 'Metformin tablets:42, Beer:8' }, 'bill-1'));
  assert(receipt.status === 'paid' && receipt.paidAmount === 42, 'pharmacy bill paid 42, beer excluded');

  ({ receipt } = await j('POST', `/api/earmarks/${earmark.id}/receipts`,
    bill({ merchant: 'City Pharmacy', date: today, total: '50', items: 'Metformin tablets:42, Beer:8' }, 'bill-1')));
  assert(receipt.status === 'rejected', 'same bill uploaded twice is rejected');

  ({ receipt } = await j('POST', `/api/earmarks/${earmark.id}/receipts`,
    bill({ merchant: 'Fresh Mart', date: today, total: '120', items: 'Rice:60, Vegetables:60' }, 'bill-2')));
  assert(receipt.status === 'needs_review', 'bill over 100 waits for sender review');

  ({ receipt } = await j('POST', `/api/receipts/${receipt.id}/review`, { decision: 'approve' }));
  assert(receipt.status === 'paid' && receipt.paidAmount === 120, 'sender approval releases 120');

  const closed = (await j('POST', `/api/earmarks/${earmark.id}/close`)).earmark;
  assert(closed.status === 'closed' && closed.returnedAmount === 138, 'closing voids the remaining 138');

  const { summary } = await j('GET', `/api/earmarks/${earmark.id}/summary`);
  assert(summary.includes('162.00'), 'spending report mentions total released');

  // ---------- Fraud checks ----------
  console.log('\nFraud checks');
  const em2 = (await j('POST', '/api/earmarks', {
    title: "Dad's medicine", purpose: 'Medicine', recipientName: 'Dad', recipientEmail: 'dad@example.com', amount: 1000,
    rulesText: 'Only medicine. No alcohol. Ask me before paying any bill over $100.',
  })).earmark;
  const o2 = (await j('POST', `/api/earmarks/${em2.id}/order`)).orderId;
  await j('POST', `/api/earmarks/${em2.id}/authorize`, { orderId: o2 });
  const up = async (bytes, fields) => (await j('POST', `/api/earmarks/${em2.id}/receipts`,
    bill({ merchant: 'Care Pharmacy', date: today, ...fields }, bytes))).receipt;
  const check = (r, id) => r.checks.find((c) => c.id === id);

  let a = await up('s1', { total: '95', items: 'Paracetamol tablets:95' });
  let b = await up('s2', { total: '96', items: 'Insulin:96' });
  let c = await up('s3', { total: '97', items: 'Metformin tablets:97' });
  assert(a.status === 'paid' && b.status === 'paid', 'first two bills just under the limit are paid');
  assert(c.status === 'needs_review' && check(c, 'split')?.status === 'warn', 'third bill just under the limit is flagged as a split bill');

  const badGst = await up('g1', { total: '20', items: 'Paracetamol tablets:20', gstin: '27AAPFU0939F1ZX' });
  assert(badGst.status === 'needs_review' && check(badGst, 'gstin')?.status === 'warn', 'made-up GST number is flagged');
  const goodGst = await up('g2', { total: '21', items: 'Paracetamol tablets:21', gstin: '27AAPFU0939F1ZV' });
  assert(goodGst.status === 'paid' && check(goodGst, 'gstin')?.status === 'pass', 'valid GST number passes');

  const badTotal = await up('t1', { total: '90', items: 'Insulin:40' });
  assert(badTotal.status === 'needs_review' && check(badTotal, 'totals')?.status === 'warn', 'items that do not add up to the total are flagged');
  assert(badTotal.riskScore >= 30 && goodGst.riskScore === 0, `risk score: edited bill ${badTotal.riskScore}, clean bill ${goodGst.riskScore}`);
  assert(check(badTotal, 'velocity')?.status === 'warn', '6th bill in 24 hours is flagged for velocity');

  await j('POST', `/api/receipts/${badGst.id}/review`, { decision: 'reject' });
  await j('POST', `/api/receipts/${badTotal.id}/review`, { decision: 'reject' });
  const afterTrust = await up('n1', { total: '10', items: 'Paracetamol tablets:10' });
  assert(afterTrust.status === 'needs_review' && check(afterTrust, 'trust')?.status === 'warn', 'after 2 rejections, auto-pay is off for the recipient');
  const view2 = (await j('GET', `/api/earmarks/${em2.id}`)).earmark;
  assert(view2.recipientRejected === 2, 'earmark shows the trust warning count');

  console.log('\nAll checks passed.');
}

run()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });
