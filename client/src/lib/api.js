async function req(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  get: (url) => req('GET', url),
  post: (url, body) => req('POST', url, body ?? {}),
};

export function money(n, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n) || 0);
  } catch {
    return `${(Number(n) || 0).toFixed(2)} ${currency}`;
  }
}

export const STATUS = {
  draft: ['Needs funding', 'warn'],
  funded: ['Active', 'info'],
  completed: ['Fully released', 'ok'],
  closed: ['Closed', 'neutral'],
  paid: ['Paid', 'ok'],
  processing: ['Processing', 'info'],
  needs_review: ['Needs your review', 'warn'],
  rejected: ['Rejected', 'bad'],
  error: ['Error', 'bad'],
  payout_failed: ['Payout failed', 'bad'],
};

export const LANGUAGES = ['English', 'Hindi', 'Spanish', 'Tagalog', 'Bengali', 'Arabic', 'French', 'Portuguese'];

export const recipientLink = (id) => `${window.location.origin}/r/${id}`;
