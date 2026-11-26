import { esc, icon, shortKey } from './icons.js';
import {
  banner,
  platformTerm,
  renderLogLines,
  sourceBranch,
  stepRow,
  toggle,
} from './ui.js';

export function renderHeader(context) {
  if (!context) {
    return '';
  }
  return (
    '<header class="hero">' +
    '<div class="hero-icon">' +
    icon('merge', 22) +
    '</div>' +
    '<div class="hero-main">' +
    '<div class="hero-title-row">' +
    '<h1>创建合并请求</h1>' +
    '<span class="platform-badge ' +
    esc(context.platform) +
    '">' +
    esc(context.platformLabel) +
    '</span>' +
    '</div>' +
    '<div class="hero-meta">' +
    '<span class="meta-item" title="' +
    esc(context.projectPath) +
    '">' +
    icon('repo', 13) +
    esc(context.repoName) +
    '</span>' +
    '<span class="meta-sep">·</span>' +
    '<span class="meta-item" title="当前分支">' +
    icon('branch', 13) +
    '<code>' +
    esc(context.currentBranch) +
    '</code>' +
    '</span>' +
    '</div>' +
    '</div>' +
    '<div class="hero-actions">' +
    '<button class="icon-btn" data-action="settings" title="打开设置" aria-label="打开设置">' +
    icon('settings', 16) +
    '</button>' +
    '<button class="icon-btn" data-action="refresh" title="刷新" aria-label="刷新">' +
    icon('refresh', 16) +
    '</button>' +
    '</div>' +
    '</header>'
  );
}

export function renderLoading(loadingText) {
  return (
    '<div class="loading-screen">' +
    '<div class="loading-mark">' +
    icon('merge', 26) +
    '</div>' +
    '<div class="spinner large"></div>' +
    '<h2>正在读取仓库信息…</h2>' +
    '<p class="muted">' +
    esc(loadingText || '识别托管平台 · 同步远端分支 · 检查已有合并请求') +
    '</p>' +
    '</div>'
  );
}

export function renderForm(state) {
  if (!state.context) {
    return renderLoading('');
  }
  return (
    '<div class="page">' +
    renderHeader(state.context) +
    '<div id="banner-area"></div>' +
    '<form class="card form-card" autocomplete="off">' +
    renderSourceField(state) +
    renderTargetField(state) +
    renderTitleField(state) +
    renderDescriptionField(state) +
    renderAssigneeField(state) +
    renderReviewerField(state) +
    renderOptionsField(state) +
    '</form>' +
    '<div id="status-area" class="status-area"></div>' +
    '</div>' +
    renderActionBar(state)
  );
}

