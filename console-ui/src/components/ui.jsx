import React, { useState, useCallback } from 'react';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import Box from '@mui/material/Box';

/** 卡片容器：统一圆角 / 描边 / 悬浮微动效。 */
export function Card({ children, className = '', sx, ...rest }) {
  return (
    <Box
      className={`rounded-xl border border-[#242a3a] bg-[#161a23] p-5 transition-shadow duration-200 hover:shadow-[0_4px_24px_rgba(0,0,0,0.35)] ${className}`}
      sx={sx}
      {...rest}
    >
      {children}
    </Box>
  );
}

export function Banner({ kind = 'ok', children, onClose }) {
  const severity = kind === 'error' ? 'error' : kind === 'warn' ? 'warning' : 'success';
  return (
    <Alert severity={severity} variant="outlined" className="fade-in" onClose={onClose} sx={{ mb: 2 }}>
      {children}
    </Alert>
  );
}

export function StatusDot({ ok }) {
  return <span className={`status-dot ${ok ? 'ok' : 'bad'}`} />;
}

export function PageHeader({ title, sub, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="m-0 text-xl font-bold tracking-wide text-[#e6e9f0]">{title}</h2>
        {sub && <p className="mt-1 text-[13px] text-[#8b93a7]">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const TAG_COLOR = {
  green: 'success',
  amber: 'warning',
  red: 'error',
  blue: 'info',
  default: 'default',
};

export function Tag({ kind = 'default', children }) {
  return <Chip size="small" color={TAG_COLOR[kind] ?? 'default'} label={children} variant="outlined" />;
}

/** 复制按钮：点击后短暂变成 ✓。 */
export function CopyButton({ text, tooltip = '复制', size = 'small' }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <Tooltip title={copied ? '已复制' : tooltip}>
      <IconButton size={size} onClick={copy} sx={{ transition: 'transform .15s', '&:active': { transform: 'scale(0.85)' } }}>
        {copied ? <CheckRoundedIcon fontSize="inherit" color="success" /> : <ContentCopyRoundedIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  );
}

/** 危险操作确认对话框。 */
export function ConfirmDialog({ open, title, text, confirmText = '确认', danger, onConfirm, onClose }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ elevation: 0 }}
      TransitionProps={{ mountOnEnter: true, unmountOnExit: true }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: 'text.secondary', maxWidth: 420 }}>{text}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">取消</Button>
        <Button
          onClick={() => { onConfirm?.(); onClose?.(); }}
          variant="contained"
          color={danger ? 'error' : 'primary'}
          autoFocus
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
