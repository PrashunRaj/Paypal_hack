require('dotenv').config();

const port = Number(process.env.PORT) || 3000;
const clientId = (process.env.PAYPAL_CLIENT_ID || '').trim();
const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

module.exports = {
  port,
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  currency: (process.env.CURRENCY || 'USD').toUpperCase(),
  paypal: {
    clientId,
    clientSecret,
    apiBase: (process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com').replace(/\/$/, ''),
  },
  // Without credentials, PayPal calls are simulated so the app still runs end to end.
  paypalMock: !clientId || !clientSecret,
  gemini: {
    key: geminiKey,
    model: (process.env.GEMINI_MODEL || 'gemini-3.5-flash').trim(),
    // Used when the main model is overloaded or unavailable.
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.8-flash,gemini-flash-latest')
      .split(',').map((s) => s.trim()).filter(Boolean),
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 45000,
  },
  // Without a key, receipts are entered manually and checked by the rule engine only.
  aiMock: !geminiKey,
};
