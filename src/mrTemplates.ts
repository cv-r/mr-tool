import { readdir, readFile, realpath } from 'node:fs/promises';
import { extname, join } from 'node:path';

export interface MrTemplate {
  name: string;
  content: string;
}

const MAX_TEMPLATES = 20;
const MAX_BYTES = 20_000;

/**
 * 读取仓库里的 MR / PR 模板：
 * - GitLab：.gitlab/merge_request_templates/**\/*.md
 * - GitHub：.github 或根目录下的 pull_request_template.md
 */
export async function loadMrTemplates(repoRoot: string): Promise<MrTemplate[]> {
  const state: { templates: MrTemplate[]; seen: Set<string> } = {
    templates: [],
    seen: new Set(),
  };

  await collectMarkdown(join(repoRoot, '.gitlab', 'merge_request_templates'), '', state, 0);

  const githubPaths: Array<[string, string]> = [
    ['.github/PULL_REQUEST_TEMPLATE.md', 'PR 模板'],
    ['.github/pull_request_template.md', 'PR 模板'],
    ['docs/pull_request_template.md', 'PR 模板'],
    ['PULL_REQUEST_TEMPLATE.md', 'PR 模板'],
  ];
  for (const [path, label] of githubPaths) {
    await addTemplate(join(repoRoot, path), label, state);
  }
  await collectMarkdown(join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE'), '', state, 0);

  return state.templates;
}

async function collectMarkdown(
  dir: string,
  prefix: string,
  state: { templates: MrTemplate[]; seen: Set<string> },
  depth: number,
): Promise<void> {
  if (depth > 3 || state.templates.length >= MAX_TEMPLATES) {
    return;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (state.templates.length >= MAX_TEMPLATES) {
      return;
    }
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectMarkdown(join(dir, entry.name), name, state, depth + 1);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      await addTemplate(join(dir, entry.name), name.replace(/\.md$/i, ''), state);
    }
  }
}

async function addTemplate(
  path: string,
  name: string,
  state: { templates: MrTemplate[]; seen: Set<string> },
): Promise<void> {
  if (state.templates.length >= MAX_TEMPLATES) {
    return;
  }
  try {
    // 用真实路径去重：macOS 不区分大小写时，.github/PULL_REQUEST_TEMPLATE.md
    // 和 .github/pull_request_template.md 指向同一个文件。
    const resolved = await realpath(path);
    if (state.seen.has(resolved)) {
      return;
    }
    const content = await readFile(resolved, 'utf8');
    if (!content.trim()) {
      return;
    }
    state.seen.add(resolved);
    state.templates.push({ name, content: content.slice(0, MAX_BYTES) });
  } catch {
    // 模板文件不存在或不可读时忽略。
  }
}
