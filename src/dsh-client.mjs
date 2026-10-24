// 自包含的 DSH Web API 客户端（Node 环境）。
// 适配 DSH 0.2.1 的协议（与 qq-bridge src/dsh-client.js 同代，逐项实测过的形状）：
// 1. RPC endpoint 为斜杠形式（session/list、session/prompt …）；
// 2. payload 包装为 { args: { <参数名>: payload } }（session/list 用 _request，其余多为 request）；
// 3. 浏览器会话鉴权：优先用 ~/.dsh/.credentials.yaml 里的持久化签名密钥**离线铸造**
//    Cookie（HMAC，无网络往返），不依赖进程启动 token；也可显式配置 dsh.authToken。
// 4. 事件流：/api/remote.mux 上按 session/follow 打开单会话流；Remote Event
//    （提问 user-questions/request、审批 approval/request）走同一条 mux 上的
//    $events 逻辑流，回执 POST /api/$events/result。
//
// 与 qq-bridge 版本的差异：本文件不依赖 @deepseek-ai/dsh-host-apiproxy，
// 用文件末尾的 MiniApiClientBase 手搓了基类所需的四个成员
// （timeoutMs / mintRpcId / onEnvelope / postJson），依赖只剩 js-yaml。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import YAML from 'js-yaml';

/** DSH home：凭据文件在这里。 */
export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

// ── 浏览器会话 Cookie 铸造 ──────────────────────────────────────────────────
// DSH 的浏览器 Cookie 用 credentials 里 client-connection/browser-session 的
// 32 字节签名密钥做 HMAC。服务端校验只要求：
//   · cookie 名 = 'dsh-auth-' + base64url(sha256(authority))
//   · payload.authority === authority（Host 头，例如 127.0.0.1:3080）
//   · issuedAt <= now < expiresAt 且有效期 <= 上限（默认 30 天）
// 本机同用户进程可以离线铸造合法 Cookie，完全绕开「随进程重启失效」的启动 token。
const BROWSER_SESSION_KEY = 'client-connection/browser-session';
const COOKIE_PAYLOAD_VERSION = 1;
const COOKIE_PREFIX = 'dsh-auth-';
const SECRET_BYTES = 32;
/** 铸造 Cookie 的有效期：远小于 DSH 默认上限，够用且留足余量。 */
export const MINTED_COOKIE_LIFETIME_MS = 60 * 60 * 1000;
/** 到期前多久主动重铸（纯本地 HMAC，提前换比撞 401 再重试便宜）。 */
const MINTED_COOKIE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const base64url = (buffer) => Buffer.from(buffer).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** 读取 DSH 持久化的浏览器会话签名密钥；不可用时返回 null（调用方回退）。 */
export function readBrowserSessionSecret() {
  try {
    const doc = YAML.load(fs.readFileSync(path.join(resolveDshHome(), '.credentials.yaml'), 'utf8'));
    const record = doc?.records?.[BROWSER_SESSION_KEY];
    if (record?.kind !== 'grant' || record?.payload?.version !== 1) return null;
    const secret = record.payload.secret;
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
    const decoded = Buffer.from(secret.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
    // 长度必须正好 32 字节；否则说明 DSH 换了密钥方案，宁可回退也不发坏 Cookie。
    return decoded.byteLength === SECRET_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

/** 用签名密钥为指定 DSH 地址铸造会话 Cookie，返回 `name=value` 串。 */
export function mintBrowserSessionCookie(baseUrl, secret, { lifetimeMs = MINTED_COOKIE_LIFETIME_MS } = {}) {
  const authority = new URL(String(baseUrl)).host;
  if (!authority) throw new Error('DSH baseUrl has no authority');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + lifetimeMs;
  const body = base64url(Buffer.from(JSON.stringify({
    version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt
  }), 'utf8'));
  const signature = base64url(createHmac('sha256', secret).update(body).digest());
  const name = COOKIE_PREFIX + base64url(createHash('sha256').update(authority).digest());
  return `${name}=v1.${body}.${signature}`;
}

/** baseUrl 是否指向本机回环地址（launch token 只允许发往回环）。 */
export function isLoopbackBase(baseUrl) {
  try {
    const u = new URL(String(baseUrl));
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1' || host === '[::1]') return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

// ── RPC 协议 ────────────────────────────────────────────────────────────────

/** 新协议 RPC 的 args 包装：旧 payload -> { <参数名>: payload }。 */
const METHOD_ARG_WRAPPERS = {
  'session/list': '_request',
  'session/create': 'request',
  'session/prompt': 'request',
  'session/cancel': 'request',
  'session/selectModel': 'request',
  'session/rename': 'request',
  'session/fork': 'request',
  'session/updateQueue': 'request',
  'session/page': 'request',
  'session/search': 'request',
  'session/follow': 'request',
  'session/projections': 'request',
  'workspace/create': 'request',
  'workspace/rename': 'request',
  'workspace/delete': 'request',
  'workspace/archiveSession': 'request',
  'agentPresets/list': null,
  'settings/describe': null,
};

function endpointOf(method) {
  return method.replace(/\./g, '/');
}

/** session/follow 开场快照携带的历史事件条数（DSH 默认 50）。 */
export const FOLLOW_SNAPSHOT_MESSAGES = 50;

function wrapArgs(method, payload) {
  const endpoint = endpointOf(method);
  let body = payload ?? {};
  // 新版 SessionPromptRequest 强制要求 requestId。
  if (endpoint === 'session/prompt' && typeof body.requestId !== 'string') {
    body = { ...body, requestId: randomUUID() };
  }
  const wrapper = METHOD_ARG_WRAPPERS[endpoint];
  if (wrapper === null) return { args: {} };
  if (wrapper === undefined) return { args: body };
  return { args: { [wrapper]: body } };
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); }
    );
  });
}

