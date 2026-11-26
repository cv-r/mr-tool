import { run, type RunResult } from './utils/shell';

export interface RemoteInfo {
  raw: string;
  host: string;
  /** HTTP(S) 远端保留端口；SSH 远端忽略端口，因为网页端口通常不同。 */
  hostWithPort: string;
  projectPath: string;
  /** 用于拼接网页地址，SSH 远端统一转换为 https。 */
  baseUrl: string;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface CommitMessage {
  subject: string;
  body: string;
}

export interface DiffInfo {
  ahead: number;
  files: number;
  additions: number;
  deletions: number;
  commits: CommitInfo[];
}

/**
 * 支持三种远端写法：
 *   https://host[:port]/group/repo.git
 *   ssh://git@host[:port]/group/repo.git
 *   git@host:group/repo.git
 */
export function parseRemote(raw: string): RemoteInfo | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  let host = '';
  let port = '';
  let path = '';
  let protocol = 'https';
  let isHttp = false;

  const httpMatch = value.match(/^(https?):\/\/(?:[^@/]+@)?([^/:]+)(?::(\d+))?\/(.+)$/i);
  const sshMatch = value.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i);
  const scpMatch = value.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);

  if (httpMatch) {
    isHttp = true;
    protocol = httpMatch[1].toLowerCase();
    host = httpMatch[2];
    port = httpMatch[3] ?? '';
    path = httpMatch[4];
  } else if (sshMatch) {
    host = sshMatch[1];
    path = sshMatch[2];
  } else if (scpMatch) {
    host = scpMatch[1];
    path = scpMatch[2];
  } else {
    return null;
  }

  path = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');

  if (!host || !path) {
    return null;
  }

  const hostWithPort = isHttp && port ? `${host}:${port}` : host;

  return {
    raw: value,
    host,
    hostWithPort,
    projectPath: path,
    baseUrl: `${protocol}://${hostWithPort}`,
  };
}

function splitCommitMessage(raw: string): CommitMessage {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return { subject: '', body: '' };
  }
  const index = text.indexOf('\n');
  if (index < 0) {
    return { subject: text.trim(), body: '' };
  }
  return {
    subject: text.slice(0, index).trim(),
    body: text.slice(index + 1).trim(),
  };
}

export class Git {
  constructor(readonly cwd: string) {}

  private exec(args: string[], timeoutMs = 60_000): Promise<RunResult> {
    return run('git', args, { cwd: this.cwd, timeoutMs });
  }

  async isRepo(): Promise<boolean> {
    const result = await this.exec(['rev-parse', '--is-inside-work-tree'], 15_000);
    return result.ok && result.stdout === 'true';
  }

  async currentBranch(): Promise<string> {
    const result = await this.exec(['branch', '--show-current'], 15_000);
    if (!result.ok || !result.stdout) {
      throw new Error('无法确定当前分支。请先检出一个分支（当前可能处于 detached HEAD 状态）。');
    }
    return result.stdout;
  }

  async remoteInfo(): Promise<RemoteInfo | null> {
    const result = await this.exec(['remote', 'get-url', 'origin'], 15_000);
    return result.ok ? parseRemote(result.stdout) : null;
  }

  /** 按最近提交时间排序的远端分支，已去掉 remote 前缀和 HEAD。 */
  async recentBranches(limit: number): Promise<string[]> {
    const result = await this.exec([
      'branch',
      '-r',
      '--sort=-committerdate',
      '--format=%(refname:short)',
    ]);
    if (!result.ok) {
      return [];
    }

    const seen = new Set<string>();
    const branches: string[] = [];
    for (const rawLine of result.stdout.split('\n')) {
      const line = rawLine.trim();
      // 只保留 origin 的分支，避免把 upstream 分支当成可合并目标。
      if (!line.startsWith('origin/')) {
        continue;
      }
      const name = line.slice('origin/'.length);
      if (!name || name === 'HEAD' || seen.has(name)) {
        continue;
      }
      seen.add(name);
      branches.push(name);
      if (branches.length >= limit) {
        break;
      }
    }
    return branches;
  }

