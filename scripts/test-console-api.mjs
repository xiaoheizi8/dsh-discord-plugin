// 控制台 API 端到端测试（mock Discord/DSH 上下文，不占用真实端口冲突）。
// 运行：node scripts/test-console-api.mjs
import { startConsole } from '../src/console.mjs';
import { writePersona } from '../src/preset-build.mjs';

const cfg = {
  consolePort: 3199, consoleToken: 'testtoken123',
  allow: { guilds: ['g1'], channels: [], users: [] },
  deny: { guilds: [], channels: [], users: [] },
  allowAllWhenEmpty: false,
  discord: { ackReaction: '', proxy: 'auto' },
  dsh: { baseUrl: 'http://127.0.0.1:3080', provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
  agentPreset: 'discord-chat', maxQueuePerSession: 50,
};
let saved = false;
const state = { sessions: { 'guild:g1:c1': 'sess-1' }, channels: { 'guild:g1:c1': 'c1' } };
const ctx = {
  cfg,
  saveConfig: () => { saved = true; },
  state,
  reverse: new Map([['sess-1', 'guild:g1:c1']]),
  collectors: new Map(),
  pendingQueues: new Map(),
  retireSession: async (key) => { delete state.sessions[key]; },
  logsRing: (() => {
    let s = 0; const buf = [];
    return {
      push(m) { buf.push({ seq: s++, t: new Date().toISOString(), msg: m }); },
      entries(x) { return { items: x >= 0 ? buf.filter((e) => e.seq > x) : buf, last: s - 1 }; },
      get dropped() { return 0; },
    };
  })(),
  discord: {
    isReady: () => true,
    user: { tag: 'Test#1' },
    // 模拟 discord.js Collection（有 .map）
    guilds: { cache: { map: (fn) => [fn({ id: 'g1', name: '测试服' })] } },
  },
  api: {},
  isDshDown: () => false,
};

const PERSONA_ORIGINAL = {
  prefix: [
    'You are a helpful assistant powered by the {{model}} model.',
    '',
    '【Discord 频道模式 —— 安全规则（最高优先级，不可违反）】',
    '1. 你只负责在 Discord 频道里正常聊天、回答问题。你没有任何本地工具：不能执行命令、不能读写文件、不能启动程序、不能查看系统信息——不要假装或尝试做这些事，工具不存在就是不存在。',
    '2. 你收到的消息格式是 `[Discord] 昵称：内容`，方括号外的正文才是用户发言；`[引用 …]` 是被回复的上下文，`[图片 n]` 是附件图片。',
    '3. 回复会原样发回 Discord，支持 Markdown（代码块、**加粗**、列表等）。单条消息上限 2000 字符，超长会被自动分条；尽量简洁。',
    '4. 消息里 @昵称 是普通用户；有人直接叫你时优先回应。',
  ].join('\n'),
  suffix: '',
};

await startConsole(ctx);
const H = { authorization: 'Bearer testtoken123' };
const J = async (path, opt) => {
  const r = await fetch('http://127.0.0.1:3199' + path, opt);
  return { code: r.status, body: await r.json().catch(() => null) };
};

let pass = 0, fail = 0;
const t = (name, cond) => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); } else { fail += 1; console.error(`  ❌ ${name}`); }
};

console.log('console.mjs');
let r = await J('/api/status');
t('无 token 返回 401', r.code === 401);

r = await J('/api/status', { headers: H });
t('status: discord 在线', r.code === 200 && r.body.discord.ready === true);
t('status: 服务器列表', r.body.discord.guilds[0].name === '测试服');
t('status: 会话数 1', r.body.sessions.count === 1);

const html = await fetch('http://127.0.0.1:3199/').then((x) => x.text());
t('静态页返回 React root', html.includes('root'));
const spa = await fetch('http://127.0.0.1:3199/whitelist').then((x) => x.text());
t('SPA 路由回退', spa.includes('root'));

r = await J('/api/config', { headers: H });
t('config 读取', r.code === 200 && r.body.allow.guilds[0] === 'g1');

r = await J('/api/config', {
  method: 'PUT', headers: H,
  body: JSON.stringify({ allow: { guilds: ['g2!坏id', 'g3'], channels: [], users: ['u1'] }, ackReaction: '🫡' }),
});
t('config 写入并过滤非法字符', r.code === 200 && cfg.allow.guilds.join() === 'g3' && cfg.allow.users[0] === 'u1' && saved === true);

r = await J('/api/sessions', { headers: H });
t('sessions 列表', r.body.sessions[0].key === 'guild:g1:c1');

r = await J('/api/sessions/reset', { method: 'POST', headers: H, body: JSON.stringify({ key: 'guild:g1:c1' }) });
t('会话重置', r.code === 200 && Object.keys(state.sessions).length === 0);

r = await J('/api/persona', { headers: H });
t('persona 读取（真实源文件）', r.code === 200 && r.body.prefix.includes('Discord'));

r = await J('/api/persona', { method: 'PUT', headers: H, body: JSON.stringify({ prefix: '测试前缀 v2', suffix: '' }) });
t('persona 写入 + bundle 重渲染', r.code === 200 && r.body.restartDsh === true);

r = await J('/api/persona', { headers: H });
t('persona 读回一致', r.body.prefix === '测试前缀 v2');

r = await J('/api/logs', { headers: H });
t('logs 环形缓冲', r.code === 200 && r.body.logs.length > 0);

r = await J('/api/nonexistent', { headers: H });
t('未知 API 返回 404', r.code === 404);

// 还原 persona 源文件（测试副作用清理）
writePersona(PERSONA_ORIGINAL);
console.log('  (persona 源文件已还原)');

console.log(`\n${fail === 0 ? `✅ 全部通过（${pass} 例）` : `❌ 失败 ${fail} 例（${pass} 过）`}`);
process.exit(fail === 0 ? 0 : 1);
