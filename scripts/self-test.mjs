// 离线自测：不连 Discord、不连 DSH，验证可单测的核心逻辑。
// 运行：npm run self-test
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { mintBrowserSessionCookie, isLoopbackBase, readBrowserSessionSecret } from '../src/dsh-client.mjs';
import { chunkForDiscord, normalizeDiscordText } from '../src/discord-format.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.error(`  ❌ ${name}\n${error?.stack ?? error}`);
    process.exitCode = 1;
  }
}

const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

console.log('dsh-client.mjs');
test('Cookie 名 = dsh-auth- + base64url(sha256(authority))', () => {
  const secret = Buffer.alloc(32, 7);
  const cookie = mintBrowserSessionCookie('http://127.0.0.1:3080', secret);
  const expectedName = 'dsh-auth-' + b64url(createHash('sha256').update('127.0.0.1:3080').digest());
  assert.ok(cookie.startsWith(`${expectedName}=v1.`), cookie);
});
test('Cookie 签名可用同一密钥复算（HMAC-SHA256 over body）', () => {
  const secret = Buffer.alloc(32, 9);
  const cookie = mintBrowserSessionCookie('http://localhost:3080', secret, { lifetimeMs: 60000 });
  const value = cookie.split('=')[1];
  const [, body, signature] = value.split('.');
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  assert.equal(signature, expected);
  const payload = JSON.parse(Buffer.from(body.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'));
  assert.equal(payload.version, 1);
  assert.equal(payload.authority, 'localhost:3080');
  assert.ok(payload.expiresAt > payload.issuedAt);
});
test('isLoopbackBase 判定回环地址', () => {
  assert.equal(isLoopbackBase('http://127.0.0.1:3080'), true);
  assert.equal(isLoopbackBase('http://localhost:3080'), true);
  assert.equal(isLoopbackBase('http://192.168.1.5:3080'), false);
  assert.equal(isLoopbackBase('not a url'), false);
});
test('readBrowserSessionSecret 不抛异常（有凭据返回 Buffer/无凭据返回 null）', () => {
  const secret = readBrowserSessionSecret();
  if (secret !== null) assert.equal(secret.byteLength, 32);
});

console.log('discord-format.mjs');
test('短文本不分块', () => {
  assert.deepEqual(chunkForDiscord('hello'), ['hello']);
});
test('空文本返回空数组', () => {
  assert.deepEqual(chunkForDiscord(''), []);
  assert.deepEqual(chunkForDiscord(null), []);
});
test('超长文本按 2000 切块且不超限', () => {
  const long = Array.from({ length: 200 }, (_, i) => `第 ${i} 行：一些中文内容用来撑长度，随便写点什么。`).join('\n');
  const chunks = chunkForDiscord(long);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.length <= 2000, `chunk too long: ${c.length}`);
  // 内容无丢失（去分隔后重新拼接应包含所有行）
  const joined = chunks.join('\n');
  for (const i of [0, 50, 150, 199]) assert.ok(joined.includes(`第 ${i} 行`));
});
test('代码块不被切断（补回未闭合 fence）', () => {
  const long = 'x'.repeat(1990) + '\n\n```js\nconsole.log(1);\n```\n';
  const chunks = chunkForDiscord(long);
  for (const c of chunks) {
    const fences = (c.match(/^```/gm) ?? []).length;
    assert.equal(fences % 2, 0, `未闭合代码块: ${c.slice(0, 80)}…`);
  }
});
test('超长行硬切不超过上限', () => {
  const chunks = chunkForDiscord('a'.repeat(5000));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= 2000);
});
test('normalizeDiscordText：提及/频道/表情归一化', () => {
  const users = new Map([['111', { globalName: '小明', username: 'xm' }]]);
  const channels = new Map([['222', { name: 'general' }]]);
  const roles = new Map([['333', { name: '管理员' }]]);
  const msg = {
    content: '<@111> 看看 <#222> 和 <@&333>，表情 <:panda:123> <a:spin:456>，还有 <@!999> 未知',
    mentions: { users, channels, roles },
  };
  const out = normalizeDiscordText(msg);
  assert.ok(out.includes('@小明'));
  assert.ok(out.includes('#general'));
  assert.ok(out.includes('@管理员'));
  assert.ok(out.includes(':panda:'));
  assert.ok(out.includes(':spin:'));
  assert.ok(out.includes('user:999'));
  assert.ok(!out.includes('<@'));
});

console.log(`\n${process.exitCode ? '❌ 有用例失败' : `✅ 全部通过（${passed} 例）`}`);
