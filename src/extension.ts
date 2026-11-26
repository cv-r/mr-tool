import * as vscode from 'vscode';
import { MyMrsProvider, type MyMrNode } from './myMrs';
import {
  notifyMrMerged,
  readFeishuConfig,
  resolvePrefix,
  sendFeishuText,
} from './notify/feishu';
import type {
  AssignedMr,
  MergeMethod,
  MergeResult,
  PlatformProvider,
} from './platforms/types';
import { resolveRepoContext, resolveRepoRoot } from './repo';
import { initStatusBar } from './statusBar';
import { toMessage } from './utils/text';
import { MrEditPanel } from './webview/editPanel';
import { MrPanel } from './webview/panel';

export function activate(context: vscode.ExtensionContext): void {
  const resolveProvider = async () => (await resolveRepoContext()).provider;
  const myMrs = new MyMrsProvider(resolveProvider, 'assigned');
  const myReviews = new MyMrsProvider(resolveProvider, 'review');
  const myCreated = new MyMrsProvider(resolveProvider, 'created');
  const refreshAll = (): void => {
    myMrs.refresh();
    myReviews.refresh();
    myCreated.refresh();
  };

  initStatusBar(context);

  context.subscriptions.push(
    vscode.window.createTreeView('mrTool.myMrs', {
      treeDataProvider: myMrs,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView('mrTool.myReviews', {
      treeDataProvider: myReviews,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView('mrTool.myCreated', {
      treeDataProvider: myCreated,
      showCollapseAll: false,
    }),
    vscode.commands.registerCommand('mrTool.create', () => openPanel(context)),
    vscode.commands.registerCommand('mrTool.refresh', () => MrPanel.refreshActive()),
    vscode.commands.registerCommand('mrTool.refreshMyMrs', () => myMrs.refresh()),
    vscode.commands.registerCommand('mrTool.refreshReviews', () => myReviews.refresh()),
    vscode.commands.registerCommand('mrTool.refreshCreated', () => myCreated.refresh()),
    vscode.commands.registerCommand('mrTool.editMr', (node: MyMrNode) =>
      editMr(node, refreshAll),
    ),
    vscode.commands.registerCommand('mrTool.openMr', (node: MyMrNode) => openMr(node)),
    vscode.commands.registerCommand('mrTool.mergeMr', (node: MyMrNode) =>
      mergeMr(node, myMrs),
    ),
    vscode.commands.registerCommand('mrTool.approveMr', (node: MyMrNode) =>
      runMrAction(node, '批准', '已批准', refreshAll, (mr, provider) =>
        provider.approveMr(mr),
      ),
    ),
    vscode.commands.registerCommand('mrTool.markReady', (node: MyMrNode) =>
      markReady(node, refreshAll),
    ),
    vscode.commands.registerCommand('mrTool.closeMr', (node: MyMrNode) =>
      closeMr(node, refreshAll),
    ),
    vscode.commands.registerCommand('mrTool.checkoutMr', (node: MyMrNode) =>
      runMrAction(node, '检出分支', '已检出到本地', refreshAll, (mr, provider) =>
        provider.checkoutMr(mr),
      ),
    ),
    vscode.commands.registerCommand('mrTool.copyMrLink', (node: MyMrNode) => copyMrLink(node)),
    vscode.commands.registerCommand('mrTool.sendFeishu', () => sendFeishuMessage()),
  );
}

export function deactivate(): void {
  // no-op
}

async function openPanel(context: vscode.ExtensionContext): Promise<void> {
  const cwd = await resolveRepoRoot();
  if (!cwd) {
    void vscode.window.showErrorMessage(
      'MR Tool：未找到 Git 仓库。请先打开一个 Git 项目，或确认当前工作区包含仓库。',
    );
    return;
  }
  await MrPanel.createOrShow(context.extensionUri, cwd, context.workspaceState);
}

function openMr(node: MyMrNode): void {
  if (node.kind !== 'mr') {
    return;
  }

  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(node.mr.url, true);
  } catch {
    return;
  }

  if (uri.scheme === 'http' || uri.scheme === 'https') {
    void vscode.env.openExternal(uri);
  }
}

function copyMrLink(node: MyMrNode): void {
  if (node.kind !== 'mr') {
    return;
  }
  void vscode.env.clipboard.writeText(node.mr.url);
  void vscode.window.showInformationMessage('已复制 MR 链接。');
}

async function sendFeishuMessage(): Promise<void> {
  const config = readFeishuConfig();
  if (!config) {
    const action = await vscode.window.showErrorMessage(
      'MR Tool：还没有配置飞书 Webhook 地址。',
      '去配置',
    );
    if (action === '去配置') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'mrTool.feishuWebhook',
      );
    }
    return;
  }

  const prefix = resolvePrefix(config, 'manual');
  const body = await vscode.window.showInputBox({
    title: '发送飞书通知',
    prompt: prefix ? `消息会自动加上前缀「${prefix}」` : '消息会发送到配置的飞书群',
    placeHolder: '例如：这个点应该可以填写工时了',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : '内容不能为空'),
  });
  if (!body || !body.trim()) {
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '正在发送飞书通知…',
      cancellable: false,
    },
    () => sendFeishuText(body, { prefix, mentions: config.mentions }),
  );

  if (result.ok) {
    void vscode.window.showInformationMessage('飞书通知已发送。');
  } else {
    void vscode.window.showErrorMessage(`飞书通知发送失败：${result.message}`);
  }
}

