# dsh-discord-plugin

把 **DeepSeek Harness（DSH）** 会话接入 **Discord** 的桥接插件。Discord 频道/私信里发消息 → 成为 DSH agent 的用户消息 → agent 的回复、提问（按钮作答）、工具审批原样回到 Discord。

协议与架构参考了 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge)（QQ 版桥接），DSH 侧的 Cookie 离线铸造、斜杠 RPC、remote.mux 事件流与其同代（适配 DSH 0.2.1）；Discord 侧为全新手搓，不依赖 SnowLuma/OneBot。

```
Discord 消息 ──► discord.js 网关 ──► 本进程 ──► DSH Web API (http://127.0.0.1:3080/api)
                                         ▲                      │
                                         └── 回复 / 提问 / 审批 ──┘
```

## 特性

- **每个频道/私信一个独立 DSH 会话**：`guild:<guildId>:<channelId>` / `dm:<userId>`，映射持久化在 `state/sessions.json`，归组到「Discord 聊天」工作区
- **离线鉴权**：自动读取 `~/.dsh/.credentials.yaml` 的签名密钥本地铸造会话 Cookie（不依赖进程启动 token，DSH 重启无需重配）；也可显式配置 `dsh.authToken`
- **多模态**：Discord 图片附件下载后作为 image part 喂给模型（8MB/张、单条 5 张上限）
- **引用回复**：Discord 回复消息会把被引用内容以 `[引用 昵称：原文]` 注入
- **提问转按钮**：agent 调用 `ask_user_question` 时在频道里出按钮，点击即回执；超时自动回空答案
- **工具审批转按钮**：`approval/request` 出 允许/拒绝 按钮，超时自动拒绝
- **fail-closed 安全**：白名单为空且 `allowAllWhenEmpty=false` 时不响应任何消息；配置的 `agentPreset` 在 DSH 中不存在时拒绝建会话（绝不回退到带本地工具的默认 preset）
- **掉线补投**：DSH 不可用期间消息在内存排队（每会话上限 50 条，丢最旧），恢复后自动补投
- **斜杠命令**：`/ds-reset` 重置频道会话；`/ds-status` 查看会话状态
- **Markdown 直通**：Discord 原生支持 Markdown，回复只在 2000 字符处分条（保持代码块闭合）

## 目录结构

```
src/
  bridge.mjs           # 主程序：配置/状态/白名单/会话管理/事件泵/Discord 交互
  dsh-client.mjs       # 自包含 DSH API 客户端（Cookie 铸造 + 斜杠 RPC + remote.mux + turn collector）
  discord-format.mjs   # 2000 字符分块（代码块安全）、@提及/频道/表情归一化
dsh/agent-presets/discord-chat/   # 最小权限 preset（无任何本地工具）
scripts/
  setup-dsh.mjs        # 把 preset 装到 ~/.dsh/.agent-presets/（幂等）
  self-test.mjs        # 离线自测（npm run self-test）
```

## 快速开始

1. **创建 Discord Bot**：到 [Discord Developer Portal](https://discord.com/developers/applications) 新建 Application → Bot，复制 Token；开启 **MESSAGE CONTENT INTENT**（Privileged Gateway Intents，必开否则收不到消息内容）。用 OAuth2 URL 生成器（scopes: `bot` + `applications.commands`）邀请进你的服务器。

2. **确认 DSH 已运行**：浏览器能打开 `http://127.0.0.1:3080`。

3. **安装并配置**：
   ```bash
   npm install
   cp config.example.json config.json
   # 编辑 config.json：填 discord.token，改 allow 白名单
   ```

4. **安装 DSH preset（必做）**：
   ```bash
   npm run setup-dsh
   ```
   然后**重启 DSH**。⚠️ 不装 preset 时会因 fail-closed 拒绝创建会话，Discord 上毫无反应。

5. **启动**：
   ```bash
   npm start          # 看到「Discord 已连接」即成功
   npm run self-test  # 离线自测（不需要 Discord/DSH）
   ```

## 配置项

| 字段 | 说明 |
|---|---|
| `discord.token` | Discord Bot Token（必填） |
| `discord.ackReaction` | 收到消息时的表情回应（如 `"🫡"`），留空关闭 |
| `dsh.baseUrl` | DSH 地址，默认 `http://127.0.0.1:3080` |
| `dsh.provider` / `dsh.model` / `dsh.reasoningEffort` | 会话模型，默认 `deepseek-official` / `deepseek-flash` / `max` |
| `dsh.authToken` | 通常留空（走离线铸造）；显式填写则尊重该意图 |
| `dsh.allowRemote` | 连远程 DSH 且需用 launch token 时才允许 `true` |
| `agentPreset` | 默认 `discord-chat`；设为空串则用 DSH 默认 preset（不建议，本地工具会暴露） |
| `allow.guilds/channels/users` | 白名单（guild id / channel id / user id）；任一命中即放行 |
| `deny.guilds/channels/users` | 黑名单，永远优先于白名单 |
| `allowAllWhenEmpty` | `true` 时白名单为空也响应所有消息（默认 `false`，fail-closed） |
| `maxQueuePerSession` | DSH 掉线时每会话内存排队上限，默认 50 |
| `questionTimeoutMs` | 提问/审批按钮超时，默认 5 分钟 |
| `maxMediaBytes` / `maxMediaCount` | 图片单张 8MB / 单条 5 张 |

## 与 qq-bridge 的差异

- Discord 侧基于官方 Bot API（discord.js v14），没有 QQ 生态的风控/语音/表情库等复杂度
- 不包含社交仿真（一代/二代）、黑话学习、Web 控制台、token 计费看板 —— 需要时可以从 qq-bridge 移植
- 回复用 Markdown 直通（QQ 需转纯文本，Discord 不需要）
- 提问/审批用 Discord 原生按钮交互，而不是文本回复解析
- DSH 客户端不依赖 `@deepseek-ai/dsh-host-apiproxy`，基类手搓，依赖只剩 `discord.js` + `js-yaml`
