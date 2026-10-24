import React, { useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Card, PageHeader, Tag, ConfirmDialog, CopyButton } from '../components/ui.jsx';
import { toast } from '../toast.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Skeleton from '@mui/material/Skeleton';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';

export default function Sessions() {
  const { data, refresh } = usePolling(() => api.sessions(), 5000);
  const [confirmKey, setConfirmKey] = useState(null);
  const [resetting, setResetting] = useState(false);

  const doReset = async () => {
    if (!confirmKey) return;
    setResetting(true);
    try {
      await api.resetSession(confirmKey);
      toast(`已重置 ${confirmKey}`, 'success');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
    setResetting(false);
    setConfirmKey(null);
  };

  const sessions = data?.sessions ?? [];

  return (
    <>
      <PageHeader title="会话" sub="Discord 频道 ↔ DSH 会话映射 · 每 5 秒自动刷新">
        <Tooltip title="立即刷新">
          <IconButton onClick={refresh} size="small">
            <RefreshRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </PageHeader>

      <Card className="fade-in">
        {!data && (
          <Box>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} width="70%" />
          </Box>
        )}
        {data && sessions.length === 0 && (
          <Box className="py-10 text-center text-sm text-[#8b93a7]">
            <div className="mb-2 text-3xl">💬</div>
            还没有任何会话 —— 去 Discord 频道里发条消息
          </Box>
        )}
        {data && sessions.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['频道 / 私信', 'DSH 会话', '状态', '排队', ''].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 13, borderColor: 'divider' }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow
                    key={s.key}
                    sx={{
                      transition: 'background .15s',
                      '&:hover': { bgcolor: 'rgba(88,101,242,0.05)' },
                      '& td': { borderColor: 'divider', py: 1.25 },
                    }}
                  >
                    <TableCell sx={{ fontSize: 13 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <span className="mono">{s.key}</span>
                        <CopyButton text={s.key} tooltip="复制频道标识" />
                      </Box>
                    </TableCell>
                    <TableCell className="mono" sx={{ fontSize: 12, color: 'text.secondary', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Tooltip title={s.sessionId}>
                        <span className="mono">{s.sessionId}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      {s.turnActive ? <Tag kind="amber">回合中</Tag> : <Tag kind="green">空闲</Tag>}
                    </TableCell>
                    <TableCell>
                      {s.queued ? (
                        <Chip size="small" color="warning" label={`×${s.queued}`} variant="outlined" />
                      ) : (
                        <span className="text-[#8b93a7]">-</span>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        startIcon={<RestartAltRoundedIcon />}
                        onClick={() => setConfirmKey(s.key)}
                      >
                        重置
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <ConfirmDialog
        open={confirmKey !== null}
        title="重置会话？"
        text={`确定重置会话 ${confirmKey ?? ''} 吗？上下文将被清空并归档，之后频道里的下一条消息会开启全新会话。`}
        confirmText={resetting ? '重置中…' : '确认重置'}
        danger
        onConfirm={doReset}
        onClose={() => !resetting && setConfirmKey(null)}
      />
    </>
  );
}
