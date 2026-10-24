// 代理引导模块：必须在 discord.js 之前 import（bridge.mjs 第一行）。
//
// 背景：国内网络访问 Discord 需要代理，但两套网络栈都不认 HTTP(S)_PROXY 环境变量：
//   1. REST（@discordjs/rest -> undici fetch）—— Node 的 fetch 默认不走代理；
//   2. 网关 WebSocket（@discordjs/ws -> ws 包）—— 构造时硬编码 options，无法注入 agent，
//      但 ws 未显式传 agent 时走 https.globalAgent，替换它即可生效。
// 本模块统一处理：
//   - REST：setGlobalDispatcher(EnvHttpProxyAgent)（认环境变量 + no_proxy）；
//   - 网关：https.globalAgent = new HttpsProxyAgent(proxy)。
// 代理来源：config.json 的 discord.proxy，为 "env" 时用环境变量；
// DSH 的 127.0.0.1 调用永远直连（no_proxy 强制包含回环地址）。
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProxyAgent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readProxyFromConfig() {
  try {
    const configPath = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return cfg?.discord?.proxy;
  } catch {
    return undefined;
  }
}

const configured = readProxyFromConfig();
const fromEnv = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy;
const proxyUrl = (configured && configured !== 'env' ? configured : fromEnv) || '';

// DSH 在本机，绝不能走代理
if (!process.env.NO_PROXY && !process.env.no_proxy) {
  process.env.NO_PROXY = '127.0.0.1,localhost,::1';
  process.env.no_proxy = process.env.NO_PROXY;
}

if (proxyUrl) {
  // 1) REST：undici 全局 dispatcher（@discordjs/rest 与本项目的 fetch 同享）
  setGlobalDispatcher(new EnvHttpProxyAgent());
  // 2) 网关 WebSocket：ws 包缺省走 https.globalAgent，换成代理 agent
  https.globalAgent = new HttpsProxyAgent(proxyUrl);
  // 配置了显式代理时同步进环境变量，让 EnvHttpProxyAgent 生效
  process.env.HTTPS_PROXY = process.env.https_proxy = proxyUrl;
  process.env.HTTP_PROXY = process.env.http_proxy = proxyUrl;
  console.log(`[proxy] 已启用代理: ${proxyUrl}（REST + 网关 WebSocket；127.0.0.1 直连）`);
} else {
  console.log('[proxy] 未配置代理（discord.proxy / HTTPS_PROXY 均为空），直连 Discord——国内网络可能无法连接');
}
