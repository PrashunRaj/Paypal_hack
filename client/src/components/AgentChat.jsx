import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import Badge from './Badge';
import Spinner from './Spinner';

const SUGGESTIONS = ["What's waiting for my review?", 'How much is left for Mom?', 'Write my report in Hindi'];
const GREETING = {
  role: 'model',
  text: 'Hi! I can create earmarks, tell you what is waiting for review, approve or reject bills, close earmarks and write reports. What would you like to do?',
};

export default function AgentChat({ onAction }) {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and React
  // would treat any returned value as a cleanup function and crash.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);

  const send = async (text) => {
    if (!text.trim() || busy) return;
    const history = messages.slice(1).map(({ role, text: t }) => ({ role, text: t }));
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setBusy(true);
    try {
      const { reply, actions } = await api.post('/api/agent', { message: text, history });
      setMessages((m) => [...m, { role: 'model', text: reply, actions }]);
      if (actions.length) onAction(actions);
    } catch (e) {
      setMessages((m) => [...m, { role: 'model', text: `Error: ${e.message}` }]);
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="flex h-96 flex-col gap-2 overflow-y-auto p-1" aria-live="polite">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[90%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
              m.role === 'user' ? 'self-end bg-blue-600 text-white' : 'self-start bg-slate-100 dark:bg-slate-800'
            }`}
          >
            {m.text}
            {m.actions?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.actions.map((a, j) => <Badge key={j} tone={a.ok ? 'ok' : 'bad'}>{a.tool}</Badge>)}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 self-start rounded-2xl bg-slate-100 px-3.5 py-2 text-sm dark:bg-slate-800">
            <Spinner /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="my-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => send(s)} disabled={busy}>{s}</button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input
          className="input" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off"
          placeholder="e.g. Send $150 to dad@example.com for school books, no toys" aria-label="Message the agent"
        />
        <button className="btn" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
