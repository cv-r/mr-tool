import * as vscode from 'vscode';
import { Git, type RemoteInfo } from './git';
import { createProvider } from './platforms';
import type { PlatformProvider } from './platforms/types';

interface GitRepository {
  rootUri: vscode.Uri;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface RepoContext {
  cwd: string;
  git: Git;
  remote: RemoteInfo;
  provider: PlatformProvider;
}

export async function resolveRepoRoot(): Promise<string | null> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (gitExtension) {
    try {
      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }
      const repositories = gitExtension.exports.getAPI(1).repositories;

      if (repositories.length === 1) {
        return repositories[0].rootUri.fsPath;
      }

      if (repositories.length > 1) {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri) {
          const match = repositories.find(
            (repo) =>
              activeUri.path === repo.rootUri.path ||
              activeUri.path.startsWith(repo.rootUri.path.replace(/\/$/, '') + '/'),
          );
          if (match) {
            return match.rootUri.fsPath;
          }
        }

        const picked = await vscode.window.showQuickPick(
          repositories.map((repo) => ({ label: repo.rootUri.fsPath, repo })),
          { placeHolder: '选择 Git 仓库' },
        );
        return picked?.repo.rootUri.fsPath ?? null;
      }
    } catch {
      // Git 扩展不可用时回退到工作区目录。
    }
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  if (folders.length > 1) {
    const picked = await vscode.window.showWorkspaceFolderPick({
      placeHolder: '选择工作区',
    });
    return picked?.uri.fsPath ?? null;
  }
  return null;
}

/** 解析当前工作区的 Git 仓库与托管平台。 */
export async function resolveRepoContext(): Promise<RepoContext> {
  const cwd = await resolveRepoRoot();
  if (!cwd) {
    throw new Error('未找到 Git 仓库。请先打开一个 Git 项目。');
  }

  const git = new Git(cwd);
  if (!(await git.isRepo())) {
    throw new Error('当前目录不是 Git 仓库。');
  }

  const remote = await git.remoteInfo();
  if (!remote) {
    throw new Error('未找到 origin 远端仓库。');
  }

  const provider = await createProvider(remote, cwd);
  return { cwd, git, remote, provider };
}
