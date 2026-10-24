// Discord ↔ DeepSeek Harness (DSH) 桥接主程序。
//
//   Discord 消息 ──► discord.js 网关 ──► 本进程 ──► DSH Web API (127.0.0.1:3080/api)
//                                            ▲                      │
//                                            └── agent 回复/提问/审批 ┘
//
// 会话模型：每个 Discord 频道（guild:guildId:channelId）或 DM（dm:userId）
// 对应一个独立 DSH 会话，归组到「Discord 聊天」工作区，映射持久化在
// state/sessions.json。消息投递用 mode:'queue'，由 DSH 排队；DSH 掉线期间
// 消息在本进程内存排队（上限 maxQueuePerSession），恢复后补投。
//
// 安全：白名单 fail-closed（allowAllWhenEmpty=false 且名单为空时不响应任何消息）；
// agentPreset 配置了但 DSH 里不存在时拒绝建会话（绝不回退到带本地工具的默认 preset）。

import './proxy-bootstrap.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {
  Client, GatewayIntentBits, Partials, Events,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { NodeApiClient, createTurnCollector, unwrap } from './dsh-client.mjs';
import { chunkForDiscord, normalizeDiscordText } from './discord-format.mjs';
import { startConsole } from './console.mjs';
import { ROOT } from './paths.mjs';

const STATE_DIR = path.join(ROOT, 'state');

// ── 配置 ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(ROOT, 'config.json');
const cfg = {};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`缺少配置文件：${CONFIG_PATH}`);
    console.error('请先复制 config.example.json 为 config.json 并填写 discord.token。');
    process.exit(1);
  }
  const loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  Object.assign(cfg, loaded);
  cfg.discord = cfg.discord ?? {};
  cfg.dsh = cfg.dsh ?? {};
  cfg.dsh.baseUrl = cfg.dsh.baseUrl || 'http://127.0.0.1:3080';
  cfg.allow = cfg.allow ?? {};
  cfg.deny = cfg.deny ?? {};
  cfg.agentPreset = cfg.agentPreset ?? 'discord-chat';
  cfg.workspaceTitle = cfg.workspaceTitle ?? 'Discord 聊天';
  cfg.maxQueuePerSession = cfg.maxQueuePerSession ?? 50;
  cfg.questionTimeoutMs = cfg.questionTimeoutMs ?? 300000;
  cfg.maxMediaBytes = cfg.maxMediaBytes ?? 8 * 1024 * 1024;
  cfg.maxMediaCount = cfg.maxMediaCount ?? 5;
  cfg.pollIntervalMs = cfg.pollIntervalMs ?? 5000;
  cfg.consolePort = cfg.consolePort ?? 3100;
  cfg.consoleToken = cfg.consoleToken ?? '';
  return cfg;
}

const cfgLoaded = loadConfig();

/** 持久化 config.json（控制台改配置时调用；会话映射走 saveState）。 */
function saveConfigJson() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (error) {
    log('写回 config.json 失败:', error?.message ?? error);
  }
}

// 控制台日志环形缓冲（最近 500 条，/api/logs 消费）
const logsRing = (() => {
  const buf = [];
  const MAX = 500;
  let seq = 0;
  let dropped = 0;
  return {
    push(msg) {
      buf.push({ seq: seq++, t: new Date().toISOString(), msg });
      if (buf.length > MAX) { buf.shift(); dropped += 1; }
    },
    entries(since) {
      const items = Number.isFinite(since) && since >= 0 ? buf.filter((e) => e.seq > since) : [...buf];
      return { items, last: seq - 1 };
    },
    get dropped() { return dropped; },
  };
})();

function log(...args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(new Date().toISOString(), msg);
  logsRing.push(msg);
}

// ── 状态持久化 ──────────────────────────────────────────────────────────────

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(path.join(STATE_DIR, 'agents'), { recursive: true });

