// PayPal REST integration (sandbox):
//   Orders v2 (intent=AUTHORIZE)  -> hold the sender's money without moving it
//   Payments v2 capture / void    -> take only what a verified bill needs, return the rest
//   Payouts v1                    -> send the released amount to the recipient
const crypto = require('crypto');
const config = require('./config');

const API = config.paypal.apiBase;
let tokenCache = { token: null, expiresAt: 0 };

const mockId = (prefix) => `MOCK-${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const fmt = (n) => Number(n).toFixed(2);

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const auth = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${data.error_description || 'check client id/secret'}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function call(method, path, body) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (method === 'POST') headers['PayPal-Request-Id'] = crypto.randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const issue = data.details?.[0] ? ` [${data.details[0].issue}: ${data.details[0].description || ''}]` : '';
    const err = new Error(`PayPal ${method} ${path} failed (${res.status}): ${data.message || data.name || 'error'}${issue}`);
    err.status = res.status >= 500 ? 502 : 400;
    err.paypal = data;
    throw err;
  }
  return data;
}

async function createAuthorizeOrder({ amount, currency, description, referenceId }) {
  if (config.paypalMock) return { id: mockId('ORDER'), mock: true };
  const data = await call('POST', '/v2/checkout/orders', {
    intent: 'AUTHORIZE',
    purchase_units: [{
      reference_id: referenceId,
      description: String(description).slice(0, 127),
      amount: { currency_code: currency, value: fmt(amount) },
    }],
    application_context: { brand_name: 'EarmarkPay', shipping_preference: 'NO_SHIPPING', user_action: 'CONTINUE' },
  });
  return { id: data.id };
}

async function authorizeOrder(orderId) {
  if (config.paypalMock) {
    return {
      authorizationId: mockId('AUTH'),
      status: 'CREATED',
      expiresAt: new Date(Date.now() + 29 * 864e5).toISOString(),
      payerEmail: 'sandbox-sender@example.com',
      mock: true,
    };
  }
  const data = await call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {});
  const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error('PayPal did not return an authorization');
  return {
    authorizationId: auth.id,
    status: auth.status,
    expiresAt: auth.expiration_time,
    payerEmail: data.payer?.email_address || null,
  };
}

async function captureAuthorization(authorizationId, { amount, currency, finalCapture, invoiceId, note }) {
  if (config.paypalMock) return { id: mockId('CAPTURE'), status: 'COMPLETED', mock: true };
  const data = await call('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
    amount: { currency_code: currency, value: fmt(amount) },
    final_capture: Boolean(finalCapture),
    invoice_id: invoiceId,
    note_to_payer: String(note || '').slice(0, 255),
  });
  return { id: data.id, status: data.status };
}

async function voidAuthorization(authorizationId) {
  if (config.paypalMock) return { status: 'VOIDED', mock: true };
  await call('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`);
  return { status: 'VOIDED' };
}

async function createPayout({ email, amount, currency, note, senderItemId }) {
  if (config.paypalMock) return { batchId: mockId('PAYOUT'), status: 'SUCCESS', mock: true };
  const data = await call('POST', '/v1/payments/payouts', {
    sender_batch_header: {
      sender_batch_id: `earmark_${senderItemId}_${Date.now()}`,
      email_subject: 'You received money from EarmarkPay',
      email_message: String(note || '').slice(0, 1000),
    },
    items: [{
      recipient_type: 'EMAIL',
      amount: { value: fmt(amount), currency },
      receiver: email,
      note: String(note || '').slice(0, 4000),
      sender_item_id: senderItemId,
    }],
  });
  return { batchId: data.batch_header?.payout_batch_id, status: data.batch_header?.batch_status };
}

module.exports = { createAuthorizeOrder, authorizeOrder, captureAuthorization, voidAuthorization, createPayout };
