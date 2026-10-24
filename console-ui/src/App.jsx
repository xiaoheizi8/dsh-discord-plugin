import React, { useEffect, useState } from 'react';
import { api, TOKEN } from './api.js';
import { Dashboard, Whitelist, Sessions, Persona, Logs } from './pages.jsx';

const NAV = [
  { id: 'dashboard', icon: '▦', label: '仪表盘' },
  { id: 'whitelist', icon: '☰', label: '白名单' },
  { id: 'sessions', icon: '◈', label: '会话' },
  { id: 'persona', icon: '✎', label: '人格' },
  { id: 'logs', icon: '≡', label: '日志' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.status();
        if (alive) { setStatus(s); setErr(null); }
      } catch (e) {
        if (alive) setErr(e.message);
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!TOKEN) {
    return (
      <div className="center-screen">
        <div className="card token-card">
          <h2>🔑 需要控制台令牌</h2>
          <p>打开方式：<code>http://127.0.0.1:{window.location.port}/?token=你的consoleToken</code></p>
          <p className="muted">consoleToken 在项目根目录 config.json 里（首次启动自动生成）。带上 ?token= 访问一次即可记住。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="./favicon.svg" alt="logo" />
          <div>
            <div className="brand-name">DSH Console</div>
            <div className="brand-sub">Discord 桥接控制台</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-btn ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
              <span className="nav-icon">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {status ? (
            <>
              <div className={`dot ${status.discord.ready ? 'green' : 'red'}`} />
              <span>{status.discord.tag ?? '离线'}</span>
              <div className={`dot ${status.dsh.down ? 'red' : 'green'}`} style={{ marginLeft: 'auto' }} />
              <span>DSH</span>
            </>
          ) : <span className="muted">连接中…</span>}
        </div>
      </aside>
      <main className="content">
        {err && <div className="banner error">⚠️ {err}</div>}
        {page === 'dashboard' && <Dashboard status={status} />}
        {page === 'whitelist' && <Whitelist />}
        {page === 'sessions' && <Sessions />}
        {page === 'persona' && <Persona />}
        {page === 'logs' && <Logs />}
      </main>
    </div>
  );
}
