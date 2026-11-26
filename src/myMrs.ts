import * as vscode from 'vscode';
import type {
  AssignedMr,
  MergeMethod,
  MergeResult,
  PlatformKind,
  PlatformProvider,
} from './platforms/types';
import { firstLine, toMessage } from './utils/text';

export type MyMrNode =
  | { kind: 'project'; project: string; mrs: AssignedMr[] }
  | { kind: 'mr'; mr: AssignedMr }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

export type MyMrsMode = 'assigned' | 'review' | 'created';

export class MyMrsProvider implements vscode.TreeDataProvider<MyMrNode> {
  private readonly emitter = new vscode.EventEmitter<MyMrNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private roots: MyMrNode[] = [];
  private provider: PlatformProvider | null = null;
  private loading = false;
  private error = '';

  constructor(
    private readonly resolve: () => Promise<PlatformProvider>,
    readonly mode: MyMrsMode = 'assigned',
  ) {}

  get kind(): PlatformKind | null {
    return this.provider ? this.provider.kind : null;
  }

  refresh(): void {
    void this.load();
  }

  merge(mr: AssignedMr, method: MergeMethod): Promise<MergeResult> {
    return this.withProvider((provider) => provider.mergeMr(mr, method));
  }

  approve(mr: AssignedMr): Promise<MergeResult> {
    return this.withProvider((provider) => provider.approveMr(mr));
  }

  markReady(mr: AssignedMr): Promise<MergeResult> {
    return this.withProvider((provider) => provider.markReady(mr));
  }

  close(mr: AssignedMr): Promise<MergeResult> {
    return this.withProvider((provider) => provider.closeMr(mr));
  }

  checkout(mr: AssignedMr): Promise<MergeResult> {
    return this.withProvider((provider) => provider.checkoutMr(mr));
  }

  getTreeItem(node: MyMrNode): vscode.TreeItem {
    if (node.kind === 'project') {
      const item = new vscode.TreeItem(node.project, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `${this.mode}:project:${node.project}`;
      item.description = String(node.mrs.length);
      item.iconPath = new vscode.ThemeIcon('repo');
      item.contextValue = 'project';
      item.tooltip = `${node.project} · ${node.mrs.length} 个合并请求`;
      return item;
    }

    if (node.kind === 'mr') {
      const mr = node.mr;
      const prefix = this.provider?.kind === 'github' ? '#' : '!';
      const branchInfo =
        mr.sourceBranch && mr.targetBranch
          ? ` · ${mr.sourceBranch} → ${mr.targetBranch}`
          : '';
      const status = mrStatus(mr);
      const item = new vscode.TreeItem(mr.title, vscode.TreeItemCollapsibleState.None);
      item.id = `${this.mode}:${mr.id}`;
      item.description = `${prefix}${mr.iid}${status.suffix}${branchInfo}`;
      item.iconPath = status.color
        ? new vscode.ThemeIcon(status.icon, new vscode.ThemeColor(status.color))
        : new vscode.ThemeIcon(status.icon);
      item.contextValue =
        this.mode === 'review' ? 'reviewMr' : this.mode === 'created' ? 'createdMr' : 'assignedMr';
      item.tooltip = [
        mr.title,
        `${mr.projectPath} ${prefix}${mr.iid}`,
        branchInfo ? branchInfo.replace(/^ · /, '') : '',
        mr.author ? `作者：${mr.author}` : '',
        mr.mergeStatus ? `状态：${mr.mergeStatus}` : '',
        status.tooltip,
        mr.updatedAt ? `更新：${formatTime(mr.updatedAt)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      item.command = { command: 'mrTool.openMr', title: '打开', arguments: [node] };
      return item;
    }

    if (node.kind === 'loading') {
      const item = new vscode.TreeItem(
        this.mode === 'review'
          ? '正在拉取待我评审的合并请求…'
          : this.mode === 'created'
            ? '正在拉取我发起的合并请求…'
            : '正在拉取分配给我的合并请求…',
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('sync~spin');
      return item;
    }

    const item = new vscode.TreeItem('拉取失败', vscode.TreeItemCollapsibleState.None);
    item.description = firstLine(node.message, 80);
    item.tooltip = node.message;
    item.iconPath = new vscode.ThemeIcon('warning');
    item.command = {
      command:
        this.mode === 'review'
          ? 'mrTool.refreshReviews'
          : this.mode === 'created'
            ? 'mrTool.refreshCreated'
            : 'mrTool.refreshMyMrs',
      title: '重试',
    };
    return item;
  }

  getChildren(node?: MyMrNode): MyMrNode[] {
    if (!node) {
      if (this.loading) {
        return [{ kind: 'loading' }];
      }
      if (this.error) {
        return [{ kind: 'error', message: this.error }];
      }
      return this.roots;
    }

    if (node.kind === 'project') {
      return node.mrs.map((mr) => ({ kind: 'mr' as const, mr }));
    }
    return [];
  }

  private async withProvider<T>(fn: (provider: PlatformProvider) => Promise<T>): Promise<T> {
    const provider = this.provider ?? (await this.resolve());
    this.provider = provider;
    return fn(provider);
  }

  private async load(): Promise<void> {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.error = '';
    this.roots = [];
    this.emitter.fire();

    try {
      const provider = await this.resolve();
      this.provider = provider;
      const items =
        this.mode === 'review'
          ? await provider.listReviewMrs()
          : this.mode === 'created'
            ? await provider.listCreatedMrs()
            : await provider.listAssignedMrs();

      const groups = new Map<string, AssignedMr[]>();
      for (const item of items) {
        const key = item.projectPath || '未知项目';
        const list = groups.get(key) ?? [];
        list.push(item);
        groups.set(key, list);
      }

      this.roots = Array.from(groups, ([project, mrs]) => ({
        kind: 'project' as const,
        project,
        mrs: mrs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      })).sort((a, b) => a.project.localeCompare(b.project));
    } catch (error) {
      this.error = toMessage(error);
      void vscode.window.showErrorMessage(`MR Tool：${this.error}`);
    } finally {
      this.loading = false;
      this.emitter.fire();
    }
  }
}

interface MrStatus {
  icon: string;
  color?: string;
  suffix: string;
  tooltip: string;
}

function mrStatus(mr: AssignedMr): MrStatus {
  if (mr.hasConflicts || mr.mergeable === 'no') {
    return {
      icon: 'warning',
      color: 'charts.orange',
      suffix: ' · 有冲突',
      tooltip: '合并：存在冲突，需要先解决',
    };
  }

  const checks =
    mr.checks === 'failed'
      ? { icon: 'error', color: 'charts.red', suffix: ' · 检查失败', text: '检查：流水线或 CI 未通过' }
      : mr.checks === 'running'
        ? { icon: 'sync~spin', suffix: ' · 检查中', text: '检查：正在进行中' }
        : mr.checks === 'success'
          ? { icon: 'pass', color: 'charts.green', suffix: ' · 检查通过', text: '检查：通过' }
          : { icon: 'git-pull-request', suffix: '', text: '' };

  if (checks.icon === 'git-pull-request' && mr.draft) {
    return {
      icon: 'git-pull-request-draft',
      suffix: checks.suffix,
      tooltip: [checks.text, '草稿：尚未标记为可评审'].filter(Boolean).join('\n'),
    };
  }

  return {
    icon: checks.icon,
    color: checks.color,
    suffix: checks.suffix,
    tooltip: [
      checks.text,
      mr.mergeable === 'yes' ? '合并：可以合并' : '',
      mr.reviewDecision ? `评审：${mr.reviewDecision}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
