import * as vscode from 'vscode';
import { Git, type CommitMessage, type DiffInfo } from './git';
import { loadMrTemplates, type MrTemplate } from './mrTemplates';
import { createProvider } from './platforms';
import type {
  CreateOptions,
  CreateResult,
  Logger,
  MrUser,
  OpenMr,
  PlatformKind,
  PlatformProvider,
} from './platforms/types';
import { firstLine } from './utils/text';

export interface MrContext {
  repoName: string;
  repoRoot: string;
  host: string;
  projectPath: string;
  platform: PlatformKind;
  platformLabel: string;
  cliName: string;
  cliAvailable: boolean;
  currentBranch: string;
  defaultTarget: string;
  branches: string[];
  sourceBranches: string[];
  localBranches: string[];
  lastCommitSubject: string;
  lastCommitBody: string;
  dirty: boolean;
  existingMr: OpenMr | null;
  defaultAssignees: MrUser[];
  defaultReviewers: MrUser[];
  currentUser: MrUser | null;
  templates: MrTemplate[];
  fetchWarning?: string;
}

export type ProgressStatus = 'running' | 'done' | 'warn' | 'error';

export interface ServiceHooks {
  log?: Logger;
  progress?: (key: string, status: ProgressStatus, detail?: string) => void;
}

