import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { MrService, type MrContext, type ProgressStatus } from '../mrService';
import { notifyMrCreated } from '../notify/feishu';
import type { CreateResult, MrUser } from '../platforms/types';
import { updateStatusBar } from '../statusBar';
import { isRecord, num, str } from '../utils/json';
import { toMessage } from '../utils/text';
import type { CreateRequest, HostMessage, SavedForm } from './protocol';

export class MrPanel {
  private static current: MrPanel | undefined;

  static async createOrShow(
    extensionUri: vscode.Uri,
    cwd: string,
    memento: vscode.Memento,
  ): Promise<void> {
    if (MrPanel.current) {
      if (MrPanel.current.cwd === cwd) {
        MrPanel.current.panel.reveal(undefined, false);
        void MrPanel.current.reload();
        return;
      }
      MrPanel.current.panel.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      'mrTool.create',
      '创建合并请求',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    MrPanel.current = new MrPanel(panel, extensionUri, cwd, memento);
  }

  static refreshActive(): void {
    void MrPanel.current?.reload();
  }

  private readonly service: MrService;
  private readonly disposables: vscode.Disposable[] = [];
  private context: MrContext | null = null;
  private busy = false;
  private disposed = false;
  private loading = false;
  private loadSeq = 0;
  private inspectSeq = 0;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    readonly cwd: string,
    private readonly memento: vscode.Memento,
  ) {
    this.service = new MrService(cwd);
    panel.webview.html = this.html();

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.onMessage(message);
      }),
      panel.onDidDispose(() => {
        this.disposed = true;
        if (MrPanel.current === this) {
          MrPanel.current = undefined;
        }
        for (const disposable of this.disposables) {
          disposable.dispose();
        }
      }),
    );

    this.send({ type: 'loading' });
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString('base64');
    const media = (...segments: string[]): string =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...segments))
        .toString();

    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      // cspSource 是必需的：ES module 的 import 请求不会携带 nonce。
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('style', 'base.css')}">
  <link rel="stylesheet" href="${media('style', 'components.css')}">
  <title>创建合并请求</title>
</head>
<body>
  <div id="app" class="app"></div>
  <div id="toast" class="toast" hidden></div>
  <script type="module" nonce="${nonce}" src="${media('main.js')}"></script>
