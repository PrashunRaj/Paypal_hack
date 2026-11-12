// Tiny JSON-file database. Good enough for a hackathon demo; swap for Postgres later.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const uploadsDir = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

let db = { earmarks: [], receipts: [] };
try {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) {
  console.warn('Could not read db.json, starting fresh:', e.message);
}
db.earmarks ||= [];
db.receipts ||= [];

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = {
  uploadsDir,
  save,
  earmarks: () => db.earmarks,
  getEarmark: (id) => db.earmarks.find((e) => e.id === id),
  insertEarmark(e) {
    db.earmarks.push(e);
    save();
    return e;
  },
  receiptsFor: (earmarkId) => db.receipts.filter((r) => r.earmarkId === earmarkId),
  getReceipt: (id) => db.receipts.find((r) => r.id === id),
  findReceipt: (pred) => db.receipts.find(pred),
  findAllReceipts: (pred) => db.receipts.filter(pred),
  insertReceipt(r) {
    db.receipts.push(r);
    save();
    return r;
  },
};