/**
 * DSH Web API 客户端。
 * @param baseUrl  DSH 基址，例如 http://127.0.0.1:3080
 * @param timeoutMs RPC 超时
 * @param auth { token?, allowRemote?, tokenExplicit? }
 */
export class NodeApiClient {
  constructor(baseUrl, timeoutMs = 30000, auth = {}) {
    this.baseUrl = String(baseUrl ?? 'http://127.0.0.1:3080').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.auth = auth ?? {};
    this.launchToken = this.auth.token || '';
    this.cookie = null;
    this.cookiePromise = null;
    this._authEpoch = 0;
    this._muxSendOpen = null;
    this._secret = undefined;
    this.tokenExplicit = this.auth.tokenExplicit === true;
    this._strategy = null;
    this._preferToken = false;
    this._cookieExpiresAt = 0;
    // 期望 follow 的会话集合：跨重连保留。DSH 重启或 WS 中断后必须重放，
    // 否则已有会话再也收不到 turn 事件（Discord 上永远没有回复，且无报错）。
    this._desiredFollows = new Set();
  }

  resolveBase() { return this.baseUrl; }

  mintRpcId() { return randomUUID(); }

  onEnvelope(_message) {}

  /** 使当前 Cookie/token 失效；DSH 重启或 401 后自动重新发现。 */
  invalidateAuth() {
    this._authEpoch += 1;
    this.cookie = null;
    this.cookiePromise = null;
    this._cookieExpiresAt = 0;
    // 密钥文件可能刚被 DSH 重建（首次启动写入凭据），重探一次。
    this._secret = undefined;
    // 刻意不碰 _preferToken：本方法也被 remote.mux 流结束调用（WS 抖动/DSH 重启），
    // 那是常态事件，不是「铸造的 Cookie 无效」的证据。
    this._strategy = null;
  }

  browserSessionSecret() {
    if (this._secret === undefined) this._secret = readBrowserSessionSecret();
    return this._secret;
  }

  hasAuth() {
    return Boolean(this.launchToken) || this.browserSessionSecret() !== null;
  }

  _mintCookie(secret) {
    this.cookie = mintBrowserSessionCookie(this.baseUrl, secret);
    this._cookieExpiresAt = Date.now() + MINTED_COOKIE_LIFETIME_MS;
    this._strategy = 'minted';
    return this.cookie;
  }

