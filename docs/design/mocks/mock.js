// Mock helper: builds the shared shell, then fills icons and presence avatars.
// Serve this folder over HTTP (modules do not load from file://).
import { icon } from '../prototype/shared.js';

const q = new URLSearchParams(location.search);
if (q.has('theme')) document.documentElement.dataset.theme = q.get('theme');
if (q.has('motion')) document.documentElement.dataset.motion = q.get('motion');
if (q.has('sheet')) document.body.dataset.sheet = q.get('sheet');

const NAV = [
  { id: 'agents', label: 'Agents', icon: 'agents', href: 'agents.html' },
  { id: 'chat', label: 'Chat', icon: 'chat', href: 'chat.html' },
  { id: 'work', label: 'Work', icon: 'work', href: 'work.html' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', href: '#', count: 5 },
];
// Mock data. The tip is what the agent is doing right now (one line), shown on hover or focus.
const AGENTS = [
  { id: 'coder', state: 'working', label: 'Running', tip: 'Running tests: pnpm vitest' },
  { id: 'general', state: 'idle', label: 'Idle', tip: 'Replied 2 h ago' },
  { id: 'homeassistant', state: 'waiting', label: 'Waiting for you', tip: 'Asked about the heating' },
  { id: 'librarian', state: 'working', label: 'Running', tip: 'Reading source 9 of 15' },
  { id: 'property', state: 'done', label: 'Finished', tip: 'Lease letter v2 is ready' },
];

const page = document.body.dataset.page;
const current = document.body.dataset.agent;
const link = (n, cls) => `<a class="${cls}" href="${n.href}"${n.id === page ? ' aria-current="page"' : ''}><span data-i="${n.icon}"></span><span>${n.label}</span>${n.count ? `<span class="count count--accent">${n.count}</span>` : ''}</a>`;
const agentLink = (a) => `<a class="sbar__agent${q.get('tip') === a.id ? ' show-tip' : ''}" href="chat.html"${a.id === current ? ' aria-current="page"' : ''} aria-label="${a.id}, ${a.label.toLowerCase()}"><span class="pa pa--md" data-agent="${a.id}" data-state="${a.state}"></span><span class="tip"><b>${a.id}</b><span>${a.tip}</span></span></a>`;

const shell = document.querySelector('.shell');
shell.insertAdjacentHTML('afterbegin', `<nav class="sbar" aria-label="Primary">
  <div class="sbar__brand" aria-hidden="true">H</div>
  <div class="sbar__nav">${NAV.map((n) => link(n, 'sbar__link')).join('')}</div>
  <div class="sbar__rule"></div>
  <div class="sbar__agents">${AGENTS.map(agentLink).join('')}</div>
  <div class="sbar__spacer"></div>
  <div class="sbar__nav"><a class="sbar__link" href="#"><span data-i="sliders"></span><span>Control</span></a></div>
</nav>`);
document.body.insertAdjacentHTML('beforeend', `<nav class="tabs" aria-label="Primary">${NAV.map((n) => link(n, '')).join('')}<a href="#"><span data-i="more"></span><span>More</span></a></nav><div class="mockchip">Mock</div>`);

const STATE_ICON = { working: 'running', waiting: 'waiting', done: 'succeeded', blocked: 'blocked' };
for (const el of document.querySelectorAll('.pa')) {
  const state = el.dataset.state || 'idle';
  const badge = STATE_ICON[state] ? `<span class="pa__badge">${icon(STATE_ICON[state])}</span>` : '';
  el.innerHTML = `<span class="pa__body"></span><span class="pa__eyes"><span class="pa__eye"></span><span class="pa__eye"></span></span><span class="pa__ring"></span>${badge}`;
  el.setAttribute('aria-hidden', 'true');
}
for (const el of document.querySelectorAll('[data-i]')) {
  el.replaceWith(Object.assign(document.createElement('span'), { innerHTML: String(icon(el.dataset.i, el.dataset.c || '')) }).firstElementChild);
}

// Phone sheets: the Workspace button opens the sheet, the scrim closes it.
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) document.body.dataset.sheet = open.dataset.open;
  else if (e.target.closest('.scrim, [data-close]')) delete document.body.dataset.sheet;
});
