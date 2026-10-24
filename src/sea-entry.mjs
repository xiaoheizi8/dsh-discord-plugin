// SEA（Single Executable Application）入口：双击 exe 即启动桥接 + 控制台。
// 职责：
//   1. 确保 exe 旁边有 config.json（没有则生成默认配置 + 随机 consoleToken）
//   2. 延迟加载 bridge.mjs（整个应用已被 esbuild 打进本文件）
//   3. 桥接就绪后自动用默认浏览器打开控制台
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { isSea } from 'node:sea';
import { ROOT } from './paths.mjs';

const CONFIG_PATH = path.join(ROOT, 'config.json');

if (!fs.existsSync(CONFIG_PATH)) {
  const consoleToken = crypto.randomUUID().replaceAll('-', '');
  const defaultConfig = {
    discord: { token: '在这里粘贴你的 Discord Bot Token', ackReaction: '', proxy: 'auto' },
    dsh: {
      baseUrl: 'http://127.0.0.1:3080', provider: 'deepseek-official',
      model: 'deepseek-flash', reasoningEffort: 'max', authToken: '', allowRemote: false,
    },
    agentPreset: 'discord-chat',
    workspaceTitle: 'Discord 聊天',
    sessionCwd: '',
    allow: { guilds: [], channels: [], users: [] },
    deny: { guilds: [], channels: [], users: [] },
    allowAllWhenEmpty: false,
    maxQueuePerSession: 50,
    questionTimeoutMs: 300000,
    maxMediaBytes: 8388608,
    maxMediaCount: 5,
    pollIntervalMs: 5000,
    consolePort: 8310,
    consoleToken,
    autoOpenConsole: true,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
  console.log('已生成默认配置 config.json —— 请先填写 discord.token 再重启本程序！');
}

if (isSea()) {
  console.log(`工作目录: ${ROOT}（config.json / state / dsh / web 都在这里）`);
}

import('./bridge.mjs').then(() => {
  if (!isSea()) return;
  // SEA 模式：桥接起来后自动打开浏览器（等 discord.login + console listen 完成）
  setTimeout(() => {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (cfg.autoOpenConsole === false || !cfg.consoleToken) return;
      const port = cfg.consolePort || 8310;
      const url = `http://127.0.0.1:${port}/?token=${cfg.consoleToken}`;
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } catch { /* 打不开浏览器不影响运行 */ }
  }, 8000);
});