  /**
   * 换取或铸造会话 Cookie。
   * 优先级：默认铸造优先（不依赖启动器记日志、不随 DSH 重启失效）；
   * 用户显式配置 dsh.authToken 时尊重显式意图；铸造被 401 后改用 token。
   */
  async ensureAuth(signal) {
    signal?.throwIfAborted();
    if (this.cookie && this._strategy !== 'minted') return this.cookie;
    if (this.cookie && Date.now() < this._cookieExpiresAt - MINTED_COOKIE_REFRESH_MARGIN_MS) return this.cookie;
    this.cookie = null;
    const secret = this.browserSessionSecret();
    // 铸造只对回环地址成立：签名密钥取自本机 DSH_HOME，远程 DSH 用的是另一份密钥。
    const canMint = secret !== null && isLoopbackBase(this.baseUrl);
    if (canMint && !this._preferToken && !this.tokenExplicit) return this._mintCookie(secret);
    if (!this.launchToken) {
      if (canMint) return this._mintCookie(secret);
      throw new Error(
        'DSH 鉴权不可用：没有可用的 launch token（config 的 dsh.authToken 为空），'
        + `也读不到 ${path.join(resolveDshHome(), '.credentials.yaml')} 里的 `
        + `${BROWSER_SESSION_KEY} 签名密钥。请在 config.json 里显式设置 dsh.authToken，`
        + '或确认 DSH_HOME 指向真正的 .dsh 目录。'
      );
    }
    // launch token 是进程启动凭据，只能放进 URL 查询串，绝不能发往非回环地址。
    if (!this.auth.allowRemote && !isLoopbackBase(this.baseUrl)) {
      throw new Error(`拒绝把 DSH launch token 发往非本机地址（${this.baseUrl}）：那是进程启动凭据，只应交给 127.0.0.1。确实要连远程 DSH 时请在 config.json 里显式设置 dsh.allowRemote: true`);
    }
    if (this.cookiePromise) return waitWithSignal(this.cookiePromise, signal);
    const promise = (async () => {
      const epoch = this._authEpoch;
      const url = new URL(this.baseUrl);
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      url.searchParams.set('token', this.launchToken);
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      const setCookie = res.headers.get('set-cookie');
      await res.body?.cancel();
      if (!setCookie) throw new Error(`DSH token exchange failed: HTTP ${res.status}`);
      if (epoch !== this._authEpoch) throw new Error('DSH auth session invalidated during token exchange');
      this.cookie = setCookie.split(';')[0];
      this._strategy = 'token';
      return this.cookie;
    })();
    this.cookiePromise = promise;
    const clearPromise = () => {
      if (this.cookiePromise === promise) this.cookiePromise = null;
    };
    promise.then(clearPromise, clearPromise);
    return waitWithSignal(promise, signal);
  }

  async doFetch(input, init) {
    return fetch(input, init);
  }

  /** 带 Cookie 的 POST，返回原始 Response。 */
  async postJson(pathname, body, signal) {
    const url = new URL(pathname, this.resolveBase());
    const headers = new Headers({ 'content-type': 'application/json' });
    if (this.hasAuth()) {
      const cookie = await this.ensureAuth(signal);
      headers.set('cookie', cookie);
    }
    const res = await this.doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    return res;
  }

  /**
   * 一元 RPC。POST /api/<endpoint>，信封 { type:'client-request', rpcId, method, payload }。
   * 只解析最外层信封，不依赖官方包的 value schema。
   */
  async callUnary(method, payload, signal) {
    const endpoint = endpointOf(method);
    const message = {
      type: 'client-request',
      rpcId: this.mintRpcId(),
      method: endpoint,
      payload: wrapArgs(method, payload)
    };
    this.onEnvelope(message);
    const response = await this.postJson(`/api/${endpoint}`, message, signal);
    let full;
    try {
      full = await response.json();
    } catch (error) {
      throw new Error(`invalid server-response for ${endpoint}: HTTP ${response.status}`);
    }
    if (!full || full.type !== 'server-response' || full.rpcId !== message.rpcId || !full.result) {
      throw new Error(`invalid server-response for ${endpoint}`);
    }
    this.onEnvelope(full);
    return { rpcId: full.rpcId, result: full.result };
  }

