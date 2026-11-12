import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import EarmarkGrid from '../components/EarmarkGrid';
import EarmarkDetail from '../components/EarmarkDetail';
import CreateForm from '../components/CreateForm';
import AgentChat from '../components/AgentChat';

export default function Sender() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id');
  const [earmarks, setEarmarks] = useState([]);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('create');

  const select = useCallback((id) => setParams(id ? { id } : {}, { replace: true }), [setParams]);

  const refresh = useCallback(async () => {
    try {
      const { earmarks: list } = await api.get('/api/earmarks');
      setEarmarks(list);
      if (selectedId) setDetail(await api.get(`/api/earmarks/${selectedId}`));
      else setDetail(null);
    } catch (e) {
      console.error(e);
    }
  }, [selectedId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const onAgentAction = async (actions) => {
    if (actions.some((a) => a.tool === 'create_earmark' && a.ok)) {
      const { earmarks: list } = await api.get('/api/earmarks');
      if (list[0]) return select(list[0].id);
    }
    refresh();
  };

  const tabClass = (t) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
      tab === t ? 'bg-white shadow-sm dark:bg-slate-900' : 'muted hover:text-slate-900 dark:hover:text-white'
    }`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 space-y-5">
        <div className="card">
          <h2 className="text-lg font-bold">Your earmarks</h2>
          <p className="muted mb-3 text-sm">Click a row to see its bills, AI checks and PayPal activity.</p>
          <EarmarkGrid earmarks={earmarks} selectedId={selectedId} onSelect={select} />
        </div>
        {detail ? (
          <EarmarkDetail key={detail.earmark.id} earmark={detail.earmark} receipts={detail.receipts} onChanged={refresh} />
        ) : (
          <div className="card muted">Create an earmark or pick one from the table.</div>
        )}
      </section>

      <aside className="min-w-0">
        <div className="card lg:sticky lg:top-20">
          <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button className={tabClass('create')} onClick={() => setTab('create')}>New earmark</button>
            <button className={tabClass('agent')} onClick={() => setTab('agent')}>Ask the agent</button>
          </div>
          <div hidden={tab !== 'create'}><CreateForm onCreated={select} /></div>
          <div hidden={tab !== 'agent'}><AgentChat onAction={onAgentAction} /></div>
        </div>
      </aside>
    </div>
  );
}
