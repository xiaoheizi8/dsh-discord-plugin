// 把 discord-chat preset 以 DSH 0.1.7+ 的 bundle 机制安装进 profile。
//
// 背景（DSH preset 机制变迁）：
//   0.1.5：preset = ~/.dsh/.agent-presets/<preset>/ 目录，DSH 启动扫目录。
//   0.1.7+：**该目录已废弃不再读取**（qq-bridge 实测确认）。preset 变成 profile
//          里的一条 @deepseek-ai/dsh-agent-preset 行，由 bundle 的 patch 文件插入：
//     ① bundle 包（~/.dsh/plugins/discord-agent-presets/）由本脚本从源渲染生成：
//        源（唯一权威）= dsh/agent-presets/discord-chat/{preset.yml,agent.cordis.yml}
//        产物 = ~/.dsh/plugins/discord-agent-presets/presets/discord-chat.patch.yml
//     ② profile 的 package.json 注册 link: 依赖 + bundles 数组；
//     ③ profiles/node_modules 建 junction（Windows junction 不需要管理员权限）。
// 装完需重启 DSH 生效。幂等：重复运行覆盖更新。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'dsh', 'agent-presets', 'discord-chat');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const BUNDLE_NAME = 'discord-agent-presets';
const DEST_PLUGINS = path.join(DSH_HOME, 'plugins', BUNDLE_NAME);
const PROFILES_DIR = path.join(DSH_HOME, 'profiles');

// ── 1. 读源 ────────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(SRC_DIR, 'preset.yml'))) {
  console.error(`找不到源 preset：${SRC_DIR}`);
  process.exit(1);
}
const presetMeta = yaml.load(fs.readFileSync(path.join(SRC_DIR, 'preset.yml'), 'utf8'));
const cordisRows = yaml.load(fs.readFileSync(path.join(SRC_DIR, 'agent.cordis.yml'), 'utf8'));

// ── 2. 渲染 patch：preset.yml 元信息 + agent.cordis.yml 插件行 + 基础工具面 ──
// 工具面对齐 qq-bridge 的 qq-chat：web 工具关闭（联网交给模型侧）、保留提问/任务列表、
// compaction 组照抄（长对话自动压缩）。无任何本地工具（bash/文件读写不存在）。
const pluginRows = [
  ...cordisRows,
  { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { search: false, fetch: false } },
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { thresholdChars: 50000, headChars: 45000, tailChars: 2000 },
      },
    ],
  },
];

const patchDoc = [
  {
    insert: [
      {
        id: 'preset-discord-chat',
        name: '@deepseek-ai/dsh-agent-preset',
        config: {
          id: 'discord-chat',
          name: presetMeta.name,
          description: presetMeta.description,
          order: presetMeta.order ?? 10,
          plugins: pluginRows,
        },
      },
    ],
  },
];
const patchHeader = [
  '# 本文件由 scripts/setup-dsh.mjs 从源生成，请勿手工编辑。',
  '# 源：dsh/agent-presets/discord-chat/{preset.yml,agent.cordis.yml}（人格正文与工具面在那里改）。',
  '# 作用：把 discord-chat 作为一条 @deepseek-ai/dsh-agent-preset 行插入 profile（DSH 0.1.7+ 的 preset 机制）。',
].join('\n');
const patchYaml = patchHeader + '\n' + yaml.dump(patchDoc, { lineWidth: -1, noRefs: true });

// ── 3. 生成 bundle 包并写入 ~/.dsh/plugins/ ─────────────────────────────────
const bundlePkg = {
  name: BUNDLE_NAME,
  version: '0.1.0',
  private: true,
  description: 'dsh-discord-plugin 的 DSH agent preset bundle：把 discord-chat 作为 @deepseek-ai/dsh-agent-preset 行插入（DSH 0.1.7+ 的 preset 机制）',
  type: 'module',
  license: 'MIT',
  dsh: { bundle: { patch: ['./presets/discord-chat.patch.yml'] } },
};
const presetsDir = path.join(DEST_PLUGINS, 'presets');
fs.mkdirSync(presetsDir, { recursive: true });
fs.writeFileSync(path.join(DEST_PLUGINS, 'package.json'), JSON.stringify(bundlePkg, null, 2));
fs.writeFileSync(path.join(presetsDir, 'discord-chat.patch.yml'), patchYaml);
console.log(`✅ bundle 已生成 -> ${DEST_PLUGINS}`);

// ── 4. 注册进所有 profile（link: 依赖 + bundles 数组 + junction） ───────────
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

  // junction：profiles/node_modules/<bundle> -> ~/.dsh/plugins/<bundle>
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

// ── 5. 清理废弃的旧目录（0.1.5 机制，DSH 已不读取） ─────────────────────────
const legacyDir = path.join(DSH_HOME, '.agent-presets', 'discord-chat');
if (fs.existsSync(legacyDir)) {
  fs.rmSync(legacyDir, { recursive: true });
  console.log(`🧹 已清理废弃目录 ${legacyDir}（DSH 0.1.7 起不再读取 ~/.dsh/.agent-presets/）`);
}

console.log('\n✅ discord-chat preset 已按 bundle 机制安装完成');
console.log('⚠️ 请重启 DSH 使其生效，然后重启桥接（npm start）。');
