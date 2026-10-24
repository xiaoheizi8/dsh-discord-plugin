// 统一路径解析：普通 Node 运行时基于仓库根；SEA 单文件 exe 运行时基于 exe 所在目录。
// 不用 import.meta.url（esbuild 打包成 CJS 时会被替换成空对象），改用 process.argv[1]。
import path from 'node:path';
import { isSea } from 'node:sea';

function computeRoot() {
  if (isSea()) return path.dirname(process.execPath);
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (entry) {
    const dir = path.dirname(entry);
    // node src/bridge.mjs → src 的父目录是根；node sea-entry 同理
    return path.basename(dir) === 'src' ? path.dirname(dir) : dir;
  }
  return process.cwd();
}

/** 项目根：仓库根（开发态）或 exe 所在目录（SEA 态）。config.json / state/ / dsh/ / web/ 都在这里。 */
export const ROOT = computeRoot();

/** preset 源文件目录（exe 分发时作为侧车文件夹随包携带，用户可直接编辑）。 */
export const PRESET_SRC_DIR = path.join(ROOT, 'dsh', 'agent-presets', 'discord-chat');
