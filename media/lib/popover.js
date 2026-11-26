export function closeOtherPopovers(except) {
  document.querySelectorAll('.combo').forEach(function (combo) {
    if (combo === except) {
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
}

export function scrollActive(list) {
  const active = list.querySelector('.popover-option.active');
  if (active) {
    active.scrollIntoView({ block: 'nearest' });
  }
}
