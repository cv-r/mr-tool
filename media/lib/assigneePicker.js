import { esc, icon } from './icons.js';
import { avatar } from './ui.js';
import { closeOtherPopovers, scrollActive } from './popover.js';

/**
 * 初始化成员选择器（Assignee / Reviewer 共用）。
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.vscode
 * @param {() => void} deps.persist
 * @param {() => void} deps.updateActionBar
 * @param {object} deps.ids combo/input/popover/filter/list/toggle/clear 的 DOM id
 * @param {() => Array<object>} deps.getSelected 当前选中的成员
 * @param {(users: Array<object>) => void} deps.setSelected 写回选中成员
 * @param {boolean} [deps.multiple] 是否多选
 * @param {() => Array<object>} deps.candidates 本地面板候选成员
 * @returns {() => void} 成员列表刷新函数，收到宿主的 members 消息时调用。
 */
export function setupMemberPicker(deps) {
  const { state, vscode, persist, updateActionBar, ids, getSelected, setSelected } = deps;
  const combo = document.getElementById(ids.combo);
  if (!combo) {
    return function () {};
  }

  const multiple = deps.multiple === true;
  const input = document.getElementById(ids.input);
  const popover = document.getElementById(ids.popover);
  const filter = document.getElementById(ids.filter);
  const list = document.getElementById(ids.list);
  const toggleButton = document.getElementById(ids.toggle);
  const clearButton = document.getElementById(ids.clear);

  if (!input || !popover || !filter || !list || !toggleButton || !clearButton) {
    return function () {};
  }

  let active = 0;
  let items = [];
  let searchTimer = null;

  const canSearch = Boolean(state.context && state.context.cliAvailable);

  function candidates() {
    return deps.candidates ? deps.candidates() : [];
  }

  function isSelected(user) {
    return getSelected().some(function (item) {
      return item && item.username === user.username;
    });
  }

  function matches(user, keyword) {
    if (!keyword) {
      return true;
    }
    return (
      String(user.username || '').toLowerCase().includes(keyword) ||
      String(user.name || '').toLowerCase().includes(keyword)
    );
  }

  function syncInput() {
    const selected = getSelected();
    input.value = selected
      .map(function (user) {
        return user.name || user.username;
      })
      .join('、');
    input.title = selected.length
      ? selected
          .map(function (user) {
            return '@' + user.username;
          })
          .join(' ')
      : '';
    combo.classList.toggle('has-value', selected.length > 0);
  }

  function open() {
    closeOtherPopovers(combo);
    filter.value = '';
    state.memberQuery = '';
    state.memberError = '';
    state.members = candidates();
    state.searching = false;
    active = 0;
    renderList('');
    popover.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(function () {
      filter.focus();
    });
  }

  function close() {
    popover.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function renderList(query) {
    if (!document.body.contains(list)) {
      return;
    }
    const keyword = String(query === undefined ? state.memberQuery : query)
      .trim()
      .toLowerCase();

    const seen = new Set();
    const source = [];
    const local = candidates();
    const remote = keyword ? state.members || [] : [];
    local.concat(remote).forEach(function (user) {
      if (!user || !user.username || seen.has(user.username) || !matches(user, keyword)) {
        return;
      }
      seen.add(user.username);
      source.push(user);
    });
    items = source;

    if (active >= items.length) {
      active = Math.max(0, items.length - 1);
    }

    const me = state.context && state.context.currentUser ? state.context.currentUser.username : '';
    let html = '';

    if (keyword && state.searching) {
      html +=
        '<div class="popover-loading"><span class="spinner small"></span> 搜索成员…</div>';
    }
    if (!canSearch && keyword) {
      html += '<div class="popover-note">未检测到 CLI，仅显示预设成员</div>';
    }
    if (state.memberError) {
      html += '<div class="popover-error">' + esc(state.memberError) + '</div>';
    }

    html +=
      '<div class="popover-option none-option" data-none="1">' +
      icon('user-x', 14) +
      '<span class="option-label">' +
      (multiple ? '清空选择' : '不指定') +
      '</span>' +
      (getSelected().length === 0 ? icon('check', 14) : '') +
      '</div>';

    html += items
      .map(function (user, index) {
        const selected = isSelected(user);
        return (
          '<div class="popover-option' +
          (index === active ? ' active' : '') +
          (selected ? ' selected' : '') +
          '" role="option" data-index="' +
          index +
          '" title="' +
          esc('@' + user.username) +
          '">' +
          avatar(user) +
          '<span class="option-label">' +
          esc(user.name || user.username) +
          (user.username === me ? '<span class="badge">我</span>' : '') +
          '</span>' +
          '<span class="option-user">@' +
          esc(user.username) +
          '</span>' +
          (selected ? icon('check', 14) : '') +
          '</div>'
        );
      })
      .join('');

    if (!items.length && !state.searching) {
      html += '<div class="popover-empty">未找到匹配成员<span>可以尝试用户名的一部分</span></div>';
    }

    list.innerHTML = html;
  }

  function choose(user) {
    if (!user) {
      setSelected([]);
      syncInput();
      close();
      input.focus();
      persist();
      updateActionBar();
      return;
    }

    if (multiple) {
      const selected = getSelected();
      const exists = selected.some(function (item) {
        return item.username === user.username;
      });
      setSelected(
        exists
          ? selected.filter(function (item) {
              return item.username !== user.username;
            })
          : selected.concat([user]),
      );
      syncInput();
      persist();
      updateActionBar();
      renderList(state.memberQuery);
      return;
    }

    setSelected([user]);
    syncInput();
    close();
    input.focus();
    persist();
    updateActionBar();
  }

  const refresh = function () {
    renderList(state.memberQuery);
  };

  input.addEventListener('click', open);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      open();
    }
  });
  input.addEventListener('blur', function () {
    setTimeout(function () {
      if (!combo.contains(document.activeElement)) {
        close();
      }
    }, 120);
  });

  toggleButton.addEventListener('mousedown', function (event) {
    event.preventDefault();
    if (popover.hidden) {
      open();
    } else {
      close();
    }
  });

  clearButton.addEventListener('mousedown', function (event) {
    event.preventDefault();
    event.stopPropagation();
    choose(null);
  });

  filter.addEventListener('input', function () {
    const keyword = filter.value.trim();
    state.memberQuery = keyword;
    state.memberError = '';
    active = 0;

    if (!keyword) {
      state.searching = false;
      state.members = candidates();
      renderList('');
      return;
    }

    if (!canSearch) {
      state.searching = false;
      renderList(keyword);
      return;
    }

    state.searching = true;
    renderList(keyword);

    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      const requestId = ++state.searchRequestId;
      vscode.postMessage({ type: 'searchMembers', requestId: requestId, query: keyword });
    }, 250);
  });

  filter.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(active + 1, Math.max(0, items.length - 1));
      renderList();
      scrollActive(list);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      renderList();
      scrollActive(list);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (items[active]) {
        choose(items[active]);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      input.focus();
    }
  });
  filter.addEventListener('blur', function () {
    setTimeout(function () {
      if (!combo.contains(document.activeElement)) {
        close();
      }
    }, 120);
  });

  list.addEventListener('mousedown', function (event) {
    event.preventDefault();
  });
  list.addEventListener('click', function (event) {
    const option = event.target.closest('.popover-option');
    if (!option) {
      return;
    }
    if (option.getAttribute('data-none') === '1') {
      choose(null);
      return;
    }
    const index = Number(option.getAttribute('data-index'));
    if (Number.isInteger(index) && items[index]) {
      choose(items[index]);
    }
  });

  syncInput();
  renderList();
  return refresh;
}
