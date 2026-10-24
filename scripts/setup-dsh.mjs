// 把 discord-chat preset 以 DSH 0.1.7+ 的 bundle 机制安装进 profile。
//
// 机制说明：DSH 0.1.7 起 ~/.dsh/.agent-presets/ 目录已废弃不再读取。
// preset 由 profile 里 bundle 的 patch 文件插入（一条 @deepseek-ai/dsh-agent-preset 行）：
//   ① bundle 包由 src/preset-build.mjs 的 writeBundle() 从源渲染生成（源是唯一权威）；
//   ② profile 的 package.json 注册 link: 依赖 + bundles 数组；
//   ③ profiles/node_modules 建 junction（Windows junction 不需要管理员权限）。
// 装完需重启 DSH 生效。幂等：重复运行覆盖更新。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBundle, resolveDshHome, BUNDLE_NAME } from '../src/preset-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'dsh', 'agent-presets', 'discord-chat');
const DSH_HOME = resolveDshHome();
const DEST_PLUGINS = path.join(DSH_HOME, 'plugins', BUNDLE_NAME);
const PROFILES_DIR = path.join(DSH_HOME, 'profiles');

if (!fs.existsSync(path.join(SRC_DIR, 'preset.yml'))) {
  console.error(`找不到源 preset：${SRC_DIR}`);
  process.exit(1);
}

// ── 1. 渲染 bundle ──────────────────────────────────────────────────────────
writeBundle(DSH_HOME);
console.log(`✅ bundle 已生成 -> ${DEST_PLUGINS}`);

// ── 2. 注册进所有 profile（link: 依赖 + bundles 数组 + junction） ───────────
if (!fs.existsSync(PROFILES_DIR)) {
  console.error(`⚠️ 未找到 profiles 目录：${PROFILES_DIR}（DSH 首次启动前安装无效，先启动一次 DSH 再跑本脚本）`);
  process.exit(1);
}
const linkTarget = DEST_PLUGINS.replace(/\\/g, '/');
for (const entry of fs.readdirSync(PROFILES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const pkgPath = path.join(PROFILES_DIR, entry.name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies[BUNDLE_NAME] = `link:${linkTarget}`;
  pkg.dsh = pkg.dsh ?? {};
  if (!Array.isArray(pkg.dsh.profile?.bundles)) pkg.dsh.profile = { ...(pkg.dsh.profile ?? {}), bundles: [] };
  if (!pkg.dsh.profile.bundles.includes(BUNDLE_NAME)) pkg.dsh.profile.bundles.push(BUNDLE_NAME);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`✅ profile "${entry.name}" 已注册 ${BUNDLE_NAME}`);

  const nm = path.join(PROFILES_DIR, entry.name, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  const junction = path.join(nm, BUNDLE_NAME);
  try {
    const existing = fs.readlinkSync(junction);
    if (existing !== DEST_PLUGINS && path.resolve(existing) !== path.resolve(DEST_PLUGINS)) {
      fs.rmSync(junction, { recursive: true });
      fs.symlinkSync(DEST_PLUGINS, junction, 'junction');
    }
  } catch {
    fs.symlinkSync(DEST_PLUGINS, junction, 'junction');
  }
  console.log(`✅ junction 已就绪 -> ${junction}`);
}

// ── 3. 清理废弃的旧目录（0.1.5 机制，DSH 已不读取） ─────────────────────────
const legacyDir = path.join(DSH_HOME, '.agent-presets', 'discord-chat');
if (fs.existsSync(legacyDir)) {
  fs.rmSync(legacyDir, { recursive: true });
  console.log(`🧹 已清理废弃目录 ${legacyDir}`);
}

console.log('\n✅ discord-chat preset 已按 bundle 机制安装完成');
console.log('⚠️ 请重启 DSH 使其生效。');
