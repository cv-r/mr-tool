import * as vscode from 'vscode';
import type { OpenMr, PlatformKind } from './platforms/types';

let item: vscode.StatusBarItem | undefined;
let currentUrl = '';

export function initStatusBar(context: vscode.ExtensionContext): void {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  item.command = 'mrTool.statusBarClick';

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('mrTool.statusBarClick', () => {
      if (currentUrl) {
        void vscode.env.openExternal(vscode.Uri.parse(currentUrl));
      } else {
        void vscode.commands.executeCommand('mrTool.create');
      }
    }),
  );

  clearStatusBar();
}

/** 当前分支没有打开的 MR。 */
export function clearStatusBar(): void {
  if (!item) {
    return;
  }
  currentUrl = '';
  item.text = '$(git-pull-request) 创建 MR';
  item.tooltip = '当前分支没有打开的合并请求，点击创建';
  item.show();
}

export function updateStatusBar(mr: OpenMr | null, kind: PlatformKind): void {
  if (!item) {
    return;
  }
  if (!mr) {
    clearStatusBar();
    return;
  }
  const sigil = kind === 'github' ? '#' : '!';
  currentUrl = mr.url;
  item.text = `$(git-pull-request) ${sigil}${mr.iid} ${truncate(mr.title, 28)}`;
  item.tooltip = `${mr.title}\n${mr.url}\n点击在浏览器中打开`;
  item.show();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
