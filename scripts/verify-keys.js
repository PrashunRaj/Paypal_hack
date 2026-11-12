// Checks that the keys in .env work: npm run verify
// PayPal: gets a sandbox token and creates (but never approves) a $1 test order.
// Gemini: sends one tiny prompt to the configured model.
const config = require('../server/config');
const paypal = require('../server/paypal');
const ai = require('../server/ai');

(async () => {
  let ok = true;

  if (config.paypalMock) {
    console.log('PayPal:  not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET empty) -> demo mode');
  } else {
    try {
      const order = await paypal.createAuthorizeOrder({ amount: 1, currency: config.currency, description: 'EarmarkPay key check', referenceId: 'verify' });
      console.log(`PayPal:  OK - sandbox token works, test order ${order.id} created (${config.paypal.apiBase})`);
    } catch (e) {
      ok = false;
      console.log(`PayPal:  FAILED - ${e.message}`);
    }
  }

  if (config.aiMock) {
    console.log('Gemini:  not configured (GEMINI_API_KEY empty) -> demo mode');
  } else {
    try {
      const content = await ai.geminiRequest({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }] });
      console.log(`Gemini:  OK - model ${config.gemini.model} replied "${ai.textOf(content).slice(0, 40)}"`);
    } catch (e) {
      ok = false;
      console.log(`Gemini:  FAILED - ${e.message}`);
    }
  }
  process.exitCode = ok ? 0 : 1;
})();
