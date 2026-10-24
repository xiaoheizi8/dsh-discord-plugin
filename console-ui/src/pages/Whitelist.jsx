import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Banner, PageHeader } from '../components/ui.jsx';

const GROUPS = [
  { key: 'guilds', title: '服务器', hint: '整个服务器放行' },
  { key: 'channels', title: '频道', hint: '只放行指定频道' },
  { key: 'users', title: '用户（私信）', hint: '只放行指定用户的私信' },
];

export default function Whitelist() {
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [inputs, setInputs] = useState({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.config().then(setCfg).catch((e) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  if (!cfg) {
    return (
      <>
        <PageHeader title="白名单" />
        <Card><p className="muted">加载中…</p></Card>
      </>
    );
  }

  const editList = (list, key, updater) => {
    setCfg({ ...cfg, [list]: { ...cfg[list], [key]: updater(cfg[list][key]) } });
    setDirty(true);
  };
  const addItem = (list, key) => {
    const v = (inputs[`${list}.${key}`] ?? '').trim();
    if (!v || cfg[list][key].includes(v)) return;
    editList(list, key, (arr) => [...arr, v]);
    setInputs({ ...inputs, [`${list}.${key}`]: '' });
  };
  const delItem = (list, key, idx) => editList(list, key, (arr) => arr.filter((_, i) => i !== idx));

  const save = async () => {
    try {
      await api.saveConfig({
        allow: cfg.allow, deny: cfg.deny,
        allowAllWhenEmpty: cfg.allowAllWhenEmpty,
        ackReaction: cfg.ackReaction,
      });
      setDirty(false);
      setMsg({ kind: 'ok', text: '✅ 已保存并热生效（无需重启桥接）' });
    } catch (e) {
      setMsg({ kind: 'error', text: '❌ ' + e.message });
    }
  };

  const renderList = (listKey, g) => (
    <div className="wl-group" key={`${listKey}.${g.key}`}>
      <div className="wl-title">{g.title} <span className="muted">· {g.hint}</span></div>
      <div className="wl-items">
        {cfg[listKey][g.key].map((id, i) => (
          <span key={`${id}.${i}`} className="chip">
            <span className="mono">{id}</span>
            <button className="chip-x" onClick={() => delItem(listKey, g.key, i)}>×</button>
          </span>
        ))}
        {cfg[listKey][g.key].length === 0 && <span className="muted">（空）</span>}
      </div>
      <div className="wl-add">
        <input
          placeholder={`输入 ${g.title} ID`}
          value={inputs[`${listKey}.${g.key}`] ?? ''}
          onChange={(e) => setInputs({ ...inputs, [`${listKey}.${g.key}`]: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addItem(listKey, g.key)}
        />
        <button onClick={() => addItem(listKey, g.key)}>添加</button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="白名单">
        {dirty && <span className="muted" style={{ marginRight: 12 }}>有未保存的修改</span>}
        <button className="primary" onClick={save}>💾 保存并热生效</button>
      </PageHeader>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <Card>
        <h3>✅ 允许（任一命中即放行）</h3>
        {GROUPS.map((g) => renderList('allow', g))}
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={cfg.allowAllWhenEmpty}
            onChange={(e) => { setCfg({ ...cfg, allowAllWhenEmpty: e.target.checked }); setDirty(true); }}
          />
          白名单为空时响应所有消息（<b>不推荐</b>，等于对所有频道开放）
        </label>
      </Card>
      <Card>
        <h3>🚫 拒绝（永远优先于白名单）</h3>
        {GROUPS.map((g) => renderList('deny', g))}
      </Card>
      <Card>
        <h3>💬 消息回应</h3>
        <div className="wl-add">
          <input
            placeholder="收到消息时的 emoji 回应，如 🫡（留空关闭）"
            value={cfg.ackReaction ?? ''}
            onChange={(e) => { setCfg({ ...cfg, ackReaction: e.target.value }); setDirty(true); }}
          />
        </div>
      </Card>
    </>
  );
}
