import React from 'react';
import { Card, PageHeader } from '../components/ui.jsx';

export default function Dashboard({ status }) {
  if (!status) {
    return (
      <>
        <PageHeader title="仪表盘" />
        <Card><p className="muted">加载中…</p></Card>
      </>
    );
  }
  const { discord, dsh, sessions, model, uptimeSec } = status;
  const cards = [
    { label: 'Discord Bot', value: discord.ready ? '在线' : '离线', sub: discord.tag ?? '', cls: discord.ready ? 'ok' : 'bad' },
    { label: 'DSH', value: dsh.down ? '不可用' : '可用', sub: dsh.baseUrl, cls: dsh.down ? 'bad' : 'ok' },
    { label: '活跃会话', value: sessions.count, sub: `回合中 ${sessions.activeTurns} · 排队 ${sessions.queued}`, cls: '' },
    { label: '模型', value: model.split('/')[1] ?? model, sub: `provider: ${model.split('/')[0]} · 运行 ${Math.floor(uptimeSec / 60)} 分钟`, cls: '' },
  ];
  return (
    <>
      <PageHeader title="仪表盘" />
      <div className="card-grid">
        {cards.map((c) => (
          <Card key={c.label} className={`stat ${c.cls}`}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-sub">{c.sub}</div>
          </Card>
        ))}
      </div>
      <Card>
        <h3>已接入的服务器</h3>
        {discord.guilds.length === 0 && <p className="muted">Bot 还没有被邀请进任何服务器</p>}
        <div className="guild-list">
          {discord.guilds.map((g) => (
            <div key={g.id} className="guild-item">
              <div className="guild-avatar">{g.name.slice(0, 1)}</div>
              <div>
                <div>{g.name}</div>
                <div className="muted mono">{g.id}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
