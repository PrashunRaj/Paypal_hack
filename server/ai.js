// AI layer (Google Gemini, free tier):
//   parseRules     - plain-language spending rules -> structured policy
//   verifyReceipt  - vision: read a bill photo, label items, spot tampering
//   summarize      - spending report in the sender's language
//   geminiRequest  - raw call used by the function-calling agent
// Every function has a no-AI fallback so the app runs without a key.
const config = require('./config');

const CATEGORY_PATTERNS = [
  ['medicine', /medic|pharma|drug|tablet|insulin|prescription/],
  ['healthcare', /health|doctor|hospital|clinic|lab test/],
  ['groceries', /grocer|vegetable|fruit|milk|rice|flour|supermarket/],
  ['food', /\bfood\b|meal|restaurant/],
  ['education', /school|tuition|education|exam|course/],
  ['books', /\bbooks?\b|stationery|notebook/],
  ['utilities', /utilit|electric|water bill|gas bill|internet|phone bill/],
  ['rent', /\brent\b|landlord/],
  ['transport', /transport|bus|train|fuel|petrol|taxi/],
  ['clothing', /cloth|uniform|shoe/],
];

// ---------- Gemini plumbing ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callModel(model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.gemini.timeoutMs),
  }).catch((e) => {
    const err = new Error(e.name === 'TimeoutError' ? `${model} took too long to answer` : `Could not reach Gemini: ${e.message}`);
    err.retryable = e.name === 'TimeoutError';
    throw err;
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini error ${res.status} (${model}): ${data.error?.message || 'unknown error'}`);
    err.retryable = [429, 500, 503].includes(res.status);
    err.tryNextModel = err.retryable || res.status === 404;
    throw err;
  }
  const cand = data.candidates?.[0];
  if (!cand?.content?.parts) {
    throw new Error(`Gemini returned no content (${cand?.finishReason || data.promptFeedback?.blockReason || 'unknown'})`);
  }
  return cand.content;
}

// Free-tier models are sometimes overloaded (503). Retry, then fall back to the next model.
// Returns { content, model } so multi-step callers (the agent) can stay on one model.
async function geminiCall(body, models = [config.gemini.model, ...config.gemini.fallbackModels]) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return { content: await callModel(model, body), model };
      } catch (e) {
        lastErr = e;
        if (!e.retryable && !e.tryNextModel) throw e;
        if (!e.retryable || attempt === 2) break;
        await sleep(1500 * attempt);
      }
    }
    console.warn(`Gemini: ${lastErr.message} - trying the next model`);
  }
  throw lastErr;
}

const geminiRequest = async (body) => (await geminiCall(body)).content;

const textOf = (content) => (content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();

function parseJSON(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI returned invalid JSON');
  }
}

async function generateJSON(parts, system) {
  const content = await geminiRequest({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });
  return parseJSON(textOf(content));
}

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const lowerList = (a) => (Array.isArray(a) ? a : []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);

// ---------- Rules ----------
function normalizeRules(r, fallbackSummary) {
  return {
    allowed_categories: lowerList(r.allowed_categories),
    blocked_keywords: lowerList(r.blocked_keywords),
    max_per_bill: toNum(r.max_per_bill),
    review_threshold: toNum(r.review_threshold),
    max_age_days: toNum(r.max_age_days) || 60,
    max_bills_per_day: toNum(r.max_bills_per_day) || 5,
    summary: String(r.summary || fallbackSummary || '').slice(0, 400),
  };
}

function parseRulesHeuristic({ rulesText, purpose }) {
  const text = `${purpose} ${rulesText}`.toLowerCase();
  const allowed = CATEGORY_PATTERNS.filter(([, re]) => re.test(text)).map(([c]) => c);
  const blocked = [];
  for (const m of String(rulesText).toLowerCase().matchAll(/\b(?:no|not|never|exclude|except|without)\s+([a-z][a-z ]{1,30}?)(?=[,.;!]|\band\b|\bor\b|$)/g)) {
    m[1].split(/\s*(?:,|\bor\b|\/)\s*/).map((s) => s.trim()).filter(Boolean).forEach((s) => blocked.push(s));
  }
  const threshold = text.match(/(?:over|above|more than|exceeds?)\s*[$₹€£]?\s*(\d+(?:\.\d+)?)/);
  const perBill = text.match(/(?:max(?:imum)?|up to|at most|no more than)\s*[$₹€£]?\s*(\d+(?:\.\d+)?)\s*(?:per|a|each)\s*(?:bill|receipt|purchase)/);
  const summary = [
    allowed.length ? `Only ${allowed.join(', ')}` : 'Any spending that matches the purpose',
    blocked.length ? `never ${blocked.join(', ')}` : null,
    perBill ? `max ${perBill[1]} per bill` : null,
    threshold ? `bills over ${threshold[1]} need your approval` : null,
  ].filter(Boolean).join('; ') + '.';
  return normalizeRules({
    allowed_categories: allowed,
    blocked_keywords: blocked,
    max_per_bill: perBill?.[1],
    review_threshold: threshold?.[1],
  }, summary);
}

async function parseRules({ rulesText, purpose, amount, currency }) {
  if (config.aiMock) return parseRulesHeuristic({ rulesText, purpose });
  try {
    const r = await generateJSON(
      [{ text: `Purpose of the money: "${purpose}"\nAmount: ${amount} ${currency}\nSender's rules: "${rulesText || '(none given)'}"` }],
      `You turn a money sender's plain-language spending rules into a strict JSON policy for an automatic receipt checker.
Return JSON exactly like:
{"allowed_categories": string[], "blocked_keywords": string[], "max_per_bill": number|null, "review_threshold": number|null, "max_age_days": number|null, "max_bills_per_day": number|null, "summary": string}
- allowed_categories: short lowercase spending categories that fit the purpose and rules (e.g. "medicine","groceries","education","utilities","rent","transport","clothing","books","healthcare","food"). Infer from the purpose if rules are empty.
- blocked_keywords: lowercase words/items the sender forbids (e.g. "alcohol","beer","cigarettes","lottery","gift card"). Include obvious synonyms.
- max_per_bill: hard cap per single bill if stated, else null.
- review_threshold: amount at or above which the sender wants to approve manually, else null.
- max_age_days: how old a bill may be, default 60.
- max_bills_per_day: how many bills per day are normal, if stated, else null (default 5).
- summary: one friendly sentence describing the policy.`
    );
    return normalizeRules(r);
  } catch (e) {
    console.warn('parseRules fell back to heuristics:', e.message);
    return parseRulesHeuristic({ rulesText, purpose });
  }
}

