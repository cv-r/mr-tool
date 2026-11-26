import { esc } from './lib/icons.js';
import { autoGrow } from './lib/ui.js';
import { renderStatus } from './lib/status.js';
import { setupBranchCombo } from './lib/branchPicker.js';
import { setupMemberPicker } from './lib/assigneePicker.js';
import {
  renderCreateError,
  renderForm,
  renderLoadError,
  renderLoading,
  renderResult,
  renderSubmitting,
} from './lib/views.js';

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

// ============================================================
// 状态
// ============================================================
const state = {
  phase: 'loading', // loading | form | submitting | success | error | loadError
  context: null,
  source: '',
  target: '',
  lastSubject: '',
  lastBody: '',
  title: '',
  description: '',
  assignee: null,
  reviewers: [],
  removeSource: false,
  draft: false,
  squash: false,
  existing: null,
  checking: false,
  diff: null,
  diffLoading: false,
  members: [],
  memberQuery: '',
  searching: false,
  memberError: '',
  searchRequestId: 0,
  logs: [],
  progress: {},
  submitted: null,
  result: null,
  createError: '',
  loadError: '',
  switchedTo: '',
  switchError: '',
  switching: false,
  loadingText: '',
  hadSavedForm: false,
};

let toastTimer = null;
let memberListRenderers = [];

restoreForm();
render();
vscode.postMessage({ type: 'ready' });

// ============================================================
// 表单状态
// ============================================================
function restoreForm() {
  const saved = vscode.getState();
  if (!saved || !saved.form) {
    return;
  }
  const form = saved.form;
  state.hadSavedForm = true;
  state.source = typeof form.source === 'string' ? form.source : '';
  state.target = typeof form.target === 'string' ? form.target : '';
  state.lastSubject = '';
  state.lastBody = '';
  state.title = typeof form.title === 'string' ? form.title : '';
  state.description = typeof form.description === 'string' ? form.description : '';
  state.removeSource = form.removeSource === true;
  state.draft = form.draft === true;
  state.squash = form.squash === true;
  state.assignee = normalizeUser(form.assignee);
  state.reviewers = Array.isArray(form.reviewers)
    ? form.reviewers.map(normalizeUser).filter(Boolean)
    : [];
}

function normalizeUser(user) {
  if (!user || typeof user.username !== 'string') {
    return null;
  }
  return {
    username: user.username,
    name: String(user.name || user.username),
    id: typeof user.id === 'number' ? user.id : undefined,
  };
}

function applyPreferences(prefs) {
  if (!prefs || typeof prefs !== 'object') {
    return;
  }
  if (typeof prefs.target === 'string' && prefs.target && prefs.target !== state.source) {
    const branches = (state.context && state.context.branches) || [];
    if (!branches.length || branches.indexOf(prefs.target) >= 0) {
      state.target = prefs.target;
    }
  }
  const assignee = normalizeUser(prefs.assignee);
  if (assignee) {
    state.assignee = assignee;
  }
  if (Array.isArray(prefs.reviewers)) {
    state.reviewers = prefs.reviewers.map(normalizeUser).filter(Boolean);
  }
  if (typeof prefs.removeSource === 'boolean') {
    state.removeSource = prefs.removeSource;
  }
  if (typeof prefs.draft === 'boolean') {
    state.draft = prefs.draft;
  }
  if (typeof prefs.squash === 'boolean') {
    state.squash = prefs.squash;
  }
}

/** 从 feature/123-xxx 这类分支名里取 issue 编号。 */
function issueNumber(branch) {
  const match = String(branch || '').match(
    /(?:^|\/)(?:feat(?:ure)?|fix(?:es)?|bugfix|hotfix)\/[^/]*?(\d+)/i,
  );
  return match ? match[1] : '';
}

/** 自动补上 "Closes #123"，已存在则不重复添加。 */
function withIssueLink(body, branch) {
  const issue = issueNumber(branch);
  if (!issue) {
    return body;
  }
  const pattern = new RegExp('(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#?' + issue + '\\b', 'i');
  if (pattern.test(body)) {
    return body;
  }
  return (body ? body + '\n\n' : '') + 'Closes #' + issue;
}

function persist() {
  vscode.setState({
    form: {
      source: state.source,
      target: state.target,
      title: state.title,
      description: state.description,
      assignee: state.assignee,
      reviewers: state.reviewers,
      removeSource: state.removeSource,
      draft: state.draft,
      squash: state.squash,
    },
  });
}

