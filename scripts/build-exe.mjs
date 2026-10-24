// 构建 Windows 单文件 exe（Node 官方 SEA 方案）：
//   1. esbuild 把 src/sea-entry.mjs（含整个桥接）打包成单文件 CJS
//   2. node --experimental-sea-config 生成注入 blob
//   3. 复制 node.exe 并用 postject 注入 blob → dist/dsh-discord.exe
//   4. 携带侧车：web/（控制台前端）、dsh/（preset 源，可编辑）、config.example.json
// 产物 dist/：双击 dsh-discord.exe 即启动，自动打开控制台浏览器。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const require2 = createRequire(import.meta.url);

const step = (m) => console.log(`\n▶ ${m}`);
const sh = (cmd, args, opts = {}) => {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
};

// ── 0. 依赖检查 ─────────────────────────────────────────────────────────────
step('检查打包依赖（esbuild / postject）');
for (const dep of ['esbuild', 'postject']) {
  try { require2.resolve(dep); } catch {
    console.error(`缺少依赖 ${dep}，请先在项目根目录运行: npm install -D ${dep}`);
    process.exit(1);
  }
}

// ── 1. 前端产物 ─────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(ROOT, 'web', 'index.html'))) {
  step('构建控制台前端（npm run build:console）');
  sh('npm', ['run', 'build:console']);
} else {
  console.log('web/ 已存在，跳过前端构建（如需重建: npm run build:console）');
}

// ── 2. esbuild 打包主程序 ───────────────────────────────────────────────────
step('esbuild 打包桥接为单文件 CJS');
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
const esbuild = require2('esbuild');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'sea-entry.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(BUILD, 'sea.cjs'),
  minify: false,
  sourcemap: false,
  logLevel: 'warning',
  // 可选依赖：运行时 try/catch 回退，缺失不影响
  external: ['bufferutil', 'utf-8-validate', '@discordjs/opus', 'sodium-native', 'zlib-sync'],
});

// ── 3. SEA blob ─────────────────────────────────────────────────────────────
step('生成 SEA 注入 blob');
const seaConfig = path.join(BUILD, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(BUILD, 'sea.cjs'),
  output: path.join(BUILD, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2));
sh(process.execPath, ['--experimental-sea-config', seaConfig]);

// ── 4. 复制 node.exe 并注入 ─────────────────────────────────────────────────
step('复制 node.exe 并注入 blob → dist/dsh-discord.exe');
const exe = path.join(DIST, 'dsh-discord.exe');
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(process.execPath, exe);
const postject = require2.resolve('postject/dist/cli.js');
sh(process.execPath, [
  postject, exe, 'NODE_SEA_BLOB', path.join(BUILD, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]);

// ── 5. 侧车文件 ─────────────────────────────────────────────────────────────
step('携带侧车文件（web/ dsh/ config.example.json）');
fs.cpSync(path.join(ROOT, 'web'), path.join(DIST, 'web'), { recursive: true });
fs.cpSync(path.join(ROOT, 'dsh'), path.join(DIST, 'dsh'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(DIST, 'config.example.json'));
if (!fs.existsSync(path.join(DIST, 'config.json'))) {
  fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(DIST, 'config.json'));
  console.log('  （已放入 config.example.json 副本作为 config.json，请填写 discord.token）');
}

const size = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ 构建完成: ${exe}（${size} MB）`);
console.log('   分发方式：把 dist/ 整个文件夹拷走，填好 config.json 的 token 后双击 dsh-discord.exe。');
