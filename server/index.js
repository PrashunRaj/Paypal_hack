const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const store = require('./store');
const svc = require('./services/earmarks');
const agent = require('./agent');

const app = express();
app.use(express.json({ limit: '1mb' }));
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(CLIENT_DIST));
app.use('/uploads', express.static(store.uploadsDir));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|heic)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(ok ? null : Object.assign(new Error('Upload a JPG, PNG, WEBP, HEIC or PDF bill'), { status: 400 }), ok);
  },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/config', (req, res) => res.json({
  paypalClientId: config.paypalMock ? null : config.paypal.clientId,
  currency: config.currency,
  paypalMock: config.paypalMock,
  aiMock: config.aiMock,
  model: config.aiMock ? null : config.gemini.model,
}));

app.get('/api/earmarks', (req, res) => res.json({ earmarks: svc.list() }));
app.post('/api/earmarks', wrap(async (req, res) => res.status(201).json({ earmark: await svc.createEarmark(req.body) })));
app.get('/api/earmarks/:id', (req, res) => res.json(svc.detail(req.params.id)));
app.get('/api/earmarks/:id/public', (req, res) => res.json(svc.publicView(req.params.id)));
app.post('/api/earmarks/:id/order', wrap(async (req, res) => res.json(await svc.createOrder(req.params.id))));
app.post('/api/earmarks/:id/authorize', wrap(async (req, res) =>
  res.json({ earmark: await svc.authorize(req.params.id, req.body.orderId) })));
app.post('/api/earmarks/:id/receipts', upload.single('receipt'), wrap(async (req, res) =>
  res.status(201).json({ receipt: await svc.submitReceipt(req.params.id, req.file, {
    merchant: req.body.merchant, total: req.body.total, date: req.body.date, items: req.body.items,
    gstin: req.body.gstin, source: req.body.source,
  }) })));
app.post('/api/earmarks/:id/close', wrap(async (req, res) => res.json({ earmark: await svc.closeEarmark(req.params.id) })));
app.get('/api/earmarks/:id/summary', wrap(async (req, res) =>
  res.json({ summary: await svc.summary(req.params.id, req.query.lang) })));
app.post('/api/receipts/:id/review', wrap(async (req, res) =>
  res.json({ receipt: await svc.reviewReceipt(req.params.id, req.body.decision, req.body.amount, req.body.note) })));
app.post('/api/agent', wrap(async (req, res) => {
  if (!req.body.message) return res.status(400).json({ error: 'message is required' });
  res.json(await agent.chat(req.body.message, req.body.history));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// React single-page app: every other route returns index.html (React Router handles it).
app.get('*', (req, res) => {
  const indexFile = path.join(CLIENT_DIST, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(503).send('Frontend not built. Run "npm run build" then "npm start", or use "npm run dev" and open http://localhost:5173');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof multer.MulterError ? 400 : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(config.port, () => {
  console.log(`EarmarkPay running at ${config.baseUrl}`);
  console.log(`  PayPal: ${config.paypalMock ? 'DEMO MODE (simulated) - add PAYPAL_CLIENT_ID/SECRET to use the sandbox' : `sandbox (${config.paypal.apiBase})`}`);
  console.log(`  AI:     ${config.aiMock ? 'DEMO MODE (manual bill entry) - add GEMINI_API_KEY for AI' : `Gemini ${config.gemini.model}`}`);
});
