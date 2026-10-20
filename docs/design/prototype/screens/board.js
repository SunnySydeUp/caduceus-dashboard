// Work › Board (work-model §2–§3, mobile §3–§4).
// Large/medium: status (or profile) columns with drag as an enhancement. Compact: ?variant=list (status
// segmented control over a vertical list, default) or ?variant=columns (82% scroll-snap columns).
// Every card action (Move to… / Assign… / Priority…) is reachable from the ⋮ button and long-press.
// Named exports are shared with tasks.js (same owner).
import {
  html, raw, esc, icon, statusBadge, taskState, avatar, emptyState, fuzzy,
  fmtAgo, fmtDur, fmtMoney, TASK_STATUSES, getTask, getPlaybook, inScope, overlaysSettled,
} from '../shared.js';

/* ---------- Screen CSS (one <link> per screen file) ---------- */
export function ensureCss(name) {
  if (document.querySelector(`link[data-screen-css="${name}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL(`./${name}.css`, import.meta.url).href;
  l.dataset.screenCss = name;
  document.head.append(l);
}
ensureCss('board');

/* ---------- In-page query state (filters/tabs live in the URL, IA §7) ---------- */
/** Query read straight from the hash: ctx.query is a snapshot from the last hashchange. */
export function liveQuery() {
  return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
}
/** True while rerender() refreshes in place, so screens keep transient state (selection) across it. */
export let keepState = false;
/** Re-render the screen keeping focus (by data-fk), caret and horizontal scroll positions (by data-keep-scroll). */
export function rerender(ctx, focusKey) {
  const a = document.activeElement;
  const key = focusKey || a?.closest?.('#main [data-fk]')?.dataset.fk;
  let sel = null;
  try { if (a && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch { /* non-text input */ }
  const scrolls = [...document.querySelectorAll('#main [data-keep-scroll]')].map((el) => [el.dataset.keepScroll, el.scrollLeft, el.scrollTop]);
  keepState = true;
  try { ctx.refresh(); } finally { keepState = false; }
  for (const [k, l, t] of scrolls) {
    const el = document.querySelector(`#main [data-keep-scroll="${CSS.escape(k)}"]`);
    if (el) { el.scrollLeft = l; el.scrollTop = t; }
  }
  if (!key) return;
  const el = document.querySelector(`#main [data-fk="${CSS.escape(key)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ }
}
/** Patch the hash query without a hashchange (no focus jump to the h1), then re-render. */
export function setQuery(ctx, patch, focusKey) {
  const [p, qs] = location.hash.slice(1).split('?');
  const q = new URLSearchParams(qs || '');
  for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') q.delete(k); else q.set(k, v); }
  const s = q.toString();
  history.replaceState(history.state, '', `#${p}${s ? '?' + s : ''}`);
  rerender(ctx, focusKey);
}

/* ---------- Vocabulary ---------- */
export const STATUS = {
  triage: { label: 'Triage', icon: 'draft', hint: 'Rough idea; Specify turns it into a brief' },
  todo: { label: 'Todo', icon: 'queued', hint: 'Accepted, not yet ready to dispatch' },
  scheduled: { label: 'Scheduled', icon: 'clock', hint: 'Becomes ready at a set time', locked: 'Set a time from the task’s Schedule' },
  ready: { label: 'Ready', icon: 'play', hint: 'The dispatcher claims it when a slot is free' },
  running: { label: 'Running', icon: 'running', hint: 'Claimed by a worker', locked: 'Only the dispatcher claims tasks; use Run now' },
  blocked: { label: 'Blocked', icon: 'blocked', hint: 'Waiting on input, a dependency or a retry' },
  review: { label: 'Review', icon: 'flag', hint: 'Waiting for your approval' },
  done: { label: 'Done', icon: 'succeeded', hint: 'Finished; archived after 7 days' },
};
export const PRIO = {
  P0: { tone: 'danger', label: 'Urgent' },
  P1: { tone: 'warning', label: 'High' },
  P2: { tone: 'info', label: 'Normal' },
  P3: { tone: 'neutral', label: 'Low' },
};
export const prioTag = (p) => html`<span class="tag prio" data-tone="${PRIO[p]?.tone || 'neutral'}"><span class="sr-only">Priority </span>${p}</span>`;

/** Hermes `tenant` (namespace string; never the category). Screen-local mock values. */
const TENANT = { t_1043: 'unit-4b', t_1038: 'ledger', t_1041: '14-elm-st', t_1049: 'api', t_1045: 'api', t_1046: 'api', t_1040: 'ui', t_1061: 'ui', t_1060: 'ui', t_1036: 'ui' };
export const tenantOf = (t) => t.tenant ?? TENANT[t.id] ?? null;
export const assigneeLabel = (a) => (a === 'you' ? 'You' : a || 'Unassigned');
export function assigneeTag(a) {
  if (!a) return html`<span class="ptag"><span class="avatar avatar--sm avatar--none" aria-hidden="true"></span><span class="ptag__name subtle">Unassigned</span></span>`;
  return html`<span class="ptag">${avatar(a, { size: 'sm' })}<span class="ptag__name">${assigneeLabel(a)}</span></span>`;
}
const skillName = (s) => s.split('/').pop();

/** Short human reason a card is not moving (blocked / stale / gave up). */
export function blockedReason(t) {
  const last = t.runs?.[t.runs.length - 1];
  if (t.status === 'running' && t.stale) return { tone: 'stale', icon: 'stale', text: `No heartbeat for ${fmtAgo(t.heartbeat)}; reclaim to retry` };
  if (t.status !== 'blocked') return null;
  if (t.gave_up) return { tone: 'danger', icon: 'failed', text: `Gave up after ${t.runs.length} attempts · ${last?.error || 'failed'}` };
  if (t.block_kind === 'needs_input') return { tone: 'warning', icon: 'question', text: last?.summary || 'Needs your answer' };
  if (t.block_kind === 'dependency') return { tone: 'blocked', icon: 'link', text: `Waiting on ${(t.parents || []).join(', ') || 'a parent task'}` };
  if (t.block_kind === 'capability') return { tone: 'blocked', icon: 'puzzle', text: 'No assignee has the required skill' };
  return { tone: 'blocked', icon: 'refresh', text: last?.error ? `Retrying · ${last.error}` : 'Transient failure; retry pending' };
}

/* ---------- Card ---------- */
export function taskCard(ctx, t, { selectMode = false, selected = false, showStatus = true, draggable = false } = {}) {
  const st = taskState(t);
  const run = t.runs?.[t.runs.length - 1];
  const attn = ['waiting', 'failed', 'stale'].includes(st.state);
  const reason = blockedReason(t);
  const pb = t.playbook && getPlaybook(t.playbook);
  const live = t.status === 'running' && !t.stale && run?.status === 'running';
  const contract = t.completion_contract
    ? (/^https?:/.test(t.completion_contract) ? `PR #${t.completion_contract.split('/').pop()}` : t.completion_contract === 'local-only' ? 'local-only' : t.completion_contract.split('/').pop())
    : null;
  return html`<article class="kcard${attn ? ' is-attn' : ''}${selected ? ' is-selected' : ''}${selectMode ? ' is-selecting' : ''}" data-task="${t.id}" ${draggable ? raw('draggable="true"') : ''} aria-labelledby="kt-${t.id}">
    <div class="kcard__top">
      ${selectMode ? html`<label class="check kcard__check"><input type="checkbox" data-select="${t.id}" data-fk="sel-${t.id}" ${selected ? raw('checked') : ''}><span class="sr-only">Select ${t.title}</span></label>` : ''}
      ${prioTag(t.priority)}<span class="mono kcard__id">${t.id}</span>
      <button type="button" class="btn btn--ghost btn--icon kcard__menu" data-menu="${t.id}" data-fk="menu-${t.id}" aria-haspopup="dialog" aria-label="Actions for ${t.title}">${icon('dots-v')}</button>
    </div>
    <h3 class="kcard__title" id="kt-${t.id}"><a class="kcard__link" href="${ctx.href('/work/tasks/' + t.id)}" data-fk="card-${t.id}">${t.title}</a></h3>
    ${showStatus ? html`<div class="kcard__status">${statusBadge(st.state, { label: st.label })}</div>` : ''}
    ${reason ? html`<p class="kcard__reason" data-tone="${reason.tone}">${icon(reason.icon, 'i-sm')}<span>${reason.text}</span></p>` : ''}
    ${live ? html`<div class="kcard__run">
        ${t.goal_mode ? html`<div class="progress" data-tone="running" role="img" aria-label="Goal turn ${run.turn} of ${t.goal_max_turns}"><i style="--p:${Math.round((run.turn / t.goal_max_turns) * 100)}%"></i></div>` : ''}
        <span class="mono">${run.step ? html`${run.step} · ` : ''}${t.goal_mode ? html`turn ${run.turn}/${t.goal_max_turns} · ` : ''}<span data-elapsed="${run.started}">${fmtDur((Date.now() - run.started) / 1000)}</span> · ${fmtMoney(run.cost)}</span>
      </div>` : ''}
    ${t.goal_mode || contract || pb || t.model_override ? html`<div class="kcard__badges">
      ${t.goal_mode ? html`<span class="tag" data-tone="accent">${icon('target', 'i-sm')}Goal · ${t.goal_max_turns} turns</span>` : ''}
      ${contract ? html`<span class="tag" data-tone="success">${icon('git', 'i-sm')}<span class="sr-only">Completion contract: </span>${contract}</span>` : ''}
      ${pb ? html`<span class="tag">${icon('playbook', 'i-sm')}${pb.name}${t.step_key ? html` · ${t.step_key}` : ''}</span>` : ''}
      ${t.model_override ? html`<span class="tag mono"><span class="sr-only">Model override: </span>${t.model_override}</span>` : ''}
    </div>` : ''}
    <div class="kcard__meta">
      ${assigneeTag(t.assignee)}
      ${t.skills.length ? html`<span class="kcard__skills">${icon('book', 'i-sm')}<span class="truncate">${skillName(t.skills[0])}${t.skills.length > 1 ? ` +${t.skills.length - 1}` : ''}</span></span>` : ''}
      ${t.comments ? html`<span>${icon('chat', 'i-sm')}${t.comments}<span class="sr-only"> comments</span></span>` : ''}
      <span class="kcard__ago">${fmtAgo(t.updated)}</span>
    </div>
  </article>`;
}

/* ---------- Sheets: task menu, Move to…, Assign…, Priority…, generic picker ---------- */
const rowCheck = (on) => (on ? html`<span class="plist__check">${icon('check')}</span>` : html`<span></span>`);

/** Generic single-choice picker sheet. options: [{ value, label, sub?, lead?, disabled? }] */
export function openPicker(ctx, { title, label, options, current, onPick, note = '' }) {
  ctx.openSheet({
    title,
    detents: options.length > 6 ? ['half', 'full'] : ['auto'],
    body: String(html`<div class="plist" role="radiogroup" aria-label="${label || title}">${options.map((o) => html`
      <button type="button" class="plist__row" role="radio" aria-checked="${String(o.value === current)}" data-v="${o.value ?? ''}" ${o.disabled ? raw('aria-disabled="true"') : ''}>
        ${o.lead || html`<span></span>`}
        <span class="plist__main"><span class="plist__name">${o.label}</span>${o.sub ? html`<span class="plist__sub">${o.sub}</span>` : ''}</span>
        ${o.end || html`<span></span>`}${rowCheck(o.value === current)}
      </button>`)}</div>${note ? html`<p class="plist__note">${raw(note)}</p>` : ''}`),
    initialFocus: '[aria-checked="true"]',
    onMount(panel, layer) {
      panel.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        layer.close();
        await overlaysSettled();
        onPick(b.dataset.v || null);
      }));
    },
  });
}

