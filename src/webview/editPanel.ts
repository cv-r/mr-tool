import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AssignedMr, MrContent, PlatformProvider } from '../platforms/types';
import { isRecord, str } from '../utils/json';
import { toMessage } from '../utils/text';

/** 编辑已有 MR / PR 的标题和描述。 */
export class MrEditPanel {
  static async open(
    provider: PlatformProvider,
    mr: AssignedMr,
    onSaved: () => void,
  ): Promise<void> {
    let content: MrContent;
    try {
      content = await provider.getMrContent(mr);
    } catch (error) {
      void vscode.window.showErrorMessage(`读取合并请求内容失败：${toMessage(error)}`);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'mrTool.edit',
      `编辑 ${sigil(mr)}${mr.iid}`,
      vscode.ViewColumn.Active,
      { enableScripts: true },
    );
    panel.webview.html = html(mr, content);

    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isRecord(raw)) {
        return;
      }
      const type = str(raw.type);
      if (type === 'cancel') {
        panel.dispose();
        return;
      }
      if (type !== 'save') {
        return;
      }

      const title = str(raw.title).trim();
      const description = str(raw.description);
      if (!title) {
        panel.webview.postMessage({ type: 'error', message: '标题不能为空。' });
        return;
      }
      if (title.length > 255) {
        panel.webview.postMessage({ type: 'error', message: '标题最多 255 个字符。' });
        return;
      }

      panel.webview.postMessage({ type: 'saving' });
      void provider
        .editMr(mr, { title, description: description.slice(0, 100_000) })
        .then((result) => {
          if (result.ok) {
            panel.dispose();
            void vscode.window.showInformationMessage(`已保存：${title}`);
            onSaved();
          } else {
            panel.webview.postMessage({ type: 'error', message: result.message });
          }
        })
        .catch((error: unknown) => {
          panel.webview.postMessage({
            type: 'error',
            message: `保存失败：${toMessage(error)}`,
          });
        });
    });
  }
}

function html(mr: AssignedMr, content: MrContent): string {
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>编辑合并请求</title>
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px 24px;
    }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 18px; }
    label { display: block; font-size: 12px; font-weight: 600; margin: 14px 0 6px; }
    input, textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      font: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      outline: none;
    }
    input:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
    textarea {
      min-height: 320px;
      resize: vertical;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      line-height: 1.5;
    }
    .actions { display: flex; gap: 10px; margin-top: 16px; }
    button {
      padding: 6px 16px;
      border-radius: 5px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font: inherit;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { opacity: 0.6; cursor: default; }
    .error { margin-top: 12px; color: var(--vscode-errorForeground); white-space: pre-wrap; }
    .hint { margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>编辑合并请求</h1>
  <p class="muted">${esc(mr.projectPath)} ${sigil(mr)}${esc(mr.iid)}</p>
  <label for="title">标题</label>
  <input id="title" maxlength="255" value="${esc(content.title)}" autocomplete="off">
  <label for="description">描述</label>
  <textarea id="description" spellcheck="false">${esc(content.description)}</textarea>
  <div class="hint">⌘/Ctrl + Enter 保存，Esc 取消</div>
  <div class="error" id="error" hidden></div>
  <div class="actions">
    <button id="save">保存</button>
    <button id="cancel" class="secondary">取消</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const titleEl = document.getElementById('title');
    const descEl = document.getElementById('description');
    const saveEl = document.getElementById('save');
    const cancelEl = document.getElementById('cancel');
    const errorEl = document.getElementById('error');

    function showError(message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }

    function submit() {
      const title = titleEl.value.trim();
      if (!title) {
        showError('标题不能为空。');
        titleEl.focus();
        return;
      }
      showError('');
      saveEl.disabled = true;
      cancelEl.disabled = true;
      vscode.postMessage({ type: 'save', title: title, description: descEl.value });
    }

    saveEl.addEventListener('click', submit);
    cancelEl.addEventListener('click', function () {
      vscode.postMessage({ type: 'cancel' });
    });
    window.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        vscode.postMessage({ type: 'cancel' });
      }
    });
    window.addEventListener('message', function (event) {
      const message = event.data || {};
      if (message.type === 'saving') {
        saveEl.textContent = '保存中…';
      } else if (message.type === 'error') {
        saveEl.disabled = false;
        cancelEl.disabled = false;
        saveEl.textContent = '保存';
        showError(String(message.message || '保存失败。'));
      }
    });
  </script>
</body>
</html>`;
}

function sigil(mr: AssignedMr): string {
  return /\/pull\//.test(mr.url) ? '#' : '!';
}

function esc(value: string): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch] ?? ch,
  );
}
