import { request } from 'node:https';
import * as vscode from 'vscode';
import type { PlatformKind } from '../platforms/types';
import { isRecord, num, parseJson, str } from '../utils/json';
import { toMessage } from '../utils/text';

export type FeishuEvent = 'create' | 'merge' | 'manual';

export interface FeishuMention {
  /** 用户 open_id；"all" 表示 @所有人。 */
  id: string;
  name: string;
}

export interface FeishuConfig {
  webhook: string;
  /** 全局默认前缀，单独配置的前缀为空时使用。 */
  prefix: string;
  createPrefix: string;
  mergePrefix: string;
  manualPrefix: string;
  createTemplate: string;
  mergeTemplate: string;
  mentions: FeishuMention[];
}

export interface FeishuResult {
  ok: boolean;
  message: string;
}

export interface CreatedMrNotice {
  projectPath: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
}

export interface MergedMrNotice {
  projectPath: string;
  iid: string;
  title: string;
  url: string;
  kind: PlatformKind;
}

interface HttpResponse {
  status: number;
  body: string;
}

export const DEFAULT_CREATE_TEMPLATE =
  '【MR 已创建】{project}\n{title}\n{source} → {target}\n{url}';

export const DEFAULT_MERGE_TEMPLATE = '【MR 已合并】{project} {number}\n{title}\n{url}';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 4_000;
const PLACEHOLDER_PATTERN = /\{(project|title|url|source|target|iid|number|mentions)\}/g;
const MENTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** 读取飞书配置；未填写 Webhook 时返回 null。 */
export function readFeishuConfig(): FeishuConfig | null {
  const config = vscode.workspace.getConfiguration('mrTool');
  const webhook = str(config.get('feishuWebhook'), '').trim();
  if (!webhook) {
    return null;
  }
  return {
    webhook,
    prefix: str(config.get('feishuPrefix'), ''),
    createPrefix: str(config.get('feishuCreatePrefix'), ''),
    mergePrefix: str(config.get('feishuMergePrefix'), ''),
    manualPrefix: str(config.get('feishuManualPrefix'), ''),
    createTemplate: str(config.get('feishuCreateTemplate'), ''),
    mergeTemplate: str(config.get('feishuMergeTemplate'), ''),
    mentions: readMentions(config.get('feishuMentions')),
  };
}

/** 取某个场景的前缀：优先用该场景的前缀，未配置时回退到全局前缀。 */
export function resolvePrefix(config: FeishuConfig, event: FeishuEvent): string {
  const specific =
    event === 'create'
      ? config.createPrefix
      : event === 'merge'
        ? config.mergePrefix
        : config.manualPrefix;
  return specific || config.prefix;
}

/** 发送文本消息，正文会拼上调用方传入的前缀和 @ 列表。 */
export async function sendFeishuText(
  body: string,
  options: { prefix?: string; mentions?: FeishuMention[] } = {},
): Promise<FeishuResult> {
  const config = readFeishuConfig();
  if (!config) {
    return { ok: false, message: '未配置飞书 Webhook 地址（mrTool.feishuWebhook）。' };
  }

  const parsed = parseWebhook(config.webhook);
  if ('error' in parsed) {
    return { ok: false, message: parsed.error };
  }

  const mentionText = options.mentions?.length ? renderMentions(options.mentions) : '';
  const text = `${options.prefix ?? ''}${body}${mentionText ? `\n${mentionText}` : ''}`;
  if (!text.trim()) {
    return { ok: false, message: '消息内容为空。' };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: `消息内容过长（最多 ${MAX_TEXT_LENGTH} 字）。` };
  }

  try {
    const response = await postJson(parsed.url, { msg_type: 'text', content: { text } });
    return interpretResponse(response);
  } catch (error) {
    return { ok: false, message: `请求飞书失败：${toMessage(error)}` };
  }
}

/** MR 创建成功后自动通知；未配置或关闭时静默跳过。 */
export function notifyMrCreated(notice: CreatedMrNotice): void {
  if (!isEnabled('feishuNotifyOnCreate')) {
    return;
  }
  const config = readFeishuConfig();
  if (!config) {
    return;
  }
  const mentionsText = renderMentions(config.mentions);
  const template = config.createTemplate || DEFAULT_CREATE_TEMPLATE;
  const body = finalizeMentions(
    renderTemplate(template, {
      project: notice.projectPath,
      title: notice.title,
      source: notice.sourceBranch,
      target: notice.targetBranch,
      url: notice.url,
      mentions: mentionsText,
    }),
    mentionsText,
    template.includes('{mentions}'),
  );
  notifyQuietly(body, resolvePrefix(config, 'create'));
}