const state = {
  sessions: {},   // key -> DSH sessionId
  channels: {},   // key -> Discord channelId（回复用；DM 场景与 key 不同构）
};
const STATE_PATH = path.join(STATE_DIR, 'sessions.json');
try {
  Object.assign(state, JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')));
} catch { /* 首次启动无状态文件 */ }

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    log('保存状态失败:', error?.message ?? error);
  }
}

// key -> DSH sessionId 与 sessionId -> key 双向映射
const reverse = new Map(); // sessionId -> key
for (const [key, sessionId] of Object.entries(state.sessions)) reverse.set(String(sessionId), key);

// ── DSH 客户端 ──────────────────────────────────────────────────────────────

const api = new NodeApiClient(cfg.dsh.baseUrl, 30000, {
  token: cfg.dsh.authToken || undefined,
  allowRemote: cfg.dsh.allowRemote === true,
  tokenExplicit: Boolean(cfg.dsh.authToken),
});

// ── Discord 客户端 ──────────────────────────────────────────────────────────

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── 白名单 ──────────────────────────────────────────────────────────────────

/** 计算消息的会话 key；不在白名单/在黑名单时返回 null（fail-closed）。 */
function sessionKeyOf(msg) {
  if (msg.author.bot) return null;
  const guildId = msg.guildId ?? null;
  const channelId = msg.channelId;
  const userId = msg.author.id;
  const deny = cfg.deny ?? {};
  if ((deny.channels ?? []).includes(channelId)) return null;
  if ((deny.users ?? []).includes(userId)) return null;
  if (guildId && (deny.guilds ?? []).includes(guildId)) return null;

  const allow = cfg.allow ?? {};
  const lists = [
    allow.guilds ?? [], allow.channels ?? [], allow.users ?? [],
  ];
  const anyAllow = lists.some((l) => l.length > 0);
  if (!anyAllow) {
    if (cfg.allowAllWhenEmpty !== true) return null;
  } else {
    const hit = (guildId && (allow.guilds ?? []).includes(guildId))
      || (allow.channels ?? []).includes(channelId)
      || (allow.users ?? []).includes(userId);
    if (!hit) return null;
  }
  return guildId ? `guild:${guildId}:${channelId}` : `dm:${userId}`;
}

function isSessionAllowed(key) {
  return typeof key === 'string' && key.length > 0;
}

// ── DSH 可用性探测与掉线排队 ─────────────────────────────────────────────────

let dshDown = false;
let dshProbeTimer = null;
const pendingQueues = new Map(); // key -> [{ parts, at }]

function markDshDown(reason) {
  if (!dshDown) {
    dshDown = true;
    log(`⚠️ DSH 不可用（${reason}），消息转入本地排队，每 ${cfg.pollIntervalMs / 1000}s 探活一次`);
    if (!dshProbeTimer) {
      dshProbeTimer = setInterval(probeDsh, cfg.pollIntervalMs);
      dshProbeTimer.unref?.();
    }
  }
}

function markDshUp() {
  if (!dshDown) return;
  dshDown = false;
  clearInterval(dshProbeTimer);
  dshProbeTimer = null;
  log('✅ DSH 恢复可用，开始补投排队消息');
  for (const [key, queue] of pendingQueues.entries()) {
    const { channelId } = parseKey(key);
    const channel = channelId ? discord.channels.cache.get(channelId) : null;
    if (channel) channel.send('📥 DSH 已恢复，正在补投期间的消息…').catch(() => {});
  }
  for (const key of [...pendingQueues.keys()]) flushQueue(key);
}

async function probeDsh() {
  try {
    await api.callUnary('session/list', {});
    markDshUp();
  } catch {
    // 仍然不可用，等待下一轮
  }
}

function enqueuePending(key, parts) {
  let queue = pendingQueues.get(key);
  if (!queue) {
    queue = [];
    pendingQueues.set(key, queue);
  }
  queue.push({ parts, at: Date.now() });
  while (queue.length > cfg.maxQueuePerSession) {
    queue.shift(); // 满了丢最旧的，保住最近的上下文
  }
}

