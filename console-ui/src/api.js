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
    // 8 秒超时兜底：keep-alive 竞态等网络异常时 fetch 可能永远 pending，
    // 不设超时会卡死 usePolling 的重入锁，页面永远"连接中"
    signal: AbortSignal.timeout(8000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
  // token 失效：清掉记住的令牌，回到引导页重新输入
  if (res.status === 401) {
    localStorage.removeItem('dshConsoleToken');
    window.location.replace('/');
    throw new Error('控制台令牌已失效，请重新输入');
  }
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
