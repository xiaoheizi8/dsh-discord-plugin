# dsh-discord-plugin

把 **DeepSeek Harness（DSH）** 会话接入 **Discord** 的桥接插件：Discord 频道/私信里发消息 → 成为 DSH agent 的用户消息 → agent 的回复、提问（按钮作答）、工具审批原样回到 Discord。

协议与架构参考 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)（QQ 版桥接），DSH 侧的 Cookie 离线铸造、斜杠 RPC、remote.mux 事件流与其同代（适配 DSH 0.2.1）；Discord 侧为全新实现，不依赖 SnowLuma/OneBot。

```
Discord 消息 ──► discord.js 网关 ──► 本进程 ──► DSH Web API (http://127.0.0.1:3080/api)
              （经代理/VPN）          │   ▲                      │
                                      └───┴── 回复 / 提问 / 审批 ──┘
```

## 功能特性

- **每个频道/私信一个独立 DSH 会话**：key 为 `guild:<guildId>:<channelId>` / `dm:<userId>`，映射持久化在 `state/sessions.json`，统一归组到「Discord 聊天」工作区
- **离线鉴权**：自动读取 `~/.dsh/.credentials.yaml` 的签名密钥，本地 HMAC 铸造会话 Cookie——不依赖进程启动 token，DSH 重启无需重新配置；也可显式配置 `dsh.authToken`
- **多模态**：Discord 图片附件下载后作为 image part 喂给模型（单张 8MB、单条 5 张上限），非图片附件只标注文件名
- **引用回复**：Discord 回复消息会把被引用内容以 `[引用 昵称：原文]` 注入上下文
- **@提及归一化**：`<@id>`/`<#id>`/自定义表情在投喂前转成 `@昵称`/`#频道名`/`:表情:`
- **提问转按钮**：agent 调用 `ask_user_question` 时在频道里出按钮，点击即回执；5 分钟超时自动回空答案
- **工具审批转按钮**：`approval/request` 出「允许/拒绝」按钮，超时自动拒绝
- **fail-closed 安全**（三道闸）：
  1. 白名单为空且 `allowAllWhenEmpty=false` 时不响应任何消息；
  2. 黑名单永远优先于白名单；
  3. 配置的 `agentPreset` 在 DSH 中不存在时拒绝建会话——**绝不回退**到带 bash/文件读写的默认 preset（频道成员无法借 agent 操作你的电脑）
- **掉线补投**：DSH 不可用期间消息在内存排队（每会话上限 50 条，满则丢最旧），恢复后自动补投；桥接进程每 5 秒自动探活
- **斜杠命令**：`/ds-reset` 重置频道会话；`/ds-status` 查看会话状态与排队数
- **Markdown 直通**：Discord 原生支持 Markdown，回复只在 2000 字符处分条发送（保证代码块 fence 配平）

## 目录结构

```
src/
  bridge.mjs           # 主程序：配置/状态/白名单/会话管理/事件泵/Discord 交互/斜杠命令
  dsh-client.mjs       # 自包含 DSH API 客户端（Cookie 铸造 + 斜杠 RPC + remote.mux + turn collector）
  discord-format.mjs   # 2000 字符分块（代码块安全）、@提及/频道/表情归一化
  proxy-bootstrap.mjs  # 代理引导：REST(undici) + 网关 WebSocket(ws) 统一走代理；127.0.0.1 直连
dsh/agent-presets/discord-chat/   # 最小权限 preset（无任何本地工具）
scripts/
  setup-dsh.mjs        # 把 preset 装到 ~/.dsh/.agent-presets/（幂等）
  self-test.mjs        # 离线自测（npm run self-test，不需要 Discord/DSH）
state/
  sessions.json        # 频道 ↔ DSH 会话映射（运行时生成，勿提交）
  agents/              # 会话工作目录
```

## 部署步骤

### 1. 创建 Discord Bot

