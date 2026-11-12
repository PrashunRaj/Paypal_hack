import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { api } from './lib/api';
import { ConfigContext } from './lib/config';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Sender from './pages/Sender';
import Recipient from './pages/Recipient';
import Spinner from './components/Spinner';

export default function App() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const location = useLocation();

  useEffect(() => {
    api.get('/api/config').then(setConfig).catch((e) => setError(e.message));
  }, []);

  return (
    <ConfigContext.Provider value={config}>
      <ToastProvider>
        <Layout>
          {error ? (
            <div className="card">Could not reach the server: {error}</div>
          ) : !config ? (
            <div className="card flex items-center gap-2"><Spinner /> Loading…</div>
          ) : (
            <ErrorBoundary key={location.pathname}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/sender" element={<Sender />} />
                <Route path="/r" element={<Recipient />} />
                <Route path="/r/:id" element={<Recipient />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          )}
        </Layout>
      </ToastProvider>
    </ConfigContext.Provider>
  );
}
