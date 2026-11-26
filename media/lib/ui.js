import { esc, icon } from './icons.js';

export function platformTerm(context) {
  return context && context.platform === 'github' ? 'Pull Request' : 'Merge Request';
}

export function sourceBranch(state) {
  return (
    (state.submitted && state.submitted.source) ||
    state.source ||
    (state.context && state.context.currentBranch) ||
    ''
  );
}

export function banner(kind, title, text, actions) {
  const iconName = kind === 'error' ? 'x-circle' : kind === 'warn' ? 'alert' : 'info';
  return (
    '<div class="banner ' +
    kind +
    '">' +
    '<span class="banner-icon">' +
    icon(iconName, 16) +
    '</span>' +
    '<div class="banner-body">' +
    (title ? '<div class="banner-title">' + title + '</div>' : '') +
    (text ? '<div class="banner-text">' + text + '</div>' : '') +
    '</div>' +
    (actions ? '<div class="banner-actions">' + actions + '</div>' : '') +
    '</div>'
  );
}

export function avatar(user) {
  const source = String(user.name || user.username || '?').trim();
  const label = source.slice(0, 1).toUpperCase() || '?';
  let hash = 0;
  const key = user.username || source;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  // 用 class 控制色相，避免 CSP 拦截内联 style 属性。
  return '<span class="avatar hue-' + (hash % 8) + '">' + esc(label) + '</span>';
}

export function autoGrow(el) {
  if (!el) {
    return;
  }
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 360) + 'px';
}

export function toggle(id, label, checked, disabled) {
  return (
    '<label class="switch' +
    (disabled ? ' disabled' : '') +
    '">' +
    '<input type="checkbox" id="' +
    id +
    '"' +
    (checked ? ' checked' : '') +
    (disabled ? ' disabled' : '') +
    ' />' +
    '<span class="track"><span class="thumb"></span></span>' +
    '<span class="switch-label">' +
    esc(label) +
    '</span></label>'
  );
}

export function stepRow(progress, key, label) {
  const current = progress[key] || { status: 'pending' };
  const status = current.status || 'pending';
  let inner;
  if (status === 'running') {
    inner = '<span class="spinner tiny"></span>';
  } else if (status === 'done') {
    inner = icon('check', 13);
  } else if (status === 'warn') {
    inner = icon('alert', 13);
  } else if (status === 'error') {
    inner = icon('x', 13);
  } else {
    inner = '<span class="step-pending"></span>';
  }
  return (
    '<div class="step-row ' +
    status +
    '">' +
    '<span class="step-dot">' +
    inner +
    '</span>' +
    '<span class="step-label">' +
    esc(label) +
    '</span>' +
    (current.detail ? '<span class="step-detail">' + esc(current.detail) + '</span>' : '') +
    '</div>'
  );
}

export function renderLogLines(logs) {
  if (!logs.length) {
    return '等待输出…';
  }
  return logs
    .map(function (entry) {
      const level = ['info', 'success', 'warn', 'error', 'step'].includes(entry.level)
        ? entry.level
        : 'info';
      return '<span class="log-line l-' + level + '">' + esc(entry.message) + '</span>';
    })
    .join('\n');
}
