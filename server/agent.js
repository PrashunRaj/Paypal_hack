// Sender's AI agent: Gemini function calling over the same service layer the UI uses.
// The agent can create earmarks, check status, approve/reject flagged bills, close earmarks and write reports.
const ai = require('./ai');
const config = require('./config');
const svc = require('./services/earmarks');

const brief = (e) => ({
  id: e.id, title: e.title, purpose: e.purpose, recipient: e.recipientName, status: e.status,
  amount: e.amount, released: e.spent, remaining: e.remaining, currency: e.currency, pending_reviews: e.pendingReviews,
});

const declarations = [
  { name: 'list_earmarks', description: 'List all of the sender\'s earmarks with status and balances.', parameters: { type: 'object', properties: {} } },
  {
    name: 'get_earmark',
    description: 'Get one earmark with its receipts, AI checks and timeline.',
    parameters: { type: 'object', properties: { earmark_id: { type: 'string' } }, required: ['earmark_id'] },
  },
  {
    name: 'create_earmark',
    description: 'Create a new purpose-locked earmark. It must then be funded with the PayPal button on the dashboard.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name, e.g. "Mom\'s medicine"' },
        purpose: { type: 'string', description: 'What the money is for' },
        recipient_name: { type: 'string' },
        recipient_email: { type: 'string', description: 'Recipient PayPal email' },
        amount: { type: 'number' },
        rules_text: { type: 'string', description: 'Spending rules in the sender\'s own words' },
        language: { type: 'string', description: 'Language for spending reports' },
      },
      required: ['title', 'purpose', 'recipient_email', 'amount'],
    },
  },
  {
    name: 'review_receipt',
    description: 'Approve (release money) or reject a bill that is waiting for the sender\'s review.',
    parameters: {
      type: 'object',
      properties: {
        receipt_id: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        amount: { type: 'number', description: 'Optional amount to release instead of the suggested one' },
      },
      required: ['receipt_id', 'decision'],
    },
  },
  {
    name: 'close_earmark',
    description: 'Close an earmark and void the PayPal authorization so unused money is never taken.',
    parameters: { type: 'object', properties: { earmark_id: { type: 'string' } }, required: ['earmark_id'] },
  },
  {
    name: 'spending_summary',
    description: 'Write a spending report for an earmark in a given language.',
    parameters: { type: 'object', properties: { earmark_id: { type: 'string' }, language: { type: 'string' } }, required: ['earmark_id'] },
  },
];

const tools = {
  list_earmarks: async () => ({ earmarks: svc.list().map(brief) }),
  get_earmark: async ({ earmark_id }) => {
    const { earmark, receipts } = svc.detail(earmark_id);
    return {
      earmark: { ...brief(earmark), rules: earmark.rules?.summary, recipient_link: earmark.recipientLink },
      receipts: receipts.map((r) => ({
        id: r.id, merchant: r.extraction?.merchant, total: r.extraction?.total, status: r.status, released: r.paidAmount,
        suggested_amount: r.payableAmount, risk_score: r.riskScore, problems: r.checks.filter((c) => c.status !== 'pass').map((c) => c.detail),
      })),
      timeline: earmark.events.slice(-8).map((e) => e.text),
    };
  },
  create_earmark: async (a) => {
    const e = await svc.createEarmark({
      title: a.title, purpose: a.purpose, recipientName: a.recipient_name, recipientEmail: a.recipient_email,
      amount: a.amount, rulesText: a.rules_text, language: a.language, senderName: 'You',
    });
    return { created: brief(e), ai_policy: e.rules.summary, next_step: 'Fund it with the PayPal button on the dashboard, then share the recipient link.', recipient_link: e.recipientLink };
  },
  review_receipt: async ({ receipt_id, decision, amount }) => {
    const r = await svc.reviewReceipt(receipt_id, decision, amount, `${decision === 'approve' ? 'Approved' : 'Rejected'} via agent`);
    return { receipt_id: r.id, status: r.status, released: r.paidAmount, error: r.error || undefined };
  },
  close_earmark: async ({ earmark_id }) => {
    const e = await svc.closeEarmark(earmark_id);
    return { status: e.status, returned_to_sender: e.returnedAmount, currency: e.currency };
  },
  spending_summary: async ({ earmark_id, language }) => ({ report: await svc.summary(earmark_id, language) }),
};

const SYSTEM = `You are the EarmarkPay assistant for a person who sends money to family for specific purposes.
EarmarkPay holds money with a PayPal authorization and releases it only when the recipient uploads a bill the AI verifies.
- Use tools to look things up and act. Look up ids with list_earmarks instead of asking the user for ids.
- Before creating an earmark, make sure you know the recipient's PayPal email, the amount and the purpose. Ask if missing.
- Before approving a flagged bill or closing an earmark, state what will happen with the money. If the user clearly asked for it, go ahead.
- Never say money moved unless a tool result confirms it. Amounts are in ${config.currency}.
- Be brief and friendly. Reply in the language the user writes in.`;

async function chat(message, history = []) {
  if (config.aiMock) {
    return {
      reply: 'The agent needs a free Gemini API key. Add GEMINI_API_KEY to your .env file and restart. You can still use every feature from the dashboard.',
      actions: [],
    };
  }
  const contents = history.slice(-10).map((h) => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(h.text || '').slice(0, 2000) }],
  }));
  contents.push({ role: 'user', parts: [{ text: String(message).slice(0, 2000) }] });
  const actions = [];
  let models; // after the first reply, stay on the same model for the whole turn

  for (let step = 0; step < 6; step++) {
    const { content, model } = await ai.geminiCall({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: 0.2 },
    }, models);
    models = [model];
    contents.push(content);
    const calls = content.parts.filter((p) => p.functionCall);
    if (!calls.length) return { reply: ai.textOf(content) || 'Done.', actions };

    const responses = [];
    for (const { functionCall: fc } of calls) {
      let result;
      try {
        if (!tools[fc.name]) throw new Error(`Unknown tool ${fc.name}`);
        result = await tools[fc.name](fc.args || {});
        actions.push({ tool: fc.name, ok: true });
      } catch (e) {
        result = { error: e.message };
        actions.push({ tool: fc.name, ok: false, error: e.message });
      }
      responses.push({ functionResponse: { name: fc.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { reply: 'I took several steps. Check the dashboard for the latest state.', actions };
}

module.exports = { chat };