到 [Discord Developer Portal](https://discord.com/developers/applications)：

1. 新建 Application → 左侧 **Bot** → **Reset Token**，复制 Token（只显示一次）
2. 同页 **Privileged Gateway Intents** 打开 **MESSAGE CONTENT INTENT**（必开，否则收不到消息内容）
3. 左侧 **OAuth2 → URL Generator**：scopes 勾 `bot` + `applications.commands`，权限给「发送消息 / 读取消息 / 添加回应」，用生成的链接把 Bot 邀请进你的服务器

> 注意：需要的是 **Bot Token**，不是 App ID 或 Public Key（公钥只在 webhook 模式才用，本项目走 WebSocket 网关）。

### 2. 准备 DSH

确认 DSH 已运行且浏览器能打开 `http://127.0.0.1:3080`，然后安装 preset 并**重启 DSH**：

```bash
npm install
npm run setup-dsh    # 把 discord-chat preset 装进 ~/.dsh/.agent-presets/
# ⚠️ 重启 DSH 使 preset 生效——不重启会因 fail-closed 拒绝建会话（频道里毫无反应）
```

### 3. 配置

```bash
cp config.example.json config.json
```

必改项：`discord.token` 填 Bot Token；`allow` 白名单填 guild/channel/user id（至少一项，否则不响应任何消息）。开发者模式开启后，Discord 里右键服务器/频道 → 复制 ID。

### 4. 网络（国内环境）

Node 不认系统代理，本插件内置两层处理（`src/proxy-bootstrap.mjs`）：

- **REST 请求**（discord.com API）：undici 全局 dispatcher 走代理
- **网关 WebSocket**（gateway.discord.gg）：`https.globalAgent` 替换为代理 agent
- `127.0.0.1`（DSH）**永远直连**，不受代理影响
- 启动脚本带 `--use-system-ca`，Node 信任 Windows 系统证书库（TUN 模式 VPN 的 TLS 拦截证书也能过）

代理来源（`discord.proxy`，默认 `"auto"`）：

| 值 | 行为 |
|---|---|
| `"auto"`（默认） | `HTTPS_PROXY` 环境变量 → Windows 系统代理（注册表）→ 直连 |
| `"env"` | 只认环境变量 |
| 显式地址 | 如 `"http://127.0.0.1:7890"`（Clash 默认 7890，v2rayN 默认 10808/10809） |
| `""` | 强制直连 |

### 5. 启动

```bash
npm start
```

成功的标志：

```
[proxy] 已启用代理: http://... （或「直连」——TUN 模式 VPN 下直连也能通）
正在连接 Discord 网关…
Discord 已连接：你的Bot名#xxxx
连接 DSH 事件流…
✅ DSH 恢复可用（或启动时直接探活成功）
```

然后到白名单频道发条消息测通。`npm run self-test` 可随时跑离线回归（10 例，不需要 Discord/DSH）。

## 配置项

### discord（Discord 侧）

| 字段 | 说明 |
|---|---|
| `token` | Bot Token（必填） |
| `ackReaction` | 收到消息时的表情回应（如 `"🫡"`），留空关闭 |
| `proxy` | 代理，见上表；默认 `"auto"` |

### dsh（DSH 侧）

| 字段 | 说明 |
|---|---|
| `baseUrl` | DSH 地址，默认 `http://127.0.0.1:3080` |
| `provider` / `model` / `reasoningEffort` | 会话模型，默认 `deepseek-official` / `deepseek-flash` / `max` |
| `authToken` | 通常留空（走离线铸造）；显式填写则尊重该意图 |
| `allowRemote` | 连远程 DSH 且需用 launch token 时才允许 `true`（token 只发给回环地址的防护） |

### 行为

| 字段 | 说明 |
|---|---|
| `agentPreset` | 默认 `discord-chat`；设为空串则用 DSH 默认 preset（**不建议**，本地工具会暴露给频道成员） |
| `workspaceTitle` | DSH 工作区标题，默认「Discord 聊天」 |
| `sessionCwd` | DSH 会话工作目录，默认 `state/agents` |
| `allow.guilds/channels/users` | 白名单（任一命中即放行） |
| `deny.guilds/channels/users` | 黑名单，永远优先于白名单 |
| `allowAllWhenEmpty` | `true` 时白名单为空也响应所有消息（默认 `false`，fail-closed） |
| `maxQueuePerSession` | DSH 掉线时每会话内存排队上限，默认 50 |
| `questionTimeoutMs` | 提问/审批按钮超时，默认 5 分钟 |
| `maxMediaBytes` / `maxMediaCount` | 图片单张 8MB / 单条 5 张 |
| `pollIntervalMs` | DSH 掉线后的探活间隔，默认 5 秒 |

## 故障排查（实战踩坑记录）

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动卡在「正在连接 Discord 网关…」无下文 | 无可用代理路径，直连被墙 | 检查 VPN 是否真的连通：浏览器能否打开 discord.com；或按上表填 `discord.proxy` |
| `unable to verify the first certificate` | VPN TUN 模式 TLS 拦截，Node 不认 Windows 证书库 | 已由 `--use-system-ca` 解决；若仍出现确认用的是 `npm start`（不要直接 `node src/bridge.mjs`） |
| 网关报 `Unexpected server response: 502` | 流量被 VPN/透明代理接管，但上游节点不通 | VPN 没真正连上：换节点/重连，浏览器验证 discord.com |
| Discord 在线但频道发消息毫无反应 | ① 不在白名单（fail-closed）；② preset 未生效 | ① 检查 `allow`；② 确认跑过 `npm run setup-dsh` 且重启了 DSH，看日志是否报「agentPreset 不在 DSH 可用清单」 |
| `获取 agent preset 清单失败: fetch failed` / `⚠️ DSH 不可用` | DSH 没在运行 | 启动 DSH 确认浏览器能打开 `127.0.0.1:3080`；桥接会每 5 秒自动探活并补投消息，无需重启 |
| 回复超长被分条 | 单条 Discord 消息上限 2000 字符 | 正常行为，代码块会自动补齐 fence |
| 想重置某频道的对话上下文 | — | 频道里输入 `/ds-reset` |

## 与 qq-bridge 的差异

- Discord 侧基于官方 Bot API（discord.js v14），没有 QQ 生态的风控/语音/表情库复杂度
- 不包含社交仿真（一代/二代）、黑话学习、Web 控制台、token 计费看板——需要时可从 qq-bridge 移植
- 回复用 Markdown 直通（QQ 需转纯文本，Discord 不需要）
- 提问/审批用 Discord 原生按钮交互，而不是文本回复解析
- DSH 客户端不依赖 `@deepseek-ai/dsh-host-apiproxy`，基类手搓，运行依赖只有 `discord.js` + `js-yaml` + `undici` + `https-proxy-agent`
- 内置国内网络代理方案（REST + WebSocket 双通道，系统代理自动检测）

## 已知协议细节（给后来维护者）

- DSH 0.2.1 的事件流**可能不发 `turn/start`**：事件直接从 `step/start` → `assistant/message` → `turn/end`。turn collector 按 `assistant/message` 惰性建档，不能只依赖 `turn/start` 预建，否则所有回复被静默丢弃
- `session/follow` 的开场快照（`session/snapshot`）含历史 `turn/end`，绝不能混进 `session/event` 通道，否则会把旧回合当新回复发出
- 断线重连时必须重放全部期望 follow 的会话，否则已存在会话会静默失联
- `assistant/chunk` 是流式分块，与 `assistant/message` 内容重复，累加会导致回复翻倍
