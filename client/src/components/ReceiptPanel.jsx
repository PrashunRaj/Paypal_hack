import { useState } from 'react';
import { api, money } from '../lib/api';
import { useToast } from './Toast';
import Badge from './Badge';
import RiskBadge from './RiskBadge';
import ChecksList from './ChecksList';
import Spinner from './Spinner';

export default function ReceiptPanel({ receipt: r, earmark: em, onChanged }) {
  const toast = useToast();
  const [amount, setAmount] = useState(r.payableAmount || '');
  const [busy, setBusy] = useState(null);
  const x = r.extraction;
  const canReview = (r.status === 'needs_review' && em.status === 'funded') || r.status === 'payout_failed';

  const review = async (decision) => {
    setBusy(decision);
    try {
      const { receipt } = await api.post(`/api/receipts/${r.id}/review`, { decision, amount });
      const failed = ['error', 'payout_failed'].includes(receipt.status);
      toast(receipt.status === 'paid' ? `Released ${money(receipt.paidAmount, em.currency)} via PayPal` : `Bill ${receipt.status.replace('_', ' ')}`,
        failed ? 'error' : 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(null);
    onChanged();
  };

  return (
    <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-[180px_minmax(0,1fr)] dark:border-slate-800">
      <a href={r.file} target="_blank" rel="noreferrer" className="block">
        {r.mimeType === 'application/pdf' ? (
          <div className="grid h-40 place-items-center rounded-lg border border-slate-200 text-sm dark:border-slate-700">Open PDF bill</div>
        ) : (
          <img src={r.file} alt="Uploaded bill" className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
        )}
      </a>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="font-semibold">{x?.merchant || 'Bill'}</div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <RiskBadge score={r.riskScore} level={r.riskLevel} />
            <Badge status={r.status} />
          </div>
        </div>
        <div className="muted text-xs">
          {r.source === 'camera' ? 'Taken with the phone camera' : 'Uploaded from files'}
          {x?.gstin && <> · GSTIN <span className="font-mono">{x.gstin}</span></>}
        </div>
        {x ? (
          <>
            <div className="muted text-sm">
              {x.date || 'no date'} · total {x.total != null ? money(x.total, em.currency) : '—'} · AI confidence {Math.round((x.confidence || 0) * 100)}%
            </div>
            {x.reasoning && <p className="mt-2 text-sm">{x.reasoning}</p>}
          </>
        ) : (
          <p className="muted text-sm">{r.aiError || 'Not read'}</p>
        )}

        {x?.items?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {x.items.map((i, idx) => (
              <span key={idx} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                {i.name} · {money(i.price, em.currency)} · <span className="muted">{i.category}</span>
              </span>
            ))}
          </div>
        )}
        {r.excludedItems?.length > 0 && (
          <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm dark:bg-amber-500/10">
            <strong>Not paid for:</strong> {r.excludedItems.map((i) => `${i.name} (${i.reason})`).join(' · ')}
          </div>
        )}

        <ChecksList checks={r.checks} />

        {r.error && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{r.error}</div>}
        <div className="muted mt-1 space-y-0.5 font-mono text-xs break-all">
          {r.captureId && <div>PayPal capture {r.captureId}</div>}
          {r.payoutBatchId && <div>PayPal payout batch {r.payoutBatchId}</div>}
        </div>
        {r.reviewNote && <div className="muted mt-1 text-sm">Note: {r.reviewNote}</div>}

        {canReview && (
          <div className="mt-3 flex flex-wrap gap-2">
            {r.status === 'needs_review' && (
              <input
                className="input max-w-40"
                type="number" step="0.01" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount to release"
                aria-label="Amount to release"
              />
            )}
            <button className="btn" onClick={() => review('approve')} disabled={!!busy}>
              {busy === 'approve' && <Spinner />} {r.status === 'payout_failed' ? 'Retry payout' : 'Approve & pay'}
            </button>
            {r.status === 'needs_review' && (
              <button className="btn-secondary" onClick={() => review('reject')} disabled={!!busy}>
                {busy === 'reject' && <Spinner />} Reject
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