function snapshot(tasks) { return tasks.map((t) => [t, { status: t.status, block_kind: t.block_kind, gave_up: t.gave_up, stale: t.stale, assignee: t.assignee, priority: t.priority, updated: t.updated }]); }
function restore(snap) { for (const [t, s] of snap) Object.assign(t, s); }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const subject = (tasks) => (tasks.length === 1 ? tasks[0].id : plural(tasks.length, 'task'));

/* ---------- Tabs (scrollable segmented header on phones, mobile §4) ---------- */
/** tabs: [{ key, label, count? }]. Panel must be rendered with tabPanelAttrs(key). */
export function tabsHtml(tabs, current, label) {
  return html`<div class="wtabs" role="tablist" aria-label="${label}" data-keep-scroll="tabs">${tabs.map((t) => html`
    <button type="button" role="tab" id="tab-${t.key}" aria-controls="panel-${t.key}" aria-selected="${String(t.key === current)}" tabindex="${t.key === current ? '0' : '-1'}" data-tab="${t.key}" data-fk="tab-${t.key}">${t.label}${t.count != null ? html`<span class="wtabs__n mono">${t.count}</span>` : ''}</button>`)}</div>`;
}
export const tabPanelAttrs = (key) => raw(`role="tabpanel" id="panel-${key}" aria-labelledby="tab-${key}" tabindex="0"`);
/** Click/arrow-key handling; onSelect(key) should persist the tab (setQuery). */
export function bindTabs(root, onSelect) {
  const list = root.querySelector('.wtabs');
  if (!list) return;
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && b.getAttribute('aria-selected') !== 'true') onSelect(b.dataset.tab); });
  list.addEventListener('keydown', (e) => {
    const all = [...list.querySelectorAll('[role=tab]')];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const rtl = getComputedStyle(list).direction === 'rtl' ? -1 : 1;
    const next = { ArrowRight: i + rtl, ArrowLeft: i - rtl, Home: 0, End: all.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    onSelect(all[(next + all.length) % all.length].dataset.tab);
  });
  const on = list.querySelector('[aria-selected="true"]');
  if (on) {
    const dx = on.getBoundingClientRect().left - list.getBoundingClientRect().left;
    if (dx < 0 || dx + on.offsetWidth > list.clientWidth) list.scrollLeft += dx - 24;
  }
}