export interface CheckoutResult {
  ok: boolean;
  message: string;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export class MrService {
  readonly git: Git;
  private provider: PlatformProvider | null = null;

  constructor(readonly cwd: string) {
    this.git = new Git(cwd);
  }

  async loadContext(hooks: ServiceHooks = {}): Promise<MrContext> {
    const log = hooks.log ?? (() => undefined);
    const progress = hooks.progress ?? (() => undefined);

    if (!(await this.git.isRepo())) {
      throw new Error('当前目录不是 Git 仓库。');
    }

    const currentBranch = await this.git.currentBranch();
    const remote = await this.git.remoteInfo();
    if (!remote) {
      throw new Error('未找到 origin 远端仓库。请先执行：git remote add origin <url>');
    }

    progress('platform', 'running');
    this.provider = await createProvider(remote, this.cwd);
    progress('platform', 'done', this.provider.label);

    const config = vscode.workspace.getConfiguration('mrTool');
    let fetchWarning: string | undefined;
    if (config.get<boolean>('autoFetch', true)) {
      progress('fetch', 'running');
      const fetched = await this.git.fetchPrune();
      if (fetched.ok) {
        progress('fetch', 'done');
      } else {
        fetchWarning = 'git fetch 失败，分支列表可能不是最新的。';
        progress('fetch', 'warn');
        log(`${fetchWarning} ${firstLine(fetched.stderr)}`, 'warn');
      }
    }

    const limit = readNumber(config.get<number>('recentBranchLimit', 50), 50, 5, 200);
    const [rawBranches, defaultBranch, rawSourceBranches, localBranches] = await Promise.all([
      this.git.recentBranches(limit),
      this.git.defaultBranch(),
      this.git.sourceBranches(limit),
      this.git.localBranches(),
    ]);
    const branches = rawBranches.filter((branch) => branch !== currentBranch);
    const sourceBranches = [
      currentBranch,
      ...rawSourceBranches.filter((branch) => branch !== currentBranch),
    ];

    let defaultTarget = 'master';
    if (defaultBranch && branches.includes(defaultBranch)) {
      defaultTarget = defaultBranch;
    } else if (branches.includes('main')) {
      defaultTarget = 'main';
    } else if (branches.includes('master')) {
      defaultTarget = 'master';
    } else if (branches.length > 0) {
      defaultTarget = branches[0];
    }

    const provider = this.provider;
    const [lastCommit, dirty, existingMr, currentUser, templates] = await Promise.all([
      this.git.lastCommitInfo(),
      this.git.isDirty(),
      provider.findOpenMr(currentBranch, defaultTarget).catch(() => null),
      provider.currentUser().catch(() => null),
      loadMrTemplates(this.cwd).catch(() => []),
    ]);

    log(`已连接 ${provider.label} · ${remote.projectPath}`, 'info');

    return {
      repoName: remote.projectPath.split('/').pop() ?? remote.projectPath,
      repoRoot: this.cwd,
      host: remote.host,
      projectPath: remote.projectPath,
      platform: provider.kind,
      platformLabel: provider.label,
      cliName: provider.cliName,
      cliAvailable: provider.cliAvailable,
      currentBranch,
      defaultTarget,
      branches,
      sourceBranches,
      localBranches,
      lastCommitSubject: lastCommit.subject,
      lastCommitBody: lastCommit.body,
      dirty,
      existingMr,
      defaultAssignees: this.readUsers('defaultAssignees'),
      defaultReviewers: this.readUsers('defaultReviewers'),
      currentUser,
      templates,
    };
  }

  async checkExisting(sourceBranch: string, targetBranch: string): Promise<OpenMr | null> {
    const source = sourceBranch.trim();
    const target = targetBranch.trim();
    if (!this.provider || !source || !target) {
      return null;
    }
    return this.provider.findOpenMr(source, target);
  }

  async loadDiff(sourceBranch: string, targetBranch: string): Promise<DiffInfo | null> {
    const source = sourceBranch.trim();
    const target = targetBranch.trim();
    if (!source || !target) {
      return null;
    }
    return this.git.diffInfo(source, target);
  }

  async lastCommitInfoOf(branch: string): Promise<CommitMessage> {
    return this.git.lastCommitInfoOn(branch.trim());
  }

  async searchMembers(query: string): Promise<MrUser[]> {
    if (!this.provider || !this.provider.cliAvailable) {
      return [];
    }
    return this.provider.searchMembers(query);
  }

  async create(options: CreateOptions, hooks: ServiceHooks = {}): Promise<CreateResult> {
    const log = hooks.log ?? (() => undefined);
    const progress = hooks.progress ?? (() => undefined);

    if (!this.provider) {
      throw new Error('仓库信息尚未加载完成，请刷新后重试。');
    }

    const sourceBranch = options.sourceBranch;
    progress('push', 'running');
    const isLocal = await this.git.isLocalBranch(sourceBranch);

    if (isLocal) {
      log(`推送分支 ${sourceBranch} 到 origin…`, 'info');
      const push = await this.git.push(sourceBranch);

      if (push.ok) {
        progress('push', 'done');
        log('分支推送成功。', 'success');
      } else {
        // 推送失败时，只有远端已经包含该分支最新提交才允许继续，避免用过期代码创建 MR。
        const [localSha, remoteSha] = await Promise.all([
          this.git.branchSha(sourceBranch),
          this.git.revParse(`refs/remotes/origin/${sourceBranch}`),
        ]);
        if (localSha && remoteSha && localSha === remoteSha) {
          progress('push', 'warn', '远端已是最新');
          log('推送失败，但远端分支与本地分支一致，继续创建。', 'warn');
        } else {
          const detail = firstLine(push.stderr || push.stdout) || '未知错误';
          progress('push', 'error', detail);
          throw new Error(`分支推送失败，已中止创建，避免用旧代码生成 MR。\n${detail}`);
        }
      }
    } else if (await this.git.remoteBranchExists(sourceBranch)) {
      progress('push', 'done', '远端已有分支');
      log(`源分支 ${sourceBranch} 仅存在于远端，跳过推送。`, 'info');
    } else {
      progress('push', 'error', '分支不存在');
      throw new Error(`源分支 ${sourceBranch} 既不存在于本地，也不存在于 origin。`);
    }

    progress('create', 'running');
    const result = await this.provider.create(options, log);
    progress(
      'create',
      result.created ? 'done' : 'warn',
      result.via === 'web' ? '改为网页创建' : undefined,
    );
    return result;
  }

  async checkout(branch: string): Promise<CheckoutResult> {
    const result = await this.git.checkout(branch);
    return {
      ok: result.ok,
      message: result.ok ? '' : firstLine(result.stderr || result.stdout) || '切换分支失败。',
    };
  }

  private readUsers(key: 'defaultAssignees' | 'defaultReviewers'): MrUser[] {
    const configured = vscode.workspace
      .getConfiguration('mrTool')
      .get<Array<{ username?: string; name?: string }>>(key, []);

    const seen = new Set<string>();
    const users: MrUser[] = [];
    for (const item of configured) {
      const username = typeof item?.username === 'string' ? item.username.trim() : '';
      if (!username || seen.has(username)) {
        continue;
      }
      seen.add(username);
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : username;
      users.push({ username, name });
    }
    return users;
  }
}