async function mergeMr(node: MyMrNode, provider: MyMrsProvider): Promise<void> {
  if (node.kind !== 'mr') {
    return;
  }

  const mr = node.mr;
  const kind = /\/pull\//.test(mr.url) ? 'github' : 'gitlab';
  const choices: Array<{ label: string; description?: string; value: MergeMethod }> =
    kind === 'github'
      ? [
          { label: '创建合并提交', description: '--merge', value: 'merge' },
          { label: '压缩合并', description: '--squash', value: 'squash' },
          { label: '变基合并', description: '--rebase', value: 'rebase' },
        ]
      : [
          { label: '合并', value: 'merge' },
          { label: '压缩后合并', value: 'squash' },
        ];

  const picked = await vscode.window.showQuickPick(choices, { placeHolder: '选择合并方式' });
  if (!picked) {
    return;
  }

  const prefix = kind === 'github' ? '#' : '!';
  const problems: string[] = [];
  if (mr.hasConflicts || mr.mergeable === 'no') {
    problems.push('存在合并冲突');
  }
  if (mr.checks === 'failed') {
    problems.push('CI / 流水线未通过');
  }
  const warning = problems.length ? `\n\n注意：${problems.join('，')}，合并可能失败。` : '';
  const action = problems.length ? '仍然合并' : '合并';

  const confirm = await vscode.window.showWarningMessage(
    `合并 ${mr.projectPath} ${prefix}${mr.iid}「${mr.title}」？${warning}`,
    { modal: true },
    action,
  );
  if (confirm !== action) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `正在合并 ${prefix}${mr.iid}…`,
      cancellable: false,
    },
    async () => {
      try {
        const result = await provider.merge(mr, picked.value);
        if (result.ok) {
          void vscode.window.showInformationMessage(`已合并：${mr.title}`);
          notifyMrMerged({
            projectPath: mr.projectPath,
            iid: mr.iid,
            title: mr.title,
            url: mr.url,
            kind,
          });
          provider.refresh();
        } else {
          void vscode.window.showErrorMessage(`合并失败：${result.message}`);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`合并失败：${toMessage(error)}`);
      }
    },
  );
}

async function editMr(node: MyMrNode, refresh: () => void): Promise<void> {
  if (node.kind !== 'mr') {
    return;
  }
  try {
    const { provider } = await resolveRepoContext();
    await MrEditPanel.open(provider, node.mr, refresh);
  } catch (error) {
    void vscode.window.showErrorMessage(`编辑失败：${toMessage(error)}`);
  }
}

async function runMrAction(
  node: MyMrNode,
  title: string,
  success: string,
  refresh: () => void,
  action: (mr: AssignedMr, provider: PlatformProvider) => Promise<MergeResult>,
): Promise<void> {
  if (node.kind !== 'mr') {
    return;
  }

  const mr = node.mr;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `正在${title} ${mrSigil(mr)}${mr.iid}…`,
      cancellable: false,
    },
    async () => {
      try {
        const { provider } = await resolveRepoContext();
        const result = await action(mr, provider);
        if (result.ok) {
          void vscode.window.showInformationMessage(`${success}：${mr.title}`);
          refresh();
        } else {
          void vscode.window.showErrorMessage(`${title}失败：${result.message}`);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`${title}失败：${toMessage(error)}`);
      }
    },
  );
}

async function markReady(node: MyMrNode, refresh: () => void): Promise<void> {
  if (node.kind !== 'mr') {
    return;
  }
  if (!node.mr.draft) {
    void vscode.window.showInformationMessage('该合并请求不是草稿状态。');
    return;
  }
  await runMrAction(node, '标记为可评审', '已标记为可评审', refresh, (mr, provider) =>
    provider.markReady(mr),
  );
}

async function closeMr(node: MyMrNode, refresh: () => void): Promise<void> {
  if (node.kind !== 'mr') {
    return;
  }
  const mr = node.mr;
  const confirm = await vscode.window.showWarningMessage(
    `关闭 ${mr.projectPath} ${mrSigil(mr)}${mr.iid}「${mr.title}」？`,
    { modal: true },
    '关闭',
  );
  if (confirm !== '关闭') {
    return;
  }
  await runMrAction(node, '关闭', '已关闭', refresh, (item, provider) =>
    provider.closeMr(item),
  );
}

function mrSigil(mr: AssignedMr): string {
  return /\/pull\//.test(mr.url) ? '#' : '!';
}
