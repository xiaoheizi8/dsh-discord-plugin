import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, PageHeader, ConfirmDialog } from '../components/ui.jsx';
import { toast } from '../toast.jsx';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';

export default function Persona() {
  const [data, setData] = useState(null); // 服务器上的最新值
  const [draft, setDraft] = useState(null); // 编辑中的值
  const [saving, setSaving] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  useEffect(() => {
    api.persona()
      .then((d) => { setData(d); setDraft(d.prefix); })
      .catch((e) => toast(e.message, 'error'));
  }, []);

  const dirty = data !== null && draft !== data.prefix;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.savePersona({ prefix: draft, suffix: data.suffix });
      setData({ ...data, prefix: draft });
      toast(`已保存并重渲染 bundle${r.restartDsh ? ' —— 需要重启 DSH 后生效' : '（即时生效）'}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
    setSaving(false);
  };

  if (!data) {
    return (
      <>
        <PageHeader title="人格" sub="编辑注入每次对话的 system prompt 前缀" />
        <Card>
          <Skeleton height={24} width="60%" />
          <Skeleton height={420} sx={{ mt: 2 }} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="人格" sub={`preset: ${data.preset} · 源文件 agent.cordis.yml 同步更新`}>
        {dirty && (
          <Chip size="small" color="warning" variant="outlined" label="● 未保存" sx={{ fontFamily: 'inherit' }} />
        )}
        <Button
          color="inherit"
          startIcon={<UndoRoundedIcon />}
          disabled={!dirty || saving}
          onClick={() => setConfirmRevert(true)}
        >
          撤销修改
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!dirty || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveRoundedIcon />}
        >
          {saving ? '保存中…' : '保存（重渲染 DSH bundle）'}
        </Button>
      </PageHeader>

      <Card className="fade-in">
        <p className="mb-3 mt-0 text-[13px] leading-relaxed text-[#8b93a7]">
          编辑 preset <code className="mono rounded bg-[#0c0e14] px-1.5 py-0.5 text-[#7c7ff5]">{data.preset}</code> 的
          persona 前缀（注入每条消息的 system prompt 开头）。
          源文件 <code className="mono rounded bg-[#0c0e14] px-1.5 py-0.5 text-[#7c7ff5]">dsh/agent-presets/discord-chat/agent.cordis.yml</code>{' '}
          会被同步更新；保存后需重启 DSH 生效。
        </p>
        <TextField
          fullWidth
          multiline
          rows={18}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          slotProps={{ input: { sx: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13, lineHeight: 1.7 } } }}
          helperText={`${draft.length} 字符${dirty ? ' · 有未保存的修改' : ' · 与服务器一致'}`}
          sx={{
            '& .MuiOutlinedInput-root': {
              transition: 'border-color .2s',
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(88,101,242,0.5)' },
            },
          }}
        />
      </Card>

      <ConfirmDialog
        open={confirmRevert}
        title="撤销修改？"
        text="编辑框将恢复为服务器上已保存的内容，未保存的改动会丢失。"
        confirmText="撤销"
        danger
        onConfirm={() => setDraft(data.prefix)}
        onClose={() => setConfirmRevert(false)}
      />
    </>
  );
}