async function flushQueue(key) {
  const queue = pendingQueues.get(key);
  if (!queue?.length) return;
  while (queue.length) {
    const item = queue[0];
    try {
      await deliverPrompt(key, item.parts, { fromQueue: true });
      queue.shift();
    } catch (error) {
      markDshDown(error?.message ?? String(error));
      break;
    }
  }
  if (queue.length === 0) pendingQueues.delete(key);
}

// ── 会话管理 ────────────────────────────────────────────────────────────────

let dshPresetIds = [];

async function refreshPresetIds() {
  try {
    const value = unwrap(await api.agentPresets.list({}), 'agentPresets.list');
    dshPresetIds = (value?.presets ?? value?.items ?? []).map((p) => p?.id ?? p?.presetId).filter(Boolean);
  } catch (error) {
    log('获取 agent preset 清单失败:', error?.message ?? error);
  }
}

async function ensureChatModel(sessionId) {
  const provider = cfg.dsh.provider;
  const model = cfg.dsh.model;
  if (!provider || !model) return 'skipped';
  const effort = cfg.dsh.reasoningEffort || undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = unwrap(await api.sessions.selectModel({
        sessionId, provider, model, ...(effort ? { reasoningEffort: effort } : {}),
      }), 'session.selectModel');
      log(`已设置会话模型 ${sessionId} -> ${result?.selected?.provider ?? provider}/${result?.selected?.model ?? model}`);
      return 'applied';
    } catch (error) {
      if (attempt < 2) await sleep(1000);
      else {
        const message = String(error?.message ?? error);
        if (/not[- ]?found/i.test(message)) return 'not-found';
        log('设置会话模型失败:', message);
        return 'failed';
      }
    }
  }
  return 'failed';
}

const sessionPromises = new Map(); // key -> Promise<sessionId>

