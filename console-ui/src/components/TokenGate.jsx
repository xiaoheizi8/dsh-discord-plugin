import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import { toast } from '../toast.jsx';

/** 未携带 consoleToken 时的引导页：支持 ?token= 链接或直接粘贴令牌。 */
export default function TokenGate() {
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);

  const unlock = async () => {
    const t = input.trim();
    if (!t) return;
    setChecking(true);
    try {
      // 先验证 token 是否有效，有效才记住并刷新
      const res = await fetch('/api/status', { headers: { authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error(res.status === 401 ? '令牌无效' : `HTTP ${res.status}`);
      localStorage.setItem('dshConsoleToken', t);
      window.location.reload();
    } catch (e) {
      toast(e.message === 'Failed to fetch' ? '无法连接控制台服务' : `验证失败：${e.message}`, 'error');
      setChecking(false);
    }
  };

  return (
    <Box
      className="fade-in"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
        background: 'radial-gradient(1200px 600px at 50% -10%, rgba(88,101,242,0.16), transparent)',
      }}
    >
      <Card sx={{ maxWidth: 460, width: '100%' }}>
        <CardContent sx={{ p: 4, '&:last-child': { pb: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box component="img" src="./favicon.svg" alt="logo" sx={{ width: 44, height: 44 }} />
            <Typography variant="h6">DSH Console</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.8 }}>
            需要控制台令牌才能进入。令牌在项目根目录 <code className="mono text-[#7c7ff5]">config.json</code> 的
            <code className="mono text-[#7c7ff5]"> consoleToken</code> 字段（首次启动自动生成，桥接启动日志也会打印完整一键链接）。
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="粘贴 consoleToken"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              slotProps={{ input: { startAdornment: <KeyRoundedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> } }}
            />
            <Button variant="contained" onClick={unlock} disabled={checking || !input.trim()} startIcon={<LoginRoundedIcon />}>
              {checking ? '验证中…' : '进入'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            或者用带 <code>?token=</code> 的一次性链接访问，令牌会自动记住。
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