  /**
   * Remote Event 结果通道：POST /api/$events/result。
   * 调用方传 { clientId, eventId, outcome }。
   */
  async respond(message, signal) {
    if (message?.clientId && message?.eventId && message?.outcome) {
      const response = await this.callUnary('$events/result', {
        clientId: message.clientId,
        eventId: message.eventId,
        outcome: message.outcome
      }, signal);
      if (!response.result?.ok) {
        const { code, message: errMsg } = response.result?.error ?? {};
        throw new Error(`$events/result rejected${code ? ` (${code})` : ''}: ${errMsg ?? 'unknown error'}`);
      }
      return response;
    }
    throw new Error('respond requires clientId/eventId/outcome');
  }

  agentPresets = {
    list: (payload, signal) => this.callUnary('agentPresets.list', payload, signal),
  };

  /** sessions 域门面（旧版官方基类提供的域方法，这里手搓同名面）。 */
  sessions = {
    list: (payload, signal) => this.callUnary('session/list', payload ?? {}, signal),
    create: (payload, signal) => this.callUnary('session/create', payload, signal),
    prompt: (payload, signal) => this.callUnary('session/prompt', payload, signal),
    cancel: (payload, signal) => this.callUnary('session/cancel', payload, signal),
    selectModel: (payload, signal) => this.callUnary('session/selectModel', payload, signal),
    rename: (payload, signal) => this.callUnary('session/rename', payload, signal),
    fork: (payload, signal) => this.callUnary('session/fork', payload, signal),
    page: (payload, signal) => this.callUnary('session/page', payload, signal),
    search: (payload, signal) => this.callUnary('session/search', payload, signal),
    projections: (payload, signal) => this.callUnary('session/projections', payload, signal),
  };

  workspace = {
    create: (payload, signal) => this.callUnary('workspace/create', payload, signal),
    rename: (payload, signal) => this.callUnary('workspace/rename', payload, signal),
    delete: (payload, signal) => this.callUnary('workspace/delete', payload, signal),
    archiveSession: (payload, signal) => this.callUnary('workspace/archiveSession', payload, signal),
  };

  /**
   * 事件流：连接 /api/remote.mux，自动 follow 所有 session，并把
   * session/follow 的 event 帧映射成可消费的 session/event 信封。
   */
  events = {
    mux: (_payload, signal, onOpen) => this.openRemoteEventStream(signal, onOpen),
    follow: (sessionId) => this._followSession(sessionId),
    forget: (sessionId) => {
      if (!sessionId) return;
      this._desiredFollows.delete(String(sessionId));
    },
  };

  openRemoteEventStream(signal, onOpen) {
    const gen = this._remoteMuxGenerator(signal, onOpen);
    return {
      [Symbol.asyncIterator]: () => gen,
      follow: (sessionId) => this._followSession(sessionId),
      forget: (sessionId) => { if (sessionId) this._desiredFollows.delete(String(sessionId)); }
    };
  }

  _followSession(sessionId) {
    if (!sessionId) return;
    const sid = String(sessionId);
    // 先记账再发送：即使此刻没有连接（或正处在重连窗口内），重连时也会重放。
    this._desiredFollows.add(sid);
    if (this._muxSendOpen) this._muxSendOpen(sid);
  }

