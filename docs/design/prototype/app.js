// Caduceus Dashboard prototype: hash router, adaptive shell, command palette,
// profile switcher, banner stack, keyboard shortcuts and the PROTOTYPE bar.
import {
  html, raw, esc, icon, avatar, profileTag, statusBadge, kbd, fuzzy, fmtAgo, uid,
  sizeClass, openLayer, openSheet, closeSheet, openDialog, openDrawer, toast,
  closeAllLayers, overlaysSettled, layerCount,
  data, modules, moduleById, navGroups, SOURCES, taskState, actionableCount, getProfile, defaultProfile, measureDock,
} from './shared.js';

/* ==========================================================================
   Route table (IA §7). Every route maps to a screen module file. Files that
   do not exist yet (or throw while loading) fall back to screens/module.js.
   `module` is the registry id in shared.js (title, group, nav, palette).
   ========================================================================== */
export const ROUTES = [
  { path: '/home', file: 'home', module: 'home' },
  { path: '/more', file: 'more', module: 'more' },
  { path: '/chat', file: 'chat', module: 'chat' },
  { path: '/chat/new', file: 'chat', module: 'chat' },
  { path: '/chat/:id', file: 'chat', module: 'chat' },
  { path: '/inbox', file: 'inbox', module: 'inbox' },
  { path: '/inbox/:id', file: 'inbox', module: 'inbox' },
  { path: '/work/board', file: 'board', module: 'board' },
  { path: '/work/board/:board', file: 'board', module: 'board' },
  { path: '/work/tasks', file: 'tasks', module: 'tasks' },
  { path: '/work/tasks/new', file: 'tasks', module: 'tasks' },
  { path: '/work/tasks/:id', file: 'tasks', module: 'tasks' },
  { path: '/work/runs/:runId', file: 'tasks', module: 'tasks' },
  { path: '/work/playbooks', file: 'playbooks', module: 'playbooks' },
  { path: '/work/playbooks/:id', file: 'playbooks', module: 'playbooks' },
  { path: '/work/playbooks/:id/runs/:rootTaskId', file: 'playbooks', module: 'playbooks' },
  { path: '/work/schedules', file: 'schedules', module: 'schedules' },
  { path: '/work/schedules/:jobId', file: 'schedules', module: 'schedules' },
  { path: '/work/projects', file: 'module', module: 'projects' },
  { path: '/work/projects/:projectId', file: 'module', module: 'projects' },
  { path: '/agents/profiles', file: 'profiles', module: 'profiles' },
  { path: '/agents/profiles/new', file: 'profiles', module: 'profiles' },
  { path: '/agents/profiles/:name', file: 'profiles', module: 'profiles' },
  { path: '/agents/profiles/:name/:tab', file: 'profiles', module: 'profiles' },
  { path: '/agents/skills', file: 'module', module: 'skills' },
  { path: '/agents/skills/hub', file: 'module', module: 'skills' },
  { path: '/agents/skills/*path', file: 'module', module: 'skills' },
  { path: '/agents/memory', file: 'module', module: 'memory' },
  { path: '/agents/memory/:tab', file: 'module', module: 'memory' },
  { path: '/agents/models', file: 'module', module: 'models' },
  { path: '/agents/models/:tab', file: 'module', module: 'models' },
  { path: '/agents/tools', file: 'module', module: 'tools' },
  { path: '/agents/tools/:tab', file: 'module', module: 'tools' },
  { path: '/connect/gateway', file: 'module', module: 'gateway' },
  { path: '/connect/channels', file: 'module', module: 'channels' },
  { path: '/connect/channels/:platform', file: 'module', module: 'channels' },
  { path: '/connect/pairing', file: 'module', module: 'pairing' },
  { path: '/connect/webhooks', file: 'module', module: 'webhooks' },
  { path: '/workspace/files', file: 'module', module: 'files' },
  { path: '/workspace/files/*path', file: 'module', module: 'files' },
  { path: '/workspace/git', file: 'module', module: 'git' },
  { path: '/workspace/checkpoints', file: 'module', module: 'checkpoints' },
  { path: '/workspace/terminal', file: 'module', module: 'terminal' },
  { path: '/workspace/artifacts', file: 'module', module: 'artifacts' },
  { path: '/observe/insights', file: 'module', module: 'insights' },
  { path: '/observe/logs', file: 'module', module: 'logs' },
  { path: '/observe/health', file: 'health', module: 'health' },
  { path: '/system/config', file: 'config', module: 'config' },
  { path: '/system/config/:category', file: 'config', module: 'config' },
  { path: '/system/keys', file: 'keys', module: 'keys' },
  { path: '/system/plugins', file: 'module', module: 'plugins' },
  { path: '/system/maintenance', file: 'module', module: 'maintenance' },
  { path: '/system/security', file: 'module', module: 'security' },
  { path: '/settings', file: 'module', module: 'settings' },
  { path: '/settings/:section', file: 'module', module: 'settings' },
];
const REDIRECTS = {
  '': '/home', '/': '/home', '/work': '/work/board', '/agents': '/agents/profiles', '/connect': '/connect/gateway',
  '/workspace': '/workspace/files', '/observe': '/observe/insights', '/system': '/system/config',
};
const PSEUDO = {
  more: { id: 'more', title: 'More', group: 'top', icon: 'more', path: '/more', summary: 'Every module', contents: [] },
  notfound: { id: 'notfound', title: 'Not found', group: 'top', icon: 'alert', path: null, summary: '', contents: [] },
};
const metaFor = (id) => moduleById[id] || PSEUDO[id] || PSEUDO.notfound;

