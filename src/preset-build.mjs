// preset 渲染共享模块：把 dsh/agent-presets/discord-chat/ 源文件渲染成
// DSH 0.1.7+ bundle patch。setup-dsh.mjs（安装）与控制台（人格热更新）共用。
// 源是唯一权威，产物 ~/.dsh/plugins/discord-agent-presets/ 纯生成物。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, PRESET_SRC_DIR } from './paths.mjs';

export const REPO_ROOT = ROOT;
export const SRC_DIR = PRESET_SRC_DIR;
export const BUNDLE_NAME = 'discord-agent-presets';
export const PRESET_ID = 'discord-chat';

export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}
export function readPersona() {
  const rows = yaml.load(fs.readFileSync(path.join(SRC_DIR, 'agent.cordis.yml'), 'utf8'));
  const persona = rows.find((r) => r?.id === 'persona');
  return {
    prefix: persona?.config?.prefix ?? '',
    suffix: persona?.config?.suffix ?? '',
  };
}

/** 写回 persona prefix/suffix 到源文件（保留其余行结构）。 */
export function writePersona({ prefix, suffix }) {
  const file = path.join(SRC_DIR, 'agent.cordis.yml');
  const rows = yaml.load(fs.readFileSync(file, 'utf8'));
  const persona = rows.find((r) => r?.id === 'persona');
  if (!persona) throw new Error('源文件里没有 persona 行');
  persona.config = { ...persona.config, prefix: String(prefix ?? ''), suffix: String(suffix ?? '') };
  fs.writeFileSync(file, yaml.dump(rows, { lineWidth: -1, noRefs: true }));
}

/** 把源渲染成 bundle patch YAML 文本。 */
export function renderPatchYaml() {
  const presetMeta = yaml.load(fs.readFileSync(path.join(SRC_DIR, 'preset.yml'), 'utf8'));
  const cordisRows = yaml.load(fs.readFileSync(path.join(SRC_DIR, 'agent.cordis.yml'), 'utf8'));
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
  const doc = [
    {
      insert: [
        {
          id: `preset-${PRESET_ID}`,
          name: '@deepseek-ai/dsh-agent-preset',
          config: {
            id: PRESET_ID,
            name: presetMeta.name,
            description: presetMeta.description,
            order: presetMeta.order ?? 10,
            plugins: pluginRows,
          },
        },
      ],
    },
  ];
  const header = [
    '# 本文件由 preset-build.mjs 从源生成，请勿手工编辑。',
    `# 源：dsh/agent-presets/discord-chat/{preset.yml,agent.cordis.yml}（人格正文与工具面在那里改）。`,
    '# 作用：把 discord-chat 作为一条 @deepseek-ai/dsh-agent-preset 行插入 profile（DSH 0.1.7+ 的 preset 机制）。',
  ].join('\n');
  return header + '\n' + yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

/**
 * 渲染并写入 bundle 到 ~/.dsh/plugins/discord-agent-presets/。
 * @returns bundle 目录
 */
export function writeBundle(dshHome = resolveDshHome()) {
  const dest = path.join(dshHome, 'plugins', BUNDLE_NAME);
  const presetsDir = path.join(dest, 'presets');
  fs.mkdirSync(presetsDir, { recursive: true });
  const bundlePkg = {
    name: BUNDLE_NAME,
    version: '0.1.0',
    private: true,
    description: 'dsh-discord-plugin 的 DSH agent preset bundle：把 discord-chat 作为 @deepseek-ai/dsh-agent-preset 行插入（DSH 0.1.7+ 的 preset 机制）',
    type: 'module',
    license: 'MIT',
    dsh: { bundle: { patch: [`./presets/${PRESET_ID}.patch.yml`] } },
  };
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(bundlePkg, null, 2));
  fs.writeFileSync(path.join(presetsDir, `${PRESET_ID}.patch.yml`), renderPatchYaml());
  return dest;
}
