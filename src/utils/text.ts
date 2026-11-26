export function firstLine(text: string, max = 300): string {
  const line =
    text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function extractUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0].replace(/[)\].,;]+$/, '') : '';
}

/** 优先抓取真正的 MR / PR 地址，避免误取帮助文档链接。 */
export function extractMrUrl(text: string, kind: 'gitlab' | 'github'): string {
  const pattern =
    kind === 'gitlab'
      ? /https?:\/\/[^\s"'<>]+\/-\/merge_requests\/\d+/
      : /https?:\/\/[^\s"'<>]+\/pull\/\d+/;
  const match = text.match(pattern);
  return match ? match[0].replace(/[)\].,;]+$/, '') : extractUrl(text);
}

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