  async *_remoteMuxGenerator(signal, onOpen) {
    const own = signal === undefined ? new AbortController() : undefined;
    const sig = signal ?? own.signal;
    sig.throwIfAborted();
    await this.ensureAuth(sig);
    sig.throwIfAborted();
    const url = new URL('/api/remote.mux', this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: { cookie: this.cookie } });
    const inbox = [];
    let wake;
    let socketOpen = false;
    let eventStreamId = null;
    let eventClientId = null;
    let ended = false;
    const followed = new Set();
    const streamToSession = new Map();
    const sessionToStream = new Map();
    const enqueue = (item) => {
      inbox.push(item);
      wake?.();
      wake = undefined;
    };
    const endStream = () => {
      if (ended) return;
      ended = true;
      if (this._muxSendOpen === sendOpen) this._muxSendOpen = null;
      // 连接断开（含鉴权失败/DSH 重启）时丢弃旧 Cookie，重连会重新铸造。
      if (!sig.aborted) this.invalidateAuth();
      enqueue({ kind: 'end' });
    };
    const sendOpen = (sessionId) => {
      if (ended || !socketOpen || sessionToStream.has(sessionId) || followed.has(sessionId)) return;
      const streamId = randomUUID();
      streamToSession.set(streamId, sessionId);
      sessionToStream.set(sessionId, streamId);
      followed.add(sessionId);
      try {
        socket.send(JSON.stringify({
          type: 'open',
          streamId,
          endpoint: 'session/follow',
          payload: {
            args: {
              request: {
                address: { kind: 'session', sessionId },
                maxMessages: FOLLOW_SNAPSHOT_MESSAGES
              }
            }
          }
        }));
      } catch (error) {
        console.error('[dsh-client] failed to open session/follow:', error?.message ?? error);
        sessionToStream.delete(sessionId);
        streamToSession.delete(streamId);
        followed.delete(sessionId);
        endStream();
      }
    };
    const sendOpenEvents = () => {
      if (ended || !socketOpen || eventStreamId) return;
      const streamId = randomUUID();
      eventStreamId = streamId;
      try {
        socket.send(JSON.stringify({
          type: 'open',
          streamId,
          endpoint: '$events',
          payload: { args: {} }
        }));
      } catch (error) {
        console.error('[dsh-client] failed to open $events stream:', error?.message ?? error);
        eventStreamId = null;
        endStream();
      }
    };
    const handleOpen = () => {
      if (ended || sig.aborted) return;
      socketOpen = true;
      this._muxSendOpen = sendOpen;
      // 重放全部期望 follow（跨重连保留）：少了这一步，DSH 一重启，
      // 所有已存在的 Discord 会话就会静默失联。
      for (const sid of this._desiredFollows) sendOpen(sid);
      sendOpenEvents();
      if (!ended) onOpen?.();
    };
    const handleMessage = (event) => {
      let msg;
      try {
        if (typeof event.data !== 'string') throw new Error('binary frame');
        msg = JSON.parse(event.data);
        if (!msg || typeof msg.type !== 'string' || typeof msg.streamId !== 'string') {
          throw new Error('unexpected remote stream frame');
        }
      } catch (error) {
        console.error('[dsh-client] dropping malformed remote.mux frame:', error?.message ?? error);
        return;
      }
      const sessionId = streamToSession.get(msg.streamId);
      const isEventStream = msg.streamId === eventStreamId;
      if (msg.type === 'item') {
        if (isEventStream && msg.value) {
          const value = msg.value;
          if (value.type === 'ready') {
            eventClientId = value.clientId;
          } else if (value.type === 'waterfall' && eventClientId) {
            if (value.event === 'approval/request') {
              enqueue({
                kind: 'frame',
                envelope: {
                  rpcId: value.eventId,
                  payload: {
                    type: 'approval/requested',
                    sessionId: value.agentId,
                    clientId: eventClientId,
                    eventId: value.eventId,
                    toolName: value.request?.toolName,
                    callId: value.request?.callId,
                    reason: value.request?.reason
                  }
                }
              });
            } else if (value.event === 'user-questions/request') {
              enqueue({
                kind: 'frame',
                envelope: {
                  rpcId: value.eventId,
                  payload: {
                    type: 'question/requested',
                    sessionId: value.agentId,
                    clientId: eventClientId,
                    eventId: value.eventId,
                    questions: value.request?.questions
                  }
                }
              });
            }
          }
        } else if (sessionId && msg.value?.type === 'event') {
          enqueue({
            kind: 'frame',
            envelope: {
              rpcId: msg.streamId,
              payload: { type: 'session/event', sessionId, event: msg.value.event }
            }
          });
        } else if (sessionId && msg.value?.type === 'snapshot') {
          // 开场快照：单独一种帧类型，绝不混进 session/event——
          // 快照里含历史 turn/end，走事件通道会把旧回合当新回合发回复。
          enqueue({
            kind: 'frame',
            envelope: {
              rpcId: msg.streamId,
              payload: { type: 'session/snapshot', sessionId, snapshot: msg.value }
            }
          });
        }
      } else if (msg.type === 'end') {
        if (isEventStream) {
          eventStreamId = null;
          eventClientId = null;
          // 仅清掉 id 会让提问/审批通道永久失联；结束 mux 由上层重连并重开。
          endStream();
        } else if (sessionId) {
          sessionToStream.delete(sessionId);
          streamToSession.delete(msg.streamId);
          followed.delete(sessionId);
          // 服务端主动结束单条会话流（follow 被回收/会话归档/空闲清理）。
          // 必须主动重开订阅，否则该会话永久失联且毫无提示。
          if (this._desiredFollows.has(sessionId)) {
            setTimeout(() => {
              if (!ended && this._desiredFollows.has(sessionId)) sendOpen(sessionId);
            }, 2000);
          }
        }
      } else if (msg.type === 'error') {
        if (isEventStream) {
          console.error('[dsh-client] $events stream failed:', msg.error?.code || 'unknown error');
          eventStreamId = null;
          eventClientId = null;
          endStream();
        } else if (sessionId) {
          sessionToSession.delete(sessionId);
          streamToSession.delete(msg.streamId);
          followed.delete(sessionId);
          // 只有已不存在的会话才永久取消订阅；临时服务错误必须在重连后重试。
          if (msg.error?.code === 'session/not-found') this._desiredFollows.delete(sessionId);
          enqueue({
            kind: 'frame',
            envelope: { rpcId: msg.streamId, payload: { type: 'stream/error', error: msg.error } }
          });
          if (msg.error?.code !== 'session/not-found') endStream();
        }
      }
    };
    const handleClose = () => endStream();
    const handleError = () => endStream();
    const handleAbort = () => {
      endStream();
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
    };
    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose, { once: true });
    socket.addEventListener('error', handleError, { once: true });
    sig.addEventListener('abort', handleAbort, { once: true });
    if (sig.aborted) handleAbort();
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift();
          if (item.kind === 'end') return;
          yield item.envelope;
        }
        await new Promise((resolve) => { wake = resolve; });
      }
    } finally {
      if (this._muxSendOpen === sendOpen) this._muxSendOpen = null;
      sig.removeEventListener('abort', handleAbort);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
      own?.abort();
      handleAbort();
    }
  }
}

