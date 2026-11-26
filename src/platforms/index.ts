import * as vscode from 'vscode';
import type { RemoteInfo } from '../git';
import { commandExists, run } from '../utils/shell';
import { GitHubProvider } from './github';
import { GitLabProvider } from './gitlab';
import type { PlatformKind, PlatformProvider } from './types';

const authCache = new Map<string, Promise<boolean>>();

async function isLoggedIn(kind: PlatformKind, cwd: string): Promise<boolean> {
  const key = `${kind}:${cwd}`;
  let cached = authCache.get(key);
  if (!cached) {
    const cli = kind === 'gitlab' ? 'glab' : 'gh';
    cached = run(cli, ['auth', 'status'], { cwd, timeoutMs: 15_000 }).then((result) => result.ok);
    authCache.set(key, cached);
  }
  return cached;
}

export async function createProvider(
  remote: RemoteInfo,
  cwd: string,
): Promise<PlatformProvider> {
  const configured = vscode.workspace.getConfiguration('mrTool').get<string>('platform', 'auto');
  const host = remote.host.toLowerCase();

  let kind: PlatformKind;
  if (configured === 'gitlab' || configured === 'github') {
    kind = configured;
  } else if (host.includes('github')) {
    kind = 'github';
  } else if (host.includes('gitlab')) {
    kind = 'gitlab';
  } else {
    // 自建实例的域名通常不含平台名，优先选择已登录的 CLI。
    const [glabInstalled, ghInstalled] = await Promise.all([
      commandExists('glab'),
      commandExists('gh'),
    ]);
    if (glabInstalled && (await isLoggedIn('gitlab', cwd))) {
      kind = 'gitlab';
    } else if (ghInstalled && (await isLoggedIn('github', cwd))) {
      kind = 'github';
    } else if (glabInstalled) {
      kind = 'gitlab';
    } else if (ghInstalled) {
      kind = 'github';
    } else {
      kind = 'gitlab';
    }
  }

  const cliAvailable = await commandExists(kind === 'gitlab' ? 'glab' : 'gh');
  return kind === 'gitlab'
    ? new GitLabProvider(remote, cwd, cliAvailable)
    : new GitHubProvider(remote, cwd, cliAvailable);
}

export function clearAuthCache(): void {
  authCache.clear();
}
