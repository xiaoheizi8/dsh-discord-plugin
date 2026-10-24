import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Banner, PageHeader } from '../components/ui.jsx';

export default function Persona() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.persona().then(setData).catch((e) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.savePersona({ prefix: data.prefix, suffix: data.suffix });
      setMsg({ kind: 'ok', text: `✅ 已保存并重渲染 bundle${r.restartDsh ? ' —— 需要重启 DSH 后生效' : ''}` });
    } catch (e) {
      setMsg({ kind: 'error', text: '❌ ' + e.message });
    }
    setSaving(false);
  };

  if (!data) {
    return (
      <>
        <PageHeader title="人格" />
        <Card><p className="muted">加载中…</p></Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="人格" />
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <Card>
        <p className="muted">
          编辑 preset <code>{data.preset}</code> 的 persona 前缀（注入每条消息的 system prompt 开头）。
          源文件 <code>dsh/agent-presets/discord-chat/agent.cordis.yml</code> 会被同步更新。
        </p>
        <textarea
          className="persona-input"
          rows={18}
          value={data.prefix}
          onChange={(e) => setData({ ...data, prefix: e.target.value })}
          spellCheck={false}
        />
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '💾 保存（重渲染 DSH bundle）'}
        </button>
        {msg?.kind === 'ok' && msg.text.includes('重启 DSH') && (
          <p className="muted" style={{ marginTop: 8 }}>重启 DSH 后在频道里发消息验证新人格。</p>
        )}
      </Card>
    </>
  );
}