/** Bulk task ops are T2 (architecture §5): passkey step-up before applying to more than one task. */
export function confirmBulk(ctx, tasks, verb) {
  if (tasks.length <= 1) return Promise.resolve(true);
  const ids = tasks.map((t) => `<span class="mono">${esc(t.id)}</span>`).join(', ');
  return ctx.openDialog({ tier: 2, title: `${verb}: ${tasks.length} tasks?`, body: `Applies to ${ids}. You can undo from the toast for 6 seconds.`, confirmLabel: verb });
}
export function moveTasks(ctx, tasks, to, after) {
  const snap = snapshot(tasks);
  for (const t of tasks) {
    t.status = to; t.updated = Date.now();
    if (to !== 'blocked') { t.block_kind = undefined; t.gave_up = undefined; }
    if (to !== 'running') t.stale = undefined;
  }
  after?.();
  ctx.toast(`Moved ${subject(tasks)} to ${STATUS[to].label}`, { detail: to === 'ready' ? 'The dispatcher claims it on its next tick' : undefined, undo: () => { restore(snap); after?.(); } });
}
export function openMoveTo(ctx, tasks, after) {
  const cur = new Set(tasks.map((t) => t.status));
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, ctx.data.tasks.filter((t) => t.status === s && t.board === tasks[0].board).length]));
  openPicker(ctx, {
    title: tasks.length === 1 ? 'Move to…' : `Move ${tasks.length} tasks to…`,
    label: 'Status',
    current: cur.size === 1 ? [...cur][0] : null,
    options: TASK_STATUSES.map((s) => ({
      value: s, label: STATUS[s].label, sub: STATUS[s].locked || STATUS[s].hint, disabled: !!STATUS[s].locked,
      lead: html`<span class="plist__ico">${icon(STATUS[s].icon)}</span>`, end: html`<span class="mono subtle">${counts[s]}</span>`,
    })),
    note: 'Moving a card never starts a run by itself. <strong>Ready</strong> hands it to the dispatcher.',
    onPick: async (to) => { if (to && !(cur.size === 1 && cur.has(to)) && await confirmBulk(ctx, tasks, `Move to ${STATUS[to].label}`)) moveTasks(ctx, tasks, to, after); },
  });
}
export function openAssign(ctx, tasks, after) {
  const cur = new Set(tasks.map((t) => t.assignee || ''));
  openPicker(ctx, {
    title: tasks.length === 1 ? 'Assign…' : `Assign ${tasks.length} tasks…`,
    label: 'Assignee profile',
    current: cur.size === 1 ? [...cur][0] : undefined,
    options: [
      ...ctx.data.profiles.map((p) => ({ value: p.name, label: p.name, sub: `${p.model} · gateway ${p.gateway}`, lead: avatar(p.name) })),
      { value: 'you', label: 'You', sub: 'Human task: shows up in your Inbox', lead: avatar('you') },
      { value: '', label: 'Unassigned', sub: 'The dispatcher skips unassigned tasks', lead: html`<span class="avatar avatar--none" aria-hidden="true"></span>` },
    ],
    onPick: async (v) => {
      if (!await confirmBulk(ctx, tasks, `Assign to ${assigneeLabel(v)}`)) return;
      const snap = snapshot(tasks);
      tasks.forEach((t) => { t.assignee = v || null; t.updated = Date.now(); });
      after?.();
      ctx.toast(`Assigned ${subject(tasks)} to ${assigneeLabel(v)}`, { undo: () => { restore(snap); after?.(); } });
    },
  });
}
export function openPriority(ctx, tasks, after) {
  const cur = new Set(tasks.map((t) => t.priority));
  openPicker(ctx, {
    title: tasks.length === 1 ? 'Priority…' : `Set priority for ${tasks.length} tasks…`,
    label: 'Priority',
    current: cur.size === 1 ? [...cur][0] : undefined,
    options: Object.entries(PRIO).map(([k, p]) => ({ value: k, label: `${k} · ${p.label}`, lead: prioTag(k), sub: k === 'P0' ? 'Dispatched before everything else' : '' })),
    onPick: async (v) => {
      if (!await confirmBulk(ctx, tasks, `Set priority ${v}`)) return;
      const snap = snapshot(tasks);
      tasks.forEach((t) => { t.priority = v; t.updated = Date.now(); });
      after?.();
      ctx.toast(`Priority ${v} for ${subject(tasks)}`, { undo: () => { restore(snap); after?.(); } });
    },
  });
}
/** Run now = status ready + dispatcher nudge (work-model §2.1). */
export function runNow(ctx, t, after) {
  if (!t.assignee || t.assignee === 'you') { ctx.toast('Assign a profile first', { tone: 'warning', detail: 'Human tasks are not dispatched' }); return; }
  t.status = 'running'; t.block_kind = undefined; t.gave_up = undefined; t.stale = undefined; t.updated = Date.now();
  const id = `r_${2300 + Math.floor(Math.random() * 600)}`;
  t.runs.push({ id, profile: t.assignee, status: 'running', started: Date.now(), duration: 0, step: t.step_key || null, summary: 'Claimed by the dispatcher; reading the brief', tokens: 0, cost: 0, turn: 1 });
  after?.();
  ctx.toast(`Dispatched ${t.id} to ${t.assignee}`, { tone: 'info', detail: `Run ${id} started`, action: { label: 'Open run', onClick: () => ctx.navigate('/work/runs/' + id) } });
}

