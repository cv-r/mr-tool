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
  Mergeable,
  MergeMethod,
  MergeResult,
  MrContent,
  MrUser,
  OpenMr,
  PlatformProvider,
} from './types';

export class GitLabProvider implements PlatformProvider {
  readonly kind = 'gitlab' as const;
  readonly label = 'GitLab';
  readonly cliName = 'glab';

  constructor(
    private readonly remote: RemoteInfo,
    private readonly cwd: string,
    readonly cliAvailable: boolean,
  ) {}

  private get projectId(): string {
    return encodeURIComponent(this.remote.projectPath);
  }

  private api(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return run('glab', ['api', '--hostname', this.remote.hostWithPort, path], {
      cwd: this.cwd,
      timeoutMs: 60_000,
    });
  }

  async searchMembers(query: string): Promise<MrUser[]> {
    if (!this.cliAvailable) {
      return [];
    }
    const keyword = query.trim();
    const params = new URLSearchParams({ per_page: '50' });
    if (keyword) {
      params.set('query', keyword);
    }

    const result = await this.api(`/projects/${this.projectId}/members/all?${params.toString()}`);
    if (!result.ok) {
      return [];
    }

    return arr(parseJson(result.stdout)).flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const username = str(item.username);
      if (!username) {
        return [];
      }
      return [
        {
          id: num(item.id, 0) || undefined,
          username,
          name: str(item.name, username),
        },
      ];
    });
  }

  async currentUser(): Promise<MrUser | null> {
    if (!this.cliAvailable) {
      return null;
    }
    const result = await this.api('/user');
    if (!result.ok) {
      return null;
    }
    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      return null;
    }
    const username = str(data.username);
    if (!username) {
      return null;
    }
    return {
      id: num(data.id, 0) || undefined,
      username,
      name: str(data.name, username),
    };
  }

  async findOpenMr(sourceBranch: string, targetBranch: string): Promise<OpenMr | null> {
    if (!this.cliAvailable) {
      return null;
    }
    const params = new URLSearchParams({
      source_branch: sourceBranch,
      target_branch: targetBranch,
      state: 'opened',
      per_page: '5',
    });
    const result = await this.api(`/projects/${this.projectId}/merge_requests?${params.toString()}`);
    if (!result.ok) {
      return null;
    }
    const first = arr(parseJson(result.stdout)).find(isRecord);
    if (!first) {
      return null;
    }
    const url = str(first.web_url);
    if (!url) {
      return null;
    }
    return {
      iid: String(num(first.iid, 0)),
      title: str(first.title),
      url,
    };
  }

  async listAssignedMrs(): Promise<AssignedMr[]> {
    return this.listMrs('assigned_to_me', 'assignee_id', '拉取分配给我的合并请求失败。');
  }

  async listReviewMrs(): Promise<AssignedMr[]> {
    return this.listMrs('reviews_for_me', 'reviewer_id', '拉取待我评审的合并请求失败。');
  }

  async listCreatedMrs(): Promise<AssignedMr[]> {
    return this.listMrs('created_by_me', 'author_id', '拉取我发起的合并请求失败。');
  }

  private async listMrs(
    scope: 'assigned_to_me' | 'reviews_for_me' | 'created_by_me',
    userIdParam: 'assignee_id' | 'reviewer_id' | 'author_id',
    failure: string,
  ): Promise<AssignedMr[]> {
    if (!this.cliAvailable) {
      throw new Error('未检测到 glab，请先安装并登录后再拉取。');
    }

    const makeParams = (extra: Record<string, string>): string =>
      new URLSearchParams({
        state: 'opened',
        per_page: '100',
        order_by: 'updated_at',
        sort: 'desc',
        ...extra,
      }).toString();

    let result = await this.api(`/merge_requests?${makeParams({ scope })}`);
    if (!result.ok) {
      // 兼容较老的 GitLab：用 assignee_id / reviewer_id 再试一次。
      const me = await this.currentUser();
      if (me?.id) {
        result = await this.api(
          `/merge_requests?${makeParams({ scope: 'all', [userIdParam]: String(me.id) })}`,
        );
      }
    }

    if (!result.ok) {
      throw new Error(firstLine(result.stderr || result.stdout) || failure);
    }

    return arr(parseJson(result.stdout)).flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      return this.mapMr(item) ?? [];
    });
  }

  private mapMr(item: Record<string, unknown>): AssignedMr | null {
    const url = str(item.web_url);
    const iid = num(item.iid, 0);
    if (!url || !iid) {
      return null;
    }

    const references = isRecord(item.references) ? str(item.references.full) : '';
    const bang = references.lastIndexOf('!');
    const projectPath =
      bang > 0 ? references.slice(0, bang) : projectPathFromUrl(url, '/-/merge_requests/');
    const projectId = num(item.project_id, 0);
    const detailed = str(item.detailed_merge_status, str(item.merge_status));
    const hasConflicts = item.has_conflicts === true;

    let mergeable: Mergeable = 'unknown';
    if (hasConflicts || /conflict|cannot_be_merged/i.test(detailed)) {
      mergeable = 'no';
    } else if (/^(mergeable|can_be_merged)$/i.test(detailed)) {
      mergeable = 'yes';
    }

    return {
      id: `gitlab:${projectId}:${iid}`,
      projectPath: projectPath || '未知项目',
      projectId: projectId || undefined,
      iid: String(iid),
      title: str(item.title, '(无标题)'),
      url,
      sourceBranch: str(item.source_branch),
      targetBranch: str(item.target_branch),
      author: isRecord(item.author) ? str(item.author.name, str(item.author.username)) : '',
      updatedAt: str(item.updated_at),
      draft:
        item.draft === true ||
        item.work_in_progress === true ||
        /^draft:/i.test(str(item.title)),
      mergeStatus: detailed,
      checks: pipelineChecks(item),
      mergeable,
      hasConflicts,
      reviewDecision: '',
    };
  }

  async getMrContent(mr: AssignedMr): Promise<MrContent> {
    if (!this.cliAvailable) {
      throw new Error('未检测到 glab，无法读取合并请求内容。');
    }
    const result = await this.api(`/projects/${this.projectRef(mr)}/merge_requests/${mr.iid}`);
    if (!result.ok) {
      throw new Error(firstLine(result.stderr || result.stdout) || '读取合并请求失败。');
    }
    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      throw new Error('合并请求内容无法解析。');
    }
    return { title: str(data.title), description: str(data.description) };
  }

  async editMr(mr: AssignedMr, content: MrContent): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 glab，无法编辑。' };
    }
    const result = await run(
      'glab',
      [
        'api',
        '--hostname',
        this.remote.hostWithPort,
        '--method',
        'PUT',
        '--header',
        'Content-Type: application/json',
        '--input',
        '-',
        `/projects/${this.projectRef(mr)}/merge_requests/${mr.iid}`,
      ],
      {
        cwd: this.cwd,
        input: JSON.stringify({
          title: content.title,
          description: content.description,
        }),
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

  async approveMr(mr: AssignedMr): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 glab，无法批准。' };
    }
    const result = await run(
      'glab',
      [
        'api',
        '--hostname',
        this.remote.hostWithPort,
        '--method',
        'POST',
        `/projects/${this.projectRef(mr)}/merge_requests/${mr.iid}/approve`,
      ],
      { cwd: this.cwd, timeoutMs: 60_000 },
    );
    if (result.ok) {
      return { ok: true, message: '已批准' };
    }
    return {
      ok: false,
      message: firstLine(result.stderr || result.stdout) || '批准失败。',
    };
  }

  async markReady(mr: AssignedMr): Promise<MergeResult> {
    return this.mrCommand(mr, ['mr', 'update', mr.iid, '--ready'], '标记失败。');
  }

  async closeMr(mr: AssignedMr): Promise<MergeResult> {
    return this.mrCommand(mr, ['mr', 'close', mr.iid], '关闭失败。');
  }

  async checkoutMr(mr: AssignedMr): Promise<MergeResult> {
    return this.mrCommand(mr, ['mr', 'checkout', mr.iid], '检出分支失败。');
  }

  private async mrCommand(
    mr: AssignedMr,
    args: string[],
    failure: string,
  ): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 glab，无法执行该操作。' };
    }
    const result = await run('glab', [...args, '-R', mr.projectPath], {
      cwd: this.cwd,
      timeoutMs: 120_000,
    });
    if (result.ok) {
      return { ok: true, message: '' };
    }
    return {
      ok: false,
      message: firstLine(result.stderr || result.stdout) || failure,
    };
  }

  private projectRef(mr: AssignedMr): string {
    return mr.projectId ? String(mr.projectId) : encodeURIComponent(mr.projectPath);
  }

  async mergeMr(mr: AssignedMr, method: MergeMethod): Promise<MergeResult> {
    if (!this.cliAvailable) {
      return { ok: false, message: '未检测到 glab，无法合并。' };
    }

    const project = this.projectRef(mr);
    const body: Record<string, unknown> = {};
    if (method === 'squash') {
      body.squash = true;
    }

    const result = await run(
      'glab',
      [
        'api',
        '--hostname',
        this.remote.hostWithPort,
        '--method',
        'PUT',
        '--header',
        'Content-Type: application/json',
        '--input',
        '-',
        `/projects/${project}/merge_requests/${mr.iid}/merge`,
      ],
      { cwd: this.cwd, input: JSON.stringify(body), timeoutMs: 120_000 },
    );

    if (result.ok) {
      return { ok: true, message: '已合并' };
    }

    const data = parseJson(result.stdout);
    const message = isRecord(data) ? str(data.message) || str(data.error) : '';
    return {
      ok: false,
      message: firstLine(message || result.stderr || result.stdout) || '合并失败。',
    };
  }

  async create(options: CreateOptions, log: Logger): Promise<CreateResult> {
    if (this.cliAvailable) {
      const cliResult = await this.createWithCli(options, log);
      if (cliResult) {
        return cliResult;
      }

      const apiResult = await this.createWithApi(options, log);
      if (apiResult) {
        return apiResult;
      }
    }

    const token =
      process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || process.env.GL_TOKEN;
    if (token) {
      const curlResult = await this.createWithCurl(options, token, log);
      if (curlResult) {
        return curlResult;
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
    if (options.squash) {
      lost.push('压缩提交');
    }
    const note = lost.length ? `网页创建页不会带入 ${lost.join('、')}，请手动设置。` : '';
    const baseWarning = this.cliAvailable
      ? '自动创建失败，已打开网页创建页面。'
      : `未检测到已登录的 glab CLI，已打开网页创建页面。安装后执行 glab auth login --hostname ${this.remote.host} 可一键创建。`;

    return {
      created: false,
      url: this.webUrl(options),
      via: 'web',
      warning: note ? `${baseWarning} ${note}` : baseWarning,
    };
  }

  private async createWithCli(
    options: CreateOptions,
    log: Logger,
  ): Promise<CreateResult | null> {
    const args = [
      'mr',
      'create',
      '--source-branch',
      options.sourceBranch,
      '--target-branch',
      options.targetBranch,
      '--title',
      options.title,
      '--description',
      options.description,
      `--remove-source-branch=${String(options.removeSource)}`,
      `--squash-before-merge=${String(options.squash)}`,
      '--no-editor',
      '--yes',
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

    log('调用 glab 创建合并请求…', 'info');
    const result = await run('glab', args, { cwd: this.cwd, timeoutMs: 120_000 });
    const output = `${result.stdout}\n${result.stderr}`;

    if (result.ok && !/ERROR/i.test(output)) {
      const url = extractMrUrl(output, 'gitlab');
      if (url) {
        log('glab 创建成功。', 'success');
        return { created: true, url, via: 'cli' };
      }
      log('glab 返回成功，但未解析到 MR 地址，尝试 API 创建…', 'warn');
      return null;
    }

    if (/already exists|409/i.test(output)) {
      const existing = await this.existingResult(options, 'cli', log);
      if (existing) {
        return existing;
      }
    }

    log(`glab 创建失败：${firstLine(result.stderr || result.stdout) || '未知错误'}`, 'warn');
    return null;
  }

  private async createWithApi(
    options: CreateOptions,
    log: Logger,
  ): Promise<CreateResult | null> {
    const body: Record<string, unknown> = {
      source_branch: options.sourceBranch,
      target_branch: options.targetBranch,
      title: options.draft ? `Draft: ${options.title}` : options.title,
      description: options.description,
      remove_source_branch: options.removeSource,
      squash: options.squash,
    };

    const assigneeId = options.assignee ? await this.resolveUserId(options.assignee) : null;
    if (assigneeId) {
      body.assignee_ids = [assigneeId];
    }
    const reviewerIds = await this.resolveUserIds(options.reviewers);
    if (reviewerIds.length) {
      body.reviewer_ids = reviewerIds;
    }

    log('使用 glab API 创建合并请求…', 'info');
    const result = await run(
      'glab',
      [
        'api',
        '--hostname',
        this.remote.hostWithPort,
        '--method',
        'POST',
        `--header`,
        'Content-Type: application/json',
        '--input',
        '-',
        `/projects/${this.projectId}/merge_requests`,
      ],
      {
        cwd: this.cwd,
        input: JSON.stringify(body),
        timeoutMs: 60_000,
      },
    );

    if (!result.ok) {
      log(`glab API 失败：${firstLine(result.stderr || result.stdout)}`, 'warn');
      return null;
    }

    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      log('glab API 返回内容无法解析。', 'warn');
      return null;
    }

    const url = str(data.web_url);
    if (url) {
      log('glab API 创建成功。', 'success');
      return { created: true, url, via: 'api' };
    }

    if (/already exists/i.test(str(data.message))) {
      const existing = await this.existingResult(options, 'api', log);
      if (existing) {
        return existing;
      }
    }

    const message = str(data.message) || firstLine(result.stdout);
    log(`glab API 未返回 MR 地址${message ? `：${message}` : ''}`, 'warn');
    return null;
  }

  private async createWithCurl(
    options: CreateOptions,
    token: string,
    log: Logger,
  ): Promise<CreateResult | null> {
    const body: Record<string, unknown> = {
      source_branch: options.sourceBranch,
      target_branch: options.targetBranch,
      title: options.draft ? `Draft: ${options.title}` : options.title,
      description: options.description,
      remove_source_branch: options.removeSource,
      squash: options.squash,
    };

    const assigneeId = options.assignee ? await this.resolveUserId(options.assignee) : null;
    if (assigneeId) {
      body.assignee_ids = [assigneeId];
    }
    const reviewerIds = await this.resolveUserIds(options.reviewers);
    if (reviewerIds.length) {
      body.reviewer_ids = reviewerIds;
    }

    const url = `${this.remote.baseUrl}/api/v4/projects/${this.projectId}/merge_requests`;
    log('使用 curl 调用 GitLab API 创建合并请求…', 'info');
    const result = await run(
      'curl',
      [
        '-sS',
        '--max-time',
        '60',
        '--request',
        'POST',
        '--header',
        `PRIVATE-TOKEN: ${token}`,
        '--header',
        'Content-Type: application/json',
        '--data-binary',
        JSON.stringify(body),
        url,
      ],
      { cwd: this.cwd, timeoutMs: 70_000 },
    );

    if (!result.ok) {
      log(`curl 请求失败：${firstLine(result.stderr)}`, 'warn');
      return null;
    }

    const data = parseJson(result.stdout);
    if (!isRecord(data)) {
      log('curl 返回内容无法解析。', 'warn');
      return null;
    }

    const webUrl = str(data.web_url);
    if (webUrl) {
      log('GitLab API 创建成功。', 'success');
      return { created: true, url: webUrl, via: 'api' };
    }

    if (/already exists/i.test(str(data.message))) {
      const existing = await this.existingResult(options, 'api', log);
      if (existing) {
        return existing;
      }
    }

    log(`GitLab API 未返回 MR 地址：${firstLine(str(data.message) || result.stdout)}`, 'warn');
    return null;
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
    log('检测到同一分支已存在打开的合并请求，返回已有地址。', 'warn');
    return {
      created: true,
      url: existing.url,
      via,
      warning: '该分支已存在打开的合并请求，已返回其地址。',
    };
  }

  private async resolveUserId(user: MrUser): Promise<number | null> {
    if (user.id && user.id > 0) {
      return user.id;
    }
    const params = new URLSearchParams({ username: user.username });
    const result = await this.api(`/users?${params.toString()}`);
    if (!result.ok) {
      return null;
    }
    const first = arr(parseJson(result.stdout)).find(isRecord);
    return first ? num(first.id, 0) || null : null;
  }

  private async resolveUserIds(users: MrUser[]): Promise<number[]> {
    const ids = await Promise.all(users.map((user) => this.resolveUserId(user)));
    return ids.filter((id): id is number => typeof id === 'number' && id > 0);
  }

  private webUrl(options: CreateOptions): string {
    const params = new URLSearchParams({
      'merge_request[source_branch]': options.sourceBranch,
      'merge_request[target_branch]': options.targetBranch,
      'merge_request[title]': options.draft ? `Draft: ${options.title}` : options.title,
      'merge_request[description]': options.description,
      'merge_request[remove_source_branch]': options.removeSource ? '1' : '0',
    });
    return `${this.remote.baseUrl}/${this.remote.projectPath}/-/merge_requests/new?${params.toString()}`;
  }
}

function pipelineChecks(item: Record<string, unknown>): ChecksStatus {
  const pipeline = isRecord(item.head_pipeline)
    ? item.head_pipeline
    : isRecord(item.pipeline)
      ? item.pipeline
      : null;
  switch (str(pipeline?.status)) {
    case 'success':
      return 'success';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'running':
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
      return 'running';
    case 'skipped':
    case 'manual':
      return 'none';
    case '':
      return 'none';
    default:
      return 'unknown';
  }
}

function projectPathFromUrl(url: string, marker: string): string {
  const index = url.indexOf(marker);
  if (index <= 0) {
    return '';
  }
  return url.slice(0, index).replace(/^https?:\/\/[^/]+\//, '');
}