async function ensureSession(key) {
  const existing = state.sessions[key];
  if (existing) {
    const applied = await ensureChatModel(existing);
    if (applied === 'not-found') {
      log(`会话 ${key} 在 DSH 侧已不存在，退役本地映射并重建`);
      await retireSession(key, { archive: false, notify: false });
    } else {
      return existing;
    }
  }
  if (sessionPromises.has(key)) return sessionPromises.get(key);
  const promise = (async () => {
    const dir = cfg.sessionCwd ? String(cfg.sessionCwd) : path.join(STATE_DIR, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    const preset = cfg.agentPreset || null;
    // fail-closed：配置了 preset 但 DSH 里没有 → 拒绝建会话。
    // 回退到 DSH 默认 preset 会把 bash/文件读写等本地工具暴露给 Discord 频道里的任何人。
    if (preset && dshPresetIds.length > 0 && !dshPresetIds.includes(preset)) {
      throw new Error(
        `拒绝为 ${key} 创建会话：agentPreset "${preset}" 不在 DSH 可用清单中（${dshPresetIds.join(', ') || '未知'}）。`
        + '回退到默认 preset 会把本地工具暴露给 Discord 频道；请先运行 npm run setup-dsh 并重启 DSH。'
      );
    }
    let sessionId = null;
    let lastError = null;
    for (const withPreset of preset ? [true, false] : [false]) {
      try {
        const wsValue = unwrap(await api.workspace.create({ path: dir }), 'workspace.create');
        if (wsValue.created && cfg.workspaceTitle) {
          await api.workspace.rename({ workspaceId: wsValue.workspace.workspaceId, title: cfg.workspaceTitle }).catch(() => {});
        }
        const params = { workspaceId: wsValue.workspace.workspaceId };
        if (withPreset && preset) params.agentPreset = preset;
        const value = unwrap(await api.sessions.create(params), 'session.create');
        sessionId = value.sessionId;
        if (withPreset && preset) log(`会话 ${key} 已挂载 preset ${preset}`);
        else if (preset) log(`⚠️ 会话 ${key} 未能挂载 preset ${preset}，已降级为无 preset 会话`);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!sessionId) {
      throw new Error(`无法为 ${key} 创建 DSH 会话（preset ${preset ?? '无'}）：${lastError?.message ?? '未知原因'}`);
    }
    api.events.follow(sessionId);
    state.sessions[key] = sessionId;
    reverse.set(sessionId, key);
    saveState();
    await ensureChatModel(sessionId);
    log(`新会话 ${key} -> ${sessionId}`);
    return sessionId;
  })();
  sessionPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    if (sessionPromises.get(key) === promise) sessionPromises.delete(key);
  }
}

async function retireSession(key, { archive = true, notify = true } = {}) {
  const sessionId = state.sessions[key];
  if (!sessionId) return;
  delete state.sessions[key];
  delete state.channels[key];
  reverse.delete(sessionId);
  saveState();
  api.events.forget(sessionId);
  collectors.delete(sessionId);
  if (archive) {
    try {
      await api.callUnary('session/cancel', { sessionId });
    } catch { /* 会话可能已不存在 */ }
    try {
      await api.callUnary('workspace/archiveSession', { sessionId });
    } catch (error) {
      log(`归档会话 ${sessionId} 失败:`, error?.message ?? error);
    }
  }
  if (notify) {
    const { channelId } = parseKey(key);
    const channel = channelId ? discord.channels.cache.get(channelId) : null;
    if (channel) channel.send('🔄 已重置本频道的 AI 会话。').catch(() => {});
  }
  log(`已退役会话 ${key} (${sessionId})`);
}

function parseKey(key) {
  const parts = String(key).split(':');
  if (parts[0] === 'guild') return { guildId: parts[1], channelId: parts[2] };
  if (parts[0] === 'dm') return { userId: parts[1], channelId: null };
  return { guildId: null, channelId: null };
}

// ── 消息 → prompt ───────────────────────────────────────────────────────────

function displayNameOf(msg) {
  return msg.member?.displayName ?? msg.author?.globalName ?? msg.author?.username ?? 'unknown';
}

/** 下载图片附件，转成 DSH 多模态 content 的 image part。 */
async function attachmentParts(msg) {
  const parts = [];
  const attachments = [...msg.attachments.values()].filter((a) => a.contentType?.startsWith('image/'));
  let total = 0;
  let index = 0;
  for (const att of attachments) {
    index += 1;
    if (index > cfg.maxMediaCount) {
      parts.push({ type: 'text', text: `[图片 ${index}（超过单条上限 ${cfg.maxMediaCount}，已跳过）]` });
      continue;
    }
    if (att.size > cfg.maxMediaBytes) {
      parts.push({ type: 'text', text: `[图片 ${index}（大小 ${Math.round(att.size / 1024)}KB 超过上限，已跳过）]` });
      continue;
    }
    try {
      const res = await fetch(att.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (total + buffer.length > cfg.maxMediaBytes) {
        parts.push({ type: 'text', text: `[图片 ${index}（图片总大小超限，已跳过）]` });
        continue;
      }
      total += buffer.length;
      parts.push({ type: 'text', text: `[图片 ${index}]` });
      const mime = att.contentType || 'image/png';
      parts.push({
        type: 'image',
        mediaType: mime,
        data: buffer.toString('base64'),
        name: `discord-image-${index}.${(mime.split('/')[1] || 'png').split(';')[0]}`,
      });
    } catch (error) {
      parts.push({ type: 'text', text: `[图片 ${index}（下载失败：${error?.message ?? error}）]` });
    }
  }
  // 非图片附件只标注文件名，不投喂内容
  for (const att of [...msg.attachments.values()].filter((a) => !a.contentType?.startsWith('image/'))) {
    parts.push({ type: 'text', text: `[附件：${att.name ?? att.url}]` });
  }
  return parts;
}

/** 把一条 Discord 消息转成 DSH prompt 的 content parts。 */
async function buildPromptParts(msg) {
  const parts = [];
  // 引用/回复：注入被引用人 + 原文
  if (msg.reference?.messageId) {
    try {
      const ref = await msg.channel.messages.fetch(msg.reference.messageId);
      if (ref) {
        const refText = normalizeDiscordText(ref) || (ref.attachments.size ? `（${ref.attachments.size} 个附件）` : '');
        parts.push({ type: 'text', text: `[引用 ${displayNameOf(ref)}：${refText.slice(0, 500)}]` });
      }
    } catch { /* 引用消息可能已删除 */ }
  }
  const text = normalizeDiscordText(msg);
  parts.push({ type: 'text', text: `[Discord] ${displayNameOf(msg)}：${text}` });
  if (msg.attachments.size > 0) parts.push(...await attachmentParts(msg));
  // 全空（理论不会发生）就不投
  if (parts.length === 1 && !parts[0].text.replace(`[Discord] ${displayNameOf(msg)}：`, '').trim()) return null;
  return parts;
}

// ── 回合事件泵 ──────────────────────────────────────────────────────────────

const collectors = new Map(); // sessionId -> turn collector

// 值得为其建 collector 的回合事件（实测 DSH 0.2.1 可能不发 turn/start，
// 从 step/start / assistant/message 直接开始，所以按内容惰性创建）。
const TURN_EVENTS = new Set(['turn/start', 'assistant/message', 'turn/end']);

function trackTurnEvent(sessionId, event) {
  if (!TURN_EVENTS.has(event.type)) return;
  let collector = collectors.get(sessionId);
  if (!collector) {
    collector = createTurnCollector();
    collectors.set(sessionId, collector);
  }
  const ended = collector.push(event);
  // turn/end 无论是否取到文本都终结 collector，防止空壳残留。
  if (ended || event.type === 'turn/end') {
    collectors.delete(sessionId);
  }
  if (ended) {
    if (ended.reason?.kind === 'completed' && ended.text.trim()) {
      const key = reverse.get(sessionId);
      if (key) sendReply(key, ended.text).catch((error) => log('发送回复失败:', error?.message ?? error));
    }
  }
}

async function sendReply(key, text) {
  // 优先用最近一次见到消息的频道（DM 的 key 不含 channelId，必须走这张表）；
  // 其次用 key 里编码的 guild channel。
  const channelId = state.channels[key] ?? parseKey(key).channelId;
  if (!channelId) return;
  const channel = discord.channels.cache.get(channelId) ?? await discord.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    log(`找不到频道 ${channelId}（key=${key}），丢弃回复`);
    return;
  }
  for (const chunk of chunkForDiscord(text)) {
    await channel.send(chunk);
  }
}

// ── 提问（ask_user_question）→ Discord 按钮 ─────────────────────────────────

const pendingQuestions = new Map(); // discord message id -> entry

async function handleQuestionEvent(frame) {
  const key = reverse.get(frame.sessionId);
  const questions = Array.isArray(frame.questions) ? frame.questions : [];
  const answerEmpty = async () => {
    try {
      await api.respond({
        clientId: frame.clientId,
        eventId: frame.eventId,
        outcome: { kind: 'result', value: { answers: questions.map((q) => ({ id: q.id, selected: [], custom: '' })) } },
      });
    } catch (error) {
      log('提交空答案回执失败:', error?.message ?? error);
    }
  };
  if (!key) return answerEmpty();
  const { channelId } = parseKey(key);
  const channel = channelId ? (discord.channels.cache.get(channelId) ?? await discord.channels.fetch(channelId).catch(() => null)) : null;
  if (!channel) return answerEmpty();

  const components = [];
  const buttonsPerRow = 5;
  let row = new ActionRowBuilder();
  let totalButtons = 0;
  questions.forEach((q, qIdx) => {
    (q.options ?? []).forEach((opt, oIdx) => {
      if (totalButtons >= 25) return;
      row.addComponents(new ButtonBuilder()
        .setCustomId(`dshq:${qIdx}:${oIdx}`)
        .setLabel(String(opt.label ?? `选项${oIdx + 1}`).slice(0, 80))
        .setStyle(ButtonStyle.Primary));
      totalButtons += 1;
      if (row.components.length >= buttonsPerRow) {
        components.push(row);
        row = new ActionRowBuilder();
      }
    });
  });
  if (row.components.length) components.push(row);

  const lines = questions.map((q) => `**${q.question ?? q.title ?? '问题'}**\n${(q.options ?? []).map((o) => `• ${o.label}`).join('\n')}`);
  const sent = await channel.send({
    content: `❓ **AI 想确认一下**\n${lines.join('\n\n')}`.slice(0, 1900),
    components,
  }).catch((error) => { log('发送提问消息失败:', error?.message ?? error); return null; });
  if (!sent) return answerEmpty();

  const entry = {
    clientId: frame.clientId,
    eventId: frame.eventId,
    sessionId: frame.sessionId,
    questions,
  };
  pendingQuestions.set(sent.id, entry);
  const timer = setTimeout(async () => {
    if (pendingQuestions.get(sent.id) === entry) {
      pendingQuestions.delete(sent.id);
      await disableComponents(sent);
      await answerEmpty();
    }
  }, cfg.questionTimeoutMs);
  timer.unref?.();
}

async function disableComponents(message) {
  try {
    await message.edit({ components: [] });
  } catch { /* 消息可能已删除 */ }
}

discord.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ds-reset') {
        await interaction.deferReply({ ephemeral: true });
        const key = sessionKeyOf({ author: interaction.user, guildId: interaction.guildId, channelId: interaction.channelId, bot: false });
        if (state.sessions[key]) {
          await retireSession(key);
          await interaction.editReply('已重置本频道的 AI 会话。');
        } else {
          await interaction.editReply('本频道没有活跃的 AI 会话。');
        }
        return;
      }
      if (interaction.commandName === 'ds-status') {
        await interaction.deferReply({ ephemeral: true });
        const key = sessionKeyOf({ author: interaction.user, guildId: interaction.guildId, channelId: interaction.channelId, bot: false });
        const sessionId = state.sessions[key];
        const queued = pendingQueues.get(key)?.length ?? 0;
        await interaction.editReply(
          sessionId
            ? `会话 key: \`${key}\`\nDSH session: \`${sessionId}\`\n掉线排队中: ${queued} 条\nDSH: ${dshDown ? '🔴 不可用' : '🟢 可用'}`
            : `本频道没有活跃的 AI 会话。\nDSH: ${dshDown ? '🔴 不可用' : '🟢 可用'}`
        );
        return;
      }
    }
    if (interaction.isButton() && interaction.customId.startsWith('dshq:')) {
      const entry = pendingQuestions.get(interaction.message.id);
      if (!entry) {
        await interaction.update({ components: [] }).catch(() => {});
        return;
      }
      const [, qIdxRaw, oIdxRaw] = interaction.customId.split(':');
      const q = entry.questions[Number(qIdxRaw)];
      const opt = q?.options?.[Number(oIdxRaw)];
      if (!q || !opt) return;
      // 一次点击即终结整个提问事件：选中项进 selected，其余问题留空。
      const answers = entry.questions.map((question, i) => (
        i === Number(qIdxRaw) ? { id: question.id, selected: [opt.label] } : { id: question.id, selected: [], custom: '' }
      ));
      try {
        await api.respond({
          clientId: entry.clientId,
          eventId: entry.eventId,
          outcome: { kind: 'result', value: { answers } },
        });
        pendingQuestions.delete(interaction.message.id);
        await interaction.update({
          content: `${interaction.message.content}\n\n> ✅ <@${interaction.user.id}> 选择了：**${opt.label}**`,
          components: [],
        });
      } catch (error) {
        log('提交答案失败:', error?.message ?? error);
        await interaction.reply({ content: '⚠️ 回答提交失败，请再点一次。', ephemeral: true }).catch(() => {});
      }
    }
  } catch (error) {
    log('interaction 处理失败:', error?.message ?? error);
  }
});

