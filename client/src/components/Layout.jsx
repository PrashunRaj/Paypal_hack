import { Link, NavLink } from 'react-router-dom';
import { useConfig } from '../lib/config';
import Badge from './Badge';

export default function Layout({ children }) {
  const config = useConfig();
  const nav = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'muted hover:text-slate-900 dark:hover:text-white'}`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 text-lg font-bold">
              <span className="grid size-7 place-items-center rounded-lg bg-blue-600 text-sm text-white">E</span>
              EarmarkPay
            </Link>
            <nav className="hidden gap-1 sm:flex">
              <NavLink to="/sender" className={nav}>Sender</NavLink>
              <NavLink to="/r" className={nav}>Recipient</NavLink>
            </nav>
          </div>
          {config && (
            <div className="flex flex-wrap gap-2">
              {config.paypalMock ? <Badge tone="warn">PayPal: demo mode</Badge> : <Badge tone="ok">PayPal sandbox</Badge>}
              {config.aiMock ? <Badge tone="warn">AI: demo mode</Badge> : <Badge tone="ok">AI: {config.model}</Badge>}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
