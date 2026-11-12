const STYLE = {
  pass: ['✓', 'text-emerald-600 dark:text-emerald-400'],
  warn: ['!', 'text-amber-600 dark:text-amber-400'],
  fail: ['✕', 'text-red-600 dark:text-red-400'],
};

export default function ChecksList({ checks = [] }) {
  return (
    <ul className="my-2 divide-y divide-slate-200 dark:divide-slate-800">
      {checks.map((c, i) => {
        const [icon, color] = STYLE[c.status] || STYLE.warn;
        return (
          <li key={`${c.id}-${i}`} className="flex gap-3 py-2">
            <span className={`w-5 shrink-0 text-center font-bold ${color}`}>{icon}</span>
            <div>
              <div className="text-sm font-semibold">{c.label}</div>
              <div className="muted text-sm">{c.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