const compiled = ROUTES.map((r) => {
  const names = [];
  const re = r.path.split('/').map((seg) => {
    if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
    if (seg.startsWith('*')) { names.push(seg.slice(1)); return '(.+)'; }
    return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { ...r, re: new RegExp(`^${re}/?$`), names };
});
function matchRoute(path) {
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (m) return { entry: r, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
const screenCache = new Map();
function loadScreen(file) {
  if (!screenCache.has(file)) {
    screenCache.set(file, import(`./screens/${file}.js`).then((m) => {
      if (!m.default || typeof m.default.render !== 'function') throw new Error(`screens/${file}.js has no default { render }`);
      return { screen: m.default, fallback: null };
    }).catch((err) => {
      if (file === 'module') throw err;
      console.info(`[prototype] screens/${file}.js unavailable → module.js fallback`, err?.message);
      return import('./screens/module.js').then((m) => ({ screen: m.default, fallback: { file, reason: String(err?.message || err) } }));
    }));
  }
  return screenCache.get(file);
}

/* ==========================================================================
   Preferences (per device; localStorage)
   ========================================================================== */
const PREF_KEY = 'hc-proto-prefs';
const prefs = Object.assign(
  { theme: 'system', skin: 'nous', density: 'auto', text: '', singleKey: true, navCollapsed: false, groups: { work: true } },
  JSON.parse(localStorage.getItem(PREF_KEY) || '{}'),
);
function savePrefs() { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }
function applyAppearance() {
  const r = document.documentElement;
  r.dataset.theme = prefs.theme;
  r.dataset.skin = prefs.skin;
  r.dataset.density = prefs.density;
  if (prefs.text) r.dataset.textScale = prefs.text; else delete r.dataset.textScale;
}
const LAST_PROFILE_KEY = 'hc-proto-last-profile';

/* ==========================================================================
   State
   ========================================================================== */
const S = {
  size: sizeClass(),
  path: '/home', query: new URLSearchParams(), params: {}, entry: null, meta: null,
  screen: null, fallback: null, cleanup: null, appBar: null, ctx: null,
  firstRender: true, dismissed: new Set(), bannersOpen: false, routeToken: 0,
};
const $ = (id) => document.getElementById(id);
const app = $('app');

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [p, qs] = raw.split('?');
  return { path: p || '', query: new URLSearchParams(qs || '') };
}
function effectiveProfile() {
  const q = S.query.get('profile');
  if (q && q !== 'all' && getProfile(q)) return getProfile(q);
  const last = localStorage.getItem(LAST_PROFILE_KEY);
  if (last && getProfile(last)) return getProfile(last);
  return defaultProfile();
}
function scope() {
  const q = S.query.get('profile');
  if (S.meta?.crossProfile) return q && q !== 'all' && getProfile(q) ? q : 'all';
  return effectiveProfile().name;
}
/** Build an in-app href that keeps the tab's ?profile= scope. */
function href(to, { keepProfile = true } = {}) {
  const [p, qs] = to.split('?');
  const q = new URLSearchParams(qs || '');
  const cur = S.query.get('profile');
  if (keepProfile && cur && !q.has('profile')) q.set('profile', cur);
  const s = q.toString();
  return `#${p}${s ? '?' + s : ''}`;
}
async function navigate(to, { replace = false, keepProfile = true } = {}) {
  await closeAllLayers();
  const target = href(to, { keepProfile });
  if (target === location.hash) { route({ focus: true }); return; }
  if (replace) location.replace(target); else location.hash = target;
}

/* ==========================================================================
   Navigation model
   ========================================================================== */
const TABS = [
  { id: 'home', label: 'Home', icon: 'home', path: '/home' },
  { id: 'chat', label: 'Chat', icon: 'chat', path: '/chat' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', path: '/inbox' },
  { id: 'work', label: 'Work', icon: 'work', path: '/work/board' },
  { id: 'more', label: 'More', icon: 'more', path: '/more' },
];
function currentTab() {
  const p = S.path;
  if (p.startsWith('/home')) return 'home';
  if (p.startsWith('/chat')) return 'chat';
  if (p.startsWith('/inbox')) return 'inbox';
  if (p.startsWith('/work')) return 'work';
  return 'more';
}
const healthDot = { connect: () => data.health.find((x) => x.id === 'gateway').state, observe: () => (data.health.some((x) => x.state !== 'online') ? 'degraded' : 'online') };
// Inbox is cross-profile: the badge counts every profile unless this tab chose one via ?profile=.
function inboxCount() { const q = S.query.get('profile'); return actionableCount(q && getProfile(q) ? q : 'all'); }
function countBadge(n, ctxLabel) {
  if (!n) return '';
  return html`<span class="count" aria-hidden="true">${n}</span><span class="sr-only">, ${n} ${ctxLabel}</span>`;
}
function navLink(m, { cls = 'nav-item', compactLabel = false } = {}) {
  const cur = S.meta?.id === m.id;
  const badge = m.id === 'inbox' ? countBadge(inboxCount(), 'need you') : '';
  const running = m.id === 'board' ? data.tasks.filter((t) => t.status === 'running' && !t.stale).length : 0;
  return html`<a class="${cls}" href="${href(m.path)}" ${cur ? raw('aria-current="page"') : ''} data-nav="${m.id}">
    ${icon(m.icon)}<span class="nav-label">${compactLabel ? m.short || m.title : m.title}</span>${badge}${running ? html`<span class="nav-meta mono" aria-label="${running} running">${running}</span>` : ''}
  </a>`;
}
function groupedNav({ inDrawer = false } = {}) {
  const top = ['home', 'chat', 'inbox'].map((id) => navLink(moduleById[id]));
  const groups = navGroups.filter((g) => g.title).map((g) => {
    const items = modules.filter((m) => m.group === g.id);
    const containsCurrent = items.some((m) => m.id === S.meta?.id);
    const open = containsCurrent || !!prefs.groups[g.id];
    const listId = `nav-${g.id}${inDrawer ? '-d' : ''}`;
    const hs = healthDot[g.id]?.();
    const dot = hs ? html`<span class="dot" data-tone="${hs === 'online' ? 'success' : 'warning'}" aria-hidden="true"></span><span class="sr-only">${hs === 'online' ? 'healthy' : 'degraded'}</span>` : '';
    return html`<div class="nav-group">
      <button type="button" class="nav-item nav-group-btn" aria-expanded="${open}" aria-controls="${listId}" data-group="${g.id}">
        ${icon(g.icon)}<span class="nav-label">${g.title}</span>${dot}${icon('chev-d', 'nav-chev')}
      </button>
      <div class="nav-group__items" id="${listId}" ${open ? '' : raw('hidden')}>${items.map((m) => navLink(m, { cls: 'nav-item nav-sub' }))}</div>
    </div>`;
  });
  return html`<div class="nav-list">${top}${groups}</div><div class="nav-foot">${navLink(moduleById.settings)}</div>`;
}
function wordmark() {
  return html`<a class="wordmark" href="${href('/home')}" aria-label="Caduceus Dashboard home"><span class="wordmark__glyph" aria-hidden="true">C</span><span class="wordmark__text">Caduceus Dashboard</span></a>`;
}
function renderSide() {
  const side = $('side');
  const rail = S.size === 'medium' || (S.size === 'large' && prefs.navCollapsed);
  app.dataset.nav = document.documentElement.dataset.shellNav = S.size === 'compact' ? 'bar' : rail ? 'rail' : 'sidebar';
  if (S.size === 'compact') { side.innerHTML = ''; return; }
  const tab = currentTab();
  if (rail) {
    const toggleLabel = S.size === 'medium' ? 'Open navigation drawer' : 'Expand sidebar';
    side.innerHTML = String(html`<div class="rail">
      <button type="button" class="btn btn--ghost btn--icon rail__toggle" data-act="${S.size === 'medium' ? 'drawer' : 'expand'}" aria-label="${toggleLabel}" ${S.size === 'medium' ? raw('aria-haspopup="dialog"') : raw('aria-expanded="false"')}>${icon(S.size === 'medium' ? 'menu' : 'sidebar-expand')}</button>
      ${TABS.map((t) => html`<a class="nav-item rail__item" href="${href(t.path)}" ${tab === t.id ? raw('aria-current="page"') : ''}>
        <span class="rail__icon">${icon(t.icon)}${t.id === 'inbox' ? countBadge(inboxCount(), 'need you') : ''}</span><span class="nav-label">${t.label}</span></a>`)}
    </div>`);
  } else {
    side.innerHTML = String(html`<div class="sidebar">
      <div class="sidebar__head">${wordmark()}<button type="button" class="btn btn--ghost btn--icon" data-act="collapse" aria-label="Collapse sidebar" aria-expanded="true">${icon('sidebar-collapse')}</button></div>
      ${groupedNav()}
    </div>`);
  }
}
function renderTabbar() {
  const bar = $('tabbar');
  if (S.size !== 'compact') { bar.innerHTML = ''; return; }
  const tab = currentTab();
  bar.innerHTML = String(html`${TABS.map((t) => html`<a class="tab" href="${href(t.path)}" ${tab === t.id ? raw('aria-current="page"') : ''}>
    ${icon(t.icon)}<span>${t.label}</span>${t.id === 'inbox' ? countBadge(inboxCount(), 'need you') : ''}</a>`)}`);
}
function renderSubnav() {
  const el = $('subnav');
  const depth = S.path.split('/').filter(Boolean).length;
  if (S.size === 'large' || !S.path.startsWith('/work/') || depth > 2 || S.screen?.layout === 'fill') { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = String(html`<nav class="subnav__inner" aria-label="Work">${modules.filter((m) => m.group === 'work').map((m) =>
    html`<a class="chip" href="${href(m.path)}" ${S.meta?.id === m.id ? raw('aria-current="page"') : ''}>${icon(m.icon)}${m.title}</a>`)}</nav>`);
}

/* ---- App bar ---- */
function parentPath() {
  if (S.appBar?.back) return S.appBar.back;
  const segs = S.path.split('/').filter(Boolean);
  const meta = S.meta;
  if (!meta || !meta.path) return '/home';
  if (S.path === meta.path) return S.size === 'compact' && currentTab() === 'more' && S.path !== '/more' ? '/more' : null;
  if (S.path.startsWith('/work/runs/')) return '/work/tasks';
  if (segs.length > 2 && S.path.startsWith(meta.path)) {
    // e.g. /work/playbooks/x/runs/y → /work/playbooks/x ; /chat/abc → /chat
    const up = '/' + segs.slice(0, segs.length - (segs[segs.length - 2] === 'runs' ? 2 : 1)).join('/');
    return up.length >= meta.path.length ? up : meta.path;
  }
  return meta.path !== S.path ? meta.path : null;
}
function renderAppBar() {
  const bar = $('appbar');
  const meta = S.meta;
  const title = S.appBar?.title || (typeof S.screen?.title === 'function' ? S.screen.title(S.ctx) : S.screen?.title) || meta.title;
  const cross = !!meta.crossProfile;
  const sc = scope();
  const prof = sc === 'all' ? null : getProfile(sc);
  const back = parentPath();
  const group = navGroups.find((g) => g.id === meta.group)?.title;
  const conn = data.connection;
  const connLabel = conn === 'online' ? 'Connected' : conn === 'reconnecting' ? 'Reconnecting' : 'Offline';
  const connTone = conn === 'online' ? 'success' : conn === 'reconnecting' ? 'warning' : 'neutral';
  const actions = (S.appBar?.actions || []);
  const compact = S.size === 'compact';
  const crumbs = [];
  if (!compact) {
    if (group) crumbs.push({ label: group });
    if (title !== meta.title && meta.path) crumbs.push({ label: meta.title, href: href(meta.path) });
    crumbs.push({ label: title, current: true });
  }
  bar.innerHTML = String(html`
    ${compact && back ? html`<a class="btn btn--ghost btn--icon appbar__back" href="${href(back)}" aria-label="Back">${icon('chev-l')}</a>` : ''}
    ${compact && !back ? html`<span class="wordmark__glyph wordmark__glyph--sm" aria-hidden="true">C</span>` : ''}
    <div class="appbar__title">
      ${compact ? html`<span class="appbar__title-text truncate">${title}</span>` : html`<nav aria-label="Breadcrumb"><ol class="crumbs">${crumbs.map((c) => html`<li>${c.href ? html`<a href="${c.href}">${c.label}</a>` : html`<span ${c.current ? raw('aria-current="page"') : ''}>${c.label}</span>`}</li>`)}</ol></nav>`}
    </div>
    ${actions.length ? html`<div class="appbar__actions">${actions.map((a, i) => a.label && !compact && !a.iconOnly
      ? html`<button type="button" class="btn ${a.primary ? 'btn--primary' : 'btn--secondary'} btn--sm" data-appbar-action="${i}">${a.icon ? icon(a.icon) : ''}${a.label}</button>`
      : html`<button type="button" class="btn btn--ghost btn--icon" data-appbar-action="${i}" aria-label="${a.label}">${icon(a.icon || 'dots-v')}</button>`)}</div>` : ''}
    <button type="button" class="chip chip--profile appbar__profile" data-act="profile" aria-haspopup="dialog" aria-label="Profile scope: ${prof ? prof.name : 'All profiles'}. Switch profile">
      ${avatar(prof ? prof.name : 'all', { size: 'sm' })}<span class="truncate">${prof ? prof.name : 'All profiles'}</span>${icon('chev-d', 'i-sm')}
    </button>
    <button type="button" class="btn btn--ghost btn--icon appbar__conn" data-act="connection" aria-label="Connection: ${connLabel}. Details">
      <span class="dot${conn === 'offline' ? ' dot--dashed' : ''}${conn === 'reconnecting' ? ' pulse' : ''}" data-tone="${connTone}" aria-hidden="true"></span>
    </button>
    <span class="sr-only" role="status">${connLabel}</span>
    ${S.size === 'large'
      ? html`<button type="button" class="appbar__search" data-act="palette" aria-label="Search and commands" aria-keyshortcuts="Meta+K Control+K">${icon('search')}<span>Search or jump to…</span>${kbd(isMac ? '⌘' : 'Ctrl', 'K')}</button>`
      : html`<button type="button" class="btn btn--ghost btn--icon" data-act="palette" aria-label="Search and commands" aria-keyshortcuts="Meta+K Control+K">${icon('search')}</button>`}
  `);
  if (cross) bar.querySelector('.appbar__profile').dataset.cross = '';
  bar.querySelectorAll('[data-appbar-action]').forEach((b) => b.addEventListener('click', (e) => actions[+b.dataset.appbarAction].onClick?.(e)));
  document.title = `${title} · Caduceus Dashboard (prototype)`;
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/* ---- Banner stack (IA §3): one visible, the rest behind a "+N" pill ---- */
function bannerList() {
  const out = [];
  if (data.connection === 'reconnecting') out.push({ id: 'conn', priority: 1, tone: 'warning', icon: 'refresh', title: 'Reconnecting to Hermes…', body: `Next attempt in 4 s. Showing cached data as of ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}.`, actions: [{ label: 'Retry now', run: () => setConnection('online', 'Reconnected') }] });
  if (data.connection === 'offline') out.push({ id: 'conn', priority: 0, tone: 'neutral', icon: 'wifi-off', title: 'Offline: server unreachable', body: 'Sends and comments wait in the outbox. Approvals and other step-up actions are disabled until you are back online.', actions: [{ label: 'Try again', run: () => setConnection('online', 'Reconnected') }] });
  if (S.path === '/home' && !S.dismissed.has('gw')) out.push({ id: 'gw', priority: 5, tone: 'info', icon: 'info', title: 'Gateway restarted · 2 sessions resumed', body: 'Restarted 3 minutes ago after a config change. Live runs reconnected and nothing was lost.', dismissible: true, actions: [{ label: 'View gateway', href: '/connect/gateway' }] });
  return out.sort((a, b) => a.priority - b.priority);
}
function renderBanners() {
  const el = $('banners');
  const list = bannerList();
  if (!list.length || S.screen?.layout === 'fill' && !list.some((b) => b.id === 'conn')) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const shown = S.bannersOpen ? list : list.slice(0, 1);
  el.innerHTML = String(html`<div class="banners__inner">${shown.map((b) => html`<div class="banner" data-tone="${b.tone}" data-banner="${b.id}" ${b.tone === 'warning' || b.tone === 'danger' ? raw('role="alert"') : ''}>
      ${icon(b.icon)}
      <div class="banner__content"><div class="banner__title">${b.title}</div><div class="banner__body">${b.body}</div>
        ${b.actions?.length ? html`<div class="banner__actions">${b.actions.map((a, i) => a.href ? html`<a class="btn btn--secondary btn--sm" href="${href(a.href)}">${a.label}</a>` : html`<button type="button" class="btn btn--secondary btn--sm" data-banner-act="${b.id}:${i}">${a.label}</button>`)}</div>` : ''}
      </div>
      ${b.dismissible ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-dismiss="${b.id}" aria-label="Dismiss: ${b.title}">${icon('x')}</button>` : html`<span></span>`}
    </div>`)}
    ${list.length > 1 ? html`<button type="button" class="chip banners__more" data-banners-toggle aria-expanded="${S.bannersOpen}">${S.bannersOpen ? 'Show fewer' : `+${list.length - 1} more`}</button>` : ''}</div>`);
  el.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', () => { S.dismissed.add(b.dataset.dismiss); renderBanners(); $('main').querySelector('h1')?.focus(); }));
  el.querySelector('[data-banners-toggle]')?.addEventListener('click', () => { S.bannersOpen = !S.bannersOpen; renderBanners(); el.querySelector('[data-banners-toggle]')?.focus(); });
  el.querySelectorAll('[data-banner-act]').forEach((b) => b.addEventListener('click', () => {
    const [id, i] = b.dataset.bannerAct.split(':');
    list.find((x) => x.id === id).actions[+i].run();
  }));
}
function setConnection(state, msg) {
  data.connection = state;
  renderAppBar(); renderBanners(); renderProto();
  if (msg) toast(msg, { tone: state === 'online' ? 'success' : 'warning' });
}

/* ==========================================================================
   Rendering
   ========================================================================== */
function makeCtx() {
  const ctx = {
    path: S.path,
    params: { ...S.params },
    query: Object.fromEntries(S.query),
    size: S.size,
    route: S.entry ? { path: S.entry.path, file: S.entry.file } : null,
    module: S.meta,
    fallback: S.fallback,
    profile: effectiveProfile(),
    scope: scope(),
    crossProfile: !!S.meta?.crossProfile,
    data,
    navigate, href, openSheet, closeSheet, openDialog, openDrawer, toast,
    openProfileSwitcher,
    setAppBar(o) { S.appBar = { ...(S.appBar || {}), ...o }; renderAppBar(); },
    refresh() { renderScreen({ focus: false }); },
  };
  return ctx;
}
function renderChrome() {
  app.dataset.size = document.documentElement.dataset.shellSize = S.size;
  renderSide(); renderTabbar(); renderAppBar(); renderSubnav(); renderBanners();
}
function renderScreen({ focus }) {
  try { S.cleanup?.(); } catch (e) { console.error(e); }
  S.cleanup = null;
  S.appBar = null;
  const ctx = makeCtx();
  S.ctx = ctx;
  const main = $('main');
  app.dataset.layout = document.documentElement.dataset.shellLayout = S.screen.layout === 'fill' ? 'fill' : 'page';
  let out;
  try { out = S.screen.render(ctx); } catch (e) {
    console.error(e);
    out = html`<div class="empty"><div class="empty__icon">${icon('alert')}</div><h1 tabindex="-1">This screen failed to render</h1><p class="mono">${String(e.message || e)}</p></div>`;
  }
  // A fresh root per render: listeners attached in mount() die with it.
  main.innerHTML = `<div class="screen" data-screen="${esc(S.fallback ? 'module' : S.entry.file)}">${String(out ?? '')}</div>`;
  const root = main.firstElementChild;
  renderChrome();
  try { const c = S.screen.mount?.(root, ctx); if (typeof c === 'function') S.cleanup = c; } catch (e) { console.error(e); }
  observeLargeTitle();
  if (focus) {
    const h1 = main.querySelector('h1');
    if (h1) { if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    else main.focus({ preventScroll: true });
  }
}
async function route({ focus = !S.firstRender } = {}) {
  const token = ++S.routeToken;
  const { path, query } = parseHash();
  if (path in REDIRECTS) {
    const q = query.toString();
    location.replace(`#${REDIRECTS[path]}${q ? '?' + q : ''}`);
    return;
  }
  const m = matchRoute(path);
  const entry = m?.entry || { path: null, file: 'module', module: 'notfound' };
  const loaded = await loadScreen(entry.file);
  if (token !== S.routeToken) return;
  const samePage = S.path === path && !S.firstRender;
  Object.assign(S, { path, query, params: m?.params || {}, entry, meta: metaFor(entry.module), screen: loaded.screen, fallback: loaded.fallback });
  S.bannersOpen = false;
  const q = query.get('profile');
  if (q && q !== 'all' && getProfile(q)) localStorage.setItem(LAST_PROFILE_KEY, q);
  app.classList.remove('is-tabbar-hidden');
  if (!samePage) window.scrollTo(0, 0);
  renderScreen({ focus });
  S.firstRender = false;
}

/* ---- Compact "large title": app-bar title appears once the page h1 scrolls away ---- */
let titleIO = null;
function observeLargeTitle() {
  titleIO?.disconnect();
  const bar = $('appbar');
  const h1 = $('main').querySelector('h1');
  if (S.size !== 'compact' || !h1 || S.screen?.layout === 'fill') { bar.classList.add('is-scrolled'); return; }
  bar.classList.remove('is-scrolled');
  titleIO = new IntersectionObserver(([e]) => bar.classList.toggle('is-scrolled', !e.isIntersecting), { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px` });
  titleIO.observe(h1);
}

/* ==========================================================================
   Profile switcher (IA §6, decision 6)
   ========================================================================== */
function openProfileSwitcher() {
  const cross = !!S.meta?.crossProfile;
  const listHtml = () => {
    const sc = scope();
    const row = (p) => {
      const checked = sc === p.name;
      return html`<button type="button" class="plist__row" role="radio" aria-checked="${checked}" data-pick="${p.name}">
        ${avatar(p.name)}
        <span class="plist__main"><span class="plist__name">${p.name}${p.isDefault ? html`<span class="tag">Hermes default</span>` : ''}</span>
          <span class="plist__sub mono truncate">${p.model}</span></span>
        ${statusBadge(p.gateway === 'running' ? 'online' : 'offline', { label: p.gateway === 'running' ? 'Gateway on' : 'Gateway off', variant: 'plain' })}
        <span class="plist__check">${checked ? icon('check') : ''}</span>
      </button>`;
    };
    const eff = cross && sc === 'all' ? effectiveProfile() : getProfile(sc) || effectiveProfile();
    return html`
      <p class="plist__note">${cross ? 'This view is cross-profile. Pick one profile to filter it, or keep all.' : 'Screens in this tab use the selected profile.'} Switching affects <strong>this tab only</strong> (<span class="mono">?profile=</span>); other tabs and devices keep their own.</p>
      <div class="plist" role="radiogroup" aria-label="Profile scope">
        ${cross ? html`<button type="button" class="plist__row" role="radio" aria-checked="${sc === 'all'}" data-pick="all">${avatar('all')}<span class="plist__main"><span class="plist__name">All profiles</span><span class="plist__sub">Inbox, Home, Board, Schedules, history and Insights</span></span><span></span><span class="plist__check">${sc === 'all' ? icon('check') : ''}</span></button>` : ''}
        ${data.profiles.map(row)}
      </div>
      <div class="plist__default">
        <div><strong>Hermes default:</strong> <span class="mono">${defaultProfile().name}</span><p class="subtle">Used by new CLI sessions and anything without a profile. Changing it is a tier-2 action.</p></div>
        <button type="button" class="btn btn--secondary" data-make-default="${eff.name}" ${eff.isDefault ? raw('disabled') : ''}>${eff.isDefault ? `${eff.name}: already the default` : `Make ${eff.name} default…`}</button>
      </div>`;
  };
  openSheet({
    title: 'Switch profile',
    detents: ['auto', 'full'],
    body: String(listHtml()),
    footer: `<a class="btn btn--ghost" href="${esc(href('/agents/profiles'))}">${icon('users')}<span>Manage profiles</span></a>`,
    initialFocus: '[aria-checked="true"]',
    onMount(panel, layer) {
      const body = panel.querySelector('[data-body]');
      const bind = () => {
        body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
          const name = b.dataset.pick;
          const q = new URLSearchParams(S.query);
          if (name === 'all') q.delete('profile'); else { q.set('profile', name); localStorage.setItem(LAST_PROFILE_KEY, name); }
          layer.close();
          await overlaysSettled();
          const s = q.toString();
          location.hash = `#${S.path}${s ? '?' + s : ''}`;
          toast(name === 'all' ? 'Showing all profiles' : `Switched this tab to ${name}`, { tone: 'info' });
        }));
        body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('keydown', (e) => {
          if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
          e.preventDefault();
          const all = [...body.querySelectorAll('[data-pick]')];
          all[(all.indexOf(b) + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
        }));
        body.querySelector('[data-make-default]')?.addEventListener('click', (e) => makeDefault(e.currentTarget.dataset.makeDefault, () => { body.innerHTML = String(listHtml()); bind(); body.querySelector('[data-make-default]')?.focus(); }));
      };
      bind();
    },
  });
}
function makeDefault(name, after) {
  openDialog({
    tier: 2,
    title: `Make ${name} the Hermes default?`,
    body: `This writes Hermes's sticky <span class="mono">active_profile</span>. New CLI sessions, cron jobs without a profile and tabs without <span class="mono">?profile=</span> start on <strong>${esc(name)}</strong>. Tabs that already chose a profile are not affected.`,
    profile: name,
    confirmLabel: `Make ${name} default`,
    onConfirm: () => {
      data.profiles.forEach((p) => { p.isDefault = p.name === name; });
      toast(`${name} is now the default profile`, { detail: `active_profile: ${name}` });
    },
  }).then((ok) => { if (ok) after?.(); });
}

/* ==========================================================================
   Command palette (IA §8)
   ========================================================================== */
let paletteLayer = null;
function goItem(path) { return () => navigate(path); }
function paletteSource() {
  const ctx = S.ctx;
  const nav = [...modules, PSEUDO.more].map((m) => ({
    group: 'Navigate', id: `nav-${m.id}`, label: m.title, sub: navGroups.find((g) => g.id === m.group)?.title || '', icon: m.icon,
    keywords: `${m.path} ${m.summary} ${m.contents.join(' ')}`, shortcut: m.key ? ['G', m.key.toUpperCase()] : null, run: goItem(m.path),
  }));
  const screenActs = (S.screen?.paletteActions?.(ctx) || []).map((a, i) => ({ group: 'Actions', id: `ctx-${i}`, sub: 'This screen', icon: 'bolt', ...a }));
  const actions = [
    ...screenActs,
    { id: 'a-chat', label: 'New chat', icon: 'plus', sub: `as ${effectiveProfile().name}`, shortcut: [isMac ? '⇧⌘O' : 'Ctrl+Shift+O'], run: goItem('/chat/new') },
    { id: 'a-task', label: 'New task', icon: 'tasks', run: goItem('/work/tasks/new') },
    { id: 'a-playbook', label: 'Run playbook…', icon: 'playbook', keywords: 'software delivery research brief bug hunt code review', run: goItem('/work/playbooks') },
    { id: 'a-cron', label: 'Run cron job now…', icon: 'clock', keywords: 'schedule trigger', run: openCronPicker },
    { id: 'a-gw', label: 'Restart gateway', icon: 'refresh', keywords: 'hermes serve', run: () => openDialog({ tier: 1, title: 'Restart the gateway?', body: 'Live runs pause for about 20 seconds and resume automatically. 4 profiles are running; chat platforms reconnect on their own.', profile: effectiveProfile().name, confirmLabel: 'Restart gateway', onConfirm: () => toast('Gateway restarted', { detail: '4 profiles back online in 18 s' }) }) },
    { id: 'a-profile', label: 'Switch profile…', icon: 'users', run: openProfileSwitcher },
    { id: 'a-default', label: 'Make profile default…', icon: 'user', sub: 'Tier 2 · passkey', run: () => makeDefault(effectiveProfile().name) },
    { id: 'a-prune', label: 'Prune old checkpoints…', icon: 'trash', sub: 'Tier 3 · type to confirm', keywords: 'shadow git delete', run: () => openDialog({ tier: 3, title: 'Prune checkpoints older than 30 days?', body: 'Deletes 41 shadow-git checkpoints (2.3 GB) for <span class="mono">caduceus-dashboard</span>.', object: 'caduceus-dashboard', profile: 'coder', danger: true, recoverability: 'This cannot be undone. Pruned checkpoints are not in backups.', confirmLabel: 'Prune 41 checkpoints', onConfirm: () => toast('Pruned 41 checkpoints', { detail: '2.3 GB freed' }) }) },
    ...['light', 'dark', 'system'].map((t) => ({ id: `a-theme-${t}`, label: `Theme: ${t[0].toUpperCase() + t.slice(1)}`, icon: t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor', keywords: 'appearance switch theme', run: () => { prefs.theme = t; savePrefs(); applyAppearance(); renderProto(); toast(`Theme: ${t}`, { tone: 'info' }); } })),
    { id: 'a-keys', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: ['?'], run: openShortcuts },
  ].map((a) => ({ group: 'Actions', ...a }));
  const st = (t) => taskState(t).label;
  const search = [
    ...data.sessions.map((s) => ({ id: `s-${s.id}`, label: s.title, sub: `Session · ${s.profile} · ${SOURCES[s.source]?.label} · ${fmtAgo(s.updated)}`, icon: SOURCES[s.source]?.icon || 'chat', keywords: `${s.preview} ${s.project || ''}`, run: goItem(`/chat/${s.id}`), recent: s.updated })),
    ...data.tasks.map((t) => ({ id: `t-${t.id}`, label: t.title, sub: `Task ${t.id} · ${st(t)} · ${t.assignee || 'unassigned'}`, icon: 'tasks', keywords: t.id, run: goItem(`/work/tasks/${t.id}`) })),
    ...data.playbooks.map((p) => ({ id: `p-${p.id}`, label: p.name, sub: `Playbook · ${p.stages.length} stages`, icon: 'playbook', keywords: p.description, run: goItem(`/work/playbooks/${p.id}`) })),
    ...data.skills.map((s) => ({ id: `k-${s.path}`, label: s.path, sub: `Skill · ${s.description}`, icon: 'stack', run: goItem(`/agents/skills/${s.path}`) })),
    ...data.config.flatMap((c) => c.keys.map((k) => ({ id: `c-${k.key}`, label: k.key, sub: `Config · ${c.title}${k.modified ? ' · modified' : ''}${k.restartRequired ? ' · restart required' : ''}`, icon: 'sliders', keywords: k.help, run: goItem(`/system/config/${c.id}?key=${encodeURIComponent(k.key)}`) }))),
    ...[['appearance', 'Appearance', 'theme skin density font size'], ['notifications', 'Notifications', 'push quiet hours digest'], ['keyboard', 'Keyboard', 'shortcuts remap'], ['accessibility', 'Accessibility', 'motion contrast text']].map(([id, label, kw]) => ({ id: `set-${id}`, label: `Settings › ${label}`, sub: 'Setting', icon: 'settings', keywords: kw, run: goItem(`/settings/${id}`) })),
  ].map((x) => ({ group: 'Search', ...x }));
  return { nav, actions, search };
}
function openPalette() {
  if (paletteLayer) { paletteLayer.close(); return; }
  const src = paletteSource();
  const full = S.size === 'compact';
  const listId = uid('pal');
  const inputId = uid('pal-in');
  let items = [];
  let active = 0;
  const sc = scope();
  const content = `<section class="palette${full ? ' palette--full' : ''}" data-panel>
    <div class="palette__input">${icon('search')}
      <input id="${inputId}" type="text" role="combobox" aria-expanded="true" aria-controls="${listId}" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search or jump to…" aria-label="Search pages, actions, sessions, tasks and settings">
      ${full ? `<button type="button" class="btn btn--ghost btn--sm" data-close>Cancel</button>` : `<kbd>Esc</kbd>`}
    </div>
    <div class="palette__list" id="${listId}" role="listbox" aria-label="Results"></div>
    <p class="sr-only" role="status" data-count></p>
    <div class="palette__foot"><span>${kbd('↑', '↓')} move</span><span>${kbd('↵')} open</span><span>${kbd('esc')} close</span><span class="palette__scope">Scope ${profileTag(sc)}</span></div>
  </section>`;
  paletteLayer = openLayer({
    kind: 'palette', content, label: 'Command palette', initialFocus: 'input',
    className: full ? 'layer--palette-full' : '',
    onClose: () => { paletteLayer = null; },
    onMount(panel, layer) {
      const input = panel.querySelector('input');
      const list = panel.querySelector('[role=listbox]');
      const count = panel.querySelector('[data-count]');
      const compute = () => {
        const q = input.value.trim();
        let groups;
        if (!q) {
          groups = [
            ['Actions', src.actions.slice(0, 6)],
            ['Navigate', src.nav.filter((n) => ['home', 'chat', 'inbox', 'board', 'tasks', 'playbooks', 'schedules'].includes(n.id.slice(4)))],
            ['Recent sessions', src.search.filter((s) => s.recent).sort((a, b) => b.recent - a.recent).slice(0, 4)],
          ];
        } else {
          // labels: fuzzy (subsequence ok); sub-text and keywords: whole-substring only, ranked below label hits
          const kw = (it) => (`${it.sub || ''} ${it.keywords || ''}`.toLowerCase().includes(q.toLowerCase()) ? 400 : -1);
          const rank = (arr, n) => arr.map((it) => ({ it, s: Math.max(fuzzy(q, it.label) * 1.5, kw(it)) }))
            .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.it);
          groups = [['Navigate', rank(src.nav, 6)], ['Actions', rank(src.actions, 6)], ['Search', rank(src.search, 8)],
            ['Ask Hermes', [{ id: 'ask', label: `Ask Hermes: “${q}”`, sub: `New chat as ${effectiveProfile().name}`, icon: 'chat', run: goItem(`/chat/new?prompt=${encodeURIComponent(q)}`) }]]];
        }
        groups = groups.filter(([, arr]) => arr.length);
        items = groups.flatMap(([, arr]) => arr);
        active = 0;
        list.innerHTML = groups.map(([g, arr], gi) => `<div role="group" aria-labelledby="${listId}-g${gi}"><div class="palette__group overline" id="${listId}-g${gi}">${esc(g)}</div>${arr.map((it) => {
          const i = items.indexOf(it);
          return `<div class="palette__item" role="option" id="${listId}-o${i}" data-i="${i}" aria-selected="false">${icon(it.icon || 'arrow-r')}<span class="grow"><span class="palette__label truncate">${esc(it.label)}</span>${it.sub ? `<span class="palette__sub truncate">${esc(it.sub)}</span>` : ''}</span>${it.shortcut ? kbd(...it.shortcut) : ''}</div>`;
        }).join('')}</div>`).join('') || `<div class="empty"><p>No results. Try a page name, a task ID like <span class="mono">t_1049</span>, or a config key.</p></div>`;
        count.textContent = q ? `${items.length} results` : '';
        setActive(0);
      };
      const setActive = (i) => {
        if (!items.length) { input.removeAttribute('aria-activedescendant'); return; }
        active = (i + items.length) % items.length;
        list.querySelectorAll('[aria-selected="true"]').forEach((o) => o.setAttribute('aria-selected', 'false'));
        const opt = list.querySelector(`[data-i="${active}"]`);
        opt.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', opt.id);
        // keep the active option visible without scrolling the page behind the palette
        const top = opt.offsetTop - list.offsetTop, bottom = top + opt.offsetHeight;
        if (top < list.scrollTop + 28) list.scrollTop = Math.max(0, top - 28);
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      };
      const run = async (i) => {
        const it = items[i];
        if (!it) return;
        layer.close();
        await overlaysSettled();
        it.run();
      };
      input.addEventListener('input', compute);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
        else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
        else if (e.key === 'Enter') { e.preventDefault(); run(active); }
      });
      list.addEventListener('pointermove', (e) => { const o = e.target.closest('[data-i]'); if (o && +o.dataset.i !== active) setActive(+o.dataset.i); });
      list.addEventListener('click', (e) => { const o = e.target.closest('[data-i]'); if (o) run(+o.dataset.i); });
      compute();
    },
  });
}
function openCronPicker() {
  openSheet({
    title: 'Run a cron job now',
    body: `<div class="plist">${data.cron.map((j) => `<button type="button" class="plist__row" data-job="${j.id}">${icon('clock')}<span class="plist__main"><span class="plist__name">${esc(j.name)}</span><span class="plist__sub mono">${esc(j.schedule)} · ${esc(j.profile)}</span></span>${statusBadge(j.state === 'paused' ? 'paused' : j.state === 'running' ? 'running' : j.lastStatus === 'failed' ? 'failed' : 'succeeded', { variant: 'plain', label: j.state === 'paused' ? 'Paused' : j.state === 'running' ? 'Running' : j.lastStatus === 'failed' ? 'Last run failed' : 'Last run OK' })}<span></span></button>`).join('')}</div>`,
    onMount(panel) {
      panel.querySelectorAll('[data-job]').forEach((b) => b.addEventListener('click', () => {
        const j = data.cron.find((x) => x.id === b.dataset.job);
        openDialog({ tier: 1, title: `Run “${j.name}” now?`, body: `Runs once outside its schedule (${esc(j.human)}). The next scheduled run is unchanged.`, profile: j.profile, confirmLabel: 'Run now', onConfirm: () => { closeSheet(); toast(`Started ${j.name}`, { detail: `run cr_${Math.floor(9100 + Math.random() * 800)}`, action: { label: 'View', onClick: () => navigate(`/work/schedules/${j.id}`) } }); } });
      }));
    },
  });
}

/* ---- Shortcut sheet ("?") ---- */
function openShortcuts() {
  const gRows = modules.filter((m) => m.key).map((m) => `<tr><td>${kbd('g', m.key)}</td><td>${esc(m.title)}</td></tr>`).join('');
  openSheet({
    title: 'Keyboard shortcuts',
    wide: true,
    detents: ['half', 'full'],
    body: `<div class="switch-row"><label for="sk-switch"><strong>Single-key shortcuts</strong><br><span class="subtle">g + letter, ?, / and j/k. Turn off if they clash with assistive tech (WCAG 2.1.4).</span></label><button type="button" id="sk-switch" class="switch" role="switch" aria-checked="${prefs.singleKey}"></button></div>
      <div class="shortcuts">
        <table class="kbd-table"><caption class="overline">Global</caption><tbody>
          <tr><td>${kbd(isMac ? '⌘' : 'Ctrl', 'K')}</td><td>Command palette and search</td></tr>
          <tr><td>${kbd('/')}</td><td>Command palette (composer: slash commands)</td></tr>
          <tr><td>${kbd(isMac ? '⇧⌘O' : 'Ctrl+Shift+O')}</td><td>New chat</td></tr>
          <tr><td>${kbd('?')}</td><td>This sheet</td></tr>
          <tr><td>${kbd('j')} ${kbd('k')}</td><td>Move through lists</td></tr>
          <tr><td>${kbd('↵')}</td><td>Open · on an approval card: Allow once</td></tr>
          <tr><td>${kbd('Esc')}</td><td>Close the top sheet or step back</td></tr>
        </tbody></table>
        <table class="kbd-table"><caption class="overline">Go to</caption><tbody>${gRows}</tbody></table>
      </div>`,
    onMount(panel) {
      const sw = panel.querySelector('#sk-switch');
      sw.addEventListener('click', () => { prefs.singleKey = !prefs.singleKey; savePrefs(); sw.setAttribute('aria-checked', String(prefs.singleKey)); });
    },
  });
}

/* ---- Connection details ---- */
function openConnection() {
  const c = data.connection;
  openSheet({
    title: 'Connection',
    body: `<div class="row">${statusBadge(c === 'online' ? 'online' : c === 'reconnecting' ? 'reconnecting' : 'offline', { label: c === 'online' ? 'Connected' : c === 'reconnecting' ? 'Reconnecting' : 'Offline' })}</div>
      <dl class="kv"><dt>server</dt><dd class="mono">https://hermes.tail1c2e.ts.net:9443</dd><dt>hermes serve</dt><dd class="mono">127.0.0.1:9119 · v${data.version.hermes}</dd><dt>realtime</dt><dd class="mono">${c === 'online' ? 'ws open · last event 2s ago' : 'ws closed · retry in 4s'}</dd><dt>latency</dt><dd class="mono">${c === 'online' ? '24 ms' : '—'}</dd><dt>outbox</dt><dd class="mono">${c === 'online' ? '0 pending' : '1 pending (comment on t_1043)'}</dd></dl>`,
    footer: `<button type="button" class="btn btn--secondary" data-reconnect>${icon('refresh')}<span>Reconnect now</span></button>`,
    onMount(panel, layer) {
      panel.querySelector('[data-reconnect]').addEventListener('click', () => { layer.close(); setConnection('online', c === 'online' ? 'Connection refreshed' : 'Reconnected'); });
    },
  });
}

/* ---- Medium: rail expands into the grouped drawer ---- */
function openNavDrawer() {
  openDrawer({
    label: 'Navigation',
    initialFocus: '[aria-current="page"]',
    body: String(html`<div class="sidebar sidebar--drawer"><div class="sidebar__head">${wordmark()}<button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Close navigation">${icon('x')}</button></div>${groupedNav({ inDrawer: true })}</div>`),
    onMount(panel) { bindGroupToggles(panel); },
  });
}
function bindGroupToggles(root) {
  root.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
    prefs.groups[b.dataset.group] = open;
    savePrefs();
  }));
}