function showToast(text) {
  if (!toastEl) {
    return;
  }
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.hidden = true;
  }, 1900);
}

// ============================================================
// 渲染
// ============================================================
function render() {
  memberListRenderers = [];
  switch (state.phase) {
    case 'loading':
      app.innerHTML = renderLoading(state.loadingText);
      break;
    case 'form':
      app.innerHTML = renderForm(state);
      break;
    case 'submitting':
      app.innerHTML = renderSubmitting(state);
      break;
    case 'success':
      app.innerHTML = renderResult(state);
      break;
    case 'error':
      app.innerHTML = renderCreateError(state);
      break;
    case 'loadError':
      app.innerHTML = renderLoadError(state);
      break;
    default:
      app.innerHTML = '';
  }
  afterRender();
}

function afterRender() {
  if (state.phase === 'form') {
    setupBranchCombo({
      ids: {
        combo: 'source-combo',
        input: 'source-input',
        popover: 'source-popover',
        filter: 'source-filter',
        list: 'source-list',
        toggle: 'source-toggle',
      },
      getBranches: function () {
        const context = state.context;
        if (!context) {
          return [];
        }
        return context.sourceBranches.filter(function (branch) {
          return branch !== state.target;
        });
      },
      getValue: function () {
        return state.source;
      },
      tags: function (branch) {
        const context = state.context;
        if (!context) {
          return '';
        }
        if (branch === context.currentBranch) {
          return '当前';
        }
        return context.localBranches.includes(branch) ? '' : '远端';
      },
      onChoose: chooseSource,
    });

    setupBranchCombo({
      ids: {
        combo: 'target-combo',
        input: 'target-input',
        popover: 'target-popover',
        filter: 'target-filter',
        list: 'target-list',
        toggle: 'target-toggle',
      },
      getBranches: function () {
        return state.context
          ? state.context.branches.filter(function (branch) {
              return branch !== state.source;
            })
          : [];
      },
      getValue: function () {
        return state.target;
      },
      onChoose: chooseTarget,
    });

    const assigneeRenderer = setupMemberPicker({
      state,
      vscode,
      persist,
      updateActionBar,
      ids: {
        combo: 'assignee-combo',
        input: 'assignee-input',
        popover: 'assignee-popover',
        filter: 'assignee-filter',
        list: 'assignee-list',
        toggle: 'assignee-toggle',
        clear: 'assignee-clear',
      },
      getSelected: function () {
        return state.assignee ? [state.assignee] : [];
      },
      setSelected: function (users) {
        state.assignee = users[0] || null;
      },
      candidates: assigneeCandidates,
    });

    const reviewerRenderer = setupMemberPicker({
      state,
      vscode,
      persist,
      updateActionBar,
      multiple: true,
      ids: {
        combo: 'reviewer-combo',
        input: 'reviewer-input',
        popover: 'reviewer-popover',
        filter: 'reviewer-filter',
        list: 'reviewer-list',
        toggle: 'reviewer-toggle',
        clear: 'reviewer-clear',
      },
      getSelected: function () {
        return state.reviewers;
      },
      setSelected: function (users) {
        state.reviewers = users;
      },
      candidates: reviewerCandidates,
    });

    memberListRenderers = [assigneeRenderer, reviewerRenderer];
    refreshStatus();
    const description = document.getElementById('desc-input');
    if (description) {
      autoGrow(description);
    }
    updateTitleCount();
    updateActionBar();
  } else if (state.phase === 'submitting') {
    scrollLogToBottom();
  }
}

function assigneeCandidates() {
  const defaults = (state.context && state.context.defaultAssignees) || [];
  const users = defaults.slice();
  const me = state.context && state.context.currentUser;
  if (me && !users.some(function (user) { return user.username === me.username; })) {
    users.unshift(me);
  }
  return users;
}

function reviewerCandidates() {
  return (state.context && state.context.defaultReviewers) || [];
}

function refreshStatus() {
  renderStatus(state, updateActionBar);
}

function scrollLogToBottom() {
  const log = document.getElementById('progress-log');
  if (log) {
    log.scrollTop = log.scrollHeight;
  }
}

