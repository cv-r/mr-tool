const ICONS = {
  merge:
    '<circle cx="6" cy="4" r="1.6"/><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="7" r="1.6"/><path d="M6 5.6v4.8M7.6 7h2.8"/>',
  branch:
    '<circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><path d="M5 5v6M11 6.5c0 3-3 2.5-6 2.5"/>',
  repo: '<path d="M3 3.5h7.5a2 2 0 0 1 2 2V13H5a2 2 0 0 1-2-2z"/><path d="M5.5 10.5H12.5"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8V5.5h-2.7"/>',
  settings: {
    box: 24,
    body:
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  },
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/>',
  user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/>',
  'user-x':
    '<circle cx="6.5" cy="5.5" r="2.3"/><path d="M2.5 13.2c0-2.3 1.8-3.7 4-3.7 1 0 1.9.3 2.6.8"/><path d="M11 10l3 3M14 10l-3 3"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  'check-circle': '<circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.2l2 2 3.8-4"/>',
  alert: '<path d="M8 3.2L13.5 13H2.5z"/><path d="M8 6.8v3M8 11.6v.1"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 5.2v.1"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  'x-circle': '<circle cx="8" cy="8" r="6.2"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>',
  external:
    '<path d="M6.5 3.5H3.5v9h9v-3"/><path d="M9 3.5h3.5V7"/><path d="M12.5 3.5L7.8 8.2"/>',
  copy:
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.4"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  chevron: '<path d="M4 6.5L8 10l4-3.5"/>',
  commit: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v4.3M8 10.2v4.3"/>',
  file: '<path d="M4 2.5h5l3 3V13.5H4z"/><path d="M9 2.5v3h3"/>',
  sparkles:
    '<path d="M8 2.2l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/><path d="M12.4 10.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>',
  arrowRight: '<path d="M3 8h9M9 5l3 3-3 3"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.2 1.4"/>',
};

export function icon(name, size = 16) {
  const def = ICONS[name];
  const box = def && typeof def === 'object' && def.box ? def.box : 16;
  const body = def && typeof def === 'object' ? def.body : def || '';
  return (
    '<svg class="icon" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 ' +
    box +
    ' ' +
    box +
    '" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    body +
    '</svg>'
  );
}

export function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

export function highlight(text, query) {
  if (!query) {
    return esc(text);
  }
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) {
    return esc(text);
  }
  return (
    esc(text.slice(0, index)) +
    '<mark>' +
    esc(text.slice(index, index + query.length)) +
    '</mark>' +
    esc(text.slice(index + query.length))
  );
}

export function shortKey() {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘⏎' : 'Ctrl+⏎';
}
