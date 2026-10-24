import React, { useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Card, Banner, PageHeader, Tag } from '../components/ui.jsx';

export default function Sessions() {
  const { data, refresh } = usePolling(() => api.sessions(), 5000);
  const [msg, setMsg] = useState(null);

  const reset = async (key) => {
    if (!confirm(`确定重置会话 ${key} 吗？上下文将被清空并归档。`)) return;
    try {
      await api.resetSession(key);
      setMsg({ kind: 'ok', text: `✅ 已重置 ${key}` });
      refresh();
    } catch (e) {
      setMsg({ kind: 'error', text: '❌ ' + e.message });
    }
  };

  return (
    <>
      <PageHeader title="会话" />
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <Card>
        {!data && <p className="muted">加载中…</p>}
        {data?.sessions.length === 0 && <p className="muted">还没有任何会话——去 Discord 频道里发条消息</p>}
        {data && data.sessions.length > 0 && (
          <table>
            <thead>
              <tr><th>频道 / 私信</th><th>DSH 会话</th><th>状态</th><th>排队</th><th></th></tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.key}>
                  <td className="mono">{s.key}</td>
                  <td className="mono muted">{s.sessionId}</td>
                  <td>{s.turnActive ? <Tag kind="amber">回合中</Tag> : <Tag kind="green">空闲</Tag>}</td>
                  <td>{s.queued || '-'}</td>
                  <td><button className="danger sm" onClick={() => reset(s.key)}>重置</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