function renderSourceField(state) {
  return (
    '<div class="field">' +
    '<div class="field-row"><label for="source-input">源分支</label>' +
    '<span class="field-hint">默认当前检出的分支</span></div>' +
    '<div class="combo" id="source-combo">' +
    '<div class="input-wrap">' +
    '<span class="input-icon">' +
    icon('branch', 15) +
    '</span>' +
    '<input id="source-input" class="input has-icon has-affix" value="' +
    esc(state.source) +
    '" placeholder="选择或输入源分支" autocomplete="off" spellcheck="false" aria-expanded="false" />' +
    '<button type="button" class="input-affix chevron-btn" id="source-toggle" tabindex="-1" aria-label="展开源分支列表">' +
    icon('chevron', 14) +
    '</button>' +
    '</div>' +
    '<div class="popover" id="source-popover" hidden>' +
    '<div class="popover-input">' +
    icon('search', 14) +
    '<input id="source-filter" placeholder="筛选分支…" autocomplete="off" spellcheck="false" />' +
    '</div>' +
    '<div class="popover-list" id="source-list" role="listbox"></div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderTargetField(state) {
  return (
    '<div class="field">' +
    '<div class="field-row"><label for="target-input">目标分支</label>' +
    '<span class="field-hint">合并目标</span></div>' +
    '<div class="combo" id="target-combo">' +
    '<div class="input-wrap">' +
    '<span class="input-icon">' +
    icon('branch', 15) +
    '</span>' +
    '<input id="target-input" class="input has-icon has-affix" value="' +
    esc(state.target) +
    '" placeholder="选择或输入目标分支" autocomplete="off" spellcheck="false" aria-expanded="false" />' +
    '<button type="button" class="input-affix chevron-btn" id="target-toggle" tabindex="-1" aria-label="展开分支列表">' +
    icon('chevron', 14) +
    '</button>' +
    '</div>' +
    '<div class="popover" id="target-popover" hidden>' +
    '<div class="popover-input">' +
    icon('search', 14) +
    '<input id="target-filter" placeholder="筛选分支…" autocomplete="off" spellcheck="false" />' +
    '</div>' +
    '<div class="popover-list" id="target-list" role="listbox"></div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderTitleField(state) {
  return (
    '<div class="field">' +
    '<div class="field-row"><label for="title-input">标题</label>' +
    '<span class="field-hint" id="title-count">0/255</span></div>' +
    '<input id="title-input" class="input" maxlength="255" value="' +
    esc(state.title) +
    '" placeholder="简要描述这次变更" autocomplete="off" />' +
    '</div>'
  );
}

function renderDescriptionField(state) {
  const templates = (state.context && state.context.templates) || [];
  const templateSelect = templates.length
    ? '<select id="template-select" class="input template-select" title="使用仓库中的 MR / PR 模板">' +
      '<option value="">使用模板…</option>' +
      templates
        .map(function (template, index) {
          return '<option value="' + index + '">' + esc(template.name) + '</option>';
        })
        .join('') +
      '</select>'
    : '';
  return (
    '<div class="field">' +
    '<div class="field-row"><label for="desc-input">描述</label>' +
    '<div class="desc-tools">' +
    templateSelect +
    '<button type="button" class="link-btn" data-action="fill-desc">' +
    icon('sparkles', 13) +
    ' 用提交记录填充</button></div></div>' +
    '<textarea id="desc-input" class="input textarea" rows="6" placeholder="补充背景、改动点、测试情况…">' +
    esc(state.description) +
    '</textarea>' +
    '</div>'
  );
}

function renderAssigneeField(state) {
  const selected = state.assignee;
  return (
    '<div class="field">' +
    '<div class="field-row"><label for="assignee-input">Assignee</label>' +
    '<span class="field-hint">可选</span></div>' +
    '<div class="combo' +
    (selected ? ' has-value' : '') +
    '" id="assignee-combo">' +
    '<div class="input-wrap">' +
    '<span class="input-icon">' +
    icon('user', 15) +
    '</span>' +
    '<input id="assignee-input" class="input has-icon has-affix" readonly value="' +
    esc(selected ? selected.name || selected.username : '') +
    '" placeholder="不指定" title="' +
    esc(selected ? '@' + selected.username : '') +
    '" aria-expanded="false" />' +
    '<button type="button" class="input-affix clear-btn" id="assignee-clear" title="清除" aria-label="清除">' +
    icon('x', 13) +
    '</button>' +
    '<button type="button" class="input-affix chevron-btn" id="assignee-toggle" tabindex="-1" aria-label="展开成员列表">' +
    icon('chevron', 14) +
    '</button>' +
    '</div>' +
    '<div class="popover" id="assignee-popover" hidden>' +
    '<div class="popover-input">' +
    icon('search', 14) +
    '<input id="assignee-filter" placeholder="搜索成员姓名或用户名…" autocomplete="off" spellcheck="false" />' +
    '</div>' +
    '<div class="popover-list" id="assignee-list" role="listbox"></div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderReviewerField(state) {
  const selected = Array.isArray(state.reviewers) ? state.reviewers : [];
  const text = selected
    .map(function (user) {
      return user.name || user.username;
    })
    .join('、');
  return (
    '<div class="field">' +
    '<div class="field-row"><label for="reviewer-input">Reviewer</label>' +
    '<span class="field-hint">可多选</span></div>' +
    '<div class="combo' +
    (selected.length ? ' has-value' : '') +
    '" id="reviewer-combo">' +
    '<div class="input-wrap">' +
    '<span class="input-icon">' +
    icon('user', 15) +
    '</span>' +
    '<input id="reviewer-input" class="input has-icon has-affix" readonly value="' +
    esc(text) +
    '" placeholder="不指定" title="' +
    esc(
      selected
        .map(function (user) {
          return '@' + user.username;
        })
        .join(' '),
    ) +
    '" aria-expanded="false" />' +
    '<button type="button" class="input-affix clear-btn" id="reviewer-clear" title="清空" aria-label="清空">' +
    icon('x', 13) +
    '</button>' +
    '<button type="button" class="input-affix chevron-btn" id="reviewer-toggle" tabindex="-1" aria-label="展开成员列表">' +
    icon('chevron', 14) +
    '</button>' +
    '</div>' +
    '<div class="popover" id="reviewer-popover" hidden>' +
    '<div class="popover-input">' +
    icon('search', 14) +
    '<input id="reviewer-filter" placeholder="搜索成员姓名或用户名…" autocomplete="off" spellcheck="false" />' +
    '</div>' +
    '<div class="popover-list" id="reviewer-list" role="listbox"></div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderOptionsField(state) {
  const isGithub = state.context.platform === 'github';
  return (
    '<div class="field">' +
    '<label>选项</label>' +
    '<div class="toggles">' +
    toggle('opt-remove', '合并后删除源分支', state.removeSource, isGithub) +
    toggle('opt-draft', '创建为草稿', state.draft, false) +
    toggle('opt-squash', '压缩提交', state.squash, isGithub) +
    '</div>' +
    (isGithub
      ? '<div class="field-note">GitHub 不支持在创建 PR 时设置删除源分支 / 压缩提交，请在合并时选择。</div>'
      : '') +
    '</div>'
  );
}

export function renderActionBar(state) {
  return (
    '<div class="actionbar">' +
    '<div class="actionbar-inner">' +
    '<div class="action-main">' +
    '<div class="action-target" id="action-target"></div>' +
    '<div class="action-hint" id="action-hint"></div>' +
    '</div>' +
    '<button class="btn primary btn-create" id="create-btn" data-action="create" disabled>' +
    '<span>创建 ' +
    platformTerm(state.context) +
    '</span><kbd>' +
    shortKey() +
    '</kbd></button>' +
    '</div>' +
    '</div>'
  );
}

export function renderSubmitting(state) {
  const term = platformTerm(state.context);
  return (
    '<div class="page page-narrow">' +
    renderHeader(state.context) +
    '<div class="card progress-card">' +
    '<div class="spinner large"></div>' +
    '<h2>正在创建' +
    esc(term) +
    '…</h2>' +
    '<p class="muted">' +
    esc(sourceBranch(state)) +
    ' → ' +
    esc(state.submitted ? state.submitted.target : state.target) +
    '</p>' +
    '<div class="progress-track"><div class="progress-indeterminate"></div></div>' +
    '<div class="step-list">' +
    stepRow(state.progress, 'push', '同步源分支到远端') +
    stepRow(state.progress, 'create', '创建' + term) +
    '</div>' +
    '<pre class="log" id="progress-log">' +
    renderLogLines(state.logs) +
    '</pre>' +
    '</div>' +
    '</div>'
  );
}

export function renderResult(state) {
  const result = state.result;
  if (!result) {
    return renderCreateError(state);
  }
  const term = platformTerm(state.context);
  const success = result.created === true;
  const target = state.submitted ? state.submitted.target : state.target;
  const title = success ? term + ' 已创建' : '已打开网页创建';
  const url = result.url || '';

  return (
    '<div class="page page-narrow">' +
    renderHeader(state.context) +
    '<div class="card result-card ' +
    (success ? 'success' : 'warn') +
    '">' +
    '<div class="result-icon">' +
    icon(success ? 'check-circle' : 'info', 26) +
    '</div>' +
    '<h2>' +
    esc(title) +
    '</h2>' +
    '<p class="muted">' +
    esc(sourceBranch(state)) +
    ' → ' +
    esc(target) +
    '</p>' +
    (result.warning
      ? '<div class="result-warning">' + banner('warn', '', esc(result.warning)) + '</div>'
      : '') +
    (url
      ? '<div class="url-box"><code title="' +
        esc(url) +
        '">' +
        esc(url) +
        '</code>' +
        '<button class="icon-btn" data-action="copy" data-text="' +
        esc(url) +
        '" title="复制链接" aria-label="复制链接">' +
        icon('copy', 15) +
        '</button></div>'
      : '') +
    '<div class="result-actions">' +
    (url
      ? '<button class="btn primary" data-action="open" data-url="' +
        esc(url) +
        '">打开 ' +
        icon('external', 14) +
        '</button>'
      : '') +
    (url
      ? '<button class="btn secondary" data-action="copy" data-text="' +
        esc(url) +
        '">' +
        icon('copy', 14) +
        ' 复制链接</button>'
      : '') +
    (target && !state.switchedTo
      ? '<button class="btn ghost" data-action="switch" data-branch="' +
        esc(target) +
        '"' +
        (state.switching ? ' disabled' : '') +
        '>' +
        (state.switching ? '<span class="spinner tiny"></span>' : icon('branch', 14)) +
        ' 切换到 ' +
        esc(target) +
        '</button>'
      : '') +
    '<button class="btn ghost" data-action="back">返回</button>' +
    '</div>' +
    (state.switchedTo
      ? '<div class="ok-line">' + icon('check', 14) + ' 已切换到 ' + esc(state.switchedTo) + '</div>'
      : '') +
    (state.switchError
      ? '<div class="result-warning">' +
        banner('error', '切换分支失败', esc(state.switchError)) +
        '</div>'
      : '') +
    renderLogDetails(state) +
    '</div>' +
    '</div>'
  );
}

export function renderCreateError(state) {
  return (
    '<div class="page page-narrow">' +
    renderHeader(state.context) +
    '<div class="card result-card error">' +
    '<div class="result-icon">' +
    icon('x-circle', 26) +
    '</div>' +
    '<h2>创建失败</h2>' +
    '<div class="error-text">' +
    esc(state.createError || '未知错误') +
    '</div>' +
    '<div class="result-actions">' +
    '<button class="btn primary" data-action="retry">返回修改</button>' +
    '<button class="btn ghost" data-action="refresh">刷新仓库信息</button>' +
    '</div>' +
    renderLogDetails(state) +
    '</div>' +
    '</div>'
  );
}

export function renderLoadError(state) {
  return (
    '<div class="page page-narrow">' +
    '<div class="card result-card error">' +
    '<div class="result-icon">' +
    icon('x-circle', 26) +
    '</div>' +
    '<h2>无法加载仓库信息</h2>' +
    '<div class="error-text">' +
    esc(state.loadError || '未知错误') +
    '</div>' +
    '<div class="result-actions">' +
    '<button class="btn primary" data-action="refresh">重试</button>' +
    '<button class="btn ghost" data-action="settings">打开设置</button>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

export function renderLogDetails(state) {
  if (!state.logs.length) {
    return '';
  }
  return (
    '<details class="log-details"><summary>执行日志（' +
    state.logs.length +
    '）</summary><pre class="log">' +
    renderLogLines(state.logs) +
    '</pre></details>'
  );
}