// ---------- Receipt verification ----------
function normalizeExtraction(x) {
  return {
    is_receipt: x.is_receipt !== false,
    merchant: x.merchant ? String(x.merchant).slice(0, 120) : null,
    date: x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null,
    currency: x.currency ? String(x.currency).toUpperCase().slice(0, 3) : null,
    total: toNum(x.total),
    tax: toNum(x.tax) || 0,
    discount: Math.abs(toNum(x.discount) || 0),
    gstin: x.gstin ? String(x.gstin).toUpperCase().replace(/\s/g, '').slice(0, 20) : null,
    items: (Array.isArray(x.items) ? x.items : []).slice(0, 60).map((i) => ({
      name: String(i.name || 'item').slice(0, 120),
      price: toNum(i.price) ?? 0,
      category: String(i.category || 'other').toLowerCase().slice(0, 40),
    })),
    purpose_match: ['match', 'partial', 'mismatch'].includes(x.purpose_match) ? x.purpose_match : 'partial',
    tamper_signals: (Array.isArray(x.tamper_signals) ? x.tamper_signals : []).map(String).slice(0, 10),
    confidence: Math.max(0, Math.min(1, toNum(x.confidence) ?? 0.5)),
    reasoning: String(x.reasoning || '').slice(0, 600),
  };
}

function manualExtraction(manual, earmark) {
  // Demo mode: the recipient types what's on the bill. Format for items: "Paracetamol:4.50, Beer:6"
  const items = String(manual.items || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, price] = s.split(':');
      const lname = name.toLowerCase();
      const cat = CATEGORY_PATTERNS.find(([, re]) => re.test(lname))?.[0] || 'other';
      return { name: name.trim(), price: toNum(price) ?? 0, category: cat };
    });
  const allowed = earmark.rules?.allowed_categories || [];
  const matching = items.filter((i) => !allowed.length || allowed.includes(i.category)).length;
  return normalizeExtraction({
    is_receipt: true,
    merchant: manual.merchant || 'Unknown merchant',
    date: manual.date || new Date().toISOString().slice(0, 10),
    currency: earmark.currency,
    gstin: manual.gstin || null,
    total: toNum(manual.total) ?? items.reduce((s, i) => s + i.price, 0),
    items,
    purpose_match: !items.length ? 'partial' : matching === items.length ? 'match' : matching ? 'partial' : 'mismatch',
    tamper_signals: [],
    confidence: 0.9,
    reasoning: 'Demo mode: bill details were entered manually (no AI key configured).',
  });
}