/** ⋮ / long-press menu for one card. */
export function openTaskMenu(ctx, t, { after, onSelect } = {}) {
  const st = taskState(t);
  const canRun = ['triage', 'todo', 'ready', 'blocked'].includes(t.status) && t.assignee && t.assignee !== 'you';
  const item = (act, ic, label, value = '') => html`<li><button type="button" class="tmenu__item" data-m="${act}">${icon(ic)}<span class="tmenu__label">${label}</span>${value ? html`<span class="tmenu__value">${value}</span>` : ''}${icon('chev-r', 'i-sm')}</button></li>`;
  ctx.openSheet({
    title: t.title,
    body: String(html`<div class="tmenu__head">${prioTag(t.priority)}<span class="mono subtle">${t.id}</span>${statusBadge(st.state, { label: st.label, variant: 'plain' })}</div>
      <ul class="tmenu" role="list">
        ${item('open', 'arrow-r', 'Open task')}
        ${item('move', 'work', 'Move to…', STATUS[t.status]?.label)}
        ${item('assign', 'user', 'Assign…', assigneeLabel(t.assignee))}
        ${item('prio', 'flag', 'Priority…', t.priority)}
        ${canRun ? item('run', 'play', 'Run now') : ''}
        ${onSelect ? item('select', 'check', 'Select…') : ''}
      </ul>`),
    onMount(panel, layer) {
      panel.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => {
        const m = b.dataset.m;
        if (m === 'open') { ctx.navigate('/work/tasks/' + t.id); return; }
        layer.close();
        await overlaysSettled();
        if (m === 'move') openMoveTo(ctx, [t], after);
        else if (m === 'assign') openAssign(ctx, [t], after);
        else if (m === 'prio') openPriority(ctx, [t], after);
        else if (m === 'run') runNow(ctx, t, after);
        else if (m === 'select') onSelect(t);
      }));
    },
  });
}

/* ---------- Dispatcher (orchestration settings) ---------- */
const ORCH = new Map(); // board id → { mode: 'auto'|'manual'|'paused' }
export function orch(board) {
  if (!ORCH.has(board.id)) ORCH.set(board.id, { mode: board.dispatcher === 'paused' ? 'paused' : 'auto' });
  return ORCH.get(board.id);
}
const MODES = { auto: 'Auto-dispatch', manual: 'Manual (Run now only)', paused: 'Paused' };
export function nudge(ctx, boardId, after) {
  const board = ctx.data.boards.find((b) => b.id === boardId) || ctx.data.boards[0];
  const o = orch(board);
  if (o.mode === 'paused') { ctx.toast(`Dispatcher on ${board.name} is paused`, { tone: 'warning', detail: 'Resume it to dispatch ready tasks' }); return; }
  const busy = ctx.data.tasks.filter((t) => t.board === board.id && t.status === 'running' && !t.stale).length;
  const ready = ctx.data.tasks.filter((t) => t.board === board.id && t.status === 'ready' && t.assignee && t.assignee !== 'you')
    .sort((a, b) => a.priority.localeCompare(b.priority));
  if (!ready.length) { ctx.toast('Dispatcher nudged', { tone: 'info', detail: `${board.name}: nothing ready to claim` }); return; }
  if (busy >= board.concurrency) { ctx.toast('Dispatcher nudged', { tone: 'info', detail: `${board.name}: all ${board.concurrency} slots busy; ${ready.length} waiting` }); return; }
  runNow(ctx, ready[0], after);
}

/* ---------- Module state ---------- */
const sel = { on: false, ids: new Set() };

function boardTasks(ctx, board, q) {
  const s = (q.q || '').trim();
  return ctx.data.tasks.filter((t) => t.board === board.id
    && t.status !== 'archived'
    && inScope(t.assignee === 'you' ? null : t.assignee, ctx.scope)
    && (!q.assignee || (q.assignee === 'none' ? !t.assignee : t.assignee === q.assignee))
    && (!q.tenant || tenantOf(t) === q.tenant)
    && (!q.workflow_template_id || (q.workflow_template_id === 'none' ? !t.playbook : t.playbook === q.workflow_template_id))
    && (!s || fuzzy(s, `${t.id} ${t.title} ${t.skills.join(' ')} ${t.assignee || ''}`) >= 0));
}
function lanesFor(ctx, tasks, by) {
  if (by === 'profile') {
    const names = [...ctx.data.profiles.map((p) => p.name), 'you', null];
    return names.map((n) => ({ key: n || 'none', label: assigneeLabel(n), lead: n ? avatar(n, { size: 'sm' }) : html`<span class="avatar avatar--sm avatar--none" aria-hidden="true"></span>`, tasks: tasks.filter((t) => (t.assignee || null) === n) }))
      .filter((l) => l.tasks.length);
  }
  return TASK_STATUSES.map((s) => ({ key: s, label: STATUS[s].label, lead: icon(STATUS[s].icon, 'i-sm'), tasks: tasks.filter((t) => t.status === s) }));
}
const PRANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const sortTasks = (ts) => [...ts].sort((a, b) => (PRANK[a.priority] - PRANK[b.priority]) || (b.updated - a.updated));