/** 把 RpcResponse 的结果槽解出来；业务错误直接抛出。 */
export function unwrap(response, label) {
  if (response.result.ok) return response.result.value;
  const { code, message } = response.result.error;
  throw new Error(`${label} failed: ${code}: ${message}`);
}

/** 在会话事件流里收集一次 turn 的 assistant 文本（按 turn 分组）。 */
export function createTurnCollector() {
  const turns = new Map(); // turn -> { text }
  return {
    /** 处理一条 session/event，返回该事件是否终结了一个 turn（此时可取最终文本）。 */
    push(event) {
      if (event.type === 'turn/start') {
        turns.set(event.data.turn, { text: '' });
        return null;
      }
      if (event.type === 'assistant/chunk') {
        // 忽略流式分块：assistant/message 携带同一内容的完整组装文本，
        // 两者都累加会导致回复文本翻倍。
        return null;
      }
      if (event.type === 'assistant/message') {
        // 实测 DSH 0.2.1 的事件流可能不发出 turn/start（直接从 step/start 开始），
        // 所以这里惰性建档，不能只依赖 turn/start 预建。
        const turn = event.data.turn;
        let t = turns.get(turn);
        if (!t) {
          t = { text: '' };
          turns.set(turn, t);
        }
        for (const block of event.data.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') t.text += block.text;
        }
        return null;
      }
      if (event.type === 'turn/end') {
        const t = turns.get(event.data.turn);
        turns.delete(event.data.turn);
        // 没见过这个 turn 的 assistant/message ⇒ 无文本可发，不当作回复。
        if (!t) return null;
        return { turn: event.data.turn, reason: event.data.reason, text: t.text };
      }
      return null;
    },
    has(turn) {
      return turns.has(turn);
    },
    size() {
      return turns.size;
    }
  };
}

/** 从 assistant 消息的 ContentBlock[] 中提取纯文本。 */
export function blocksToText(content) {
  return (content ?? [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
