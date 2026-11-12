import { useState } from 'react';
import { api, LANGUAGES } from '../lib/api';
import { useToast } from './Toast';
import Spinner from './Spinner';

const EMPTY = { title: '', recipientName: '', amount: '', recipientEmail: '', purpose: '', rulesText: '', senderName: '', language: 'English' };
const EXAMPLE = {
  title: "Mom's medicine", recipientName: 'Mom', amount: '300', purpose: 'Diabetes medicine and groceries', senderName: 'Raj',
  rulesText: 'Only medicine and groceries. No alcohol or cigarettes. Ask me before paying any bill over $100.',
};

export default function CreateForm({ onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { earmark } = await api.post('/api/earmarks', form);
      setForm(EMPTY);
      toast('Earmark created. Fund it with PayPal.');
      onCreated(earmark.id);
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit}>
      <label className="label" htmlFor="f-title">Name</label>
      <input id="f-title" className="input" value={form.title} onChange={set('title')} placeholder="Mom's medicine" required />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="f-rname">Recipient name</label>
          <input id="f-rname" className="input" value={form.recipientName} onChange={set('recipientName')} placeholder="Mom" />
        </div>
        <div>
          <label className="label" htmlFor="f-amount">Amount</label>
          <input id="f-amount" className="input" type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} placeholder="300" required />
        </div>
      </div>

      <label className="label" htmlFor="f-remail">Recipient PayPal email</label>
      <input id="f-remail" className="input" type="email" value={form.recipientEmail} onChange={set('recipientEmail')} placeholder="mom@example.com" required />

      <label className="label" htmlFor="f-purpose">What is it for?</label>
      <input id="f-purpose" className="input" value={form.purpose} onChange={set('purpose')} placeholder="Diabetes medicine and groceries" required />

      <label className="label" htmlFor="f-rules">Rules, in your own words</label>
      <textarea
        id="f-rules" className="input min-h-24" value={form.rulesText} onChange={set('rulesText')}
        placeholder="Only medicine and groceries. No alcohol or cigarettes. Ask me before paying any bill over $100."
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="f-sname">Your name</label>
          <input id="f-sname" className="input" value={form.senderName} onChange={set('senderName')} placeholder="Raj" />
        </div>
        <div>
          <label className="label" htmlFor="f-lang">Report language</label>
          <select id="f-lang" className="input" value={form.language} onChange={set('language')}>
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button className="btn flex-1" type="submit" disabled={busy}>
          {busy ? <><Spinner /> AI is reading your rules…</> : 'Create earmark'}
        </button>
        <button
          type="button" className="btn-secondary"
          onClick={() => { setForm((f) => ({ ...f, ...EXAMPLE })); toast('Now enter a sandbox personal account email as the recipient'); }}
        >
          Fill example
        </button>
      </div>
    </form>
  );
}
