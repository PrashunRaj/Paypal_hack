export default function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800/70">
      <div className="muted text-xs font-medium tracking-wide uppercase">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
