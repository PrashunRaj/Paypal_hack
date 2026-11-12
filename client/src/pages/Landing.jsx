import { Link } from 'react-router-dom';

const STEPS = [
  ['Set the purpose', 'Write the rules in your own words: "Medicine only, no alcohol, ask me above $100." AI turns them into a policy.'],
  ['PayPal holds the money', 'You approve a PayPal authorization. The money is reserved, not sent.'],
  ['AI checks each bill', 'The recipient photographs a bill. AI reads the items, matches them to the purpose, and spots duplicates and edited totals.'],
  ["Pay exactly what's verified", 'PayPal captures just that amount and pays it out. Close the earmark anytime and the rest is voided.'],
];

export default function Landing() {
  return (
    <div className="py-6 sm:py-12">
      <section className="max-w-3xl">
        <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          PayPal + AI
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Send money for a purpose. Release it only on proof.
        </h1>
        <p className="muted mt-4 text-lg text-pretty">
          Earmark money for a parent's medicine, a sibling's school fees, or a family's groceries. PayPal holds it. AI checks every bill.
          Only what matches the purpose is paid, and the rest is never taken from you.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/sender" className="btn px-5 py-2.5 text-base">I'm sending money</Link>
          <Link to="/r" className="btn-secondary px-5 py-2.5 text-base">I received a link</Link>
        </div>
      </section>

      <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, text], i) => (
          <div key={title} className="card">
            <div className="grid size-8 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              {i + 1}
            </div>
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="muted mt-1 text-sm">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