// ── 消息入口 ────────────────────────────────────────────────────────────────

discord.on(Events.MessageCreate, async (msg) => {
  try {
    const key = sessionKeyOf(msg);
    if (!isSessionAllowed(key)) return;
    const parts = await buildPromptParts(msg);
    if (!parts) return;
    state.channels[key] = msg.channelId;
    if (cfg.discord.ackReaction) {
      msg.react(cfg.discord.ackReaction).catch(() => {});
    }
    if (dshDown) {
      enqueuePending(key, parts);
      return;
    }
    try {
      await deliverPrompt(key, parts, {});
    } catch (error) {
      const message = String(error?.message ?? error);
      if (/fetch failed|ECONNREFUSED|network|HTTP 5\d\d|timeout/i.test(message)) {
        markDshDown(message);
        enqueuePending(key, parts);
      } else {
        log('投递失败:', message);
        msg.reply(`⚠️ 消息投递失败：${message.slice(0, 300)}`).catch(() => {});
      }
    }
  } catch (error) {
    log('消息处理失败:', error?.message ?? error);
  }
});

async function deliverPrompt(key, parts, _meta) {
  const sessionId = await ensureSession(key);
  const accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content: parts });
  if (!accepted.result.ok) {
    throw new Error(`${accepted.result.error?.code}: ${accepted.result.error?.message}`);
  }
  if (accepted.result.value?.command?.text) {
    await sendReply(key, accepted.result.value.command.text);
    return;
  }
  log(`已投递 ${key}: ${parts[0]?.text?.slice(0, 80) ?? '(多媒体)'}${(parts[0]?.text?.length ?? 0) > 80 ? '…' : ''}`);
}