/** MR 合并成功后自动通知；未配置或关闭时静默跳过。 */
export function notifyMrMerged(notice: MergedMrNotice): void {
  if (!isEnabled('feishuNotifyOnMerge')) {
    return;
  }
  const config = readFeishuConfig();
  if (!config) {
    return;
  }
  const sigil = notice.kind === 'github' ? '#' : '!';
  const mentionsText = renderMentions(config.mentions);
  const template = config.mergeTemplate || DEFAULT_MERGE_TEMPLATE;
  const body = finalizeMentions(
    renderTemplate(template, {
      project: notice.projectPath,
      iid: notice.iid,
      number: `${sigil}${notice.iid}`,
      title: notice.title,
      url: notice.url,
      mentions: mentionsText,
    }),
    mentionsText,
    template.includes('{mentions}'),
  );
  notifyQuietly(body, resolvePrefix(config, 'merge'));
}

/** 用已知占位符替换模板，未知占位符原样保留。 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\r\n/g, '\n')
    .replace(PLACEHOLDER_PATTERN, (match, key: string) => values[key] ?? match)
    .trim();
}

/** 模板里没写 {mentions} 时，把 @ 列表追加到消息末尾。 */
function finalizeMentions(rendered: string, mentionsText: string, inline: boolean): string {
  if (!mentionsText || inline) {
    return rendered;
  }
  return `${rendered}\n${mentionsText}`;
}

/** 生成飞书文本消息里的 <at> 标签。 */
export function renderMentions(mentions: FeishuMention[]): string {
  return mentions
    .map(
      (mention) =>
        `<at user_id="${escapeMarkup(mention.id)}">${escapeMarkup(mention.name)}</at>`,
    )
    .join(' ');
}

function readMentions(value: unknown): FeishuMention[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const mentions: FeishuMention[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const raw = str(item.id).trim();
    const id = raw.toLowerCase() === 'all' ? 'all' : raw;
    if (!MENTION_ID_PATTERN.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = str(item.name).trim().slice(0, 64) || (id === 'all' ? '所有人' : id);
    mentions.push({ id, name });
  }
  return mentions;
}

function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEnabled(key: 'feishuNotifyOnCreate' | 'feishuNotifyOnMerge'): boolean {
  return vscode.workspace.getConfiguration('mrTool').get<boolean>(key, true);
}

function notifyQuietly(body: string, prefix: string): void {
  void sendFeishuText(body, { prefix }).then((result) => {
    if (!result.ok) {
      void vscode.window.showWarningMessage(`飞书通知发送失败：${result.message}`);
    }
  });
}

function parseWebhook(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: '飞书 Webhook 地址不是合法的 URL。' };
  }
  if (url.protocol !== 'https:') {
    return { error: '飞书 Webhook 地址必须以 https:// 开头。' };
  }
  return { url };
}

function postJson(url: URL, payload: unknown): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = request(
      {
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size < MAX_RESPONSE_BYTES) {
            chunks.push(chunk);
            size += chunk.length;
          }
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end(data);
  });
}

/** 飞书成功响应为 code:0（新版）或 StatusCode:0（旧版）。 */
function interpretResponse(response: HttpResponse): FeishuResult {
  const payload = parseJson(response.body);
  const httpOk = response.status >= 200 && response.status < 300;

  if (!isRecord(payload)) {
    return httpOk
      ? { ok: true, message: '已发送。' }
      : { ok: false, message: `飞书返回 HTTP ${response.status}` };
  }

  const code = num(payload.code, num(payload.StatusCode, httpOk ? 0 : -1));
  const detail = str(payload.msg, str(payload.StatusMessage, ''));
  if (code === 0) {
    return { ok: true, message: '已发送。' };
  }

  const reason = detail ? `：${detail}` : '';
  if (!httpOk) {
    return { ok: false, message: `飞书返回 HTTP ${response.status}${reason}` };
  }
  return { ok: false, message: `飞书返回错误（code ${code}）${reason}` };
}
