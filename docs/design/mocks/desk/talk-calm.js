// Talk, calmer: popovers, how a message is sent, and Details. The ?pop= and ?details= parameters click the same buttons a person would.
const $ = (selector, root = document) => root.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const triggers = all('[data-pop]');
const popOf = (button) => document.getElementById(button.getAttribute('aria-controls'));
const comp = $('.cx-comp');
const field = $('#msg');
const cx = $('.cx');
const phone = matchMedia('(max-width: 899px)');
const CHIP = { delegate: 'Delegate: runs in the background', repeat: 'Repeat: you pick when' };

// While a menu from the session rail is open, the list behind it is inert: nothing under the menu can be reached, as with a modal menu.
function syncBehind() {
  const railMenu = ['m-filters', 'm-more'].some((id) => !document.getElementById(id).hidden);
  $('.cx-list').inert = railMenu;
}

function closeAll(except) {
  for (const button of triggers) {
    if (button === except || button.getAttribute('aria-expanded') !== 'true') continue;
    button.setAttribute('aria-expanded', 'false');
    popOf(button).hidden = true;
  }
  syncBehind();
}

function setIntent(value) {
  comp.dataset.intent = value;
  for (const item of all('[data-intent-value]')) item.setAttribute('aria-pressed', String(item.dataset.intentValue === value));
  if (CHIP[value]) $('#chip-text').textContent = CHIP[value];
}

function toggleDetails() {
  if (phone.matches) {
    document.body.dataset.sheet = 'details';
    return;
  }
  const open = cx.dataset.details !== 'open';
  cx.dataset.details = open ? 'open' : 'closed';
  for (const button of all('[data-details-toggle]')) button.setAttribute('aria-expanded', String(open));
}

function countFilters() {
  const on = all('#m-filters [role="switch"][aria-checked="true"]').length;
  const badge = $('#filter-count');
  badge.textContent = String(on);
  badge.hidden = on === 0;
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-pop]');
  if (trigger) {
    const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
    closeAll();
    if (!wasOpen) {
      trigger.setAttribute('aria-expanded', 'true');
      popOf(trigger).hidden = false;
      syncBehind();
    }
    return;
  }
  const choice = event.target.closest('[data-intent-value]');
  if (choice) {
    setIntent(choice.dataset.intentValue);
    closeAll();
    $('[aria-controls="m-intent"]').focus();
    return;
  }
  if (event.target.closest('[data-intent-reset]')) return setIntent('ask');
  if (event.target.closest('[data-details-toggle]')) return toggleDetails();
  const toggle = event.target.closest('.cx-pop [role="switch"]');
  if (toggle) {
    toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true'));
    countFilters();
    return;
  }
  if (!event.target.closest('.cx-pop')) closeAll();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const open = triggers.find((button) => button.getAttribute('aria-expanded') === 'true');
  if (!open) return;
  closeAll();
  open.focus();
});

field.addEventListener('input', () => {
  comp.dataset.empty = String(field.value.trim() === '');
  field.style.blockSize = 'auto';
  field.style.blockSize = `${Math.min(field.scrollHeight, 160)}px`;
});

const thread = $('.cx-thread');
thread.scrollTop = thread.scrollHeight;

const q = new URLSearchParams(location.search);
if (q.has('typed')) {
  field.value = q.get('typed');
  field.dispatchEvent(new Event('input'));
}
if (q.has('pop')) $(`[data-pop="${q.get('pop')}"]`)?.click();
if (q.get('details') === 'open') toggleDetails();