</body>
</html>`;
  }

  private send(message: HostMessage): void {
    if (this.disposed) {
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isRecord(raw)) {
      return;
    }

    switch (str(raw.type)) {
      case 'ready':
      case 'refresh':
        await this.reload();
        break;
      case 'searchMembers': {
        const requestId = num(raw.requestId, 0);
        if (requestId > 0) {
          await this.onSearchMembers(requestId, str(raw.query).trim().slice(0, 100));
        }
        break;
      }
      case 'inspect':
        await this.onInspect(str(raw.source), str(raw.target));
        break;
      case 'create': {
        const options = parseCreateRequest(raw.options);
        if (options) {
          await this.onCreate(options);
        } else {
          this.send({ type: 'createError', message: '提交内容无效，请检查目标分支和标题。' });
        }
        break;
      }
      case 'openExternal':
        await this.onOpenExternal(str(raw.url));
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(str(raw.text).slice(0, 200_000));
        break;
      case 'switchBranch':
        await this.onSwitchBranch(str(raw.branch));
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'mrTool');
        break;
      default:
        break;
    }
  }

  private async reload(): Promise<void> {
    if (this.loading || this.busy) {
      return;
    }
    this.loading = true;
    const seq = ++this.loadSeq;
    this.send({ type: 'loading' });

    try {
      const context = await this.service.loadContext({
        log: (message, level) => {
          this.send({ type: 'log', message, level: level ?? 'info' });
        },
        progress: (key, status, detail) => {
          this.send({ type: 'progress', key, status, detail });
        },
      });

      if (seq !== this.loadSeq) {
        return;
      }

      this.context = context;
      updateStatusBar(context.existingMr, context.platform);

      const diff = await this.service
        .loadDiff(context.currentBranch, context.defaultTarget)
        .catch(() => null);
      if (seq !== this.loadSeq) {
        return;
      }

      this.send({
        type: 'context',
        payload: {
          context,
          existingMr: context.existingMr,
          diff,
          preferences: this.readPreferences(),
        },
      });
    } catch (error) {
      if (seq === this.loadSeq) {
        this.send({ type: 'loadError', message: toMessage(error) });
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading = false;
      }
    }
  }

  private async onInspect(rawSource: string, rawTarget: string): Promise<void> {
    const source = rawSource.trim().slice(0, 255);
    const target = rawTarget.trim().slice(0, 255);
    const seq = ++this.inspectSeq;

    if (!source || !target) {
      this.send({
        type: 'inspect',
        source,
        target,
        existing: null,
        diff: null,
        lastCommitSubject: '',
        lastCommitBody: '',
      });
      return;
    }

    const [existing, diff, lastCommit] = await Promise.all([
      this.service.checkExisting(source, target).catch(() => null),
      this.service.loadDiff(source, target).catch(() => null),
      this.service.lastCommitInfoOf(source).catch(() => ({ subject: '', body: '' })),
    ]);

    if (seq !== this.inspectSeq) {
      return;
    }

    this.send({
      type: 'inspect',
      source,
      target,
      existing,
      diff,
      lastCommitSubject: lastCommit.subject,
      lastCommitBody: lastCommit.body,
    });
  }

  private async onSearchMembers(requestId: number, query: string): Promise<void> {
    if (!this.context) {
      return;
    }
    const members = await this.service.searchMembers(query).catch(() => []);
    this.send({ type: 'members', requestId, query, members });
  }

  private async onCreate(options: CreateRequest): Promise<void> {
    if (this.busy) {
      return;
    }
    const context = this.context;
    if (!context) {
      this.send({ type: 'createError', message: '仓库信息尚未加载完成，请刷新后重试。' });
      return;
    }
    if (options.sourceBranch === options.targetBranch) {
      this.send({ type: 'createError', message: '源分支和目标分支不能相同。' });
      return;
    }

    this.busy = true;
    this.send({
      type: 'log',
      message: `开始创建「${options.title}」：${options.sourceBranch} → ${options.targetBranch}`,
      level: 'step',
    });

    try {
      const existing = await this.service
        .checkExisting(options.sourceBranch, options.targetBranch)
        .catch(() => null);
      if (existing) {
        throw new Error(`该分支已存在打开的合并请求：${existing.url}`);
      }

      const result: CreateResult = await this.service.create(
        {
          sourceBranch: options.sourceBranch,
          targetBranch: options.targetBranch,
          title: options.title,
          description: options.description,
          assignee: options.assignee,
          reviewers: options.reviewers,
          removeSource: options.removeSource,
          draft: options.draft,
          squash: options.squash,
        },
        {
          log: (message, level) => {
            this.send({ type: 'log', message, level: level ?? 'info' });
          },
          progress: (key: string, status: ProgressStatus, detail?: string) => {
            this.send({ type: 'progress', key, status, detail });
          },
        },
      );

      this.send({ type: 'result', result });

      if (result.created) {
        void this.savePreferences(options);
        updateStatusBar(
          { iid: parseIid(result.url), title: options.title, url: result.url },
          context.platform,
        );
        notifyMrCreated({
          projectPath: context.projectPath,
          title: options.title,
          sourceBranch: options.sourceBranch,
          targetBranch: options.targetBranch,
          url: result.url,
        });
      }

      if (result.via === 'web') {
        await this.onOpenExternal(result.url);
      }
    } catch (error) {
      this.send({ type: 'createError', message: toMessage(error) });
    } finally {
      this.busy = false;
    }
  }

  private prefKey(): string {
    return `mrTool.lastForm.${this.cwd}`;
  }

  private readPreferences(): SavedForm | null {
    return this.memento.get<SavedForm>(this.prefKey()) ?? null;
  }

  private async savePreferences(options: CreateRequest): Promise<void> {
    const saved: SavedForm = {
      target: options.targetBranch,
      assignee: options.assignee,
      reviewers: options.reviewers,
      removeSource: options.removeSource,
      draft: options.draft,
      squash: options.squash,
    };
    try {
      await this.memento.update(this.prefKey(), saved);
    } catch {
      // 记住上次选择失败不影响主流程。
    }
  }

  private async onSwitchBranch(rawBranch: string): Promise<void> {
    const branch = rawBranch.trim();
    if (!branch || branch.length > 255 || /[\s]/.test(branch)) {
      this.send({ type: 'branchSwitchFailed', message: '分支名无效。' });
      return;
    }

    const result = await this.service.checkout(branch).catch((error: unknown) => ({
      ok: false,
      message: toMessage(error),
    }));

    if (result.ok) {
      this.send({ type: 'branchSwitched', branch });
    } else {
      this.send({ type: 'branchSwitchFailed', message: result.message });
    }
  }

  private async onOpenExternal(rawUrl: string): Promise<void> {
    const url = rawUrl.trim().slice(0, 4000);
    if (!url) {
      return;
    }

    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(url, true);
    } catch {
      return;
    }

    if (uri.scheme !== 'http' && uri.scheme !== 'https') {
      return;
    }
    await vscode.env.openExternal(uri);
  }
}

function parseCreateRequest(value: unknown): CreateRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceBranch = str(value.sourceBranch).trim();
  const targetBranch = str(value.targetBranch).trim();
  const title = str(value.title).trim();
  const description = str(value.description);

  if (!sourceBranch || !targetBranch || !title) {
    return null;
  }
  if (sourceBranch.length > 255 || targetBranch.length > 255 || title.length > 255) {
    return null;
  }
  if (
    /[\r\n]/.test(sourceBranch) ||
    /[\r\n]/.test(targetBranch) ||
    /[\r\n]/.test(title)
  ) {
    return null;
  }

  const assignee = parseUsers(value.assignee)[0] ?? null;
  const reviewers = parseUsers(value.reviewers);

  return {
    sourceBranch,
    targetBranch,
    title,
    description: description.slice(0, 100_000),
    assignee,
    reviewers,
    removeSource: value.removeSource === true,
    draft: value.draft === true,
    squash: value.squash === true,
  };
}

function parseUsers(value: unknown): MrUser[] {
  const items = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const users: MrUser[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const username = str(item.username).trim();
    if (!username || username.length > 200 || seen.has(username)) {
      continue;
    }
    seen.add(username);
    const id = num(item.id, 0);
    users.push({
      username,
      name: str(item.name, username).slice(0, 200),
      id: id > 0 ? id : undefined,
    });
  }
  return users;
}

function parseIid(url: string): string {
  const match = url.match(/\/(?:merge_requests|pull)\/(\d+)/);
  return match ? match[1] : '';
}
