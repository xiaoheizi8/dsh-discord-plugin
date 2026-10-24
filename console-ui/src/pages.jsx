import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// ── 仪表盘 ──────────────────────────────────────────────────────────────────
export function Dashboard({ status }) {
  if (!status) return <h2>仪表盘</h2>;
  const { discord, dsh, sessions, model, uptimeSec } = status;
  const cards = [
    { label: 'Discord Bot', value: discord.ready ? '在线' : '离线', sub: discord.tag ?? '', cls: discord.ready ? 'ok' : 'bad' },
    { label: 'DSH', value: dsh.down ? '不可用' : '可用', sub: dsh.baseUrl, cls: dsh.down ? 'bad' : 'ok' },
    { label: '活跃会话', value: sessions.count, sub: `回合中 ${sessions.activeTurns} · 排队 ${sessions.queued}`, cls: '' },
    { label: '模型', value: model.split('/')[1] ?? model, sub: `provider: ${model.split('/')[0]} · 运行 ${Math.floor(uptimeSec / 60)} 分钟`, cls: '' },
  ];
  return (
    <>
      <h2>仪表盘</h2>
      <div className="card-grid">
        {cards.map((c) => (
          <div key={c.label} className={`card stat ${c.cls}`}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="card">
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
      </div>
    </>
  );
}

// ── 白名单 ──────────────────────────────────────────────────────────────────
export function Whitelist() {
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [inputs, setInputs] = useState({});

  const load = async () => setCfg(await api.config());
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);

  if (!cfg) return <h2>白名单</h2>;
  const groups = [
    { key: 'guilds', title: '服务器', hint: '整个服务器放行' },
    { key: 'channels', title: '频道', hint: '只放行指定频道' },
    { key: 'users', title: '用户（私信）', hint: '只放行指定用户的私信' },
  ];

  const addItem = (list, key) => {
    const v = (inputs[list + key] ?? '').trim();
    if (!v) return;
    if (cfg[list][key].includes(v)) return;
    setCfg({ ...cfg, [list]: { ...cfg[list], [key]: [...cfg[list][key], v] } });
    setInputs({ ...inputs, [list + key]: '' });
  };
  const delItem = (list, key, idx) => {
    const arr = cfg[list][key].filter((_, i) => i !== idx);
    setCfg({ ...cfg, [list]: { ...cfg[list], [key]: arr } });
  };

  const save = async () => {
    try {
      await api.saveConfig({
        allow: cfg.allow, deny: cfg.deny,
        allowAllWhenEmpty: cfg.allowAllWhenEmpty,
        ackReaction: cfg.ackReaction,
      });
      setMsg({ ok: true, text: '✅ 已保存并热生效（无需重启桥接）' });
    } catch (e) { setMsg({ ok: false, text: '❌ ' + e.message }); }
  };

  const renderList = (listKey, g) => (
    <div className="wl-group" key={listKey + g.key}>
      <div className="wl-title">{g.title} <span className="muted">· {g.hint}</span></div>
      <div className="wl-items">
        {cfg[listKey][g.key].map((id, i) => (
          <span key={id + i} className="chip">
            <span className="mono">{id}</span>
            <button className="chip-x" onClick={() => delItem(listKey, g.key, i)}>×</button>
          </span>
        ))}
        {cfg[listKey][g.key].length === 0 && <span className="muted">（空）</span>}
      </div>
      <div className="wl-add">
        <input
          placeholder={`输入 ${g.title} ID`}
          value={inputs[listKey + g.key] ?? ''}
          onChange={(e) => setInputs({ ...inputs, [listKey + g.key]: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addItem(listKey, g.key)}
        />
        <button onClick={() => addItem(listKey, g.key)}>添加</button>
      </div>
    </div>
  );

  return (
    <>
      <h2>白名单</h2>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="card">
        <h3>✅ 允许（任一命中即放行）</h3>
        {groups.map((g) => renderList('allow', g))}
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={cfg.allowAllWhenEmpty}
            onChange={(e) => setCfg({ ...cfg, allowAllWhenEmpty: e.target.checked })}
          />
          白名单为空时响应所有消息（<b>不推荐</b>，等于对所有频道开放）
        </label>
      </div>
      <div className="card">
        <h3>🚫 拒绝（永远优先于白名单）</h3>
        {groups.map((g) => renderList('deny', g))}
      </div>
      <div className="card">
        <h3>💬 消息回应</h3>
        <div className="wl-add">
          <input
            placeholder="收到消息时的 emoji 回应，如 🫡（留空关闭）"
            value={cfg.ackReaction ?? ''}
            onChange={(e) => setCfg({ ...cfg, ackReaction: e.target.value })}
          />
        </div>
      </div>
      <button className="primary" onClick={save}>💾 保存并热生效</button>
    </>
  );
}

// ── 会话 ────────────────────────────────────────────────────────────────────
export function Sessions() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = async () => setData(await api.sessions());
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const reset = async (key) => {
    if (!confirm(`确定重置会话 ${key} 吗？上下文将被清空并归档。`)) return;
    try {
      await api.resetSession(key);
      setMsg({ ok: true, text: `✅ 已重置 ${key}` });
      load();
    } catch (e) { setMsg({ ok: false, text: '❌ ' + e.message }); }
  };

  return (
    <>
      <h2>会话</h2>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="card">
        {!data && <p className="muted">加载中…</p>}
        {data && data.sessions.length === 0 && <p className="muted">还没有任何会话——去 Discord 频道里发条消息</p>}
        {data && data.sessions.length > 0 && (
          <table>
            <thead><tr><th>频道 / 私信</th><th>DSH 会话</th><th>状态</th><th>排队</th><th></th></tr></thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.key}>
                  <td className="mono">{s.key}</td>
                  <td className="mono muted">{s.sessionId}</td>
                  <td>{s.turnActive ? <span className="tag amber">回合中</span> : <span className="tag green">空闲</span>}</td>
                  <td>{s.queued || '-'}</td>
                  <td><button className="danger sm" onClick={() => reset(s.key)}>重置</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── 人格 ────────────────────────────────────────────────────────────────────
export function Persona() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const areaRef = useRef(null);

  useEffect(() => { api.persona().then(setData).catch((e) => setMsg({ ok: false, text: e.message })); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.savePersona({ prefix: data.prefix, suffix: data.suffix });
      setMsg({ ok: true, text: `✅ 已保存并重渲染 bundle${r.restartDsh ? ' —— 需要重启 DSH 后生效' : ''}` });
    } catch (e) { setMsg({ ok: false, text: '❌ ' + e.message }); }
    setSaving(false);
  };

  if (!data) return <h2>人格</h2>;
  return (
    <>
      <h2>人格</h2>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="card">
        <p className="muted">
          编辑 preset <code>{data.preset}</code> 的 persona 前缀（会注入每一条消息的 system prompt 开头）。
          源文件 <code>dsh/agent-presets/discord-chat/agent.cordis.yml</code> 会被同步更新。
        </p>
        <textarea
          ref={areaRef}
          className="persona-input"
          rows={18}
          value={data.prefix}
          onChange={(e) => setData({ ...data, prefix: e.target.value })}
          spellCheck={false}
        />
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '💾 保存（重渲染 DSH bundle）'}
        </button>
        {msg?.ok && msg.text.includes('重启 DSH') && (
          <p className="muted" style={{ marginTop: 8 }}>重启 DSH 后在频道里发消息验证新人格。</p>
        )}
      </div>
    </>
  );
}

// ── 日志 ────────────────────────────────────────────────────────────────────
export function Logs() {
  const [logs, setLogs] = useState([]);
  const [paused, setPaused] = useState(false);
  const sinceRef = useRef(-1);
  const boxRef = useRef(null);

  useEffect(() => {
    if (paused) return;
    const tick = async () => {
      try {
        const r = await api.logs(sinceRef.current);
        if (r.logs.length) {
          sinceRef.current = r.last;
          setLogs((prev) => [...prev, ...r.logs].slice(-500));
          requestAnimationFrame(() => {
            if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
          });
        }
      } catch { /* 静默重试 */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [paused]);

  return (
    <>
      <h2>桥接日志</h2>
      <div className="toolbar">
        <button onClick={() => setPaused(!paused)}>{paused ? '▶ 继续' : '⏸ 暂停'}</button>
        <button onClick={() => setLogs([])}>清屏</button>
        <span className="muted">每 2 秒轮询 · 最近 500 条</span>
      </div>
      <div className="log-box mono" ref={boxRef}>
        {logs.map((l) => (
          <div key={l.seq} className="log-line">
            <span className="log-t">{l.t.slice(11, 19)}</span>
            <span className={l.msg.includes('❌') || l.msg.includes('⚠️') || l.msg.includes('失败') ? 'log-err' : l.msg.includes('✅') ? 'log-ok' : ''}>{l.msg}</span>
          </div>
        ))}
        {logs.length === 0 && <p className="muted">暂无日志</p>}
      </div>
    </>
  );
}
