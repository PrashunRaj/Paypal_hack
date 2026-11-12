import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money, STATUS } from '../lib/api';
import { useToast } from '../components/Toast';
import Badge from '../components/Badge';
import Stat from '../components/Stat';
import ChecksList from '../components/ChecksList';
import Spinner from '../components/Spinner';

const HEADLINE = {
  paid: (r, c) => `✓ ${money(r.paidAmount, c)} is on its way to your PayPal account.`,
  needs_review: () => 'The sender needs to approve this bill. You will be paid once they do.',
  rejected: () => 'This bill could not be paid.',
  error: () => 'Something went wrong while paying. The sender has been notified.',
  payout_failed: () => 'The payment was approved but could not be delivered yet. The sender can retry.',
};
const BORDER = { paid: 'border-l-emerald-500', needs_review: 'border-l-amber-500' };

function Finder() {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState('');
  return (
    <div className="mx-auto max-w-xl card">
      <h2 className="text-lg font-bold">Upload a bill</h2>
      <p className="muted mt-1 text-sm">Paste the link or code the sender shared with you.</p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const m = code.match(/em_[a-f0-9]+/);
          if (m) navigate(`/r/${m[0]}`);
          else toast('That does not look like an EarmarkPay link', 'error');
        }}
      >
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…/r/em_… or em_…" required />
        <button className="btn">Open</button>
      </form>
    </div>
  );
}

function UploadForm({ id, aiMock, onResult }) {
  const toast = useToast();
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [source, setSource] = useState('file');
  const [preview, setPreview] = useState(null);
  const [manual, setManual] = useState({ merchant: '', date: '', total: '', items: '', gstin: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const pick = (f, from) => {
    if (!f) return;
    setFile(f);
    setSource(from);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('receipt', file);
    fd.append('source', source);
    if (aiMock) Object.entries(manual).forEach(([k, v]) => fd.append(k, v));
    try {
      const { receipt } = await api.post(`/api/earmarks/${encodeURIComponent(id)}/receipts`, fd);
      onResult(receipt);
      setFile(null);
      setPreview(null);
      e.target.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const set = (k) => (e) => setManual((m) => ({ ...m, [k]: e.target.value }));

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="text-lg font-bold">Upload a bill</h2>
      <p className="muted mt-1 text-sm">
        Take a clear photo of the whole bill, including the shop name, date, items and total. You will be paid for the items that match the purpose.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => cameraRef.current.click()}>Take a photo of the bill</button>
        <button type="button" className="btn-secondary" onClick={() => fileRef.current.click()}>Upload a file</button>
      </div>
      <p className="muted mt-2 text-xs">Taking a live photo is preferred. Uploaded files get a closer look.</p>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files[0], 'camera')} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files[0], 'file')} />
      {file && (
        <div className="mt-3 text-sm">
          <span className="font-medium">{file.name}</span>
          <span className="muted"> · {source === 'camera' ? 'taken with camera' : 'uploaded from files'}</span>
        </div>
      )}
      {preview && <img src={preview} alt="Bill preview" className="mt-3 max-h-64 rounded-lg border border-slate-200 dark:border-slate-700" />}

      {aiMock && (
        <>
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-500/10">Demo mode (no AI key): type what is on the bill.</div>
          <label className="label" htmlFor="m-merchant">Shop name</label>
          <input id="m-merchant" className="input" value={manual.merchant} onChange={set('merchant')} placeholder="City Pharmacy" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="m-date">Date</label>
              <input id="m-date" className="input" type="date" value={manual.date} onChange={set('date')} />
            </div>
            <div>
              <label className="label" htmlFor="m-total">Total</label>
              <input id="m-total" className="input" type="number" step="0.01" value={manual.total} onChange={set('total')} />
            </div>
          </div>
          <label className="label" htmlFor="m-items">Items (name:price, comma separated)</label>
          <input id="m-items" className="input" value={manual.items} onChange={set('items')} placeholder="Metformin tablets:42, Beer:8" />
          <label className="label" htmlFor="m-gstin">GST number on the bill (optional)</label>
          <input id="m-gstin" className="input font-mono uppercase" value={manual.gstin} onChange={set('gstin')} placeholder="27AAPFU0939F1ZV" />
        </>
      )}

      <button className="btn mt-5 w-full sm:w-auto" disabled={busy || !file}>
        {busy ? <><Spinner /> AI is checking your bill…</> : 'Submit bill'}
      </button>
    </form>
  );
}

export default function Recipient() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/earmarks/${encodeURIComponent(id)}/public`));
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  if (!id) return <Finder />;
  if (error) return <div className="mx-auto max-w-xl card"><h2 className="text-lg font-bold">Link not found</h2><p className="muted">{error}</p></div>;
  if (!data) return <div className="mx-auto max-w-xl card flex items-center gap-2"><Spinner /> Loading…</div>;

  const c = data.currency;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{data.senderName} set aside money for you</h2>
            <div className="muted mt-1">For: <strong className="text-slate-900 dark:text-white">{data.purpose}</strong></div>
          </div>
          <Badge status={data.status} />
        </div>
        <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Set aside" value={money(data.amount, c)} />
          <Stat label="Paid to you" value={money(data.spent, c)} />
          <Stat label="Available" value={money(data.remaining, c)} />
        </div>
        <p className="text-sm"><strong>Rules:</strong> {data.rulesSummary}</p>
      </div>

      {data.status === 'funded' ? (
        <UploadForm id={id} aiMock={data.aiMock} onResult={(r) => { setResult(r); load(); }} />
      ) : (
        <div className="card">This earmark is {(STATUS[data.status]?.[0] || data.status).toLowerCase()}. No more bills can be uploaded.</div>
      )}

      {result && (
        <div className={`card border-l-4 ${BORDER[result.status] || 'border-l-red-500'}`}>
          <div className="flex items-start justify-between gap-3">
            <strong>{result.extraction?.merchant || 'Your bill'}</strong>
            <Badge status={result.status} />
          </div>
          <p className="mt-1">{(HEADLINE[result.status] || (() => result.status))(result, c)}</p>
          {result.excludedItems?.length > 0 && (
            <p className="mt-2 text-sm"><strong>Not covered:</strong> {result.excludedItems.map((i) => i.name).join(', ')}</p>
          )}
          <ChecksList checks={result.checks} />
        </div>
      )}

      {data.receipts.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-lg font-bold">Your bills</h2>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.receipts.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <div className="font-semibold">{r.merchant || 'Bill'}</div>
                  <div className="muted text-sm">
                    {new Date(r.uploadedAt).toLocaleString()} · bill {r.total != null ? money(r.total, c) : '—'} · paid {money(r.paidAmount, c)}
                  </div>
                </div>
                <Badge status={r.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
