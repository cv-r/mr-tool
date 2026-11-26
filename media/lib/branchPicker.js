import { esc, highlight, icon } from './icons.js';
import { closeOtherPopovers, scrollActive } from './popover.js';

/**
 * 通用分支下拉选择器。
 *
 * deps:
 *   ids: { combo, input, popover, filter, list, toggle }
 *   getBranches: () => string[]
 *   getValue: () => string
 *   tags?: (branch: string) => string
 *   onChoose: (branch: string) => void
 */
export function setupBranchCombo(deps) {
  const { ids, getBranches, getValue, onChoose } = deps;
  const tags = deps.tags || function () {};
  const combo = document.getElementById(ids.combo);
  if (!combo) {
    return;
  }

  const input = combo.querySelector('#' + ids.input);
  const popover = combo.querySelector('#' + ids.popover);
  const filter = combo.querySelector('#' + ids.filter);
  const list = combo.querySelector('#' + ids.list);
  const toggleButton = combo.querySelector('#' + ids.toggle);

  let active = 0;
  let items = [];

  function open() {
    closeOtherPopovers(combo);
    filter.value = '';
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
    const keyword = String(query || '').trim().toLowerCase();
    items = getBranches().filter(function (branch) {
      return !keyword || branch.toLowerCase().includes(keyword);
    });

    if (!items.length) {
      active = 0;
      list.innerHTML =
        '<div class="popover-empty">没有匹配的分支<span>可以直接输入分支名</span></div>';
      return;
    }

    if (active >= items.length) {
      active = items.length - 1;
    }

    list.innerHTML = items
      .map(function (branch, index) {
        const tag = tags(branch);
        return (
          '<div class="popover-option' +
          (index === active ? ' active' : '') +
          '" role="option" data-value="' +
          esc(branch) +
          '" title="' +
          esc(branch) +
          '">' +
          icon('branch', 14) +
          '<span class="option-label">' +
          highlight(branch, keyword) +
          '</span>' +
          (tag ? '<span class="option-tag">' + esc(tag) + '</span>' : '') +
          '</div>'
        );
      })
      .join('');
  }

  function choose(value) {
    const next = String(value || '').trim();
    close();
    input.focus();
    if (!next) {
      return;
    }
    input.value = next;
    if (next === getValue()) {
      return;
    }
    onChoose(next);
  }

  input.addEventListener('click', open);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      close();
      input.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(input.value);
    } else if (event.key === 'ArrowDown') {
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

  filter.addEventListener('input', function () {
    active = 0;
    renderList(filter.value);
  });
  filter.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      renderList(filter.value);
      scrollActive(list);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      renderList(filter.value);
      scrollActive(list);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (items[active]) {
        choose(items[active]);
      } else if (filter.value.trim()) {
        choose(filter.value.trim());
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
    if (option) {
      choose(option.getAttribute('data-value') || '');
    }
  });
}
