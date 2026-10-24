const params = new URLSearchParams(window.location.search);
const saved = localStorage.getItem('dshConsoleToken');
export const TOKEN = params.get('token') || saved || '';
if (params.get('token')) {
  localStorage.setItem('dshConsoleToken', params.get('token'));
  params.delete('token');
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  status: () => request('/api/status'),
  config: () => request('/api/config'),
  saveConfig: (body) => request('/api/config', { method: 'PUT', body: JSON.stringify(body) }),
  sessions: () => request('/api/sessions'),
  resetSession: (key) => request('/api/sessions/reset', { method: 'POST', body: JSON.stringify({ key }) }),
  persona: () => request('/api/persona'),
  savePersona: (body) => request('/api/persona', { method: 'PUT', body: JSON.stringify(body) }),
  logs: (since) => request(`/api/logs${since !== undefined ? `?since=${since}` : ''}`),
};
