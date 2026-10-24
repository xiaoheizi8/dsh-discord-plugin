import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStatus } from '../hooks/useStatus.js';

const NAV = [
  { to: '/', icon: '▦', label: '仪表盘', end: true },
  { to: '/whitelist', icon: '☰', label: '白名单' },
  { to: '/sessions', icon: '◈', label: '会话' },
  { to: '/persona', icon: '✎', label: '人格' },
  { to: '/logs', icon: '≡', label: '日志' },
];

export default function Layout() {
  const { status, error } = useStatus();
  const location = useLocation();

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
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-btn ${isActive || (n.to === '/' && location.pathname === '/') ? 'active' : ''}`}
            >
              <span className="nav-icon">{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {status ? (
            <>
              <StatusDot ok={status.discord.ready} />
              <span>{status.discord.tag ?? '离线'}</span>
              <StatusDot ok={!status.dsh.down} />
              <span style={{ marginLeft: 'auto' }}>DSH</span>
            </>
          ) : (
            <span className="muted">连接中…</span>
          )}
        </div>
      </aside>
      <main className="content">
        {error && <div className="banner error">⚠️ {error}</div>}
        <Outlet />
      </main>
    </div>
  );
}

function StatusDot({ ok }) {
  return <span className={`dot ${ok ? 'green' : 'red'}`} />;
}
