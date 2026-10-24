import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStatus } from '../hooks/useStatus.js';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';

const NAV = [
  { to: '/', icon: <DashboardRoundedIcon fontSize="small" />, label: '仪表盘', end: true },
  { to: '/whitelist', icon: <VerifiedUserRoundedIcon fontSize="small" />, label: '白名单' },
  { to: '/sessions', icon: <ForumRoundedIcon fontSize="small" />, label: '会话' },
  { to: '/persona', icon: <PsychologyRoundedIcon fontSize="small" />, label: '人格' },
  { to: '/logs', icon: <TerminalRoundedIcon fontSize="small" />, label: '日志' },
];

export default function Layout() {
  const { status, error } = useStatus();
  const location = useLocation();

  const discordOk = status?.discord?.ready;
  const dshOk = status ? !status.dsh.down : null;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="aside"
        sx={{
          width: 228,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'rgba(15, 17, 23, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        {/* 品牌 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 2.5 }}>
          <Box
            component="img"
            src="./favicon.svg"
            alt="logo"
            sx={{ width: 38, height: 38, filter: 'drop-shadow(0 2px 8px rgba(88,101,242,.5))' }}
          />
          <Box>
            <div className="text-[15px] font-bold leading-tight">DSH Console</div>
            <div className="text-[11px] text-[#8b93a7]">Discord 桥接控制台</div>
          </Box>
        </Box>

        {/* 导航 */}
        <Box component="nav" className="fade-in" sx={{ px: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} style={{ textDecoration: 'none' }}>
              {({ isActive }) => (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.75,
                    py: 1.1,
                    borderRadius: 2,
                    fontSize: 14,
                    fontWeight: 600,
                    color: isActive ? '#fff' : '#8b93a7',
                    bgcolor: isActive ? 'rgba(88,101,242,0.18)' : 'transparent',
                    border: '1px solid',
                    borderColor: isActive ? 'rgba(88,101,242,0.45)' : 'transparent',
                    position: 'relative',
                    transition: 'all .18s ease',
                    '&:hover': { color: '#e6e9f0', bgcolor: 'rgba(255,255,255,0.05)', transform: 'translateX(3px)' },
                  }}
                >
                  {isActive && (
                    <Box
                      sx={{
                        position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)',
                        width: 4, height: 20, borderRadius: 2, bgcolor: 'primary.main',
                      }}
                    />
                  )}
                  {n.icon}
                  {n.label}
                </Box>
              )}
            </NavLink>
          ))}
        </Box>

        {/* 底部状态 */}
        <Box sx={{ mt: 'auto', px: 2.5, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          {status ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Tooltip title={discordOk ? `已登录 ${status.discord.tag ?? ''}` : 'Discord 离线'}>
                <Chip
                  size="small"
                  icon={<span className={`status-dot ${discordOk ? 'ok' : 'bad'}`} />}
                  label={status.discord.tag?.split('#')[0] ?? '离线'}
                  variant="outlined"
                  sx={{ '& .MuiChip-icon': { display: 'flex', alignItems: 'center', justifyContent: 'center', ml: 0.5 } }}
                />
              </Tooltip>
              <Tooltip title={dshOk ? 'DSH 可用' : 'DSH 不可用'}>
                <Chip
                  size="small"
                  icon={<span className={`status-dot ${dshOk ? 'ok' : 'bad'}`} />}
                  label="DSH"
                  variant="outlined"
                  sx={{ '& .MuiChip-icon': { display: 'flex', alignItems: 'center', justifyContent: 'center', ml: 0.5 } }}
                />
              </Tooltip>
            </Box>
          ) : (
            <div className="text-[12px] text-[#8b93a7]">连接中…</div>
          )}
        </Box>
      </Box>

      {/* 主内容 */}
      <Box component="main" sx={{ flex: 1, p: 3, minWidth: 0 }}>
        {error && (
          <Alert severity="error" variant="outlined" className="fade-in" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Outlet />
      </Box>
    </Box>
  );
}
