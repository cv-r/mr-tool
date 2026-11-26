import { esc, icon } from './icons.js';
import { banner, platformTerm } from './ui.js';

export function renderStatus(state, updateActionBar) {
  const area = document.getElementById('status-area');
  if (!area || !state.context) {
    return;
  }
  const context = state.context;
  let html = '';

  if (context.dirty) {
    html += banner('warn', '工作区有未提交的更改', '只有已提交的内容会出现在合并请求中。');
  }
  if (context.fetchWarning) {
    html += banner('warn', '远端同步失败', esc(context.fetchWarning));
  }
  if (!context.cliAvailable) {
    html += banner(
      'info',
      '未检测到 ' + esc(context.cliName) + ' CLI',
      '将直接打开 ' +
        esc(context.platformLabel) +
        ' 网页创建。安装并登录 ' +
        esc(context.cliName) +
        ' 后可一键创建。',
      '<button class="btn small ghost" data-action="settings">配置</button>',
    );
  }

  if (state.checking) {
    html +=
      '<div class="inline-status"><span class="spinner small"></span> 正在检查是否已有打开的 ' +
      esc(platformTerm(context)) +
      '…</div>';
  } else if (state.existing) {
    html += banner(
      'warn',
      '该分支已存在打开的 ' +
        esc(platformTerm(context)) +
        (state.existing.iid ? ' !' + esc(state.existing.iid) : ''),
      esc(state.existing.title || state.existing.url),
      '<button class="btn small ghost" data-action="open" data-url="' +
        esc(state.existing.url) +
        '">打开 ' +
        icon('external', 12) +
        '</button>',
    );
  }

  if (state.diffLoading) {
    html +=
      '<div class="inline-status"><span class="spinner small"></span> 正在计算与目标分支的差异…</div>';
  } else if (state.diff) {
    html += renderDiff(state.diff, state.target);
  } else if (state.target) {
    html += banner(
      'info',
      '无法计算差异',
      '目标分支 origin/' + esc(state.target) + ' 可能不存在，请确认分支名是否正确。',
    );
  }

  if (state.switchError) {
    html += banner('error', '切换分支失败', esc(state.switchError));
  }

  area.innerHTML = html;
  updateActionBar();
}

export function renderDiff(diff, target) {
  const commits = Array.isArray(diff.commits) ? diff.commits : [];
  return (
    '<div class="diff-card">' +
    '<div class="diff-stats">' +
    '<span class="stat">' +
    icon('commit', 13) +
    '<strong>' +
    diff.ahead +
    '</strong> 个提交</span>' +
    '<span class="stat">' +
    icon('file', 13) +
    '<strong>' +
    diff.files +
    '</strong> 个文件</span>' +
    '<span class="add">+' +
    diff.additions +
    '</span>' +
    '<span class="del">−' +
    diff.deletions +
    '</span>' +
    '</div>' +
    (diff.ahead === 0
      ? '<div class="diff-note">与 origin/' +
        esc(target) +
        ' 相比没有新提交，合并请求可能没有变更。</div>'
      : '') +
    (commits.length
      ? '<details class="commits"><summary>查看提交记录（' +
        commits.length +
        '）</summary><ul class="commit-list">' +
        commits
          .map(function (commit) {
            return (
              '<li class="commit-item">' +
              '<code class="commit-hash">' +
              esc(commit.hash) +
              '</code>' +
              '<span class="commit-subject" title="' +
              esc(commit.subject) +
              '">' +
              esc(commit.subject) +
              '</span>' +
              '<span class="commit-meta">' +
              esc(commit.author) +
              ' · ' +
              esc(commit.date) +
              '</span>' +
              '</li>'
            );
          })
          .join('') +
        '</ul></details>'
      : '') +
    '</div>'
  );
}