/* ==========================================================================
   Prototype bar (theme, skin, density, text, connection)
   ========================================================================== */
function seg(name, label, options, current) {
  return `<div class="proto__row"><span class="overline" id="pl-${name}">${label}</span><div class="seg" role="radiogroup" aria-labelledby="pl-${name}" data-pref="${name}">${options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${current === v}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
}
function renderProto() {
  const el = $('proto');
  const open = el.dataset.open === 'true';
  el.innerHTML = `
    <div class="proto__panel" id="proto-panel" role="region" aria-label="Prototype controls" ${open ? '' : 'hidden'}>
      <div class="proto__head"><span class="proto__badge">Prototype</span><span class="subtle">Mock data · nothing reaches Hermes</span></div>
      ${seg('theme', 'Theme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], prefs.theme)}
      <div class="proto__row"><label class="overline" for="proto-skin">Skin</label><select id="proto-skin" class="input" data-pref-select="skin">${[['nous', 'Nous (default)'], ['hermes', 'Hermes Teal'], ['gold', 'Gold'], ['cherenkov', 'Cherenkov'], ['verdant', 'Verdant'], ['mono', 'Mono']].map(([v, l]) => `<option value="${v}" ${prefs.skin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${seg('density', 'Density', [['auto', 'Auto'], ['compact', 'Compact'], ['comfortable', 'Comfy']], prefs.density)}
      ${seg('text', 'Text size', [['sm', 'S'], ['', 'M'], ['lg', 'L'], ['xl', 'XL']], prefs.text)}
      ${seg('connection', 'Connection', [['online', 'Online'], ['reconnecting', 'Flaky'], ['offline', 'Offline']], data.connection)}
      <div class="proto__foot"><button type="button" class="btn btn--ghost btn--sm" data-proto-reset>Reset prototype</button><button type="button" class="btn btn--secondary btn--sm" data-proto-close>Done</button></div>
    </div>
    <button type="button" class="proto__pill" aria-expanded="${open}" aria-controls="proto-panel">${icon('sliders', 'i-sm')}<span>Prototype</span></button>`;
  el.querySelector('.proto__pill').addEventListener('click', () => { el.dataset.open = String(!open); renderProto(); el.querySelector(open ? '.proto__pill' : '.seg button[aria-checked="true"]')?.focus(); });
  el.querySelector('[data-proto-close]').addEventListener('click', () => { el.dataset.open = 'false'; renderProto(); el.querySelector('.proto__pill').focus(); });
  el.querySelector('[data-proto-reset]').addEventListener('click', () => { localStorage.removeItem(PREF_KEY); localStorage.removeItem(LAST_PROFILE_KEY); location.hash = '#/home'; location.reload(); });
  el.querySelectorAll('[data-pref] [role=radio]').forEach((b) => b.addEventListener('click', () => {
    const k = b.closest('[data-pref]').dataset.pref;
    const v = b.dataset.v;
    if (k === 'connection') { setConnection(v, v === 'online' ? 'Reconnected' : null); el.querySelector(`[data-pref="connection"] [data-v="${v}"]`)?.focus(); return; }
    prefs[k] = v; savePrefs(); applyAppearance(); renderProto();
    el.querySelector(`[data-pref="${k}"] [data-v="${v}"]`)?.focus();
    requestAnimationFrame(() => observeLargeTitle());
  }));
  el.querySelector('[data-pref-select]').addEventListener('change', (e) => { prefs.skin = e.target.value; savePrefs(); applyAppearance(); });
}

/* ==========================================================================
   Global events
   ========================================================================== */
function isEditable(t) { return t.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'); }
let gPending = null;
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'k') { e.preventDefault(); openPalette(); return; }
  if (mod && e.shiftKey && k === 'o') { e.preventDefault(); navigate('/chat/new'); return; }
  if (e.key === 'Escape' && $('proto').dataset.open === 'true' && $('proto').contains(document.activeElement)) { $('proto').dataset.open = 'false'; renderProto(); $('proto').querySelector('.proto__pill').focus(); return; }
  if (layerCount() || mod || e.altKey || isEditable(e.target) || !prefs.singleKey) return;
  if (gPending) {
    clearTimeout(gPending); gPending = null; $('ghint').hidden = true;
    const m = modules.find((x) => x.key === k);
    if (m) { e.preventDefault(); navigate(m.path); }
    return;
  }
  if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (k === 'g' && !e.shiftKey) { gPending = setTimeout(() => { gPending = null; $('ghint').hidden = true; }, 1500); $('ghint').hidden = false; }
});
// Arrow keys inside segmented radiogroups
document.addEventListener('keydown', (e) => {
  const r = e.target.closest?.('.seg[role=radiogroup] [role=radio]');
  if (!r || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const all = [...r.parentElement.querySelectorAll('[role=radio]')];
  const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
  const rtl = getComputedStyle(r).direction === 'rtl' && e.key.startsWith('Arrow') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? -1 : 1;
  const next = all[(all.indexOf(r) + dir * rtl + all.length) % all.length];
  next.focus(); next.click();
});
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (a && layerCount() && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); navigate(a.getAttribute('href').slice(1), { keepProfile: false }); return; }
  const proto = $('proto');
  // e.target may already be detached (the proto bar re-renders itself on click)
  if (proto.dataset.open === 'true' && e.target.isConnected && !proto.contains(e.target)) { proto.dataset.open = 'false'; renderProto(); }
});
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'palette') openPalette();
  else if (act === 'profile') openProfileSwitcher();
  else if (act === 'connection') openConnection();
  else if (act === 'drawer') openNavDrawer();
  else if (act === 'collapse' || act === 'expand') {
    prefs.navCollapsed = act === 'collapse'; savePrefs(); renderSide();
    $('side').querySelector(prefs.navCollapsed ? '[data-act="expand"]' : '[data-act="collapse"]')?.focus();
  }
});
$('side').addEventListener('click', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  const open = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', String(open));
  document.getElementById(b.getAttribute('aria-controls')).hidden = !open;
  prefs.groups[b.dataset.group] = open;
  savePrefs();
});
window.addEventListener('hashchange', () => { closeAllLayers({ fromHistory: true }); route(); });
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const s = sizeClass();
    if (s !== S.size) { S.size = s; renderScreen({ focus: false }); }
  });
});
// Tab bar hides while scrolling down, returns on scroll up (IA §2)
let lastY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const d = y - lastY;
  if (Math.abs(d) < 6) return;
  const hide = S.size === 'compact' && d > 0 && y > 72 && !$('tabbar').contains(document.activeElement);
  app.classList.toggle('is-tabbar-hidden', hide);
  document.body.classList.toggle('is-tabbar-hidden', hide);
  lastY = y;
}, { passive: true });
// Soft keyboard inset (mobile §1)
if (window.visualViewport) {
  const vv = window.visualViewport;
  const kb = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    app.classList.toggle('is-keyboard', inset > 120);
  };
  vv.addEventListener('resize', kb);
}
// Toasts and the PROTOTYPE pill stay above sticky `data-dock` bars (bulk bar, dispatch bar)
let dockRaf = 0;
const scheduleDock = () => { cancelAnimationFrame(dockRaf); dockRaf = requestAnimationFrame(measureDock); };
new MutationObserver(scheduleDock).observe($('main'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-dock'] });
window.addEventListener('resize', scheduleDock);
window.addEventListener('scroll', scheduleDock, { passive: true, capture: true });

/* ---- Boot ---- */
applyAppearance();
renderProto();
route({ focus: false });