  async defaultBranch(): Promise<string | null> {
    const result = await this.exec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 15_000);
    return result.ok && result.stdout.startsWith('origin/')
      ? result.stdout.slice('origin/'.length)
      : null;
  }

  async lastCommitInfo(): Promise<CommitMessage> {
    return this.commitInfo('HEAD');
  }

  private async commitInfo(ref: string): Promise<CommitMessage> {
    const result = await this.exec(['log', '-1', '--pretty=%B', ref], 15_000);
    return result.ok ? splitCommitMessage(result.stdout) : { subject: '', body: '' };
  }

  async localBranches(): Promise<string[]> {
    const result = await this.exec(['branch', '--format=%(refname:short)'], 15_000);
    if (!result.ok) {
      return [];
    }
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /** 可作为源分支的本地 + origin 远端分支，本地优先去重。 */
  async sourceBranches(limit: number): Promise<string[]> {
    const [local, remote] = await Promise.all([
      this.exec(['branch', '--sort=-committerdate', '--format=%(refname:short)'], 15_000),
      this.exec(['branch', '-r', '--sort=-committerdate', '--format=%(refname:short)'], 15_000),
    ]);

    const seen = new Set<string>();
    const branches: string[] = [];
    const push = (name: string): void => {
      if (!name || seen.has(name) || branches.length >= limit) {
        return;
      }
      seen.add(name);
      branches.push(name);
    };

    for (const line of local.stdout.split('\n')) {
      push(line.trim());
    }
    for (const line of remote.stdout.split('\n')) {
      const name = line.trim();
      if (name.startsWith('origin/')) {
        const branch = name.slice('origin/'.length);
        if (branch !== 'HEAD') {
          push(branch);
        }
      }
    }
    return branches;
  }

  async isLocalBranch(branch: string): Promise<boolean> {
    return (await this.revParse(`refs/heads/${branch}`)) !== null;
  }

  async branchSha(branch: string): Promise<string | null> {
    return this.revParse(`refs/heads/${branch}`);
  }

  /** 本地分支用分支名，仅远端存在的分支用 origin/<name>。 */
  async resolveRef(branch: string): Promise<string | null> {
    if (await this.isLocalBranch(branch)) {
      return branch;
    }
    if (await this.remoteBranchExists(branch)) {
      return `origin/${branch}`;
    }
    return null;
  }

  async lastCommitInfoOn(branch: string): Promise<CommitMessage> {
    const ref = await this.resolveRef(branch);
    if (!ref) {
      return { subject: '', body: '' };
    }
    return this.commitInfo(ref);
  }

  async isDirty(): Promise<boolean> {
    const result = await this.exec(['status', '--porcelain'], 30_000);
    return result.ok && result.stdout.length > 0;
  }

  async fetchPrune(): Promise<RunResult> {
    return this.exec(['fetch', '--prune'], 45_000);
  }

  async remoteBranchExists(branch: string): Promise<boolean> {
    const result = await this.exec(
      ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
      15_000,
    );
    return result.ok;
  }

  async revParse(ref: string): Promise<string | null> {
    const result = await this.exec(['rev-parse', '--verify', '--quiet', ref], 15_000);
    return result.ok && result.stdout ? result.stdout : null;
  }

  async headSha(): Promise<string | null> {
    return this.revParse('HEAD');
  }

  /** 源分支相对于目标分支的提交列表与改动统计；分支不存在时返回 null。 */
  async diffInfo(sourceBranch: string, targetBranch: string): Promise<DiffInfo | null> {
    if (!(await this.remoteBranchExists(targetBranch))) {
      return null;
    }
    const sourceRef = await this.resolveRef(sourceBranch);
    if (!sourceRef) {
      return null;
    }

    const base = `origin/${targetBranch}`;
    const [count, stat, log] = await Promise.all([
      this.exec(['rev-list', '--count', `${base}..${sourceRef}`], 30_000),
      this.exec(['diff', '--shortstat', `${base}...${sourceRef}`], 60_000),
      this.exec(
        ['log', `${base}..${sourceRef}`, '--pretty=%h%x09%s%x09%an%x09%ar', '--max-count=50'],
        30_000,
      ),
    ]);

    const files = /(\d+)\s+files?\s+changed/.exec(stat.stdout);
    const insertions = /(\d+)\s+insertions?\(\+\)/.exec(stat.stdout);
    const deletions = /(\d+)\s+deletions?\(-\)/.exec(stat.stdout);

    const commits: CommitInfo[] = log.ok
      ? log.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [hash = '', subject = '', author = '', date = ''] = line.split('\t');
            return { hash, subject, author, date };
          })
      : [];

    return {
      ahead: count.ok ? Number.parseInt(count.stdout, 10) || 0 : 0,
      files: files ? Number(files[1]) : 0,
      additions: insertions ? Number(insertions[1]) : 0,
      deletions: deletions ? Number(deletions[1]) : 0,
      commits,
    };
  }

  async push(branch: string): Promise<RunResult> {
    return this.exec(['push', '--set-upstream', 'origin', branch], 120_000);
  }

  async checkout(branch: string): Promise<RunResult> {
    return this.exec(['checkout', branch], 60_000);
  }
}