// ── DSH 事件流 ──────────────────────────────────────────────────────────────

async function pumpMux() {
  let retryMs = 3000;
  for (;;) {
    try {
      log('连接 DSH 事件流…');
      for await (const envelope of api.events.mux({})) {
        retryMs = 3000;
        const frame = envelope.payload;
        if (frame.type === 'session/snapshot') continue;
        if (frame.type === 'session/event') {
          if (!reverse.has(frame.sessionId)) continue;
          trackTurnEvent(frame.sessionId, frame.event);
        } else if (frame.type === 'question/requested') {
          handleQuestionEvent(frame).catch((e) => log('处理提问失败:', e?.message ?? e));
        } else if (frame.type === 'approval/requested') {
          handleApprovalEvent(frame).catch((e) => log('处理审批失败:', e?.message ?? e));
        } else if (frame.type === 'stream/error') {
          log('会话流出错:', frame.error?.code ?? '', frame.error?.message ?? '');
        }
      }
    } catch (error) {
      log('事件流中断:', error?.message ?? error);
    }
    await sleep(retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  }
}

async function handleApprovalEvent(frame) {
  const key = reverse.get(frame.sessionId);
  if (!key) {
    try {
      await api.respond({ clientId: frame.clientId, eventId: frame.eventId, outcome: { kind: 'result', value: 'rejected' } });
    } catch { /* ignore */ }
    return;
  }
  const { channelId } = parseKey(key);
  const channel = channelId ? discord.channels.cache.get(channelId) : null;
  if (!channel) return;
  const sent = await channel.send({
    content: `🔐 **工具审批请求**\n工具：\`${frame.toolName ?? 'unknown'}\`${frame.reason ? `\n原因：${String(frame.reason).slice(0, 500)}` : ''}`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dsha:allow').setLabel('允许').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('dsha:reject').setLabel('拒绝').setStyle(ButtonStyle.Danger),
    )],
  }).catch(() => null);
  if (!sent) return;
  const filter = (i) => i.customId === 'dsha:allow' || i.customId === 'dsha:reject';
  try {
    const choice = await sent.awaitMessageComponent({ filter, time: cfg.questionTimeoutMs });
    const outcome = choice.customId === 'dsha:allow' ? 'allowed-once' : 'rejected';
    await api.respond({ clientId: frame.clientId, eventId: frame.eventId, outcome: { kind: 'result', value: outcome } });
    await choice.update({
      content: `${sent.content}\n\n> ${outcome === 'allowed-once' ? '✅ 已通过' : '❌ 已拒绝'}（by <@${choice.user.id}>）`,
      components: [],
    });
  } catch {
    try {
      await api.respond({ clientId: frame.clientId, eventId: frame.eventId, outcome: { kind: 'result', value: 'rejected' } });
      await sent.edit({ content: `${sent.content}\n\n> ⏱️ 超时，已自动拒绝`, components: [] });
    } catch { /* ignore */ }
  }
}

