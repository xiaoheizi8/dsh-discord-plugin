// 把 discord-chat preset 安装到 DSH 的 preset 目录（~/.dsh/.agent-presets/）。
// 幂等：已存在时覆盖更新。装完需要重启 DSH 才会生效。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'dsh', 'agent-presets', 'discord-chat');
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const DEST = path.join(dshHome, '.agent-presets', 'discord-chat');

if (!fs.existsSync(path.join(SRC, 'preset.yml'))) {
  console.error(`找不到源 preset：${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });
for (const file of fs.readdirSync(SRC)) {
  fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
  console.log(`已安装 ${file} -> ${path.join(DEST, file)}`);
}
console.log(`\n✅ discord-chat preset 已安装到 ${DEST}`);
console.log('⚠️ 请重启 DSH 使其生效，然后运行 npm start 启动桥接。');