async function verifyReceipt({ buffer, mimeType, earmark, manual }) {
  if (config.aiMock) return manualExtraction(manual || {}, earmark);
  const r = earmark.rules || {};
  const categories = r.allowed_categories?.length ? r.allowed_categories.join(', ') : '(any that fits the purpose)';
  const x = await generateJSON(
    [
      {
        text: `The sender earmarked this money for: "${earmark.purpose}".
Allowed categories: ${categories}.
Blocked items/keywords: ${(r.blocked_keywords || []).join(', ') || '(none)'}.
Today's date: ${new Date().toISOString().slice(0, 10)}.
Read the attached bill and audit it.`,
      },
      { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
    ],
    `You are a careful receipt auditor for EarmarkPay, a service that releases money only for its stated purpose.
Return JSON exactly like:
{"is_receipt": boolean, "merchant": string|null, "date": "YYYY-MM-DD"|null, "currency": "ISO 4217 code"|null, "total": number|null,
 "tax": number|null, "discount": number|null, "gstin": string|null,
 "items": [{"name": string, "price": number, "category": string}],
 "purpose_match": "match"|"partial"|"mismatch", "tamper_signals": string[], "confidence": number, "reasoning": string}
Rules:
- is_receipt=false if the image is not a real bill/receipt/invoice (e.g. a random photo, a blank template, a screenshot of a chat).
- items: every product/service line with its line price (quantity x unit price). Do NOT include tax, GST/CGST/SGST, service charge, discount, rounding or subtotal lines as items. category MUST be one of the allowed categories, or "other".
- tax: the sum of all tax and service-charge lines added on top of the items (0 if prices already include tax). discount: total discount as a positive number.
- gstin: the seller's 15-character GSTIN exactly as printed, or null if none.
- total: the final amount paid. Copy the numbers exactly as printed — do not correct them, even if they don't add up. Infer currency from symbols (₹=INR, $=USD, €=EUR, £=GBP).
- purpose_match: does what was bought serve the stated purpose? "partial" if only some items do.
- tamper_signals: only CONCRETE evidence of editing or fraud that you can point to in the image, e.g. "total digits use a different font and size from the other prices", "date appears overwritten", "text is cut and pasted over a different background", "placeholder text like 'Store Name' or 'XXXX'". Clean, printed or digitally generated bills (e-bills, PDF invoices, POS printouts) are normal and are NOT a signal by themselves. Do not report arithmetic mismatches here (they are checked separately). Empty array if none.
- confidence: 0-1, how sure you are about the extracted numbers.
- reasoning: 1-2 plain sentences a non-technical person can understand.`
  );
  return normalizeExtraction(x);
}

// ---------- Spending report ----------
function summarizeFallback(em, receipts) {
  const paid = receipts.filter((r) => r.status === 'paid');
  const flagged = receipts.filter((r) => ['needs_review', 'rejected'].includes(r.status));
  const lines = [
    `Spending report for "${em.title}" (${em.purpose})`,
    `- Released so far: ${em.spent.toFixed(2)} of ${em.amount.toFixed(2)} ${em.currency} across ${paid.length} verified bill(s).`,
    ...paid.map((r) => `- ${r.extraction?.merchant || 'Bill'}: ${Number(r.paidAmount || 0).toFixed(2)} ${em.currency}`),
    flagged.length ? `- ${flagged.length} bill(s) were flagged or rejected — check the receipts list.` : '- No bills were flagged.',
    em.status === 'closed'
      ? `- Earmark closed; ${Number(em.returnedAmount || 0).toFixed(2)} ${em.currency} was returned to you.`
      : `- Still held for this purpose: ${(em.amount - em.spent).toFixed(2)} ${em.currency}.`,
  ];
  return lines.join('\n') + (config.aiMock ? '\n\n(Demo mode: add a GEMINI_API_KEY for an AI-written report in any language.)' : '');
}

async function summarize(em, receipts, language) {
  if (config.aiMock) return summarizeFallback(em, receipts);
  const data = {
    earmark: {
      title: em.title, purpose: em.purpose, recipient: em.recipientName, amount: em.amount, currency: em.currency,
      released: em.spent, status: em.status, returned_to_sender: em.returnedAmount || 0,
      still_held: em.status === 'funded' ? +(em.amount - em.spent).toFixed(2) : 0,
    },
    receipts: receipts.map((r) => ({
      date: r.extraction?.date, merchant: r.extraction?.merchant, bill_total: r.extraction?.total,
      released: r.paidAmount || 0, status: r.status,
      excluded_items: r.excludedItems, problems: (r.checks || []).filter((c) => c.status !== 'pass').map((c) => c.detail),
    })),
  };
  try {
    const content = await geminiRequest({
      systemInstruction: {
        parts: [{
          text: `You write short, warm, factual spending reports for someone who sent money to family for a specific purpose.
Write in ${language || 'English'}. Max 150 words. Plain text, short lines starting with "- ".
Cover: what was released and for what, anything flagged/rejected and why, what is still held or returned. Never invent numbers.`,
        }],
      },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(data) }] }],
      generationConfig: { temperature: 0.4 },
    });
    return textOf(content);
  } catch (e) {
    console.warn('summarize fell back:', e.message);
    return summarizeFallback(em, receipts);
  }
}

module.exports = { parseRules, verifyReceipt, summarize, geminiRequest, geminiCall, textOf };