// ── Discord 启动 ────────────────────────────────────────────────────────────

discord.once(Events.ClientReady, async (client) => {
  log(`Discord 已连接：${client.user.tag}`);
  // 注册斜杠命令（guild 级即时生效；全局命令需要最长 1 小时传播）
  const commands = [
    { name: 'ds-reset', description: '重置当前频道的 AI 会话' },
    { name: 'ds-status', description: '查看当前频道的 AI 会话状态' },
  ];
  try {
    for (const guild of client.guilds.cache.values()) {
      await guild.commands.set(commands);
    }
    log('斜杠命令已注册');
  } catch (error) {
    log('注册斜杠命令失败:', error?.message ?? error);
  }
  // 恢复既有会话的事件订阅
  for (const sessionId of new Set(Object.values(state.sessions).map(String))) {
    api.events.follow(sessionId);
    log(`已恢复会话订阅: ${sessionId}`);
  }
  // 启动时先探测 DSH
  try {
    await refreshPresetIds();
    await api.callUnary('session/list', {});
    markDshUp();
  } catch (error) {
    markDshDown(error?.message ?? String(error));
  }
});

discord.on(Events.Error, (error) => log('Discord 客户端错误:', error?.message ?? error));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!cfg.discord.token) {
    console.error('config.json 缺少 discord.token，无法启动。');
    process.exit(1);
  }
  log('正在连接 Discord 网关…（超过 30 秒无下文通常是代理/VPN 未连通）');
  const loginHint = setTimeout(() => {
    log('⚠️ 30 秒仍未连上 Discord：请确认 VPN/代理可用（浏览器能否打开 discord.com），'
      + '或在 config.json 的 discord.proxy 里显式填写代理地址，如 "http://127.0.0.1:7890"');
  }, 30000);
  loginHint.unref?.();
  try {
    await discord.login(cfg.discord.token);
  } catch (error) {
    log('❌ Discord 登录失败:', error?.message ?? error);
    process.exit(1);
  }
  clearTimeout(loginHint);

  // 本地控制台（SnowLuma 风格 WebUI）：只监听 127.0.0.1
  try {
    await startConsole({
      cfg,
      saveConfig: saveConfigJson,
      state,
      reverse,
      collectors,
      pendingQueues,
      retireSession,
      logsRing,
      discord,
      api,
      isDshDown: () => dshDown,
    });
  } catch (error) {
    log('控制台启动失败（不影响桥接）:', error?.message ?? error);
  }

  pumpMux().catch((error) => {
    log('事件泵退出:', error?.message ?? error);
    process.exitCode = 1;
  });
}

process.on('unhandledRejection', (reason) => log('unhandledRejection:', reason?.message ?? reason));

main();
