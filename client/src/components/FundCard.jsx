import { useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { api } from '../lib/api';
import { useConfig } from '../lib/config';
import { useToast } from './Toast';
import Spinner from './Spinner';

// Funding = PayPal authorization. Money is held on the sender's account, not moved.
export default function FundCard({ earmark, onFunded }) {
  const config = useConfig();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const createOrder = async () => (await api.post(`/api/earmarks/${earmark.id}/order`)).orderId;
  const authorize = async (orderId) => {
    await api.post(`/api/earmarks/${earmark.id}/authorize`, { orderId });
    toast('Funds authorized. PayPal is holding the money.');
    onFunded();
  };

  const simulate = async () => {
    setBusy(true);
    try {
      await authorize(await createOrder());
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/30 dark:bg-blue-500/10">
      <div className="font-semibold">Fund this earmark</div>
      <p className="muted mt-1 mb-4 text-sm">
        Approve with PayPal. The money is <em>authorized</em> (held), not sent. It is captured only when a bill passes the AI checks.
      </p>
      {config.paypalMock ? (
        <button className="btn" onClick={simulate} disabled={busy}>
          {busy && <Spinner />} Simulate PayPal approval (demo mode)
        </button>
      ) : (
        <div className="max-w-sm">
          <PayPalScriptProvider
            options={{ clientId: config.paypalClientId, currency: config.currency, intent: 'authorize', components: 'buttons' }}
          >
            <PayPalButtons
              style={{ layout: 'vertical', shape: 'rect', label: 'paypal' }}
              createOrder={createOrder}
              onApprove={(data) => authorize(data.orderID).catch((e) => toast(e.message, 'error'))}
              onError={(err) => toast(err?.message || 'PayPal error', 'error')}
            />
          </PayPalScriptProvider>
        </div>
      )}
    </div>
  );
}
