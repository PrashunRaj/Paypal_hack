import { STATUS } from '../lib/api';

const TONES = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  bad: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export default function Badge({ status, tone, children }) {
  const [label, statusTone] = STATUS[status] || [status, 'neutral'];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone || statusTone]}`}>
      {children ?? label}
    </span>
  );
}
