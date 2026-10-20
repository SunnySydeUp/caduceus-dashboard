// The Desk mocks: builds the shared shell, sigils and icons, and wires the few interactions (intent, tray, sheet).
// Serve docs/design over HTTP: modules do not load from file://.
import { icon } from '../../prototype/shared.js';

const q = new URLSearchParams(location.search);
for (const k of ['theme', 'motion']) if (q.has(k)) document.documentElement.dataset[k] = q.get(k);
if (q.has('sheet')) document.body.dataset.sheet = q.get('sheet');

// Mock data. Pattern = the four cells of the 2x2 sigil. State colour is never the only signal: ring + corner badge + text.
const CREW = [
  { id: 'coder', s: 'waiting', p: ['tl', 'e', 'e', 'br'], line: 'Wants to push feat/x', t: '2m' },
  { id: 'general', s: 'waiting', p: ['c', 'c', 'c', 'c'], line: 'Two plumber slots free', t: '9m' },
  { id: 'homeassistant', s: 'waiting', p: ['tl', 'tr', 'sq', 'sq'], line: 'Heating while you are away?', t: '6m' },
  { id: 'librarian', s: 'working', p: ['sq', 'sq', 'e', 'sq'], line: 'Reading source 9 of about 15', t: '11m' },
  { id: 'property', s: 'done', p: ['e', 'tr', 'sq', 'sq'], line: 'Lease letter is ready', t: '2m' },
];
// A page may say which agent is idle (the open thread's own agent often is), so the sidebar agrees with the thread header.
const idleAgent = CREW.find((c) => c.id === document.body.dataset.idle);
if (idleAgent) Object.assign(idleAgent, { s: 'idle', line: 'Replied 2 h ago', t: '2h' });
const BADGE = { waiting: 'waiting', working: 'running', done: 'succeeded', blocked: 'failed' };
const NAV = [
  { id: 'today', label: 'Today', icon: 'home', href: 'today.html', count: 3 },
  { id: 'talk', label: 'Talk', icon: 'chat', href: 'talk.html' },
  { id: 'work', label: 'Work', icon: 'work', href: 'work.html' },
];
const page = document.body.dataset.page;
const current = document.body.dataset.agent;
const sig = (a, size = '', state) => {
  const c = CREW.find((x) => x.id === a);
  return `<span class="sg ${size}" data-a="${a}" data-s="${state ?? c.s}" data-p="${c.p.join(' ')}"></span>`;
};
const navLink = (n) => `<a href="${n.href}"${n.id === page ? ' aria-current="page"' : ''}><span data-i="${n.icon}"></span>${n.label}${n.count ? `<span class="count">${n.count}</span>` : ''}</a>`;

document.querySelector('.app').insertAdjacentHTML('afterbegin', `<aside class="crew" aria-label="Crew">
  <div class="brand"><span>H</span>Hermes</div>
  <nav class="nav" aria-label="Primary">${NAV.map(navLink).join('')}</nav>
  <h2>Crew <span>5</span></h2>
  ${CREW.map((c) => `<a class="mate" href="talk.html"${c.id === current ? ' aria-current="true"' : ''}>${sig(c.id)}<span><b>${c.id}</b><small>${c.line}</small></span><span>${c.t}</span></a>`).join('')}
  <div class="spacer"></div>
  <nav class="nav" aria-label="Secondary"><a href="#"><span data-i="search"></span>Search<span class="mono faint" style="margin-inline-start:auto;font-size:12px">Cmd K</span></a><a href="#"><span data-i="sliders"></span>Control</a></nav>
</aside>`);
document.body.insertAdjacentHTML('beforeend', `<nav class="tabs" aria-label="Primary">${[...NAV, { id: 'more', label: 'More', icon: 'more', href: '#' }].map(navLink).join('')}</nav><div class="mockchip">Mock</div>`);

for (const el of document.querySelectorAll('[data-sg]')) {
  const [a, size, state] = el.dataset.sg.split(':');
  el.outerHTML = sig(a, size ? `sg--${size}` : '', state || undefined);
}
for (const el of document.querySelectorAll('.sg')) {
  const cells = el.dataset.p.split(' ').map((c) => `<i class="${c === 'sq' ? '' : c}"></i>`).join('');
  el.innerHTML = cells + (BADGE[el.dataset.s] ? `<b>${icon(BADGE[el.dataset.s])}</b>` : '');
  el.setAttribute('aria-hidden', 'true');
}
for (const el of document.querySelectorAll('[data-i]')) {
  const holder = Object.assign(document.createElement('span'), { innerHTML: String(icon(el.dataset.i)) });
  const svg = holder.firstElementChild;
  if (el.dataset.c) svg.classList.add(el.dataset.c);
  el.replaceWith(svg);
}

document.addEventListener('click', (e) => {
  const intent = e.target.closest('.intent button');
  if (intent) {
    const box = intent.closest('.composer');
    box.dataset.intent = intent.dataset.v;
    for (const b of box.querySelectorAll('.intent button')) b.setAttribute('aria-pressed', String(b === intent));
    return;
  }
  const tray = e.target.closest('.tray__btn');
  if (tray) { const t = tray.closest('.tray'); t.dataset.open = String(t.dataset.open !== 'true'); tray.setAttribute('aria-expanded', t.dataset.open); return; }
  const open = e.target.closest('[data-open]');
  if (open) { document.body.dataset.sheet = open.dataset.open; return; }
  if (e.target.closest('.scrim')) delete document.body.dataset.sheet;
});
if (q.get('tray') === 'open') { document.querySelector('.tray')?.setAttribute('data-open', 'true'); document.querySelector('.tray__btn')?.setAttribute('aria-expanded', 'true'); }
if (q.has('intent')) document.querySelector(`.intent button[data-v="${q.get('intent')}"]`)?.click();

// A thread opens at its newest message, like a real chat.
for (const th of document.querySelectorAll('.thread')) th.scrollTop = th.scrollHeight;
