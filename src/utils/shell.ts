import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';

export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

const MAX_OUTPUT = 10 * 1024 * 1024;

// 从 Dock/Spotlight 启动的 VS Code 通常拿不到 Homebrew 的 PATH，
// 这里补上常见目录，避免找不到 git / glab / gh。
const EXTRA_PATHS =
  process.platform === 'win32'
    ? []
    : ['/opt/homebrew/bin', '/usr/local/bin', `${homedir()}/.local/bin`];

function withExtraPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged = { ...env };
  const key =
    process.platform === 'win32'
      ? Object.keys(merged).find((name) => name.toLowerCase() === 'path') ?? 'Path'
      : 'PATH';
  const parts = (merged[key] ?? '').split(delimiter).filter(Boolean);
  for (const extra of EXTRA_PATHS) {
    if (!parts.includes(extra)) {
      parts.push(extra);
    }
  }
  merged[key] = parts.join(delimiter);
  return merged;
}

/**
 * 执行外部命令。永远不经过 shell，避免参数注入。
 * 返回统一结构，调用方自行决定如何处理非零退出码。
 */
export function run(file: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: withExtraPath(options.env ?? process.env),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ok: false, code: 1, stdout: '', stderr: (error as Error).message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: RunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        code: 124,
        stdout: stdout.trim(),
        stderr: `命令超时（${timeoutMs}ms）：${file}`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) {
        stderr += chunk.toString('utf8');
      }
    });
    child.on('error', (error) => {
      finish({ ok: false, code: 1, stdout: stdout.trim(), stderr: error.message });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    if (child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input ?? '');
    }
  });
}

const commandCache = new Map<string, Promise<boolean>>();

export function commandExists(command: string): Promise<boolean> {
  let cached = commandCache.get(command);
  if (!cached) {
    cached = run(command, ['--version'], { timeoutMs: 10_000 }).then((result) => result.ok);
    commandCache.set(command, cached);
  }
  return cached;
}
