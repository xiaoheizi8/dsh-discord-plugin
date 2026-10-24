import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { PageHeader, CopyButton } from '../components/ui.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import TextField from '@mui/material/TextField';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';

function classify(msg) {
  if (msg.includes('❌') || msg.includes('失败')) return 'err';
  if (msg.includes('⚠️') || msg.includes('警告')) return 'warn';
  if (msg.includes('✅')) return 'ok';
  return 'info';
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [atBottom, setAtBottom] = useState(true);
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
      } catch { /* 静默重试 */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [paused]);

  // 滚动跟随：仅当用户停留在底部时自动滚
  useEffect(() => {
    if (atBottom && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [logs, atBottom]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const shown = useMemo(
    () => logs.filter((l) => {
      if (filter !== 'all' && classify(l.msg) !== filter) return false;
      if (query && !l.msg.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    }),
    [logs, filter, query]
  );

  const counts = useMemo(() => {
    const c = { err: 0, warn: 0, ok: 0 };
    for (const l of logs) {
      const k = classify(l.msg);
      if (c[k] !== undefined) c[k]++;
    }
    return c;
  }, [logs]);

  const scrollToBottom = () => {
    const el = boxRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <>
      <PageHeader title="桥接日志" sub="环形缓冲最近 500 条 · 每 2 秒轮询">
        <Chip size="small" variant="outlined" label={`${logs.length} 条`} sx={{ fontFamily: 'inherit' }} />
        {counts.err > 0 && <Chip size="small" color="error" variant="outlined" label={`错误 ${counts.err}`} sx={{ fontFamily: 'inherit' }} />}
        {counts.warn > 0 && <Chip size="small" color="warning" variant="outlined" label={`警告 ${counts.warn}`} sx={{ fontFamily: 'inherit' }} />}
        <Tooltip title={paused ? '继续' : '暂停'}>
          <IconButton onClick={() => setPaused(!paused)} size="small">
            {paused ? <PlayArrowRoundedIcon fontSize="small" /> : <PauseRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="清屏（只清显示，不影响桥接）">
          <IconButton onClick={() => { setLogs([]); sinceRef.current = -1; }} size="small">
            <DeleteSweepRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <CopyButton text={shown.map((l) => `${l.t} ${l.msg}`).join('\n')} tooltip="复制当前显示的日志" />
      </PageHeader>

      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }} className="fade-in">
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_, v) => v && setFilter(v)}
        >
          <ToggleButton value="all" sx={{ px: 1.5, py: 0.25, fontSize: 12 }}>全部</ToggleButton>
          <ToggleButton value="ok" sx={{ px: 1.5, py: 0.25, fontSize: 12, color: '#57c785' }}>成功</ToggleButton>
          <ToggleButton value="warn" sx={{ px: 1.5, py: 0.25, fontSize: 12, color: '#f0b357' }}>警告</ToggleButton>
          <ToggleButton value="err" sx={{ px: 1.5, py: 0.25, fontSize: 12, color: '#f27477' }}>错误</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="搜索日志…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 240, '& input': { py: 0.5, fontSize: 13 } }}
        />
        {query && (
          <span className="text-[12px] text-[#8b93a7]">匹配 {shown.length} 条</span>
        )}
        {!atBottom && !paused && (
          <Button size="small" variant="outlined" startIcon={<ArrowDownwardRoundedIcon />} onClick={scrollToBottom}>
            跟随最新
          </Button>
        )}
      </Box>

      <div className="log-box mono fade-in" ref={boxRef} onScroll={onScroll}>
        {shown.map((l) => {
          const k = classify(l.msg);
          return (
            <div key={l.seq} className="log-line">
              <span className="log-t">{l.t.slice(11, 19)}</span>
              <span className={k === 'err' ? 'log-err' : k === 'ok' ? 'log-ok' : k === 'warn' ? 'log-warn' : ''}>
                {l.msg}
              </span>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="m-0 py-6 text-center text-sm text-[#8b93a7]">
            {logs.length === 0 ? '暂无日志' : '当前过滤条件下没有匹配的日志'}
          </p>
        )}
      </div>
    </>
  );
}
