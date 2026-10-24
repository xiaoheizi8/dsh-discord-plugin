// 本地控制台：HTTP 服务器 + REST API + 静态托管 web/。
// 只监听 127.0.0.1；/api/* 需要 Bearer consoleToken（config.json，空则自动生成并写回）。
// 路由：
//   GET  /api/status                    Discord/DSH 状态、会话统计
//   GET  /api/config                    白名单等运行配置
//   PUT  /api/config                    更新 allow/deny/allowAllWhenEmpty/ackReaction（内存热生效 + 写盘）
//   GET  /api/sessions                  活跃会话列表（key/sessionId/排队/回合中）
//   POST /api/sessions/reset {key}      重置某会话
//   GET  /api/persona                   persona prefix/suffix
//   PUT  /api/persona                   保存 persona 并重渲染 DSH bundle（需重启 DSH）
//   GET  /api/logs?since=N              桥接日志环形缓冲
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { readPersona, writePersona, writeBundle, resolveDshHome, PRESET_ID } from './preset-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
};

export function startConsole(ctx) {
  const { cfg, saveConfig } = ctx;
  const log = ctx.log ?? ((m) => ctx.logsRing?.push(m));

  // token 为空则生成并持久化（控制台每次启动保持不变）
  if (!cfg.consoleToken) {
    cfg.consoleToken = randomUUID().replaceAll('-', '');
    saveConfig();
    log(`控制台令牌已自动生成并写入 config.json（consoleToken）`);
  }
  const port = cfg.consolePort || 3100;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, ctx);
      return serveStatic(req, res, url);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error?.message ?? String(error) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${port}`;
      log(`🖥️ 控制台已启动: ${base}/?token=${cfg.consoleToken.slice(0, 8)}…（完整 token 在 config.json 的 consoleToken）`);
      resolve(server);
    });
  });
}

// ── 静态文件 ────────────────────────────────────────────────────────────────

function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  let full = path.join(WEB_DIR, file);
  if (!full.startsWith(WEB_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    full = path.join(WEB_DIR, 'index.html'); // SPA 回退
  }
  if (!fs.existsSync(full)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('控制台前端未构建：请运行 npm run build:console（产物输出到 web/）');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

// ── API ────────────────────────────────────────────────────────────────────

async function handleApi(req, res, url, ctx) {
  const { cfg, saveConfig, state, reverse, collectors, pendingQueues, retireSession, logsRing, discord, api, isDshDown } = ctx;
  const log = ctx.log ?? ((m) => logsRing?.push(m));

  // 鉴权
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${cfg.consoleToken}`) {
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'token 不正确（config.json 的 consoleToken）' }));
  }

  const send = (code, data) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const readBody = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/status') {
    const sessions = Object.entries(state.sessions);
    let queued = 0;
    for (const q of pendingQueues.values()) queued += q.length;
    return send(200, {
      discord: {
        ready: discord.isReady(),
        tag: discord.user?.tag ?? null,
        guilds: discord.guilds.cache.map((g) => ({ id: g.id, name: g.name })),
      },
      dsh: { down: isDshDown(), baseUrl: cfg.dsh.baseUrl, preset: cfg.agentPreset },
      model: `${cfg.dsh.provider}/${cfg.dsh.model}${cfg.dsh.reasoningEffort ? ` (${cfg.dsh.reasoningEffort})` : ''}`,
      sessions: { count: sessions.length, queued, activeTurns: collectors.size },
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (req.method === 'GET' && p === '/api/config') {
    return send(200, {
      allow: cfg.allow, deny: cfg.deny, allowAllWhenEmpty: cfg.allowAllWhenEmpty,
      ackReaction: cfg.discord.ackReaction ?? '', proxy: cfg.discord.proxy ?? 'auto',
      dsh: { baseUrl: cfg.dsh.baseUrl, provider: cfg.dsh.provider, model: cfg.dsh.model, reasoningEffort: cfg.dsh.reasoningEffort },
      consolePort: cfg.consolePort || 3100,
    });
  }

  if (req.method === 'PUT' && p === '/api/config') {
    const body = await readBody();
    const cleanList = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => /^[\w:-]+$/.test(x)) : undefined;
    for (const key of ['guilds', 'channels', 'users']) {
      const a = cleanList(body.allow?.[key]);
      if (a) cfg.allow[key] = a;
      const d = cleanList(body.deny?.[key]);
      if (d) cfg.deny[key] = d;
    }
    if (typeof body.allowAllWhenEmpty === 'boolean') cfg.allowAllWhenEmpty = body.allowAllWhenEmpty;
    if (typeof body.ackReaction === 'string') cfg.discord.ackReaction = body.ackReaction.slice(0, 8);
    saveConfig();
    log('⚙️ 配置已通过控制台更新并热生效');
    return send(200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/sessions') {
    const list = Object.entries(state.sessions).map(([key, sessionId]) => ({
      key, sessionId,
      channelId: state.channels[key] ?? null,
      turnActive: collectors.has(sessionId),
      queued: pendingQueues.get(key)?.length ?? 0,
    }));
    return send(200, { sessions: list });
  }

  if (req.method === 'POST' && p === '/api/sessions/reset') {
    const body = await readBody();
    const key = String(body.key ?? '');
    if (!state.sessions[key]) return send(404, { error: `会话不存在: ${key}` });
    await retireSession(key);
    return send(200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/persona') {
    return send(200, { preset: PRESET_ID, ...readPersona() });
  }

  if (req.method === 'PUT' && p === '/api/persona') {
    const body = await readBody();
    if (typeof body.prefix !== 'string') return send(400, { error: 'prefix 必须是字符串' });
    writePersona({ prefix: body.prefix, suffix: body.suffix ?? '' });
    const bundleDir = writeBundle(resolveDshHome());
    log('✏️ persona 已通过控制台更新，bundle 已重渲染（重启 DSH 后生效）');
    return send(200, { ok: true, bundleDir, restartDsh: true });
  }

  if (req.method === 'GET' && p === '/api/logs') {
    const since = Number(url.searchParams.get('since') ?? -1);
    const logs = logsRing.entries(since);
    return send(200, { logs: logs.items, last: logs.last, dropped: logsRing.dropped });
  }

  send(404, { error: `unknown api: ${req.method} ${p}` });
}
