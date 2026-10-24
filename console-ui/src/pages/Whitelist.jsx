import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, PageHeader, CopyButton } from '../components/ui.jsx';
import { toast } from '../toast.jsx';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tooltip from '@mui/material/Tooltip';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';

const GROUPS = [
  { key: 'guilds', title: '服务器', hint: '整个服务器放行' },
  { key: 'channels', title: '频道', hint: '只放行指定频道' },
  { key: 'users', title: '用户（私信）', hint: '只放行指定用户的私信' },
];

export default function Whitelist() {
  const [cfg, setCfg] = useState(null);
  const [inputs, setInputs] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.config().then(setCfg).catch((e) => toast(e.message, 'error'));
  }, []);

  if (!cfg) {
    return (
      <>
        <PageHeader title="白名单" sub="谁可以让 Bot 响应（热生效，无需重启）" />
        <Card>
          <Skeleton height={30} width="30%" />
          <Skeleton height={52} sx={{ my: 1.5 }} />
          <Skeleton height={30} width="45%" />
          <Skeleton height={52} sx={{ my: 1.5 }} />
        </Card>
      </>
    );
  }

  const editList = (list, key, updater) => {
    setCfg({ ...cfg, [list]: { ...cfg[list], [key]: updater(cfg[list][key]) } });
    setDirty(true);
  };

  const addItem = (list, key) => {
    const field = `${list}.${key}`;
    const v = (inputs[field] ?? '').trim();
    if (!v) return;
    if (cfg[list][key].includes(v)) {
      toast('该 ID 已存在', 'warning');
      return;
    }
    editList(list, key, (arr) => [...arr, v]);
    setInputs({ ...inputs, [field]: '' });
  };

  const delItem = (list, key, idx) => editList(list, key, (arr) => arr.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    try {
      await api.saveConfig({
        allow: cfg.allow, deny: cfg.deny,
        allowAllWhenEmpty: cfg.allowAllWhenEmpty,
        ackReaction: cfg.ackReaction,
      });
      setDirty(false);
      toast('已保存并热生效（无需重启桥接）', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
    setSaving(false);
  };

  const renderList = (listKey, g) => {
    const field = `${listKey}.${g.key}`;
    const list = cfg[listKey][g.key];
    return (
      <Box key={field} sx={{ mb: 3 }}>
        <div className="mb-1.5 text-[13.5px] font-semibold">
          {g.title} <span className="ml-1 font-normal text-[#8b93a7]">· {g.hint}</span>
        </div>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25, minHeight: 32 }}>
          {list.map((id, i) => (
            <Chip
              key={`${id}.${i}`}
              label={id}
              size="small"
              onDelete={() => delItem(listKey, g.key, i)}
              icon={
                <Box sx={{ ml: 0.75, display: 'flex' }}>
                  <CopyButton text={id} tooltip="复制 ID" size="small" />
                </Box>
              }
              sx={{
                transition: 'all .15s ease',
                '&:hover': { bgcolor: 'rgba(237,66,69,0.08)', borderColor: 'rgba(237,66,69,0.4)' },
                '& .MuiChip-deleteIcon': { color: '#8b93a7', '&:hover': { color: '#ed4245' } },
              }}
            />
          ))}
          {list.length === 0 && <span className="text-[12.5px] text-[#8b93a7]">（空）</span>}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={`输入 ${g.title} ID，回车添加`}
            value={inputs[field] ?? ''}
            onChange={(e) => setInputs({ ...inputs, [field]: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addItem(listKey, g.key)}
            sx={{ maxWidth: 420 }}
          />
          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => addItem(listKey, g.key)}>
            添加
          </Button>
        </Box>
      </Box>
    );
  };

  return (
    <>
      <PageHeader title="白名单" sub="谁可以让 Bot 响应（热生效，无需重启）">
        {dirty && (
          <Tooltip title="有未保存的修改，离开页面前请先保存">
            <Chip size="small" color="warning" variant="outlined" label="● 未保存" sx={{ fontFamily: 'inherit' }} />
          </Tooltip>
        )}
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || !dirty}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveRoundedIcon />}
        >
          {saving ? '保存中…' : '保存并热生效'}
        </Button>
      </PageHeader>

      <Card className="fade-in" sx={{ mb: 2.5 }}>
        <h3 className="mb-3 mt-0 text-[15px] font-bold">✅ 允许（任一命中即放行）</h3>
        {GROUPS.map((g) => renderList('allow', g))}
        <FormControlLabel
          control={
            <Switch
              checked={cfg.allowAllWhenEmpty}
              onChange={(e) => { setCfg({ ...cfg, allowAllWhenEmpty: e.target.checked }); setDirty(true); }}
              color="warning"
            />
          }
          label={
            <span className="text-[13px]">
              白名单为空时响应所有消息（<b className="text-[#f0b357]">不推荐</b>，等于对所有频道开放）
            </span>
          }
        />
      </Card>

      <Card className="fade-in" sx={{ mb: 2.5, borderColor: 'rgba(237,66,69,0.3)' }}>
        <h3 className="mb-3 mt-0 text-[15px] font-bold">🚫 拒绝（永远优先于白名单）</h3>
        {GROUPS.map((g) => renderList('deny', g))}
      </Card>

      <Card className="fade-in">
        <h3 className="mb-3 mt-0 text-[15px] font-bold">💬 消息回应</h3>
        <TextField
          size="small"
          fullWidth
          placeholder="收到消息时的 emoji 回应，如 🫡（留空关闭）"
          value={cfg.ackReaction ?? ''}
          onChange={(e) => { setCfg({ ...cfg, ackReaction: e.target.value }); setDirty(true); }}
          sx={{ maxWidth: 420 }}
        />
      </Card>
    </>
  );
}
