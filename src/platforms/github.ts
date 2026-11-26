import type { RemoteInfo } from '../git';
import { arr, isRecord, num, parseJson, str } from '../utils/json';
import { run } from '../utils/shell';
import { extractMrUrl, firstLine } from '../utils/text';
import type {
  AssignedMr,
  ChecksStatus,
  CreateOptions,
  CreateResult,
  CreateVia,
  Logger,
  MergeMethod,
  MergeResult,
  MrContent,
  MrUser,
  OpenMr,
  PlatformProvider,
} from './types';

export class GitHubProvider implements PlatformProvider {
  readonly kind = 'github' as const;
  readonly label = 'GitHub';
  readonly cliName = 'gh';

  private readonly owner: string;
  private readonly repo: string;

  constructor(
    private readonly remote: RemoteInfo,
    private readonly cwd: string,
    readonly cliAvailable: boolean,
  ) {
    const [owner = '', repo = ''] = remote.projectPath.split('/');
    this.owner = owner;
    this.repo = repo;
  }

  private get slug(): string {
    return `${this.owner}/${this.repo}`;
  }

  async searchMembers(query: string): Promise<MrUser[]> {
    if (!this.cliAvailable) {
      return [];
    }
    const result = await run(
      'gh',
      ['api', `repos/${this.slug}/assignees?per_page=100`],
      { cwd: this.cwd, timeoutMs: 60_000 },
    );
    if (!result.ok) {
      return [];
    }

    const keyword = query.trim().toLowerCase();
    return arr(parseJson(result.stdout))
      .flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }
        const username = str(item.login);
        if (!username) {
          return [];
        }
        const name = str(item.name, username);
        if (
          keyword &&
          !username.toLowerCase().includes(keyword) &&
          !name.toLowerCase().includes(keyword)
        ) {
          return [];
        }
        return [
          {
            id: num(item.id, 0) || undefined,
            username,
            name,
          },
        ];
      })
      .slice(0, 50);
  }

  async currentUser(): Promise<MrUser | null> {
    if (!this.cliAvailable) {
      return null;
    }
    const result = await run('gh', ['api', 'user'], { cwd: this.cwd, timeoutMs: 30_000 });
    if (!result.ok) {
      return null;
    }
    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      return null;
    }
    const username = str(data.login);
    if (!username) {
      return null;
    }
    return {
      id: num(data.id, 0) || undefined,
      username,
      name: str(data.name, username) || username,
    };
  }

  async findOpenMr(sourceBranch: string, targetBranch: string): Promise<OpenMr | null> {
    if (!this.cliAvailable) {
      return null;
    }
    const result = await run(
      'gh',
      [
        'pr',
        'list',
        '--head',
        sourceBranch,
        '--base',
        targetBranch,
        '--state',
        'open',
        '--json',
        'number,title,url',
        '--limit',
        '5',
      ],
      { cwd: this.cwd, timeoutMs: 60_000 },
    );
    if (!result.ok) {
      return null;
    }
    const first = arr(parseJson(result.stdout)).find(isRecord);
    if (!first) {
      return null;
    }
    const url = str(first.url);
    if (!url) {
      return null;
    }
    return {
      iid: String(num(first.number, 0)),
      title: str(first.title),
      url,
    };
  }

  async listAssignedMrs(): Promise<AssignedMr[]> {
    return this.listMrs('is:pr is:open assignee:@me', '拉取分配给我的 Pull Request 失败。');
  }

  async listReviewMrs(): Promise<AssignedMr[]> {
    return this.listMrs(
      'is:pr is:open review-requested:@me',
      '拉取待我评审的 Pull Request 失败。',
    );
  }

  async listCreatedMrs(): Promise<AssignedMr[]> {
    return this.listMrs('is:pr is:open author:@me', '拉取我发起的 Pull Request 失败。');
  }

  async getMrContent(mr: AssignedMr): Promise<MrContent> {
    if (!this.cliAvailable) {
      throw new Error('未检测到 gh，无法读取 Pull Request 内容。');
    }
    const result = await run(
      'gh',
      ['pr', 'view', mr.iid, '--repo', mr.projectPath, '--json', 'title,body'],
      { cwd: this.cwd, timeoutMs: 60_000 },
    );
    if (!result.ok) {
      throw new Error(firstLine(result.stderr || result.stdout) || '读取 Pull Request 失败。');
    }
    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      throw new Error('Pull Request 内容无法解析。');
    }
    return { title: str(data.title), description: str(data.body) };
  }

  async editMr(mr: AssignedMr, content: MrContent): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 gh，无法编辑。' };
    }
    const result = await run(
      'gh',
      [
        'api',
        '--method',
        'PATCH',
        `repos/${mr.projectPath}/pulls/${mr.iid}`,
        '--input',
        '-',
      ],
      {
        cwd: this.cwd,
        input: JSON.stringify({ title: content.title, body: content.description }),
        timeoutMs: 60_000,
      },
    );
    if (result.ok) {
      return { ok: true, message: '已保存' };
    }
    const data = parseJson(result.stdout);
    const message = isRecord(data) ? str(data.message) || str(data.error) : '';
    return {
      ok: false,
      message: firstLine(message || result.stderr || result.stdout) || '保存失败。',
    };
  }

  private async listMrs(query: string, failure: string): Promise<AssignedMr[]> {
    if (!this.cliAvailable) {
      throw new Error('未检测到 gh，请先安装并登录后再拉取。');
    }

    const result = await run(
      'gh',
      ['api', '--method', 'GET', 'search/issues', '-f', `q=${query}`, '-f', 'per_page=100'],
      { cwd: this.cwd, timeoutMs: 60_000 },
    );

    if (!result.ok) {
      throw new Error(firstLine(result.stderr || result.stdout) || failure);
    }

    const data = parseJson(result.stdout);
    const items = isRecord(data) ? arr(data.items) : [];

    const mrs = items.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const url = str(item.html_url);
      const number = num(item.number, 0);
      const repositoryUrl = str(item.repository_url);
      const repo = repositoryUrl.split('/').filter(Boolean).slice(-2).join('/');
      if (!url || !number || !repo) {
        return [];
      }

      return [
        {
          id: `github:${repo}:${number}`,
          projectPath: repo,
          iid: String(number),
          title: str(item.title, '(无标题)'),
          url,
          sourceBranch: '',
          targetBranch: '',
          author: isRecord(item.user) ? str(item.user.login) : '',
          updatedAt: str(item.updated_at),
          draft: item.draft === true,
          mergeStatus: str(item.state),
          checks: 'unknown' as ChecksStatus,
          mergeable: 'unknown' as const,
          hasConflicts: false,
          reviewDecision: '',
        },
      ];
    });

    return this.enrich(mrs);
  }

  /** search API 不含检查状态，按仓库批量补齐。 */
  private async enrich(mrs: AssignedMr[]): Promise<AssignedMr[]> {
    if (!mrs.length) {
      return mrs;
    }

    const byRepo = new Map<string, AssignedMr[]>();
    for (const mr of mrs) {
      const list = byRepo.get(mr.projectPath) ?? [];
      list.push(mr);
      byRepo.set(mr.projectPath, list);
    }

    const enriched = new Map<string, AssignedMr>();
    await Promise.all(
      Array.from(byRepo, async ([repo, items]) => {
        const result = await run(
          'gh',
          [
            'pr',
            'list',
            '--repo',
            repo,
            '--state',
            'open',
            '--limit',
            '100',
            '--json',
            'number,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,isDraft',
          ],
          { cwd: this.cwd, timeoutMs: 60_000 },
        );
        if (!result.ok) {
          return;
        }

        const details = new Map<number, Record<string, unknown>>();
        for (const raw of arr(parseJson(result.stdout))) {
          if (isRecord(raw)) {
            details.set(num(raw.number, 0), raw);
          }
        }

        for (const mr of items) {
          const info = details.get(Number(mr.iid));
          if (!info) {
            continue;
          }
          const mergeable = str(info.mergeable).toUpperCase();
          const mergeState = str(info.mergeStateStatus).toUpperCase();
          const conflict = mergeable === 'CONFLICTING' || mergeState === 'DIRTY';
          enriched.set(mr.id, {
            ...mr,
            draft: info.isDraft === true || mr.draft,
            mergeable: mergeable === 'MERGEABLE' ? 'yes' : conflict ? 'no' : 'unknown',
            hasConflicts: conflict,
            checks: githubChecks(arr(info.statusCheckRollup)),
            reviewDecision: str(info.reviewDecision),
          });
        }
      }),
    );

    return mrs.map((mr) => enriched.get(mr.id) ?? mr);
  }

  async approveMr(mr: AssignedMr): Promise<MergeResult> {
    return this.prCommand(
      ['pr', 'review', mr.iid, '--repo', mr.projectPath, '--approve'],
      '批准失败。',
      60_000,
    );
  }

  async markReady(mr: AssignedMr): Promise<MergeResult> {
    return this.prCommand(['pr', 'ready', mr.iid, '--repo', mr.projectPath], '标记失败。');
  }

  async closeMr(mr: AssignedMr): Promise<MergeResult> {
    return this.prCommand(['pr', 'close', mr.iid, '--repo', mr.projectPath], '关闭失败。');
  }

  async checkoutMr(mr: AssignedMr): Promise<MergeResult> {
    return this.prCommand(
      ['pr', 'checkout', mr.iid, '--repo', mr.projectPath],
      '检出分支失败。',
    );
  }

  private async prCommand(
    args: string[],
    failure: string,
    timeoutMs = 120_000,
  ): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 gh，无法执行该操作。' };
    }
    const result = await run('gh', args, { cwd: this.cwd, timeoutMs });
    if (result.ok) {
      return { ok: true, message: '' };
    }
    return {
      ok: false,
      message: firstLine(result.stderr || result.stdout) || failure,
    };
  }

  async mergeMr(mr: AssignedMr, method: MergeMethod): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 gh，无法合并。' };
    }

    const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge';
    const result = await run('gh', ['pr', 'merge', mr.iid, '--repo', mr.projectPath, flag], {
      cwd: this.cwd,
      timeoutMs: 120_000,
    });

    if (result.ok) {
      return { ok: true, message: '已合并' };
    }

    return {
      ok: false,
      message: firstLine(result.stderr || result.stdout) || '合并失败。',
    };
  }

  async create(options: CreateOptions, log: Logger): Promise<CreateResult> {
    const warning =
      options.removeSource || options.squash
        ? 'GitHub 不支持在创建 PR 时设置删除源分支或压缩提交，请在合并时选择。'
        : undefined;
    if (warning) {
      log(warning, 'warn');
    }

    if (this.cliAvailable) {
      const cliResult = await this.createWithCli(options, log);
      if (cliResult) {
        return { ...cliResult, warning: joinWarnings(warning, cliResult.warning) };
      }

      const apiResult = await this.createWithApi(options, log);
      if (apiResult) {
        return { ...apiResult, warning: joinWarnings(warning, apiResult.warning) };
      }
    }

    log('所有自动创建方式均不可用，改为打开网页手动创建。', 'warn');
    const lost: string[] = [];
    if (options.assignee) {
      lost.push('Assignee');
    }
    if (options.reviewers.length) {
      lost.push('Reviewer');
    }
    if (options.draft) {
      lost.push('草稿状态');
    }
    const note = lost.length ? `网页创建页不会带入 ${lost.join('、')}，请手动设置。` : '';
    const baseWarning = this.cliAvailable
      ? '自动创建失败，已打开网页创建页面。'
      : '未检测到已登录的 gh CLI，已打开网页创建页面。安装后执行 gh auth login 可一键创建。';

    return {
      created: false,
      url: this.webUrl(options),
      via: 'web',
      warning: joinWarnings(warning, baseWarning, note),
    };
  }

  private async createWithCli(
    options: CreateOptions,
    log: Logger,
  ): Promise<CreateResult | null> {
    const args = [
      'pr',
      'create',
      '--base',
      options.targetBranch,
      '--head',
      options.sourceBranch,
      '--title',
      options.title,
      '--body',
      options.description,
    ];
    if (options.draft) {
      args.push('--draft');
    }
    if (options.assignee) {
      args.push('--assignee', options.assignee.username);
    }
    if (options.reviewers.length) {
      args.push('--reviewer', options.reviewers.map((user) => user.username).join(','));
    }

    log('调用 gh 创建 Pull Request…', 'info');
    const result = await run('gh', args, { cwd: this.cwd, timeoutMs: 120_000 });
    const output = `${result.stdout}\n${result.stderr}`;

    if (result.ok) {
      const url =
        extractMrUrl(output, 'github') || (output.trim().startsWith('http') ? output.trim() : '');
      if (url) {
        log('gh 创建成功。', 'success');
        return { created: true, url, via: 'cli' };
      }
      log('gh 返回成功，但未解析到 PR 地址，尝试 API 创建…', 'warn');
      return null;
    }

    if (/already exists/i.test(output)) {
      const existing = await this.existingResult(options, 'cli', log);
      if (existing) {
        return existing;
      }
    }

    log(`gh 创建失败：${firstLine(result.stderr || result.stdout) || '未知错误'}`, 'warn');
    return null;
  }

  private async createWithApi(
    options: CreateOptions,
    log: Logger,
  ): Promise<CreateResult | null> {
    const body: Record<string, unknown> = {
      title: options.title,
      head: options.sourceBranch,
      base: options.targetBranch,
      body: options.description,
      draft: options.draft,
    };

    log('使用 gh API 创建 Pull Request…', 'info');
    const result = await run(
      'gh',
      ['api', '--method', 'POST', `repos/${this.slug}/pulls`, '--input', '-'],
      { cwd: this.cwd, input: JSON.stringify(body), timeoutMs: 60_000 },
    );

    if (!result.ok) {
      log(`gh API 失败：${firstLine(result.stderr || result.stdout)}`, 'warn');
      return null;
    }

    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      log('gh API 返回内容无法解析。', 'warn');
      return null;
    }

    const url = str(data.html_url);
    if (!url) {
      const message = str(data.message) || firstLine(result.stdout);
      if (/already exists/i.test(message)) {
        const existing = await this.existingResult(options, 'api', log);
        if (existing) {
          return existing;
        }
      }
      log(`gh API 未返回 PR 地址${message ? `：${message}` : ''}`, 'warn');
      return null;
    }

    const number = num(data.number, 0);
    if (options.assignee && number > 0) {
      const assign = await run(
        'gh',
        ['api', '--method', 'POST', `repos/${this.slug}/issues/${number}/assignees`, '--input', '-'],
        {
          cwd: this.cwd,
          input: JSON.stringify({ assignees: [options.assignee.username] }),
          timeoutMs: 30_000,
        },
      );
      if (!assign.ok) {
        log('PR 已创建，但 Assignee 设置失败。', 'warn');
      }
    }

    if (options.reviewers.length && number > 0) {
      const review = await run(
        'gh',
        [
          'api',
          '--method',
          'POST',
          `repos/${this.slug}/pulls/${number}/requested_reviewers`,
          '--input',
          '-',
        ],
        {
          cwd: this.cwd,
          input: JSON.stringify({ reviewers: options.reviewers.map((user) => user.username) }),
          timeoutMs: 30_000,
        },
      );
      if (!review.ok) {
        log('PR 已创建，但 Reviewer 设置失败。', 'warn');
      }
    }

    log('gh API 创建成功。', 'success');
    return { created: true, url, via: 'api' };
  }

  private async existingResult(
    options: CreateOptions,
    via: CreateVia,
    log: Logger,
  ): Promise<CreateResult | null> {
    const existing = await this.findOpenMr(options.sourceBranch, options.targetBranch);
    if (!existing) {
      return null;
    }
    log('检测到同一分支已存在打开的 Pull Request，返回已有地址。', 'warn');
    return {
      created: true,
      url: existing.url,
      via,
      warning: '该分支已存在打开的 Pull Request，已返回其地址。',
    };
  }

  private webUrl(options: CreateOptions): string {
    const base = `${this.remote.baseUrl}/${this.remote.projectPath}/compare`;
    const range = `${encodeRef(options.targetBranch)}...${encodeRef(options.sourceBranch)}`;
    const params = new URLSearchParams({
      quick_pull: '1',
      title: options.title,
      body: options.description,
    });
    return `${base}/${range}?${params.toString()}`;
  }
}

function githubChecks(rollup: unknown[]): ChecksStatus {
  if (!rollup.length) {
    return 'none';
  }

  let running = false;
  for (const raw of rollup) {
    if (!isRecord(raw)) {
      continue;
    }
    const conclusion = str(raw.conclusion).toUpperCase();
    const state = str(raw.state).toUpperCase();
    const status = str(raw.status).toUpperCase();
    if (
      ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(
        conclusion,
      ) ||
      ['FAILURE', 'ERROR'].includes(state)
    ) {
      return 'failed';
    }
    if (
      ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED'].includes(status) ||
      ['PENDING', 'EXPECTED'].includes(state)
    ) {
      running = true;
    }
    if (!conclusion && !state && !status) {
      running = true;
    }
  }
  return running ? 'running' : 'success';
}

function encodeRef(ref: string): string {
  // 分支名里的 / 是 ref 的一部分，保留可读性；其余字符编码。
  return encodeURIComponent(ref).replace(/%2F/gi, '/');
}

function joinWarnings(...warnings: Array<string | undefined>): string | undefined {
  const text = warnings.filter(Boolean).join(' ');
  return text || undefined;
}