// ============================================================
// 校验与操作栏
// ============================================================
function validateForm() {
  if (!state.context) {
    return '正在加载仓库信息…';
  }
  if (!state.source) {
    return '请选择源分支';
  }
  if (!state.target) {
    return '请选择目标分支';
  }
  if (state.source === state.target) {
    return '源分支和目标分支不能相同';
  }
  if (!state.title.trim()) {
    return '请填写 MR 标题';
  }
  if (state.existing) {
    return '该分支已存在打开的合并请求';
  }
  return '';
}

function updateActionBar() {
  const button = document.getElementById('create-btn');
  if (!button || !state.context) {
    return;
  }

  const targetEl = document.getElementById('action-target');
  if (targetEl) {
    targetEl.innerHTML =
      '合并 <code>' +
      esc(state.source || '—') +
      '</code> → <code>' +
      esc(state.target || '—') +
      '</code>';
  }

  const error = validateForm();
  let message = error;
  let disabled = Boolean(error);
  if (!error && state.checking) {
    disabled = true;
    message = '正在检查是否已有打开的合并请求…';
  }

  button.disabled = disabled;
  button.title = message || '';

  const hint = document.getElementById('action-hint');
  if (hint) {
    hint.textContent = message || '';
    hint.classList.toggle('error', Boolean(error));
  }
}

function updateTitleCount() {
  const el = document.getElementById('title-count');
  if (el) {
    el.textContent = state.title.length + '/255';
  }
}

// ============================================================
// 操作
// ============================================================
function refreshInspect() {
  if (!state.source || !state.target) {
    refreshStatus();
    return;
  }
  state.checking = true;
  state.diffLoading = true;
  refreshStatus();
  vscode.postMessage({ type: 'inspect', source: state.source, target: state.target });
}

function chooseSource(branch) {
  state.source = branch;
  if (state.target === branch) {
    const candidates = (state.context && state.context.branches) || [];
    const fallback = candidates.find(function (item) {
      return item !== branch;
    });
    state.target = fallback || '';
    const targetInput = document.getElementById('target-input');
    if (targetInput instanceof HTMLInputElement) {
      targetInput.value = state.target;
    }
  }
  persist();
  refreshInspect();
}

function chooseTarget(branch) {
  state.target = branch;
  persist();
  refreshInspect();
}

function syncFormStateFromDom() {
  const sourceEl = document.getElementById('source-input');
  if (sourceEl instanceof HTMLInputElement) {
    state.source = sourceEl.value.trim();
  }
  const targetEl = document.getElementById('target-input');
  if (targetEl instanceof HTMLInputElement) {
    state.target = targetEl.value.trim();
  }
  const titleEl = document.getElementById('title-input');
  if (titleEl instanceof HTMLInputElement) {
    state.title = titleEl.value.trim();
  }
  const descEl = document.getElementById('desc-input');
  if (descEl instanceof HTMLTextAreaElement) {
    state.description = descEl.value;
  }
}

function submitCreate() {
  if (state.phase !== 'form' || !state.context) {
    return;
  }
  syncFormStateFromDom();
  const error = validateForm();
  if (error) {
    showToast(error);
    updateActionBar();
    return;
  }

  state.submitted = {
    source: state.source,
    target: state.target,
    title: state.title,
  };
  state.phase = 'submitting';
  state.logs = [];
  state.progress = {};
  state.createError = '';
  state.result = null;
  state.switchError = '';
  state.switchedTo = '';
  state.switching = false;
  persist();
  render();

  vscode.postMessage({
    type: 'create',
    options: {
      sourceBranch: state.source,
      targetBranch: state.target,
      title: state.title,
      description: state.description,
      assignee: state.assignee,
      reviewers: state.reviewers,
      removeSource: state.removeSource,
      draft: state.draft,
      squash: state.squash,
    },
  });
}

function applyTemplate(indexText) {
  const templates = (state.context && state.context.templates) || [];
  const template = templates[Number(indexText)];
  if (!template) {
    return;
  }
  syncFormStateFromDom();
  const auto = !state.description || state.description === state.lastBody;
  state.description = auto ? template.content : state.description + '\n\n' + template.content;
  const el = document.getElementById('desc-input');
  if (el instanceof HTMLTextAreaElement) {
    el.value = state.description;
    autoGrow(el);
    el.focus();
  }
  persist();
  showToast('已应用模板：' + template.name);
}

