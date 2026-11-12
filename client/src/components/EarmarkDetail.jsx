import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, recipientLink, LANGUAGES } from '../lib/api';
import { useToast } from './Toast';
import Badge from './Badge';
import Stat from './Stat';
import FundCard from './FundCard';
import ReceiptGrid from './ReceiptGrid';
import ReceiptPanel from './ReceiptPanel';
import Spinner from './Spinner';

export default function EarmarkDetail({ earmark: em, receipts, onChanged }) {
  const toast = useToast();
  const [receiptId, setReceiptId] = useState(null);
  const [lang, setLang] = useState(em.language || 'English');
  const [report, setReport] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  const r = em.rules || {};
  const link = recipientLink(em.id);
  const selected = receipts.find((x) => x.id === receiptId) || receipts.find((x) => x.status === 'needs_review');

  const writeReport = async () => {
    setReportBusy(true);
    try {
      const { summary } = await api.get(`/api/earmarks/${em.id}/summary?lang=${encodeURIComponent(lang)}`);
      setReport(summary);
    } catch (e) {
      setReport(e.message);
    }
    setReportBusy(false);
  };

  const close = async () => {
    if (!window.confirm(`Close "${em.title}"? The PayPal authorization will be voided and ${money(em.remaining, em.currency)} will never be taken from your account.`)) return;
    setClosing(true);
    try {
      await api.post(`/api/earmarks/${em.id}/close`);
      toast('Earmark closed. The remaining hold was voided.');
    } catch (e) {
      toast(e.message, 'error');
    }
    setClosing(false);
    onChanged();
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{em.title}</h2>
          <div className="muted text-sm break-words">
            For {em.recipientName} ({em.recipientEmail}) · {em.purpose}
          </div>
        </div>
        <Badge status={em.status} />
      </div>

      {em.recipientRejected >= 2 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <strong>Trust warning:</strong> {em.recipientRejected} bills from {em.recipientName} were rejected.
          Auto-pay is off for this recipient. Every new bill waits for your approval.
        </div>
      )}

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Earmarked" value={money(em.amount, em.currency)} />
        <Stat label="Released" value={money(em.spent, em.currency)} />
        <Stat
          label={em.status === 'closed' ? 'Returned to you' : 'Still held'}
          value={money(em.status === 'closed' ? em.returnedAmount : em.remaining, em.currency)}
        />
      </div>

      <h3 className="mt-5 mb-1 text-sm font-semibold">Rules the AI enforces</h3>
      <p className="text-sm">{r.summary}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(r.allowed_categories || []).map((c) => <Badge key={c} tone="ok">{c}</Badge>)}
        {(r.blocked_keywords || []).map((c) => <Badge key={c} tone="bad">no {c}</Badge>)}
        {r.max_per_bill && <Badge tone="neutral">max {money(r.max_per_bill, em.currency)}/bill</Badge>}
        {r.review_threshold && <Badge tone="warn">review ≥ {money(r.review_threshold, em.currency)}</Badge>}
      </div>

      {em.status === 'draft' && <FundCard earmark={em} onFunded={onChanged} />}

      {em.status === 'funded' && (
        <>
          <h3 className="mt-5 mb-1 text-sm font-semibold">Recipient link</h3>
          <p className="muted mb-2 text-sm">Share this with {em.recipientName}. They upload bills here.</p>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-0 flex-1" readOnly value={link} aria-label="Recipient link" />
            <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(link).then(() => toast('Link copied'))}>Copy</button>
            <Link className="btn-secondary" to={`/r/${em.id}`} target="_blank">Open</Link>
          </div>
        </>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold">Bills</h3>
      <ReceiptGrid receipts={receipts} currency={em.currency} selectedId={selected?.id} onSelect={setReceiptId} />
      {selected && <ReceiptPanel key={selected.id} receipt={selected} earmark={em} onChanged={onChanged} />}

      <h3 className="mt-6 mb-2 text-sm font-semibold">AI spending report</h3>
      <div className="flex flex-wrap gap-2">
        <select className="input max-w-48" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Report language">
          {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
        </select>
        <button className="btn-secondary" onClick={writeReport} disabled={reportBusy}>
          {reportBusy && <Spinner />} Write report
        </button>
      </div>
      {report && <div className="mt-3 rounded-xl bg-slate-100 p-4 text-sm whitespace-pre-wrap dark:bg-slate-800/70">{report}</div>}

      {em.status === 'funded' && (
        <button className="btn-danger mt-6" onClick={close} disabled={closing}>
          {closing && <Spinner />} Close earmark &amp; void the rest
        </button>
      )}

      <details className="mt-6" open>
        <summary className="cursor-pointer text-sm font-semibold">Timeline</summary>
        <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4 dark:border-slate-800">
          {em.events.slice().reverse().map((e, i) => (
            <li key={i} className="text-sm">
              <div className="muted text-xs">{new Date(e.at).toLocaleString()}</div>
              {e.text}
            </li>
          ))}
        </ol>
        {em.authorizationId && (
          <div className="muted mt-3 font-mono text-xs break-all">
            PayPal order {em.orderId} · authorization {em.authorizationId}
            {em.authExpiresAt && ` · expires ${new Date(em.authExpiresAt).toLocaleDateString()}`}
          </div>
        )}
      </details>
    </div>
  );
}
