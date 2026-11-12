# EarmarkPay

**Send money for a purpose. Release it only on proof.**

People send money home every day for a specific need: a parent's medicine, a sibling's school fees, a family's groceries. Today they have no way to know it was used for that, and donors to individual families have the same worry.

EarmarkPay holds the money with a **PayPal authorization**. The recipient photographs each bill. **AI reads the bill** and checks it against the sender's rules, and PayPal **captures and pays out only the verified amount**. When the sender closes the earmark, the remaining authorization is voided, so unused money is never taken.

## Features

| | Feature | How it works |
|---|---|---|
| 1 | **Rules in your own words** | "Only medicine and groceries. No alcohol. Ask me above $100." Gemini turns this into a structured policy (allowed categories, blocked items, per-bill limit, review threshold). |
| 2 | **Money held, not sent** | PayPal Orders v2 with `intent: AUTHORIZE`. The sender approves with the PayPal button, and the funds are reserved for up to 29 days. |
| 3 | **AI bill verification** | Gemini vision reads the merchant, date, total and every line item, labels each item's category, and flags signs of tampering (items that don't add up to the total, overwritten digits, template-looking bills). |
| 4 | **Item-level payment** | A pharmacy bill with medicine plus beer pays for the medicine only. Blocked or off-purpose items are excluded from the amount. |
| 5 | **Fraud protection** | Duplicate bills, totals checked by code, GST number check-digit validation, bill-splitting and too-many-bills detection, a recipient trust score, and a 0–100 **risk score** on every bill. See [Fraud protection](#fraud-protection). |
| 6 | **Exact capture + payout** | An approved bill triggers a partial capture of the authorization for exactly that amount, then **PayPal Payouts** sends it to the recipient's PayPal account. |
| 7 | **Sender review queue** | Flagged bills wait for the sender, who can approve (optionally changing the amount) or reject. |
| 8 | **Close & void** | One click voids the remaining authorization. The money never leaves the sender's account. |
| 9 | **AI agent** | Chat with an agent (Gemini function calling) that can create earmarks, find bills waiting for review, approve or reject them, close earmarks and write reports. |
| 10 | **Reports in any language** | AI-written spending report in Hindi, Spanish, Tagalog, Arabic and more. |
| 11 | **Ledger with AG Grid** | Sortable, filterable grids of earmarks and bills with status and risk. |
| 12 | **Camera-first upload** | On phones, the recipient page opens the camera for a live photo. Each bill records whether it was taken live or uploaded from files. |

## Fraud protection

Bill photos can be faked, so EarmarkPay assumes some will be. It makes cheating **hard, small and visible**:

- **Money is held, never handed over upfront.** The worst case is one bill, not the whole amount.
- **Big or risky bills always go to a human.**
- **Every decision is explained** check by check.

### Checks on every bill ([server/rules.js](server/rules.js))

| Check | How | Result if it trips |
|---|---|---|
| **Reused bill** | SHA-256 hash of the file, plus merchant + date + total compared with earlier bills | Rejected |
| **Not a real bill** | Gemini vision: random photos, blank templates, chat screenshots | Rejected |
| **Items don't add up** | **Code** (not the AI) checks that items + tax − discount = total, within 3% | Sender review |
| **Fake GST number** | The GSTIN on Indian bills is validated with its government mod-36 check digit and state code ([server/gstin.js](server/gstin.js)) | Sender review |
| **Signs of editing** | Gemini flags overwritten digits, mismatched fonts, AI-generated or template look | Sender review |
| **Bill splitting** | A 3rd bill in a week just under the review limit (e.g. $95, $96, $97 with a $100 limit) | Sender review |
| **Too many bills** | More than 5 bills in 24 hours (configurable in the rules) | Sender review |
| **Recipient trust** | After 2 rejected bills, auto-pay is switched off for that recipient and the sender sees a trust warning | Sender review |
| **Wrong purpose** | Each item is categorised; off-purpose and blocked items are excluded from payment | Item not paid / rejected |
| **Date** | Future-dated, or older than 60 days | Sender review |
| **Limits** | Per-bill cap and the sender's "ask me above $X" | Sender review |
| **Low AI confidence** | The AI is less than 60% sure of the numbers | Sender review |

Each bill also gets a **risk score from 0 to 100** (low / medium / high), shown in the bills table.

### What it can't catch yet (honest limits)
- A **well-made fake** bill with a valid GSTIN and correct arithmetic.
- A **real bill from someone else's purchase**, or buying an item, uploading the bill, then returning the item.
- In demo mode (no AI key), the image itself isn't checked, only the details typed in.

### Roadmap: making fake bills impossible
The real fix is to stop relying on photos and **make the payment itself the proof**:
1. **Pay shops directly, locked by category.** Money goes from the PayPal hold straight to approved shop types (pharmacy, grocery, school), verified by card-network merchant category codes, the same way purpose-locked cards work. There's no bill to fake.
2. **Partner merchants on PayPal.** Pharmacies and schools send **itemised orders from their own checkout systems** through PayPal, so the proof comes from the shop, not a photo.
3. **Government-signed e-invoices.** Verify India's GST e-invoice QR codes (IRN), which are digitally signed by the government portal and can't be forged.
4. **E-prescription matching** for medicine: release money only for what a doctor prescribed and the pharmacy dispensed.
5. **PayPal webhooks** for payout confirmation, and **shop reputation** across all users to spot bad merchants.

Even then, a shop could collude with the recipient. That risk is handled with verified merchant onboarding and monitoring, but fake bills themselves would be eliminated.

## Architecture

```
 Sender (browser)                    EarmarkPay server (Node/Express)                 External
 ─────────────────                   ────────────────────────────────                 ────────
 Create earmark ──────────────────▶  ai.parseRules ─────────────────────────────▶  Gemini
 PayPal button (JS SDK) ──────────▶  paypal.createAuthorizeOrder / authorizeOrder ▶ PayPal Orders v2
                                                                                      (hold funds)
 Recipient (phone)
 ─────────────────
 Upload bill photo ───────────────▶  ai.verifyReceipt (vision) ───────────────────▶ Gemini
                                     rules.evaluate (deterministic policy engine)
                                       ├─ approve ─▶ paypal.captureAuthorization ─▶ PayPal Payments v2
                                       │             paypal.createPayout ─────────▶ PayPal Payouts v1
                                       ├─ review  ─▶ sender approves / rejects
                                       └─ reject
 Close earmark ───────────────────▶  paypal.voidAuthorization ────────────────────▶ PayPal Payments v2
 Agent chat ──────────────────────▶  agent.chat (function calling over the same services) ▶ Gemini
```

The AI **reads** the bill. A deterministic rule engine ([server/rules.js](server/rules.js)) **decides** what happens to the money, so every payment decision can be explained check by check.

```
Paypal_hack/
├── server/
│   ├── index.js              # Express app + REST routes
│   ├── config.js             # env config, demo-mode detection
│   ├── paypal.js             # PayPal OAuth, Orders (authorize), capture, void, Payouts
│   ├── ai.js                 # Gemini: rules parsing, receipt vision, reports (+ no-AI fallbacks)
│   ├── rules.js              # policy engine: pass / warn / fail checks -> approve / review / reject, risk score
│   ├── gstin.js              # Indian GST number validation (format, state code, check digit)
│   ├── agent.js              # Gemini function-calling agent
│   ├── store.js              # JSON-file storage (data/db.json, data/uploads/)
│   └── services/earmarks.js  # business logic shared by routes and agent
├── client/                   # React 18 + Vite + Tailwind CSS v4
│   ├── index.html
│   └── src/
│       ├── main.jsx, App.jsx, index.css
│       ├── lib/              # api client, config context, helpers
│       ├── pages/            # Landing, Sender (/sender), Recipient (/r/:id)
│       └── components/       # EarmarkGrid & ReceiptGrid (AG Grid React), FundCard (PayPal React SDK),
│                             # ReceiptPanel, EarmarkDetail, CreateForm, AgentChat, Badge, Toast…
├── scripts/smoke-test.js     # end-to-end API test in demo mode
├── vite.config.mjs           # dev server proxies /api and /uploads to Express
├── render.yaml               # one-click deploy to Render
├── .env.example
└── LICENSE (MIT)
```

## Run it locally

Requirements: **Node.js 18+**.

```bash
git clone <this repo>
cd Paypal_hack
npm install
cp .env.example .env      # Windows: copy .env.example .env

# Development (hot reload): API on :3000, React on :5173
npm run dev               # open http://localhost:5173

# Production: build the React app, Express serves it
npm run build
npm start                 # open http://localhost:3000
```

**It runs with no keys at all.** Without keys, PayPal calls are simulated and bills are typed in by hand, so you can try the full flow right away. Add the free keys below to use the real PayPal sandbox and real AI.

Run the end-to-end test (demo mode): `npm run check`

### 1. PayPal sandbox keys (free)
1. Sign in at [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials** → make sure **Sandbox** is selected → **Create App** (type: Merchant).
2. Copy the **Client ID** and **Secret** into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. In the app's settings, make sure **Payouts** is enabled under features.
4. Go to **Testing Tools → Sandbox Accounts**. You get a default *Business* account (the app) and a *Personal* account.
   - Use the **Personal** account to log in on the PayPal button (it plays the sender).
   - Create a second **Personal** account and use its email as the **recipient email** (it receives the payouts).
   - Log in to [sandbox.paypal.com](https://www.sandbox.paypal.com) with these accounts to see the money move.

### 2. Gemini API key (free tier)
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key**.
2. Put it in `.env` as `GEMINI_API_KEY`.
3. `GEMINI_MODEL` defaults to `gemini-3.5-flash`. You can set it to any current Flash model that supports images and function calling.

## Try the demo flow
1. Open **/sender** → **Fill example** → enter your recipient sandbox email → **Create earmark**. Watch the AI turn the rules into a policy.
2. Click the **PayPal** button and approve with the sandbox Personal account. The status becomes **Active**, and the timeline shows the authorization ID.
3. Copy the **recipient link** and open it on your phone (or in another tab).
4. Upload a **pharmacy bill** that includes a blocked item. It's paid automatically, minus the blocked item, and the payout appears in the recipient's sandbox account.
5. Upload the **same bill again**. It's rejected as a duplicate.
6. Upload a **bill over $100**. It waits in the sender's review queue → **Approve & pay**.
7. Open **Ask the agent**: "What's waiting for my review?" / "Write my report in Hindi".
8. **Close earmark**. The remaining authorization is voided.

### Try the fraud checks
Use a different image file for each bill. In demo mode, type the details shown.

| Upload | Expected |
|---|---|
| Items `Insulin:40`, total `90` | **Flagged:** items add up to 40.00 but the total says 90.00 (high risk) |
| Items `Paracetamol tablets:20`, GSTIN `27AAPFU0939F1ZX` | **Flagged:** GST number check digit is wrong |
| Same, with GSTIN `27AAPFU0939F1ZV` (a valid published example) | GST check passes |
| Three bills of `95`, `96`, `97` (limit $100) | The third is **flagged as a split bill** |
| Reject two bills, then upload a normal one | **Trust warning**, and the normal bill waits for approval |

## Deploy (free) on Render
1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, then pick the repo (it reads `render.yaml`).
3. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY`, and `BASE_URL` (your `https://<name>.onrender.com` URL).

Note: Render's free tier storage is temporary, so data resets when the service restarts. That's fine for a demo.

## Tools and how they're used

| Tool | Used for |
|---|---|
| **PayPal Orders v2** (`intent: AUTHORIZE`) | Holding the sender's money without moving it |
| **PayPal JS SDK** via `@paypal/react-paypal-js` (Buttons) | Sender approves the hold |
| **PayPal Payments v2** (capture / void authorization) | Capturing exactly the verified amount, voiding the rest |
| **PayPal Payouts v1** | Sending released money to the recipient's PayPal account |
| **Google Gemini** (vision + JSON mode) | Reading bills: merchant, date, total, line items, categories, tamper signals |
| **Google Gemini** (JSON mode) | Turning plain-language rules into a policy |
| **Google Gemini** (function calling) | Sender's agent that acts on earmarks and bills |
| **Google Gemini** (text) | Spending reports in the sender's language |
| **AG Grid Community** (`ag-grid-react`) | Earmark and bill ledgers |
| **React 18 + Vite + Tailwind CSS v4** | Frontend |
| **Render** | Hosting |

## Limitations & next steps
- A PayPal authorization can be captured for up to 29 days (with a 3-day honor period). Longer earmarks would need reauthorization or PayPal Vault for recurring funding.
- In production, holding and forwarding money between people needs a licensed setup (for example PayPal's multiparty/marketplace flows, or paying the pharmacy or school directly as the merchant).
- Bill photos can be faked; see [Fraud protection](#fraud-protection) for what is caught today and the roadmap to remove bills entirely.
- Next: pay merchants directly, WhatsApp bill upload, recurring monthly earmarks, perceptual image hashing to catch re-photographed duplicates.

## License
[MIT](LICENSE)