export default {
  routes: ['/work/board', '/work/board/:board'],
  title: (ctx) => (ctx.data.boards.find((b) => b.id === ctx.params.board) || ctx.data.boards[0]).name,
  group: 'work',

  render(ctx) {
    const d = ctx.data;
    const q = liveQuery();
    const board = d.boards.find((b) => b.id === ctx.params.board) || d.boards[0];
    if (!keepState) { sel.on = false; sel.ids.clear(); } // fresh navigation / resize: leave selection mode
    const compact = ctx.size === 'compact';
    const by = q.lanes === 'profile' ? 'profile' : 'status';
    const variant = q.variant === 'columns' ? 'columns' : 'list';
    const all = boardTasks(ctx, board, {});
    const tasks = boardTasks(ctx, board, q);
    const lanes = lanesFor(ctx, tasks, by);
    const o = orch(board);
    const busy = all.filter((t) => t.status === 'running' && !t.stale).length;
    const stale = all.filter((t) => t.status === 'running' && t.stale);
    const ready = all.filter((t) => t.status === 'ready').length;
    const needs = all.filter((t) => ['waiting', 'failed'].includes(taskState(t).state)).length;
    const filtered = !!(q.assignee || q.tenant || q.workflow_template_id || q.q);
    const nFilters = ['assignee', 'tenant', 'workflow_template_id'].filter((k) => q[k]).length;
    const dnd = ctx.size === 'large' && !sel.on;
    const card = (t) => html`<li>${taskCard(ctx, t, { selectMode: sel.on, selected: sel.ids.has(t.id), showStatus: by === 'profile' || ['running', 'blocked', 'review', 'scheduled'].includes(t.status), draggable: dnd })}</li>`;

    // Compact list: current lane from ?status= (or ?lane=), defaulting to the first lane that needs attention.
    const laneKey = q.lane || lanes.find((l) => l.tasks.some((t) => ['waiting', 'failed', 'stale'].includes(taskState(t).state)))?.key || lanes.find((l) => l.tasks.length)?.key || lanes[0]?.key;
    const current = lanes.find((l) => l.key === laneKey) || lanes[0];

    const filterChip = (k, ic, label, value) => html`<button type="button" class="chip" data-filter="${k}" data-fk="f-${k}" aria-haspopup="dialog" aria-pressed="${String(!!value)}">${icon(ic)}${label}${value ? html`: <strong class="chip__val">${value}</strong>` : ''}${icon('chev-d', 'i-sm')}</button>`;
    const segLanes = html`<div class="seg bseg" role="radiogroup" aria-label="${by === 'status' ? 'Status' : 'Assignee'}" data-keep-scroll="bseg">${lanes.map((l) => html`
      <button type="button" role="radio" aria-checked="${String(l.key === current?.key)}" data-lane="${l.key}" data-fk="lane-${l.key}">${l.label}<span class="bseg__n mono">${l.tasks.length}</span></button>`)}</div>`;

    const laneEl = (l) => html`<section class="lane" data-lane-drop="${l.key}" aria-labelledby="lane-${l.key}">
      <header class="lane__head"><h2 class="overline lane__title" id="lane-${l.key}">${l.lead}${l.label}</h2><span class="lane__n mono" aria-label="${l.tasks.length} tasks">${l.tasks.length}</span></header>
      ${l.tasks.length ? html`<ul class="kcards" role="list">${sortTasks(l.tasks).map(card)}</ul>` : html`<p class="lane__empty">${by === 'status' && !filtered ? STATUS[l.key]?.hint : 'No tasks'}</p>`}
    </section>`;

    let boardEl;
    if (!tasks.length) {
      boardEl = emptyState({ icon: 'filter', title: filtered ? 'No tasks match these filters' : 'This board is empty', body: filtered ? 'Clear a filter or search for something else.' : 'Create a task, run a playbook or let a schedule add work here.', action: filtered ? html`<button type="button" class="btn btn--secondary" data-clear>Clear filters</button>` : html`<a class="btn btn--primary" href="${ctx.href('/work/tasks/new?board=' + board.id)}">${icon('plus')}New task</a>` });
    } else if (compact && variant === 'list') {
      boardEl = html`${segLanes}
        <section class="blist" aria-labelledby="blist-h">
          <h2 class="sr-only" id="blist-h">${current.label}: ${plural(current.tasks.length, 'task')}</h2>
          ${by === 'status' && STATUS[current.key] ? html`<p class="blist__hint subtle">${STATUS[current.key].hint}</p>` : ''}
          ${current.tasks.length ? html`<ul class="kcards" role="list">${sortTasks(current.tasks).map(card)}</ul>` : emptyState({ icon: STATUS[current.key]?.icon || 'work', title: `Nothing in ${current.label}`, body: filtered ? 'Filters may be hiding tasks.' : STATUS[current.key]?.hint || '' })}
        </section>`;
    } else {
      boardEl = html`${compact ? segLanes : ''}<div class="board bboard${compact ? ' bboard--snap' : ''}" data-keep-scroll="board" tabindex="0" aria-label="Board lanes, scroll sideways">${lanes.map(laneEl)}</div>`;
    }

    return html`<div class="bpage${sel.on ? ' is-selecting' : ''}">
      <header class="page-header">
        <div class="page-header__text">
          <p class="overline">Board</p>
          <div class="bhead"><h1 tabindex="-1">${board.name}</h1><button type="button" class="btn btn--ghost btn--icon" data-switch data-fk="switch" aria-haspopup="dialog" aria-label="Switch board (current: ${board.name})">${icon('chev-d')}</button></div>
          <p class="page-header__sub">${plural(all.length, 'task')} · ${busy} running · ${needs} need${needs === 1 ? 's' : ''} you · ${ready} ready${filtered ? ` · showing ${tasks.length}` : ''}</p>
        </div>
        ${compact ? '' : html`<div class="page-header__actions"><a class="btn btn--primary" href="${ctx.href('/work/tasks/new?board=' + board.id)}">${icon('plus')}New task</a></div>`}
      </header>

      <section class="disp panel" aria-labelledby="disp-h" data-mode="${o.mode}">
        <div class="disp__main">
          <span class="dot${o.mode === 'auto' ? ' pulse' : ''}" data-tone="${o.mode === 'paused' ? 'paused' : stale.length ? 'warning' : 'success'}" aria-hidden="true"></span>
          <div class="disp__text">
            <h2 class="disp__title" id="disp-h">Dispatcher · ${compact ? o.mode[0].toUpperCase() + o.mode.slice(1) : MODES[o.mode]}</h2>
            <p class="disp__sub mono">${busy}/${board.concurrency} ${compact ? 'busy' : 'slots busy'} · ${ready} ready${stale.length ? html` · <span class="disp__warn">${stale.length} stale</span>` : ''}</p>
          </div>
        </div>
        ${ctx.size !== 'compact' ? html`<div class="seg" role="radiogroup" aria-label="Orchestration mode">${Object.keys(MODES).map((m) => html`<button type="button" role="radio" aria-checked="${String(o.mode === m)}" data-mode="${m}" data-fk="mode-${m}">${m === 'auto' ? 'Auto' : m === 'manual' ? 'Manual' : 'Paused'}</button>`)}</div>` : ''}
        <div class="disp__actions">
          ${stale.length ? html`<button type="button" class="btn btn--secondary btn--sm" data-reclaim="${stale[0].id}">${icon('refresh')}Reclaim ${stale[0].id}</button>` : ''}
          <button type="button" class="btn btn--secondary btn--sm" data-nudge data-fk="nudge" ${o.mode === 'paused' ? raw('aria-disabled="true"') : ''}>${icon('bolt')}Nudge</button>
          ${ctx.size === 'compact' ? html`<button type="button" class="btn btn--ghost btn--icon" data-disp-settings aria-haspopup="dialog" aria-label="Dispatcher settings">${icon('settings')}</button>` : ''}
        </div>
      </section>

      <div class="btools" role="search" aria-label="Filter tasks">
        <div class="input-wrap btools__search">${icon('search')}<input class="input" type="search" data-q data-fk="q" value="${q.q || ''}" placeholder="Search this board" aria-label="Search tasks on this board" enterkeyhint="search"></div>
        <div class="chips-scroll btools__chips" data-keep-scroll="chips">
          ${filterChip('assignee', 'user', 'Assignee', q.assignee ? assigneeLabel(q.assignee === 'none' ? null : q.assignee) : '')}
          ${filterChip('tenant', 'briefcase', 'Tenant', q.tenant || '')}
          ${filterChip('workflow_template_id', 'playbook', 'Playbook', q.workflow_template_id ? (q.workflow_template_id === 'none' ? 'None' : getPlaybook(q.workflow_template_id)?.name) : '')}
          ${nFilters || q.q ? html`<button type="button" class="btn btn--ghost btn--sm" data-clear data-fk="clear">${icon('x')}Clear</button>` : ''}
        </div>
        <div class="btools__view">
          <div class="seg" role="radiogroup" aria-label="Lanes by">
            <button type="button" role="radio" aria-checked="${String(by === 'status')}" data-lanes="status" data-fk="lanes-status">${compact ? '' : icon('work')}Status</button>
            <button type="button" role="radio" aria-checked="${String(by === 'profile')}" data-lanes="profile" data-fk="lanes-profile">${compact ? '' : icon('users')}Profile</button>
          </div>
          ${compact ? html`<div class="seg" role="radiogroup" aria-label="Layout">
            <button type="button" role="radio" aria-checked="${String(variant === 'list')}" data-variant="list" data-fk="v-list" aria-label="List">${icon('rows')}</button>
            <button type="button" role="radio" aria-checked="${String(variant === 'columns')}" data-variant="columns" data-fk="v-columns" aria-label="Columns">${icon('work')}</button>
          </div>` : ''}
          <button type="button" class="btn btn--secondary btn--sm" data-selectmode data-fk="selectmode" aria-pressed="${String(sel.on)}">${icon('check')}${sel.on ? 'Done' : 'Select'}</button>
        </div>
      </div>

      ${boardEl}

      ${sel.on ? html`<div class="bulkbar" data-dock role="region" aria-label="Bulk actions">
        <p class="bulkbar__n" aria-live="polite"><strong>${sel.ids.size}</strong> selected</p>
        ${compact
          ? html`<button type="button" class="btn btn--primary btn--sm" data-bulk="sheet" data-fk="bulk-sheet" ${sel.ids.size ? '' : raw('disabled')}>Actions…</button>`
          : html`<button type="button" class="btn btn--secondary btn--sm" data-bulk="all" data-fk="bulk-all">Select all ${tasks.length}</button>
            <button type="button" class="btn btn--secondary btn--sm" data-bulk="move" ${sel.ids.size ? '' : raw('disabled')}>${icon('work')}Move to…</button>
            <button type="button" class="btn btn--secondary btn--sm" data-bulk="assign" ${sel.ids.size ? '' : raw('disabled')}>${icon('user')}Assign…</button>
            <button type="button" class="btn btn--secondary btn--sm" data-bulk="prio" ${sel.ids.size ? '' : raw('disabled')}>${icon('flag')}Priority…</button>`}
        <button type="button" class="btn btn--ghost btn--sm" data-selectmode data-fk="selectmode-bar">Cancel</button>
      </div>` : ''}
    </div>`;
  },

  mount(root, ctx) {
    const d = ctx.data;
    const board = d.boards.find((b) => b.id === ctx.params.board) || d.boards[0];
    const after = () => rerender(ctx);
    const selected = () => [...sel.ids].map(getTask).filter(Boolean);
    let longPressAt = 0;
    if (ctx.size === 'compact') ctx.setAppBar({ actions: [{ icon: 'plus', label: 'New task', onClick: () => ctx.navigate('/work/tasks/new?board=' + board.id) }] });
    // Keep the current lane visible in the scrollable segmented control.
    const segOn = root.querySelector('.bseg [aria-checked="true"]');
    if (segOn) {
      const box = segOn.parentElement, dx = segOn.getBoundingClientRect().left - box.getBoundingClientRect().left;
      if (dx < 0 || dx + segOn.offsetWidth > box.clientWidth) box.scrollLeft += dx - 24;
    }

    const pickFilter = (k) => {
      const q = liveQuery();
      const ts = d.tasks.filter((t) => t.board === board.id);
      let options;
      if (k === 'assignee') {
        const names = [...new Set(ts.map((t) => t.assignee || 'none'))];
        options = [{ value: '', label: 'Any assignee' }, ...names.map((n) => ({ value: n, label: assigneeLabel(n === 'none' ? null : n), lead: n === 'none' ? html`<span class="avatar avatar--none" aria-hidden="true"></span>` : avatar(n), end: html`<span class="mono subtle">${ts.filter((t) => (t.assignee || 'none') === n).length}</span>` }))];
      } else if (k === 'tenant') {
        const tens = [...new Set(ts.map(tenantOf).filter(Boolean))].sort();
        options = [{ value: '', label: 'Any tenant', sub: 'Hermes tenant namespace' }, ...tens.map((n) => ({ value: n, label: n, lead: html`<span class="plist__ico">${icon('briefcase')}</span>`, end: html`<span class="mono subtle">${ts.filter((t) => tenantOf(t) === n).length}</span>` }))];
      } else {
        options = [{ value: '', label: 'Any playbook' }, ...d.playbooks.map((p) => ({ value: p.id, label: p.name, sub: `workflow_template_id=${p.id}@${p.version}`, lead: html`<span class="plist__ico">${icon('playbook')}</span>`, end: html`<span class="mono subtle">${ts.filter((t) => t.playbook === p.id).length}</span>` })), { value: 'none', label: 'Not from a playbook' }];
      }
      openPicker(ctx, {
        title: k === 'assignee' ? 'Filter by assignee' : k === 'tenant' ? 'Filter by tenant' : 'Filter by playbook',
        current: q[k] || '', options,
        onPick: (v) => setQuery(ctx, { [k]: v }, `f-${k}`),
      });
    };

    const openBoardSwitch = () => openPicker(ctx, {
      title: 'Switch board', label: 'Board', current: board.id,
      options: d.boards.map((b) => {
        const n = d.tasks.filter((t) => t.board === b.id && t.status !== 'done').length;
        return { value: b.id, label: b.name, sub: `${b.project || 'No project'} · dispatcher ${orch(b).mode} · ${b.concurrency} slot${b.concurrency === 1 ? '' : 's'}`, lead: html`<span class="plist__ico">${icon('work')}</span>`, end: html`<span class="mono subtle">${n} open</span>` };
      }),
      onPick: (v) => {
        if (!v || v === board.id) return;
        const q = new URLSearchParams(liveQuery());
        q.delete('lane');
        const s = q.toString();
        ctx.navigate(`/work/board/${v}${s ? '?' + s : ''}`);
      },
    });

    const setMode = (m) => {
      const o = orch(board);
      const prev = o.mode;
      if (prev === m) return;
      o.mode = m; board.dispatcher = m === 'paused' ? 'paused' : 'running';
      rerender(ctx);
      ctx.toast(`Dispatcher: ${MODES[m]}`, { detail: board.name, undo: () => { o.mode = prev; board.dispatcher = prev === 'paused' ? 'paused' : 'running'; rerender(ctx); } });
    };
    const dispSettings = () => ctx.openSheet({
      title: 'Dispatcher',
      body: String(html`<p class="muted">Orchestration settings for <strong>${board.name}</strong>. The dispatcher spawns <span class="mono">hermes -p &lt;assignee&gt;</span> for each ready task.</p>
        <div class="field"><span class="field__label" id="om-l">Mode</span>
          <div class="plist" role="radiogroup" aria-labelledby="om-l">${Object.entries(MODES).map(([m, label]) => html`<button type="button" class="plist__row" role="radio" aria-checked="${String(orch(board).mode === m)}" data-m="${m}"><span class="plist__ico">${icon(m === 'auto' ? 'bolt' : m === 'manual' ? 'play' : 'paused')}</span><span class="plist__main"><span class="plist__name">${label}</span><span class="plist__sub">${m === 'auto' ? 'Claims ready tasks whenever a slot is free' : m === 'manual' ? 'Only Run now and Nudge start work' : 'Nothing new starts; running work continues'}</span></span><span></span>${rowCheck(orch(board).mode === m)}</button>`)}</div></div>
        <dl class="kv"><dt>concurrency</dt><dd>${board.concurrency} slots</dd><dt>circuit breaker</dt><dd>3 consecutive failures → gave up</dd><dt>max runtime</dt><dd>per task (default 2h)</dd></dl>`),
      onMount(panel, layer) {
        panel.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => { layer.close(); await overlaysSettled(); setMode(b.dataset.m); }));
      },
    });

    const bulkSheet = () => {
      const ts = selected();
      ctx.openSheet({
        title: `${plural(ts.length, 'task')} selected`,
        body: String(html`<ul class="tmenu" role="list">
          <li><button type="button" class="tmenu__item" data-b="move">${icon('work')}<span class="tmenu__label">Move to…</span>${icon('chev-r', 'i-sm')}</button></li>
          <li><button type="button" class="tmenu__item" data-b="assign">${icon('user')}<span class="tmenu__label">Assign…</span>${icon('chev-r', 'i-sm')}</button></li>
          <li><button type="button" class="tmenu__item" data-b="prio">${icon('flag')}<span class="tmenu__label">Priority…</span>${icon('chev-r', 'i-sm')}</button></li>
          <li><button type="button" class="tmenu__item" data-b="all">${icon('check')}<span class="tmenu__label">Select all in view</span></button></li>
        </ul>`),
        onMount(panel, layer) {
          panel.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', async () => {
            layer.close(); await overlaysSettled();
            bulk(b.dataset.b);
          }));
        },
      });
    };
    const bulkAfter = () => { sel.ids.clear(); sel.on = false; rerender(ctx, 'selectmode'); };
    const bulk = (k) => {
      if (k === 'sheet') return bulkSheet();
      if (k === 'all') { root.querySelectorAll('[data-task]').forEach((c) => sel.ids.add(c.dataset.task)); return rerender(ctx); }
      const ts = selected();
      if (!ts.length) return;
      if (k === 'move') openMoveTo(ctx, ts, bulkAfter);
      if (k === 'assign') openAssign(ctx, ts, bulkAfter);
      if (k === 'prio') openPriority(ctx, ts, bulkAfter);
    };
    const enterSelect = (t) => { sel.on = true; if (t) sel.ids.add(t.id); rerender(ctx, t ? `sel-${t.id}` : 'selectmode'); };

    root.addEventListener('click', (e) => {
      const t = e.target;
      const b = t.closest('button, a, input');
      const cardEl = t.closest('[data-task]');
      if (sel.on && cardEl && !t.closest('[data-menu]')) {
        // Selection mode: the whole card toggles; links do not navigate.
        if (b?.matches('a')) e.preventDefault();
        const id = cardEl.dataset.task;
        if (!t.matches('input[data-select]')) { e.preventDefault(); }
        sel.ids.has(id) ? sel.ids.delete(id) : sel.ids.add(id);
        rerender(ctx, `sel-${id}`);
        return;
      }
      if (cardEl && Date.now() - longPressAt < 700) { e.preventDefault(); return; }
      if (!b) return;
      if (b.dataset.menu) openTaskMenu(ctx, getTask(b.dataset.menu), { after, onSelect: enterSelect });
      else if (b.dataset.filter) pickFilter(b.dataset.filter);
      else if (b.hasAttribute('data-clear')) setQuery(ctx, { assignee: null, tenant: null, workflow_template_id: null, q: null }, 'q');
      else if (b.dataset.lanes) setQuery(ctx, { lanes: b.dataset.lanes === 'status' ? null : b.dataset.lanes, lane: null }, `lanes-${b.dataset.lanes}`);
      else if (b.dataset.variant) setQuery(ctx, { variant: b.dataset.variant === 'list' ? null : b.dataset.variant }, `v-${b.dataset.variant}`);
      else if (b.dataset.lane) {
        if (root.querySelector('.bboard--snap')) {
          // Columns variant: the segmented control jumps to a column.
          root.querySelector(`[data-lane-drop="${CSS.escape(b.dataset.lane)}"]`)?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'smooth' });
          root.querySelectorAll('[data-lane]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        } else setQuery(ctx, { lane: b.dataset.lane }, `lane-${b.dataset.lane}`);
      } else if (b.hasAttribute('data-selectmode')) { sel.on = !sel.on; sel.ids.clear(); rerender(ctx, 'selectmode'); }
      else if (b.dataset.bulk) bulk(b.dataset.bulk);
      else if (b.hasAttribute('data-switch')) openBoardSwitch();
      else if (b.dataset.mode) setMode(b.dataset.mode);
      else if (b.hasAttribute('data-disp-settings')) dispSettings();
      else if (b.hasAttribute('data-nudge')) nudge(ctx, board.id, after);
      else if (b.dataset.reclaim) {
        const task = getTask(b.dataset.reclaim);
        ctx.openDialog({ tier: 1, title: `Reclaim ${task.id}?`, body: `Terminates the silent worker for <strong>${esc(task.title)}</strong> and returns the task to <strong>Ready</strong>. Its partial run is kept.`, profile: task.assignee, confirmLabel: 'Reclaim' })
          .then((ok) => {
            if (!ok) return;
            task.status = 'ready'; task.stale = undefined;
            const last = task.runs[task.runs.length - 1]; if (last) last.status = 'cancelled';
            const h = d.health.find((x) => x.id === 'dispatcher'); if (h) { h.state = 'online'; h.metric = '0 stale'; h.detail = 'All workers reporting'; }
            ctx.refresh();
            ctx.toast(`Reclaimed ${task.id}`, { detail: 'Back in Ready' });
          });
      }
    });

    // Search: debounce, keep caret.
    let qt = 0;
    root.querySelector('[data-q]')?.addEventListener('input', (e) => {
      clearTimeout(qt);
      const v = e.target.value;
      qt = setTimeout(() => setQuery(ctx, { q: v.trim() || null }, 'q'), 180);
    });

    // Long-press (touch) and context menu (mouse / Android long-press) → card menu.
    let lp = 0, lpXY = null;
    const openFromCard = (el) => {
      if (Date.now() - longPressAt < 700) return;
      longPressAt = Date.now();
      navigator.vibrate?.(8);
      openTaskMenu(ctx, getTask(el.dataset.task), { after, onSelect: enterSelect });
    };
    root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-task]');
      if (!el || e.pointerType === 'mouse' || e.target.closest('button, input')) return;
      lpXY = [e.clientX, e.clientY];
      clearTimeout(lp);
      lp = setTimeout(() => openFromCard(el), 500);
    });
    root.addEventListener('pointermove', (e) => { if (lpXY && Math.hypot(e.clientX - lpXY[0], e.clientY - lpXY[1]) > 10) { clearTimeout(lp); lpXY = null; } });
    ['pointerup', 'pointercancel'].forEach((ev) => root.addEventListener(ev, () => { clearTimeout(lp); lpXY = null; }));
    root.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('[data-task]');
      if (!el || sel.on) return;
      e.preventDefault();
      clearTimeout(lp);
      openFromCard(el);
    });

    // Drag between lanes (large + fine pointer only; Move to… is the real path).
    let dragId = null;
    root.addEventListener('dragstart', (e) => {
      const el = e.target.closest?.('[data-task]');
      if (!el) return;
      dragId = el.dataset.task;
      e.dataTransfer.setData('text/plain', dragId);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => el.classList.add('is-dragging'));
    });
    root.addEventListener('dragend', (e) => { e.target.closest?.('[data-task]')?.classList.remove('is-dragging'); root.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop')); dragId = null; });
    root.addEventListener('dragover', (e) => {
      const lane = e.target.closest('[data-lane-drop]');
      if (!lane || !dragId) return;
      e.preventDefault();
      root.querySelectorAll('.is-drop').forEach((x) => x !== lane && x.classList.remove('is-drop'));
      lane.classList.add('is-drop');
    });
    root.addEventListener('drop', (e) => {
      const lane = e.target.closest('[data-lane-drop]');
      if (!lane || !dragId) return;
      e.preventDefault();
      const task = getTask(dragId);
      const key = lane.dataset.laneDrop;
      if (liveQuery().lanes === 'profile') {
        const v = key === 'none' ? null : key;
        if ((task.assignee || null) === v) return;
        const prev = task.assignee;
        task.assignee = v; after();
        ctx.toast(`Assigned ${task.id} to ${assigneeLabel(v)}`, { undo: () => { task.assignee = prev; after(); } });
      } else if (task.status !== key) {
        if (STATUS[key].locked) { ctx.toast(`Can’t drop into ${STATUS[key].label}`, { tone: 'warning', detail: STATUS[key].locked }); return; }
        moveTasks(ctx, [task], key, after);
      }
    });

    // Columns variant: keep the segmented control in sync with the visible column.
    const snap = root.querySelector('.bboard--snap');
    // Start on the lane the segmented control points at (rerender() restores the user's scroll afterwards).
    const on = snap && root.querySelector('.bseg [aria-checked="true"]');
    const lane0 = on && snap.querySelector(`[data-lane-drop="${CSS.escape(on.dataset.lane)}"]`);
    if (lane0) snap.scrollLeft += lane0.getBoundingClientRect().left - snap.getBoundingClientRect().left - (parseFloat(getComputedStyle(snap).scrollPaddingInlineStart) || 0);
    let st = 0;
    snap?.addEventListener('scroll', () => {
      cancelAnimationFrame(st);
      st = requestAnimationFrame(() => {
        const lanes = [...snap.querySelectorAll('[data-lane-drop]')];
        const x = snap.getBoundingClientRect().left + (parseFloat(getComputedStyle(snap).scrollPaddingInlineStart) || 0);
        const cur = lanes.reduce((best, l) => (Math.abs(l.getBoundingClientRect().left - x) < Math.abs(best.getBoundingClientRect().left - x) ? l : best), lanes[0]);
        root.querySelectorAll('[data-lane]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lane === cur?.dataset.laneDrop)));
        const b = root.querySelector('.bseg [aria-checked="true"]'), box = b?.parentElement;
        if (b) { const dx = b.getBoundingClientRect().left - box.getBoundingClientRect().left; if (dx < 0 || dx + b.offsetWidth > box.clientWidth) box.scrollLeft += dx - 24; }
      });
    }, { passive: true });

    const tick = setInterval(() => root.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); }), 1000);
    return () => { clearInterval(tick); clearTimeout(qt); clearTimeout(lp); };
  },

  paletteActions(ctx) {
    const board = ctx.data.boards.find((b) => b.id === ctx.params.board) || ctx.data.boards[0];
    return [
      { label: 'New task', icon: 'plus', sub: `on ${board.name}`, run: () => ctx.navigate('/work/tasks/new?board=' + board.id) },
      { label: 'Run dispatcher (nudge)', icon: 'bolt', sub: board.name, run: () => nudge(ctx, board.id, () => ctx.refresh()) },
      { label: 'Filter board', icon: 'filter', sub: 'Search and filter cards', run: async () => { await overlaysSettled(); setTimeout(() => document.querySelector('#main [data-q]')?.focus(), 60); } },
    ];
  },
};