function fillDescription() {
  if (!state.diff || !Array.isArray(state.diff.commits) || !state.diff.commits.length) {
    showToast('暂无提交记录可填充');
    return;
  }
  const lines = state.diff.commits.map(function (commit) {
    return '- ' + commit.subject + ' (' + commit.hash + ')';
  });
  const block = (state.description ? '\n\n' : '') + '## 变更内容\n\n' + lines.join('\n');
  state.description += block;
  const el = document.getElementById('desc-input');
  if (el) {
    el.value = state.description;
    autoGrow(el);
    el.focus();
  }
  persist();
  showToast('已填入 ' + state.diff.commits.length + ' 条提交');
}

function switchBranch(branch) {
  if (state.switching) {
    return;
  }
  state.switching = true;
  state.switchError = '';
  render();
  vscode.postMessage({ type: 'switchBranch', branch: branch });
}

function backToForm() {
  vscode.postMessage({ type: 'refresh' });
}

// ============================================================
// 事件
// ============================================================
app.addEventListener('submit', function (event) {
  event.preventDefault();
});

app.addEventListener('input', function (event) {
  const el = event.target;
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return;
  }
  if (el.id === 'title-input') {
    state.title = el.value;
    updateTitleCount();
    updateActionBar();
    persist();
  } else if (el.id === 'desc-input') {
    state.description = el.value;
    autoGrow(el);
    persist();
  }
});

app.addEventListener('change', function (event) {
  const el = event.target;
  if (el instanceof HTMLSelectElement) {
    if (el.id === 'template-select') {
      applyTemplate(el.value);
    }
    return;
  }
  if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') {
    return;
  }
  if (el.id === 'opt-remove') {
    state.removeSource = el.checked;
  } else if (el.id === 'opt-draft') {
    state.draft = el.checked;
  } else if (el.id === 'opt-squash') {
    state.squash = el.checked;
  }
  persist();
});

app.addEventListener('click', function (event) {
  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }
  const action = target.getAttribute('data-action');
  if (action === 'refresh') {
    vscode.postMessage({ type: 'refresh' });
  } else if (action === 'settings') {
    vscode.postMessage({ type: 'openSettings' });
  } else if (action === 'fill-desc') {
    fillDescription();
  } else if (action === 'create') {
    submitCreate();
  } else if (action === 'open') {
    const url = target.getAttribute('data-url') || '';
    if (url) {
      vscode.postMessage({ type: 'openExternal', url: url });
    }
  } else if (action === 'copy') {
    const text = target.getAttribute('data-text') || '';
    if (text) {
      vscode.postMessage({ type: 'copy', text: text });
      showToast('已复制到剪贴板');
    }
  } else if (action === 'switch') {
    switchBranch(target.getAttribute('data-branch') || '');
  } else if (action === 'back') {
    backToForm();
  } else if (action === 'retry') {
    state.phase = 'form';
    render();
  }
});

document.addEventListener('click', function (event) {
  document.querySelectorAll('.combo').forEach(function (combo) {
    if (combo.contains(event.target)) {
      return;
    }
    const popover = combo.querySelector('.popover');
    if (popover) {
      popover.hidden = true;
    }
    const input = combo.querySelector('input');
    if (input) {
      input.setAttribute('aria-expanded', 'false');
    }
  });
});

window.addEventListener('keydown', function (event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && state.phase === 'form') {
    event.preventDefault();
    submitCreate();
  }
});

