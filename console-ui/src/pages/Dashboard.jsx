import React from 'react';
import { useStatus } from '../hooks/useStatus.jsx';
import { Card, PageHeader, StatusDot, CopyButton } from '../components/ui.jsx';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import IconButton from '@mui/material/IconButton';

const STAT_COLORS = {
  ok: '#3ba55d',
  bad: '#ed4245',
  blue: '#00a8fc',
  accent: '#5865f2',
};

export default function Dashboard() {
  const { status, error, refresh } = useStatus();

  return (
    <>
      <PageHeader title="仪表盘" sub="桥接运行状态总览 · 每 4 秒自动刷新">
        <Tooltip title="立即刷新">
          <IconButton onClick={refresh} size="small" className="fade-in">
            <RefreshRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </PageHeader>

      {error && (
        <Card className="mb-4" sx={{ borderColor: '#5c2a2c' }}>
          <span className="text-[#f27477]">状态获取失败：{error}</span>
        </Card>
      )}

      <Box className="fade-in" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2, mb: 3 }}>
        {!status
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <Skeleton width="40%" height={18} />
                <Skeleton width="65%" height={34} sx={{ my: 1 }} />
                <Skeleton width="85%" height={14} />
              </Card>
            ))
          : renderCards(status)}
      </Box>

      {status && (
        <Card className="fade-in">
          <h3 className="mb-3 mt-0 text-[15px] font-bold">已接入的服务器（{status.discord.guilds.length}）</h3>
          {status.discord.guilds.length === 0 && (
            <p className="mb-0 mt-1 text-sm text-[#8b93a7]">Bot 还没有被邀请进任何服务器</p>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1.5 }}>
            {status.discord.guilds.map((g) => (
              <Box
                key={g.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider',
                  transition: 'all .18s ease',
                  '&:hover': { borderColor: 'primary.main', bgcolor: 'rgba(88,101,242,0.06)', transform: 'translateY(-2px)' },
                }}
              >
                <Box
                  sx={{
                    width: 40, height: 40, borderRadius: 2, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 17, fontWeight: 700, color: '#fff',
                    background: 'linear-gradient(135deg, #5865f2, #7c7ff5)',
                  }}
                >
                  {g.name.slice(0, 1)}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <div className="truncate text-[13.5px] font-semibold">{g.name}</div>
                  <div className="mono truncate text-[11.5px] text-[#8b93a7]">{g.id}</div>
                </Box>
                <CopyButton text={g.id} tooltip="复制服务器 ID" />
              </Box>
            ))}
          </Box>
        </Card>
      )}
    </>
  );
}

function renderCards(status) {
  const { discord, dsh, sessions, model, uptimeSec } = status;
  const cards = [
    {
      label: 'Discord Bot',
      value: discord.ready ? '在线' : '离线',
      sub: discord.tag ?? '',
      color: discord.ready ? STAT_COLORS.ok : STAT_COLORS.bad,
      ok: discord.ready,
    },
    {
      label: 'DSH',
      value: dsh.down ? '不可用' : '可用',
      sub: dsh.baseUrl,
      color: dsh.down ? STAT_COLORS.bad : STAT_COLORS.ok,
      ok: !dsh.down,
    },
    {
      label: '活跃会话',
      value: sessions.count,
      sub: `回合中 ${sessions.activeTurns} · 排队 ${sessions.queued}`,
      color: STAT_COLORS.blue,
    },
    {
      label: '模型',
      value: model.split('/')[1] ?? model,
      sub: `provider: ${model.split('/')[0]} · 运行 ${Math.floor(uptimeSec / 60)} 分钟`,
      color: STAT_COLORS.accent,
    },
  ];

  return cards.map((c) => (
    <Card
      key={c.label}
      sx={{ position: 'relative', overflow: 'hidden', transition: 'transform .2s ease, box-shadow .2s ease', '&:hover': { transform: 'translateY(-3px)' } }}
    >
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: c.color, borderRadius: 2 }} />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-[#8b93a7] uppercase">
        {c.ok !== undefined && <StatusDot ok={c.ok} />}
        {c.label}
      </div>
      <div className="my-1.5 truncate text-[26px] font-bold leading-tight">{c.value}</div>
      <div className="mono truncate text-[12px] text-[#8b93a7]">{c.sub}</div>
    </Card>
  ));
}
