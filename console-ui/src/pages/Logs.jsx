import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { PageHeader } from '../components/ui.jsx';

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [paused, setPaused] = useState(false);
  const sinceRef = useRef(-1);
  const boxRef = useRef(null);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.logs(sinceRef.current);
        if (!alive || !r.logs.length) return;
        sinceRef.current = r.last;
        setLogs((prev) => [...prev, ...r.logs].slice(-500));
        requestAnimationFrame(() => {
          if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
        });
      } catch { /* 静默重试 */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [paused]);

  return (
    <>
      <PageHeader title="桥接日志">
        <button onClick={() => setPaused(!paused)}>{paused ? '▶ 继续' : '⏸ 暂停'}</button>
        <button onClick={() => setLogs([])}>清屏</button>
        <span className="muted">每 2 秒轮询 · 最近 500 条</span>
      </PageHeader>
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