// ============================================================
// 宿主消息
// ============================================================
window.addEventListener('message', function (event) {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  switch (message.type) {
    case 'loading':
      state.phase = 'loading';
      state.loadingText = '';
      render();
      break;

    case 'context':
      applyContext(message.payload);
      break;

    case 'inspect':
      if (
        state.phase !== 'form' ||
        message.source !== state.source ||
        message.target !== state.target
      ) {
        return;
      }
      state.checking = false;
      state.diffLoading = false;
      state.existing = message.existing || null;
      state.diff = message.diff || null;

      let changed = false;
      if (message.lastCommitSubject && (!state.title || state.title === state.lastSubject)) {
        state.title = String(message.lastCommitSubject);
        state.lastSubject = state.title;
        const titleInput = document.getElementById('title-input');
        if (titleInput instanceof HTMLInputElement) {
          titleInput.value = state.title;
        }
        updateTitleCount();
        changed = true;
      }

      const rawBody = typeof message.lastCommitBody === 'string' ? message.lastCommitBody : '';
      const nextBody = withIssueLink(rawBody, state.source);
      if (!state.description || state.description === state.lastBody) {
        state.description = nextBody;
        state.lastBody = nextBody;
        const descInput = document.getElementById('desc-input');
        if (descInput instanceof HTMLTextAreaElement) {
          descInput.value = nextBody;
          autoGrow(descInput);
        }
        changed = true;
      }

      if (changed) {
        persist();
      }
      refreshStatus();
      break;

    case 'members':
      if (message.requestId !== state.searchRequestId) {
        return;
      }
      state.searching = false;
      state.members = Array.isArray(message.members) ? message.members : [];
      memberListRenderers.forEach(function (renderer) {
        if (typeof renderer === 'function') {
          renderer();
        }
      });
      break;

    case 'log':
      state.logs.push({ message: String(message.message || ''), level: message.level || 'info' });
      if (state.phase === 'submitting') {
        render();
      }
      break;

    case 'progress':
      state.progress[String(message.key || '')] = {
        status: message.status || 'running',
        detail: message.detail || '',
      };
      if (state.phase === 'loading') {
        updateLoadingText(message);
      } else if (state.phase === 'submitting') {
        render();
      }
      break;

    case 'result':
      state.phase = 'success';
      state.result = message.result;
      state.switching = false;
      state.switchError = '';
      state.switchedTo = '';
      render();
      break;

    case 'createError':
      state.phase = 'error';
      state.createError = String(message.message || '未知错误');
      render();
      break;

    case 'loadError':
      state.phase = 'loadError';
      state.loadError = String(message.message || '未知错误');
      render();
      break;

    case 'branchSwitched':
      state.switching = false;
      state.switchedTo = String(message.branch || '');
      state.switchError = '';
      if (state.phase === 'success') {
        render();
      }
      break;

    case 'branchSwitchFailed':
      state.switching = false;
      state.switchError = String(message.message || '切换分支失败');
      if (state.phase === 'success') {
        render();
      }
      break;

    default:
      break;
  }
});

function applyContext(payload) {
  if (!payload || !payload.context) {
    return;
  }
  const context = payload.context;
  const firstLoad = !state.context;

  state.context = context;

  if (!state.source) {
    state.source = context.currentBranch || '';
  }
  if (!state.target) {
    state.target = context.defaultTarget || '';
  }
  const sourceIsCurrent = !state.source || state.source === context.currentBranch;
  if (!state.title && sourceIsCurrent) {
    state.title = context.lastCommitSubject || '';
    state.lastSubject = state.title;
  }
  if (!state.description && sourceIsCurrent) {
    state.description = withIssueLink(context.lastCommitBody || '', state.source);
    state.lastBody = state.description;
  }
  if (firstLoad && !state.hadSavedForm) {
    state.removeSource =
      context.platform !== 'github' &&
      String(context.currentBranch || '').indexOf('feature/') === 0;
    if (payload.preferences) {
      applyPreferences(payload.preferences);
    }
  }

  state.phase = 'form';
  state.loadingText = '';
  state.existing = null;
  state.diff = null;
  state.checking = false;
  state.diffLoading = false;
  state.logs = [];
  state.progress = {};
  state.createError = '';
  state.loadError = '';
  state.result = null;
  state.switchError = '';
  state.switchedTo = '';
  state.switching = false;

  const isInitial = state.source === context.currentBranch && state.target === context.defaultTarget;
  if (isInitial) {
    state.existing = payload.existingMr || null;
    state.diff = payload.diff || null;
  } else {
    state.checking = Boolean(state.source && state.target);
    state.diffLoading = Boolean(state.source && state.target);
  }

  render();

  if (!isInitial && state.source && state.target) {
    refreshInspect();
  }
}

function updateLoadingText(message) {
  if (message.key === 'platform' && message.status === 'running') {
    state.loadingText = '正在识别代码托管平台…';
  } else if (message.key === 'platform' && message.status === 'done') {
    state.loadingText = '已连接 ' + (message.detail || '') + '，正在同步远端分支…';
  } else if (message.key === 'fetch' && message.status === 'running') {
    state.loadingText = '正在同步远端分支（git fetch）…';
  } else if (message.key === 'fetch' && (message.status === 'done' || message.status === 'warn')) {
    state.loadingText = '分支已同步，正在检查已有合并请求…';
  }
  if (state.phase === 'loading') {
    render();
  }
}
