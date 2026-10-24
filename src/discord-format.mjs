// Discord 消息格式化辅助：出站分块、引用/提及归一化。

/**
 * 把任意长度的 Markdown 文本切成 Discord 单条消息（≤2000 字符）。
 * 按行累积；跨块时把未闭合的 ``` 代码块补回（块尾闭合、块首重开）。
 * @returns string[] 分块后的消息数组（空文本返回空数组）。
 */
export function chunkForDiscord(text, limit = 2000) {
  const input = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!input) return [];
  if (input.length <= limit) return [input];

  const chunks = [];
  let current = '';
  let openFence = false; // current 是否处于未闭合代码块中

  // 收尾当前块：开着 fence 就补上闭合，新块开头再重开 fence。
  const push = () => {
    if (openFence) current += '\n```';
    if (current.trim()) chunks.push(current);
    current = openFence ? '```\n' : '';
  };

  for (const line of input.split('\n')) {
    if (/^```/.test(line)) openFence = !openFence;
    if (current.length + 1 + line.length <= limit) {
      current = current ? current + '\n' + line : line;
      continue;
    }
    push();
    if (line.length <= limit) {
      current = current + line;
    } else {
      // 超长单行硬切（纯文本场景）；若处于代码块中，切出的每段都要补配平的 fence。
      for (let i = 0; i < line.length; i += limit) {
        const piece = line.slice(i, i + limit);
        if (i === 0) {
          current = current + piece;
        } else {
          push();
          current = (openFence ? '```\n' : '') + piece;
        }
      }
    }
  }
  push();
  return chunks.filter((c) => c.trim().length > 0).slice(0, 20);
}

/**
 * 把 Discord 消息的 raw 文本归一化成给模型看的纯文本：
 * - <@user_id> / <@!user_id> -> @昵称
 * - <#channel_id> -> #频道名
 * - <@&role_id> -> @角色名
 * - 去掉自定义表情的 <> 包裹（保留名字）
 * @param msg discord.js Message
 */
export function normalizeDiscordText(msg) {
  let text = msg.content ?? '';
  // 用户提及
  text = text.replace(/<@!?(\d+)>/g, (_m, id) => {
    const user = msg.mentions?.users?.get(id);
    const name = user?.globalName ?? user?.username ?? `user:${id}`;
    return `@${name}`;
  });
  // 频道提及
  text = text.replace(/<#(\d+)>/g, (_m, id) => {
    const ch = msg.mentions?.channels?.get(id);
    return `#${ch?.name ?? `channel:${id}`}`;
  });
  // 角色提及
  text = text.replace(/<@&(\d+)>/g, (_m, id) => {
    const role = msg.mentions?.roles?.get(id);
    return `@${role?.name ?? `role:${id}`}`;
  });
  // 自定义表情 <:name:id> / <a:name:id> -> :name:
  text = text.replace(/<a?:(\w+):\d+>/g, (_m, name) => `:${name}:`);
  return text.trim();
}
