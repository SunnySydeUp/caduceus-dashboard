// Inbox (work-model §2.5, mobile §3–§6, IA §1): one prioritised queue over Hermes state.
// Needs decision → Failed → FYI / activity. Cards show the exact action preview and 1–2 inline actions;
// "More" opens a detail sheet (compact) or the detail pane (list/detail split at ≥ 45rem).
// Gestures (compact / touch): swipe → = done (T0-safe items only), swipe ← = snooze. Both live in the ⋮ menu too.
import {
  html, raw, esc, icon, statusBadge, profileTag, sourceTag, pageHeader, emptyState, kbd, avatar,
  fmtAgo, fmtDur, fmtMoney, fmtTime, fmtWhen, ago, inScope,
  getTask, getSession, getJob, getProfile, openLayer, overlaysSettled, SOURCES,
} from '../shared.js';

/* ---- Screen CSS (loaded once, before first render) ---- */
if (!document.getElementById('css-inbox')) {
  const l = document.createElement('link');
  l.id = 'css-inbox';
  l.rel = 'stylesheet';
  l.href = new URL('./inbox.css', import.meta.url).href;
  document.head.append(l);
}

/* ==========================================================================
   Screen-local mock data: extends `data.inbox` so every §2.5 source is covered.
   The shared records are never redefined; only runtime state (resolved, snoozedUntil) is set on them.
   ========================================================================== */
const LOCAL = [
  { id: 'in_run_failed', kind: 'run_failed', urgency: 'failed', needsAction: false, title: 'Run failed: Add skeletons to Inbox list', preview: 'pnpm build exited 1 · TS2322 in InboxSkeleton.tsx:14', profile: 'coder', source: { type: 'task', id: 't_1040' }, run: 'r_2205', created: ago(22), cost: 0.07 },
  { id: 'in_gateway_down', kind: 'gateway_down', urgency: 'failed', needsAction: false, title: 'Gateway stopped for homeassistant', preview: 'Discord adapter exited: 401 Unauthorized · 3 messages queued', profile: 'homeassistant', source: { type: 'gateway', id: 'homeassistant' }, created: ago(100) },
  { id: 'in_cron_overdue', kind: 'cron_overdue', urgency: 'failed', needsAction: false, title: 'Energy report is overdue', preview: 'Due 1h 35m ago · not started because the homeassistant gateway is stopped', profile: 'homeassistant', source: { type: 'cron', id: 'c_energy' }, created: ago(95) },
  { id: 'in_act_pr', kind: 'finished', urgency: 'fyi', needsAction: false, title: 'Claude Code opened PR #212', preview: 'Refactor gateway client resume logic: coalesce reconnects on visibilitychange', profile: 'coder', source: { type: 'session', id: 's_cc_77a1' }, created: ago(95), cost: 1.84 },
  { id: 'in_act_brief', kind: 'finished', urgency: 'fyi', needsAction: false, title: 'Morning briefing delivered to Telegram', preview: '3 meetings, rain after 15:00, 2 packages arriving.', profile: 'default', source: { type: 'session', id: 's_cron_brief' }, created: ago(690), cost: 0.01 },
  { id: 'in_act_research', kind: 'finished', urgency: 'fyi', needsAction: false, title: 'Research brief finished: local vector DBs', preview: 'Report attached: vector-dbs-2026.md (11 sources)', profile: 'librarian', source: { type: 'task', id: 't_1044' }, created: ago(1440), cost: 0.58 },
];
const UNREAD = new Set(['in_approval', 'in_clarify', 'in_pairing', 'in_review', 'in_run_failed', 'in_gateway_down', 'in_budget', 'in_act_pr']);

/* Kinds → label, glyph and notification category (mobile §6 categories double as filters). */
const KIND = {
  approval: { label: 'Tool approval', icon: 'terminal', cat: 'approvals' },
  clarify: { label: 'Question', icon: 'question', cat: 'approvals' },
  review: { label: 'Review gate', icon: 'flag', cat: 'reviews' },
  needs_input: { label: 'Blocked · needs input', icon: 'blocked', cat: 'reviews' },
  pairing: { label: 'Pairing request', icon: 'user-plus', cat: 'pairing' },
  gave_up: { label: 'Gave up', icon: 'failed', cat: 'failures' },
  run_failed: { label: 'Run failed', icon: 'failed', cat: 'failures' },
  cron_failed: { label: 'Cron run failed', icon: 'clock', cat: 'failures' },
  cron_overdue: { label: 'Cron overdue', icon: 'clock', cat: 'failures' },
  gateway_down: { label: 'Gateway down', icon: 'broadcast', cat: 'failures' },
  budget: { label: 'Budget', icon: 'coin', cat: 'budget' },
  update: { label: 'Update available', icon: 'download', cat: 'updates' },
  finished: { label: 'Finished', icon: 'succeeded', cat: 'finished' },
};
const CATS = [
  { id: 'approvals', label: 'Approvals & questions', sub: 'Tool approvals and clarify questions from live runs' },
  { id: 'reviews', label: 'Reviews & blocked', sub: 'Playbook gates, tasks in review, tasks blocked on you' },
  { id: 'failures', label: 'Failures', sub: 'Runs, cron jobs and the gateway' },
  { id: 'finished', label: 'Finished runs', sub: 'Completed tasks, deliveries and PRs' },
  { id: 'pairing', label: 'Pairing', sub: 'New people asking to DM a profile' },
  { id: 'budget', label: 'Budget', sub: 'Spend crossing 80% and 100%' },
  { id: 'updates', label: 'Updates', sub: 'New Hermes and Caduceus versions' },
];
const GROUPS = [
  { id: 'decision', title: 'Needs decision', icon: 'waiting', tone: 'warning' },
  { id: 'failed', title: 'Failed', icon: 'failed', tone: 'danger' },
  { id: 'fyi', title: 'FYI / activity', icon: 'info', tone: 'neutral' },
];

/* Per-device UI state (snoozes and dismissals are per device in the spec; here they live in memory). */
const S = {
  read: new Set(),
  outcome: new Map(), // id → what happened (resolved this session)
  selected: null, // list/detail selection
  lastHash: null,
  deepLink: null,
  focusedId: null,
  pendingFocus: null,
  hintDismissed: false,
  notif: {
    device: 'ios', permission: 'default', installed: false,
    cats: { approvals: true, reviews: true, failures: true, finished: false, pairing: true, budget: true, updates: false },
    digest: true, digestAt: '18:00', quiet: true, quietFrom: '22:00', quietTo: '07:00', quietBreak: false,
  },
};

/* ---- Helpers ---- */
const codeify = (s) => raw(esc(s).replace(/`([^`]+)`/g, '<code>$1</code>'));
const plain = (s) => String(s).replace(/`/g, '');
const allItems = (ctx) => [...ctx.data.inbox, ...LOCAL];
const findItem = (ctx, id) => allItems(ctx).find((i) => i.id === id);
const isSnoozed = (it) => it.snoozedUntil && it.snoozedUntil > Date.now();
const isOpen = (it) => !it.resolved && !isSnoozed(it);
const isUnread = (it) => UNREAD.has(it.id) && !S.read.has(it.id);
const catOf = (it) => KIND[it.kind]?.cat || 'finished';
const splitMQ = () => window.matchMedia('(min-width: 45rem)');
const isSplit = () => splitMQ().matches;
const isCompact = () => window.innerWidth < 600;
/** T0-safe resolution: per-device dismissal of failures and FYI. Gestures never grant approval (design-system: Approval card). */
const canDone = (it) => it.urgency !== 'decision' && it.kind !== 'gateway_down';
const doneLabel = (it) => (it.urgency === 'failed' ? 'Dismiss' : 'Mark done');

function srcHref(it) {
  const s = it.source;
  if (it.kind === 'run_failed') return `/work/runs/${it.run}`;
  switch (s.type) {
    case 'session': return `/chat/${s.id}`;
    case 'task': return `/work/tasks/${s.id}`;
    case 'cron': return `/work/schedules/${s.id}`;
    case 'pairing': return '/connect/pairing';
    case 'gateway': return '/connect/gateway';
    case 'budget': return '/observe/insights';
    default: return '/system/maintenance';
  }
}
function srcLabel(it) {
  const s = it.source;
  if (s.type === 'session') return getSession(s.id)?.title || s.id;
  if (s.type === 'task') return `${s.id} · ${getTask(s.id)?.title || ''}`;
  if (s.type === 'cron') return getJob(s.id)?.name || s.id;
  if (s.type === 'pairing') return 'Pairing requests';
  if (s.type === 'gateway') return `Gateway · ${s.id}`;
  if (s.type === 'budget') return 'Spend & budgets';
  return 'Maintenance';
}
function srcTag(it) {
  const s = it.source;
  const key = s.type === 'session' ? getSession(s.id)?.source : s.type === 'task' ? 'kanban' : s.type === 'cron' ? 'cron' : s.type === 'pairing' ? 'telegram' : s.type === 'gateway' ? 'discord' : null;
  if (key && SOURCES[key]) return sourceTag(key);
  return html`<span class="srctag">${icon(s.type === 'budget' ? 'coin' : 'server', 'i-sm')}<span>${s.type === 'budget' ? 'Budget' : 'System'}</span></span>`;
}
const who = (it) => (it.profile ? profileTag(it.profile) : html`<span class="ptag">${avatar('all', { size: 'sm' })}<span class="ptag__name">All profiles</span></span>`);
const approvalBlock = (ctx) => ctx.data.transcripts.s_8f2c1a.find((b) => b.type === 'approval');

const overlayOpen = () => document.documentElement.classList.contains('has-overlay');
/**
 * Reflect the selection in the URL without a route change (no scroll jump, focus kept).
 * Overlays own history entries, so by default this waits until none is open; `now` is for
 * the instant before a sheet opens.
 */
function setUrl(ctx, path, { now = false } = {}) {
  const s = new URLSearchParams(ctx.query).toString();
  const h = `#${path}${s ? '?' + s : ''}`;
  const apply = () => { history.replaceState(history.state, '', h); S.lastHash = location.hash; };
  if (now) { apply(); return; }
  const later = () => {
    if (overlayOpen()) { setTimeout(later, 150); return; }
    overlaysSettled().then(() => setTimeout(() => (overlayOpen() ? later() : apply()), 0));
  };
  later();
}

/* ==========================================================================
   Actions and tiers (architecture §5): T0 undo toast · T1 confirm naming object + profile ·
   T2 passkey step-up · T3 (not reachable from the Inbox).
   ========================================================================== */
const A = (id, label, tier, o = {}) => ({ id, label, tier, ...o });
function actionsFor(it) {
  switch (it.kind) {
    case 'approval': return [A('allow_once', 'Allow once', 0, { primary: true, inline: true }), A('allow_session', 'This session', 0), A('allow_always', 'Always…', 2), A('deny', 'Deny…', 0, { danger: true, inline: true })];
    case 'clarify': return [A('reply', 'Reply…', 0, { inline: true })];
    case 'review': return [A('review_approve', 'Approve', 0, { primary: true, inline: true }), A('review_reject', 'Reject + note…', 0, { danger: true, inline: true }), A('open_source', 'Open result', null)];
    case 'needs_input': return [A('unblock', 'Answer & unblock…', 0, { primary: true, inline: true }), A('open_source', 'Open task', null)];
    case 'pairing': return [A('pair_approve', 'Approve…', 2, { primary: true, inline: true }), A('pair_deny', 'Deny', 0, { danger: true, inline: true })];
    case 'gave_up': return [A('retry', 'Retry…', 1, { primary: true, inline: true }), A('reassign', 'Reassign…', 0, { inline: true }), A('open_source', 'Open log', null)];
    case 'run_failed': return [A('retry', 'Retry run…', 1, { primary: true, inline: true }), A('reassign', 'Reassign…', 0, { inline: true }), A('open_source', 'Open run', null)];
    case 'cron_failed': return [A('cron_run', 'Run now…', 1, { primary: true, inline: true }), A('cron_pause', 'Pause job', 0, { inline: true }), A('open_source', 'Open output', null)];
    case 'cron_overdue': return [A('cron_run', 'Run now…', 1, { primary: true, inline: true }), A('cron_pause', 'Pause job', 0, { inline: true }), A('open_source', 'Open job', null)];
    case 'gateway_down': return [A('restart_gateway', 'Restart gateway…', 2, { primary: true, inline: true }), A('open_source', 'Open gateway', null)];
    case 'budget': return [A('raise_budget', 'Raise budget…', 1, { primary: true, inline: true }), A('open_source', 'Open spend', null, { inline: true })];
    case 'update': return [A('update_notes', 'Release notes', null, { inline: true }), A('update_now', 'Update…', 2, { inline: true })];
    default: return [A('open_source', 'Open', null, { inline: true })];
  }
}
/** "Approve focused item" in the palette: the item's primary decision. */
function primaryAction(it) {
  const acts = actionsFor(it);
  return acts.find((a) => a.primary) || (it.kind === 'clarify' ? acts[0] : null) || (canDone(it) ? A('done', doneLabel(it), 0) : null);
}
const TIER_NOTE = { 0: 'Undo for 6 s', 1: 'Confirm', 2: 'Passkey', 3: 'Passkey + type' };

function actBtn(ctx, it, a, { sm = true } = {}) {
  const cls = a.primary ? 'btn--primary' : a.danger ? 'btn--danger-quiet' : 'btn--secondary';
  const off = ctx.data.connection === 'offline' && a.tier >= 2;
  return html`<button type="button" class="btn ${cls}${sm ? ' btn--sm' : ''}" data-do="${a.id}" data-item="${it.id}" ${off ? raw('disabled') : ''}>${a.tier >= 2 ? icon('fingerprint', 'i-sm') : ''}<span>${a.label}</span>${a.tier >= 2 ? html`<span class="sr-only"> (needs passkey${off ? '; unavailable offline' : ''})</span>` : ''}</button>`;
}

/** Resolve an item: refresh, keep focus on the next card, offer Undo when the action is T0. */
function resolve(ctx, it, verb, { detail, undo = true, tone } = {}) {
  const order = [...document.querySelectorAll('.ibx [data-id]')].map((el) => el.dataset.id);
  const i = order.indexOf(it.id);
  const next = order[i + 1] || order[i - 1] || null;
  it.resolved = true;
  S.outcome.set(it.id, verb);
  S.read.add(it.id);
  if (S.selected === it.id) {
    S.selected = next;
    if (isSplit()) setUrl(ctx, next ? `/inbox/${next}` : '/inbox');
  }
  S.pendingFocus = next ? `[data-id="${next}"] .icard__title a` : 'h1';
  ctx.refresh();
  ctx.toast(verb, {
    tone, detail: detail || `${it.profile || 'all profiles'} · ${it.source.id}`,
    undo: undo ? () => { it.resolved = false; S.outcome.delete(it.id); S.pendingFocus = `[data-id="${it.id}"] .icard__title a`; ctx.refresh(); } : undefined,
  });
}

async function perform(ctx, it, act, value) {
  const d = ctx.data;
  const name = plain(it.title);
  S.read.add(it.id);
  switch (act) {
    case 'allow_once': return resolve(ctx, it, 'Allowed once: git push origin feat/x', { detail: 'coder · s_8f2c1a · sends when the undo window closes' });
    case 'allow_session': return resolve(ctx, it, 'Allowed git push for this session', { detail: 'coder · s_8f2c1a · until the session ends' });
    case 'allow_always': {
      const ok = await ctx.openDialog({
        tier: 2, title: 'Always allow git push?', profile: it.profile, confirmLabel: 'Always allow',
        body: 'Adds <span class="mono">git push*</span> to the <strong>coder</strong> allowlist. Future pushes from any coder session run without asking. Remove it in Agents › Tools › Approvals.',
      });
      if (ok) resolve(ctx, it, 'Rule added: always allow git push* on coder', { detail: 'approvals.yaml · this push runs now', undo: false });
      return;
    }
    case 'deny': return denySheet(ctx, it);
    case 'choose': return resolve(ctx, it, `Answered “${value}”`, { detail: `${it.profile} · ${it.source.id} · the agent continues` });
    case 'reply': return replySheet(ctx, it);
    case 'review_approve': return resolve(ctx, it, 'Approved design review', { detail: 'pr_1060 · stage 6 “Implementation plan” starts on coder' });
    case 'review_reject': return rejectSheet(ctx, it);
    case 'unblock': return unblockSheet(ctx, it);
    case 'pair_approve': {
      const ok = await ctx.openDialog({
        tier: 2, title: 'Approve @mara_k on Telegram?', profile: it.profile, confirmLabel: 'Approve pairing',
        body: 'Mara K. can then DM the <strong>default</strong> profile and start sessions that use its tools and memory. Code <span class="mono">4F7-K2Q</span> must match what Mara sees in Telegram.',
      });
      if (ok) {
        const p = d.pairing.find((x) => x.id === 'pair_mara');
        if (p) p.state = 'approved';
        resolve(ctx, it, 'Paired @mara_k with default', { detail: 'telegram · revoke any time in Connect › Pairing', undo: false });
      }
      return;
    }
    case 'pair_deny': return resolve(ctx, it, 'Denied pairing request from @mara_k', { detail: 'telegram · they can ask again in 24 h' });
    case 'retry': {
      const task = getTask(it.source.id);
      const ok = await ctx.openDialog({
        tier: 1, title: `Retry ${it.source.id}?`, profile: task?.assignee || it.profile, confirmLabel: 'Retry',
        body: it.kind === 'gave_up'
          ? `Resets the circuit breaker on <strong>${esc(task?.title)}</strong> and starts attempt 4. The last three failed with HTTP 403, so consider changing the brief or reassigning first.`
          : `Starts a new run of <strong>${esc(task?.title)}</strong> in its worktree. The failed run <span class="mono">${esc(it.run)}</span> and its log are kept.`,
      });
      if (!ok) return;
      if (task) { task.status = 'ready'; task.gave_up = false; }
      return resolve(ctx, it, `Retry queued: ${it.source.id}`, { detail: 'the dispatcher claims it on the next tick', undo: false });
    }
    case 'reassign': return reassignSheet(ctx, it);
    case 'cron_run': {
      const j = getJob(it.source.id);
      const ok = await ctx.openDialog({ tier: 1, title: `Run “${j.name}” now?`, profile: j.profile, confirmLabel: 'Run now', body: `Runs once outside its schedule (${esc(j.human)}). The next scheduled run is unchanged.` });
      if (ok) resolve(ctx, it, `Started ${j.name}`, { detail: `run cr_${9100 + Math.floor(Math.random() * 800)} · ${j.profile}`, undo: false });
      return;
    }
    case 'cron_pause': {
      const j = getJob(it.source.id);
      const prev = j.state;
      j.state = 'paused';
      it.resolved = true;
      S.outcome.set(it.id, `Paused ${j.name}`);
      ctx.refresh();
      ctx.toast(`Paused ${j.name}`, { detail: `${j.profile} · resume from Work › Schedules`, undo: () => { j.state = prev; it.resolved = false; S.outcome.delete(it.id); ctx.refresh(); } });
      return;
    }
    case 'restart_gateway': {
      const ok = await ctx.openDialog({
        tier: 2, title: 'Restart the homeassistant gateway?', profile: 'homeassistant', confirmLabel: 'Restart gateway',
        body: 'Restarts the Discord adapter for <strong>homeassistant</strong> (≈ 5 s). The 3 queued messages are delivered once it is back. The last exit was <span class="mono">401 Unauthorized</span>: if the bot token was rotated, update it in System › Keys first.',
      });
      if (!ok) return;
      const p = getProfile('homeassistant');
      if (p) p.gateway = 'running';
      return resolve(ctx, it, 'Gateway restarted for homeassistant', { detail: 'discord adapter online · 3 queued messages sent', undo: false });
    }
    case 'raise_budget': return budgetSheet(ctx, it);
    case 'update_notes': return notesSheet(ctx, it);
    case 'update_now': {
      const ok = await ctx.openDialog({
        tier: 2, title: 'Update Hermes to v0.14.2?', confirmLabel: 'Update and restart',
        body: 'Installs v0.14.2 and restarts the gateway (≈ 20 s). Running chats reconnect automatically; kanban workers pause and resume. A checkpoint is taken first.',
      });
      if (ok) resolve(ctx, it, 'Updating Hermes to v0.14.2', { detail: 'gateway restarts in ≈ 20 s', undo: false, tone: 'info' });
      return;
    }
    case 'done': return resolve(ctx, it, `${it.urgency === 'failed' ? 'Dismissed' : 'Done'}: ${name}`, { detail: 'on this device · reappears if it changes' });
    case 'snooze': return snoozeSheet(ctx, it);
    case 'read': S.read.add(it.id); S.pendingFocus = `[data-id="${it.id}"] .icard__menu`; return ctx.refresh();
    case 'unread': S.read.delete(it.id); UNREAD.add(it.id); S.pendingFocus = `[data-id="${it.id}"] .icard__menu`; return ctx.refresh();
    case 'copy': {
      const url = `${location.origin}${location.pathname}${ctx.href(`/inbox/${it.id}`)}`;
      try { await navigator.clipboard.writeText(url); } catch { /* prototype: clipboard may be blocked */ }
      return ctx.toast('Link copied', { tone: 'info', detail: `/inbox/${it.id}` });
    }
    case 'details': return openDetail(ctx, it, { focus: true });
    case 'open_source': return ctx.navigate(srcHref(it));
    default: return undefined;
  }
}

/* ---- Action sheets ---- */
function choiceChips(name, opts, label) {
  return html`<div class="ibx-choices" role="radiogroup" aria-label="${label}">${opts.map((o, i) => html`<button type="button" class="chip" role="radio" aria-checked="${String(i === 0)}" data-pick="${name}" data-v="${o}">${o}</button>`)}</div>`;
}
function bindChoices(panel) {
  panel.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    panel.querySelectorAll(`[data-pick="${b.dataset.pick}"]`).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  }));
  panel.querySelectorAll('.ibx-choices').forEach((g) => g.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const all = [...g.querySelectorAll('[role=radio]')];
    const i = all.indexOf(document.activeElement);
    const n = all[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
    n.focus(); n.click();
  }));
}
const picked = (panel, name) => panel.querySelector(`[data-pick="${name}"][aria-checked="true"]`)?.dataset.v;

function denySheet(ctx, it) {
  ctx.openSheet({
    title: 'Deny git push origin feat/x?',
    body: String(html`<p class="muted">The command does not run. coder gets your reason and continues without it.</p>
      <div class="field"><span class="field__label" id="ibx-deny-l">Reason</span>${choiceChips('reason', ['Not yet', 'Wrong branch', 'Open a PR instead', 'Other'], 'Reason')}</div>
      <div class="field"><label class="field__label" for="ibx-deny-note">Note to the agent (optional)</label><textarea id="ibx-deny-note" class="input" rows="3" placeholder="e.g. Push after I review the diff"></textarea></div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--danger" data-send>Deny</button>',
    onMount(panel, layer) {
      bindChoices(panel);
      panel.querySelector('[data-send]').addEventListener('click', () => {
        const r = picked(panel, 'reason');
        layer.close();
        resolve(ctx, it, 'Denied git push origin feat/x', { detail: `coder told: ${r}${panel.querySelector('textarea').value.trim() ? ' + note' : ''}` });
      });
    },
  });
}
function replySheet(ctx, it) {
  ctx.openSheet({
    title: 'Answer librarian',
    body: String(html`<p class="ibx-q">${it.title}</p>
      <div class="field"><span class="field__label">Pick one</span>${choiceChips('choice', it.choices, 'Citation style')}</div>
      <div class="field"><label class="field__label" for="ibx-reply">Or write your own</label><textarea id="ibx-reply" class="input" rows="3" placeholder="e.g. APA 7, but keep DOIs as links"></textarea><p class="field__help">Written text wins over the chip. The agent continues as soon as you send.</p></div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-send>Send answer</button>',
    initialFocus: '[data-pick]',
    onMount(panel, layer) {
      bindChoices(panel);
      panel.querySelector('[data-send]').addEventListener('click', () => {
        const txt = panel.querySelector('textarea').value.trim();
        layer.close();
        resolve(ctx, it, `Answered “${txt || picked(panel, 'choice')}”`, { detail: 'librarian · s_3b91d0 · the agent continues' });
      });
    },
  });
}
function rejectSheet(ctx, it) {
  ctx.openSheet({
    title: 'Reject design review',
    body: String(html`<p class="muted">The gate sends the run back with your note. Nothing downstream starts until the reworked stage passes this gate again.</p>
      <div class="field"><label class="field__label" for="ibx-rj-to">Send back to</label><select id="ibx-rj-to" class="input"><option>Stage 4 · Architecture notes (coder)</option><option>Stage 3 · Mockups (coder)</option><option>Stage 1 · Intake (you)</option></select></div>
      <div class="field"><label class="field__label" for="ibx-rj-note">Note (required)</label><textarea id="ibx-rj-note" class="input" rows="4" aria-describedby="ibx-rj-help" placeholder="What has to change?"></textarea><p class="field__help" id="ibx-rj-help">Posted as a comment on t_1061 and added to the next brief.</p></div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--danger" data-send disabled>Reject + send note</button>',
    initialFocus: 'textarea',
    onMount(panel, layer) {
      const ta = panel.querySelector('textarea'), btn = panel.querySelector('[data-send]');
      ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
      btn.addEventListener('click', () => {
        const to = panel.querySelector('select').value.split(' · ')[0];
        layer.close();
        resolve(ctx, it, 'Rejected design review', { detail: `pr_1060 · back to ${to} with your note` });
      });
    },
  });
}
function unblockSheet(ctx, it) {
  ctx.openSheet({
    title: 'Answer and unblock',
    body: String(html`<p class="ibx-q">${it.preview}</p>
      <div class="field"><span class="field__label">Quick answer</span>${choiceChips('date', ['31 Oct (lease end)', '7 Nov (tenant email)'], 'Move-out date')}</div>
      <div class="field"><label class="field__label" for="ibx-ans">Comment (optional)</label><textarea id="ibx-ans" class="input" rows="3" placeholder="e.g. The tenant's email extends the lease by agreement"></textarea><p class="field__help">Posted on ${it.source.id}; the task leaves Blocked and returns to Ready.</p></div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-send>Send and unblock</button>',
    initialFocus: '[data-pick]',
    onMount(panel, layer) {
      bindChoices(panel);
      panel.querySelector('[data-send]').addEventListener('click', () => {
        const v = picked(panel, 'date');
        layer.close();
        const t = getTask(it.source.id);
        const prev = t?.status;
        if (t) t.status = 'ready';
        it.resolved = true;
        S.outcome.set(it.id, `Answered “${v}”`);
        ctx.refresh();
        ctx.toast(`Answered “${v}”; task unblocked`, { detail: `${it.source.id} → ready`, undo: () => { if (t) t.status = prev; it.resolved = false; S.outcome.delete(it.id); ctx.refresh(); } });
      });
    },
  });
}
function reassignSheet(ctx, it) {
  const t = getTask(it.source.id);
  const cur = t?.assignee || it.profile;
  ctx.openSheet({
    title: `Reassign ${it.source.id}`,
    body: String(html`<p class="muted">${t?.title}. The next attempt runs on the profile you pick, with its own model, skills and keys.</p>
      <div class="plist" role="radiogroup" aria-label="Assign to">${ctx.data.profiles.map((p) => html`<button type="button" class="plist__row" role="radio" aria-checked="${String(p.name === cur)}" data-pick="who" data-v="${p.name}">${avatar(p.name)}<span class="plist__main"><span class="plist__name">${p.name}${p.name === cur ? html`<span class="tag">current</span>` : ''}</span><span class="plist__sub mono">${p.model}</span></span><span></span><span class="plist__check">${p.name === cur ? icon('check') : ''}</span></button>`)}</div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-send>Reassign and retry</button>',
    initialFocus: '[aria-checked="true"]',
    onMount(panel, layer) {
      panel.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        panel.querySelectorAll('[data-pick]').forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.querySelector('.plist__check').innerHTML = x === b ? String(icon('check')) : ''; });
      }));
      panel.querySelector('[data-send]').addEventListener('click', () => {
        const to = picked(panel, 'who');
        layer.close();
        const prev = t?.assignee;
        if (t) { t.assignee = to; t.status = 'ready'; t.gave_up = false; }
        it.resolved = true;
        S.outcome.set(it.id, `Reassigned to ${to}`);
        ctx.refresh();
        ctx.toast(`Reassigned ${it.source.id} to ${to}`, { detail: 'queued for the next dispatcher tick', undo: () => { if (t) t.assignee = prev; it.resolved = false; S.outcome.delete(it.id); ctx.refresh(); } });
      });
    },
  });
}
function budgetSheet(ctx, it) {
  const b = ctx.data.spend.budget, sp = ctx.data.spend;
  ctx.openSheet({
    title: 'Raise the weekly budget',
    body: String(html`<p class="muted">This week: <span class="mono">${fmtMoney(sp.week)}</span> of <span class="mono">${fmtMoney(b.week)}</span> (${Math.round((sp.week / b.week) * 100)}%). At 100% the dispatcher and unattended cron jobs pause; chats are never blocked.</p>
      <div class="field"><label class="field__label" for="ibx-bud">New weekly limit (USD)</label><input id="ibx-bud" class="input input--mono" type="number" inputmode="decimal" min="${Math.ceil(sp.week)}" step="5" value="${b.week + 10}"><p class="field__help">Applies from now; the warning repeats at ${Math.round(b.warnAt * 100)}% of the new limit.</p></div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-send>Continue</button>',
    initialFocus: 'input',
    onMount(panel, layer) {
      panel.querySelector('[data-send]').addEventListener('click', async () => {
        const v = Math.max(Math.ceil(sp.week), Number(panel.querySelector('input').value) || b.week);
        layer.close();
        await overlaysSettled();
        const ok = await ctx.openDialog({ tier: 1, title: `Raise the weekly budget to ${fmtMoney(v)}?`, confirmLabel: 'Raise budget', body: `Changes <span class="mono">budget.week</span> in caduceus/config.yaml from ${fmtMoney(b.week)} to ${fmtMoney(v)} for every profile.` });
        if (!ok) return;
        b.week = v;
        resolve(ctx, it, `Weekly budget is now ${fmtMoney(v)}`, { detail: `${Math.round((sp.week / v) * 100)}% used`, undo: false });
      });
    },
  });
}
function notesSheet(ctx, it) {
  ctx.openSheet({
    title: 'Hermes v0.14.2 release notes',
    wide: true,
    body: String(html`<p class="muted">You run <span class="mono">v${ctx.data.version.hermes}</span>. Updating restarts the gateway (≈ 20 s).</p>
      <div class="ibx-notes">
        <h3>Fixes</h3><ul><li>Cron: scripts no longer inherit the gateway's <span class="mono">PATH</span> on macOS.</li><li>Kanban: circuit breaker resets when a task is reassigned.</li><li>Telegram: long approval previews are split instead of truncated.</li></ul>
        <h3>Improvements</h3><ul><li><span class="mono">/api/approvals</span> includes the matched pattern and flags.</li><li>Faster session search over 10k+ sessions.</li></ul>
        <h3>Security</h3><ul><li>Pairing codes expire after 15 minutes.</li></ul>
      </div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Close</button><button type="button" class="btn btn--primary" data-update>' + String(icon('fingerprint', 'i-sm')) + '<span>Update…</span></button>',
    onMount(panel, layer) {
      panel.querySelector('[data-update]').addEventListener('click', async () => { layer.close(); await overlaysSettled(); perform(ctx, it, 'update_now'); });
    },
  });
}
function snoozeSheet(ctx, it) {
  const now = new Date();
  const at = (h, m = 0, addDay = 0) => { const d = new Date(now); d.setDate(d.getDate() + addDay); d.setHours(h, m, 0, 0); return d.getTime(); };
  const tonight = at(20) > Date.now() + 30 * 60_000 ? at(20) : at(23) > Date.now() + 30 * 60_000 ? at(23) : null;
  const opts = [
    { label: 'In 1 hour', ts: Date.now() + 3_600_000 },
    tonight ? { label: 'Tonight', ts: tonight } : null,
    { label: 'Tomorrow morning', ts: at(9, 0, 1) },
  ].filter(Boolean);
  ctx.openSheet({
    title: 'Snooze until…',
    body: String(html`<p class="muted truncate">${plain(it.title)}</p>
      <div class="plist">${opts.map((o) => html`<button type="button" class="plist__row" data-snz="${o.ts}">${icon('clock')}<span class="plist__main"><span class="plist__name">${o.label}</span><span class="plist__sub mono">${fmtWhen(o.ts)}</span></span><span></span><span></span></button>`)}</div>
      <p class="plist__note">Snoozes are kept on this device. The item comes back at that time, or sooner if it changes.${it.needsAction ? ' The agent keeps waiting meanwhile.' : ''}</p>`),
    onMount(panel, layer) {
      panel.querySelectorAll('[data-snz]').forEach((b) => b.addEventListener('click', () => {
        const ts = +b.dataset.snz;
        layer.close();
        const order = [...document.querySelectorAll('.ibx [data-id]')].map((el) => el.dataset.id);
        const i = order.indexOf(it.id);
        const next = order[i + 1] || order[i - 1];
        it.snoozedUntil = ts;
        if (S.selected === it.id) { S.selected = next || null; if (isSplit()) setUrl(ctx, next ? `/inbox/${next}` : '/inbox'); }
        S.pendingFocus = next ? `[data-id="${next}"] .icard__title a` : 'h1';
        ctx.refresh();
        ctx.toast(`Snoozed until ${fmtWhen(ts)}`, { detail: plain(it.title), undo: () => { it.snoozedUntil = null; S.pendingFocus = `[data-id="${it.id}"] .icard__title a`; ctx.refresh(); } });
      }));
    },
  });
}

/* ---- ⋮ menu: popover on medium/large, action sheet on compact (long menus become sheets on phones) ---- */
function menuItems(it) {
  const acts = actionsFor(it);
  const out = [{ id: 'details', label: 'Details', icon: 'eye' }];
  if (it.kind === 'clarify') it.choices.forEach((c) => out.push({ id: 'choose', v: c, label: `Answer “${c}”`, icon: 'chat' }));
  acts.filter((a) => !a.danger).forEach((a) => out.push({ id: a.id, label: a.label, icon: a.tier >= 2 ? 'fingerprint' : a.tier == null ? 'external' : 'bolt', tier: a.tier }));
  out.push({ sep: true });
  if (canDone(it)) out.push({ id: 'done', label: doneLabel(it), icon: 'check', note: 'or swipe →' });
  out.push({ id: 'snooze', label: 'Snooze…', icon: 'clock', note: 'or swipe ←' });
  out.push(isUnread(it) ? { id: 'read', label: 'Mark as read', icon: 'eye' } : { id: 'unread', label: 'Mark as unread', icon: 'bell' });
  out.push({ id: 'copy', label: 'Copy link', icon: 'link' });
  const danger = acts.filter((a) => a.danger);
  if (danger.length) { out.push({ sep: true }); danger.forEach((a) => out.push({ id: a.id, label: a.label, icon: 'x', danger: true })); }
  return out;
}
function menuHtml(it) {
  return menuItems(it).map((m) => (m.sep ? '<div class="menu__sep" role="separator"></div>'
    : String(html`<button type="button" role="menuitem" class="menu__item${m.danger ? ' menu__item--danger' : ''}" data-mi="${m.id}" ${m.v ? raw(`data-v="${esc(m.v)}"`) : ''}>${icon(m.icon, 'i-sm')}<span class="ibx-menu__label">${m.label}</span>${m.note ? html`<span class="ibx-menu__note">${m.note}</span>` : m.tier >= 2 ? html`<span class="ibx-menu__note">passkey</span>` : ''}</button>`))).join('');
}
function bindMenu(ctx, it, panel, layer) {
  const items = () => [...panel.querySelectorAll('[role=menuitem]')];
  panel.addEventListener('keydown', (e) => {
    const all = items(); const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); all[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); all[all.length - 1].focus(); }
  });
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mi]');
    if (!b) return;
    layer.close();
    await overlaysSettled();
    perform(ctx, it, b.dataset.mi, b.dataset.v);
  });
}
function openMenu(ctx, it, btn) {
  if (isCompact()) {
    ctx.openSheet({ title: plain(it.title), className: 'ibx-menu-sheet', body: `<div class="ibx-menu" role="menu" aria-label="Actions">${menuHtml(it)}</div>`, onMount: (p, l) => bindMenu(ctx, it, p, l) });
    return;
  }
  openLayer({
    kind: 'popover', className: 'ibx-pop', role: 'menu', label: `Actions for ${plain(it.title)}`,
    content: `<div class="menu ibx-menu ibx-pop__menu" data-panel>${menuHtml(it)}</div>`,
    initialFocus: '[role=menuitem]',
    onMount(panel, layer) {
      const r = btn.getBoundingClientRect();
      const w = panel.offsetWidth, hgt = panel.offsetHeight;
      const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      const top = r.bottom + 4 + hgt > window.innerHeight - 8 ? Math.max(8, r.top - hgt - 4) : r.bottom + 4;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      bindMenu(ctx, it, panel, layer);
    },
  });
}

/* ==========================================================================
   Rendering
   ========================================================================== */
function cardPreview(ctx, it) {
  switch (it.kind) {
    case 'approval': {
      const a = approvalBlock(ctx);
      return html`<div class="ibx-cmd"><span class="ibx-cmd__tool">${a.tool}</span><code>${a.command}</code></div>
        <p class="icard__preview"><span class="mono">${a.cwd}</span> · 2 commits · <span class="mono">+38 −4</span></p>
        <div class="ibx-flags">${a.flags.map((f) => html`<span class="tag" data-tone="warning">${f}</span>`)}</div>`;
    }
    case 'clarify': {
      const left = Math.max(0, Math.round((it.created + it.countdown * 1000 - Date.now()) / 60000));
      return html`<p class="icard__preview">${getSession(it.source.id)?.title}. <span class="ibx-countdown" data-countdown="${it.created + it.countdown * 1000}">Uses APA 7 in ${left}m</span> if you don't answer.</p>
        <div class="ibx-choices" role="group" aria-label="Answer choices">${it.choices.map((c) => html`<button type="button" class="chip" data-do="choose" data-item="${it.id}" data-v="${c}">${c}</button>`)}</div>`;
    }
    case 'review': {
      const run = ctx.data.playbookRuns.find((r) => r.id === it.playbookRun);
      const idx = run.stages.findIndex((s) => s.state === 'waiting') + 1;
      return html`<p class="icard__preview">Software Delivery · stage ${idx} of ${run.stages.length} · architecture notes + 2 mockups</p>
        <p class="ibx-stat"><span class="mono ibx-add">+412</span> <span class="mono ibx-rem">−88</span><span>7 files</span><span class="mono">${fmtMoney(run.cost)} so far</span></p>`;
    }
    case 'needs_input': return html`<blockquote class="ibx-quote">${it.preview}</blockquote>`;
    case 'pairing': return html`<p class="icard__preview">Mara K. wants to DM the <strong>default</strong> profile on Telegram.</p><p class="ibx-stat"><span>Code</span><span class="mono">4F7-K2Q</span></p>`;
    case 'gave_up': return html`<p class="icard__preview">3 of 3 attempts failed · circuit breaker tripped</p><div class="ibx-err mono">HTTPError 403 · eplanning.council.example</div>`;
    case 'run_failed': return html`<p class="icard__preview">Run <span class="mono">${it.run}</span> · attempt 1 · 3m 12s</p><div class="ibx-err mono">${it.preview}</div>`;
    case 'cron_failed': return html`<p class="icard__preview">verify_backup.sh · exit 2 · 41s</p><div class="ibx-err mono">sha256 mismatch: 2026-10-05.tar.zst</div>`;
    case 'cron_overdue': return html`<p class="icard__preview">${it.preview}</p>`;
    case 'gateway_down': return html`<div class="ibx-err mono">discord: 401 Unauthorized</div><p class="icard__preview">Down ${fmtAgo(it.created)} · 3 messages queued · Energy report blocked</p>`;
    case 'budget': {
      const sp = ctx.data.spend, p = sp.week / sp.budget.week;
      return html`<p class="icard__preview"><span class="mono">${fmtMoney(sp.week)}</span> of <span class="mono">${fmtMoney(sp.budget.week)}</span> this week · unattended work pauses at 100%</p>
        <div class="progress" data-tone="${p >= 1 ? 'danger' : 'warning'}" role="img" aria-label="${Math.round(p * 100)}% of weekly budget"><i style="--p:${Math.min(100, p * 100).toFixed(0)}%"></i></div>`;
    }
    case 'update': return html`<p class="icard__preview"><span class="mono">v${ctx.data.version.hermes} → v${ctx.data.version.latest}</span> · 3 fixes, 1 security · restarts the gateway (≈ 20 s)</p>`;
    default: return html`<p class="icard__preview">${it.preview}</p>`;
  }
}

function card(ctx, it, group, { selected }) {
  const k = KIND[it.kind];
  const acts = actionsFor(it).filter((a) => a.inline).slice(0, 2);
  const tid = `ic-${it.id}`;
  const unread = isUnread(it);
  const sel = selected === it.id;
  return html`<li class="icard${unread ? ' is-unread' : ''}${sel ? ' is-selected' : ''}" data-id="${it.id}" data-tone="${group.tone}" data-done="${canDone(it) ? 'yes' : 'no'}">
    <div class="icard__under" aria-hidden="true"><span class="icard__u icard__u--done">${icon('check')}${canDone(it) ? doneLabel(it) : 'Use ⋮ to decide'}</span><span class="icard__u icard__u--snooze">Snooze${icon('clock')}</span></div>
    <article class="icard__surface" aria-labelledby="${tid}">
      <div class="icard__top">
        <span class="icard__kind">${icon(k.icon, 'i-sm')}<span class="overline">${k.label}</span></span>
        ${unread ? html`<span class="icard__new"><span class="dot" data-tone="accent" aria-hidden="true"></span>New</span>` : ''}
        <span class="icard__age mono"><time datetime="${new Date(it.created).toISOString()}">${fmtAgo(it.created)}</time></span>
        <button type="button" class="btn btn--ghost btn--icon btn--sm icard__menu" data-menu="${it.id}" aria-haspopup="menu" aria-label="Actions for: ${plain(it.title)}">${icon('dots-v')}</button>
      </div>
      <h3 class="icard__title" id="${tid}"><a href="${ctx.href(`/inbox/${it.id}`)}" data-open="${it.id}" ${sel ? raw('aria-current="true"') : ''}>${unread ? html`<span class="sr-only">Unread: </span>` : ''}${codeify(it.title)}</a></h3>
      ${cardPreview(ctx, it)}
      <div class="icard__meta">${who(it)}${srcTag(it)}${it.cost ? html`<span class="mono">${fmtMoney(it.cost)}</span>` : ''}</div>
      <div class="icard__actions">${acts.map((a) => actBtn(ctx, it, a))}<button type="button" class="btn btn--ghost btn--sm icard__more" data-more="${it.id}">${isSplit() ? 'Details' : 'More'}${icon('chev-r', 'i-sm')}</button></div>
    </article>
  </li>`;
}

/* ---- Detail (shared by the right pane and the compact sheet) ---- */
function detailBody(ctx, it) {
  const d = ctx.data;
  switch (it.kind) {
    case 'approval': {
      const a = approvalBlock(ctx);
      return html`<div class="approval">
        <p class="ibx-d__lead">Allow <code>${a.tool}</code> to run:</p>
        <pre class="ibx-pre"><code>${a.command}</code></pre>
        <p class="subtle">in <span class="mono">${a.cwd}</span></p>
        <p>${a.consequence}</p>
        <div class="ibx-flags">${a.flags.map((f) => html`<span class="tag" data-tone="warning">${icon('alert', 'i-sm')}${f}</span>`)}</div>
        <p class="subtle ibx-small">${codeify(a.reason)}</p>
      </div>
      <section class="ibx-d__sec" aria-label="Commits to push"><h3 class="overline">2 commits · <span class="ibx-add">+38</span> <span class="ibx-rem">−4</span> · 3 files</h3>
        <ul class="list panel ibx-rows"><li class="ibx-row"><span class="mono">3e9a1c7</span><span>feat(webhooks): exponential backoff with jitter</span></li><li class="ibx-row"><span class="mono">b41d2e0</span><span>test(webhooks): seed jitter in dispatch.test.ts</span></li></ul></section>`;
    }
    case 'clarify': {
      const s = getSession(it.source.id);
      return html`<p class="ibx-q">${it.title}</p>
        <p class="muted">librarian is drafting “Related work” for <strong>${s?.title}</strong> (14 sources so far). The style changes every in-text citation, so it asks before writing.</p>
        <div class="ibx-choices" role="group" aria-label="Answer choices">${it.choices.map((c) => html`<button type="button" class="chip" data-do="choose" data-item="${it.id}" data-v="${c}">${c}</button>`)}</div>
        <p class="subtle ibx-small">${icon('clock', 'i-sm')} <span data-countdown="${it.created + it.countdown * 1000}">Uses APA 7 in ${Math.max(0, Math.round((it.created + it.countdown * 1000 - Date.now()) / 60000))}m</span> if nobody answers (clarify timeout).</p>`;
    }
    case 'review': {
      const run = d.playbookRuns.find((r) => r.id === it.playbookRun);
      const idx = run.stages.findIndex((s) => s.state === 'waiting');
      return html`<p class="muted">${it.preview}. Approving starts <strong>stage ${idx + 2}: Implementation plan</strong> on coder.</p>
        <div class="ibx-stages" role="img" aria-label="Stage ${idx + 1} of ${run.stages.length}">${run.stages.map((s) => html`<i data-s="${s.state}"></i>`)}</div>
        <section class="ibx-d__sec" aria-label="Attached result"><h3 class="overline">Result · <span class="ibx-add">+412</span> <span class="ibx-rem">−88</span> · 7 files</h3>
          <ul class="list panel ibx-rows">
            <li class="ibx-row">${icon('file', 'i-sm')}<span class="mono">docs/bulk-move/architecture.md</span><span class="mono ibx-add">+212</span></li>
            <li class="ibx-row">${icon('file', 'i-sm')}<span class="mono">src/board/BulkMoveSheet.tsx</span><span class="mono ibx-add">+148 <span class="ibx-rem">−61</span></span></li>
            <li class="ibx-row">${icon('file', 'i-sm')}<span class="mono">src/board/selection.ts</span><span class="mono ibx-add">+52 <span class="ibx-rem">−27</span></span></li>
            <li class="ibx-row">${icon('eye', 'i-sm')}<span>Mockup · phone, Mockup · desktop</span><span class="mono subtle">2 PNG</span></li>
          </ul></section>
        <dl class="kv"><dt>gate</dt><dd>Approve / Reject + note</dd><dt>cost</dt><dd class="mono">${fmtMoney(run.cost)} so far</dd><dt>run</dt><dd class="mono">${run.id} · v${run.version}</dd></dl>`;
    }
    case 'needs_input': {
      const t = getTask(it.source.id);
      const r = t?.runs?.[t.runs.length - 1];
      return html`<blockquote class="ibx-quote">${it.preview}</blockquote>
        <dl class="kv"><dt>task</dt><dd>${t?.title}</dd><dt>status</dt><dd>${statusBadge('blocked', { label: 'Blocked · needs input', variant: 'plain' })}</dd><dt>last run</dt><dd>${r?.summary}</dd></dl>`;
    }
    case 'pairing': return html`<p class="muted">A new Telegram user asked to talk to Hermes. Approving lets them DM the profile below and start sessions that use its tools and memory.</p>
      <dl class="kv"><dt>user</dt><dd>@mara_k (Mara K.)</dd><dt>platform</dt><dd>Telegram</dd><dt>profile</dt><dd>${profileTag('default')}</dd><dt>code</dt><dd class="mono ibx-code">4F7-K2Q</dd><dt>expires</dt><dd>in 1m (15-minute codes)</dd></dl>`;
    case 'gave_up': {
      const t = getTask(it.source.id);
      return html`<p class="muted">The dispatcher stopped retrying after 3 consecutive failures. The task stays Blocked until you retry or reassign it.</p>
        <ol class="list panel ibx-rows">${t.runs.map((r, i) => html`<li class="ibx-row ibx-row--run">${statusBadge('failed', { label: `Attempt ${i + 1}`, variant: 'plain' })}<span>${r.summary}</span><span class="mono subtle">${fmtDur(r.duration)} · ${fmtAgo(r.started, { suffix: true })}</span></li>`)}</ol>`;
    }
    case 'run_failed': return html`<p class="muted">The build step failed in the task worktree. The task went back to Ready; nothing was merged.</p>
      <pre class="log">$ pnpm build
src/inbox/InboxSkeleton.tsx:14:7 - error TS2322:
  Type 'string' is not assignable to type 'number'.
14   rows="6"
         ~~~
Found 1 error. exit 1</pre>
      <dl class="kv"><dt>run</dt><dd class="mono">${it.run}</dd><dt>model</dt><dd class="mono">glm-5.3-flash</dd><dt>cost</dt><dd class="mono">${fmtMoney(it.cost)}</dd></dl>`;
    case 'cron_failed': {
      const j = getJob('c_backup');
      return html`<pre class="log">${j.runs[0].output}</pre>
        <dl class="kv"><dt>job</dt><dd>${j.name} · <span class="mono">${j.schedule}</span></dd><dt>script</dt><dd class="mono">${j.script}</dd><dt>previous</dt><dd>${j.runs.slice(1).map((r) => html`<span class="ibx-prev">${statusBadge('succeeded', { label: fmtAgo(r.at, { suffix: true }), variant: 'plain' })}</span>`)}</dd></dl>`;
    }
    case 'cron_overdue': {
      const j = getJob('c_energy');
      return html`<p class="muted">The scheduler fired the job but it could not start: its delivery target (Discord on homeassistant) is down. Restart the gateway, or run it now and deliver later.</p>
        <dl class="kv"><dt>job</dt><dd>${j.name} · ${j.human}</dd><dt>due</dt><dd class="mono">${fmtTime(it.created)}</dd><dt>last ok</dt><dd>${fmtAgo(j.runs[0].at, { suffix: true })}</dd><dt>deliver</dt><dd>${sourceTag('discord')}</dd></dl>`;
    }
    case 'gateway_down': return html`<pre class="log">${fmtTime(it.created)} discord  connecting as homeassistant#4410
${fmtTime(it.created)} discord  401 Unauthorized (token rejected)
${fmtTime(it.created)} gateway  adapter exited 1; not restarting (auth error)</pre>
      <dl class="kv"><dt>profile</dt><dd>${profileTag('homeassistant')}</dd><dt>down</dt><dd>${fmtAgo(it.created, { suffix: true })}</dd><dt>queued</dt><dd>3 messages · Energy report</dd></dl>`;
    case 'budget': {
      const sp = d.spend;
      const bar = (label, a, b) => { const p = a / b; return html`<div class="ibx-bud"><span>${label}</span><div class="progress" data-tone="${p >= 1 ? 'danger' : p >= sp.budget.warnAt ? 'warning' : 'accent'}" role="img" aria-label="${Math.round(p * 100)}%"><i style="--p:${Math.min(100, p * 100).toFixed(0)}%"></i></div><span class="mono">${fmtMoney(a)} / ${fmtMoney(b)}</span></div>`; };
      return html`<p class="muted">Unattended work (kanban dispatcher, cron jobs flagged unattended) pauses at 100%. Attended chats are never blocked.</p>
        <div class="ibx-buds">${bar('Today', sp.today, sp.budget.day)}${bar('Week', sp.week, sp.budget.week)}${bar('Month', sp.month, sp.budget.month)}</div>`;
    }
    case 'update': return html`<p class="muted">v${d.version.latest} fixes cron PATH on macOS, resets kanban circuit breakers on reassign, and shortens pairing-code lifetime. Updating restarts the gateway (≈ 20 s); a checkpoint is taken first.</p>`;
    default: return html`<p class="muted">${it.preview}</p>${it.cost ? html`<dl class="kv"><dt>cost</dt><dd class="mono">${fmtMoney(it.cost)}</dd></dl>` : ''}`;
  }
}
function stateBadge(it) {
  if (it.resolved) return statusBadge('done', { label: S.outcome.get(it.id) || 'Resolved' });
  if (isSnoozed(it)) return statusBadge('paused', { label: `Snoozed until ${fmtWhen(it.snoozedUntil)}` });
  if (it.urgency === 'decision') return statusBadge('waiting');
  if (it.urgency === 'failed') return statusBadge(it.kind === 'gateway_down' ? 'offline' : it.kind === 'cron_overdue' ? 'stale' : 'failed', { label: KIND[it.kind].label });
  return statusBadge(it.kind === 'finished' ? 'succeeded' : 'queued', { label: KIND[it.kind].label });
}
function detailHtml(ctx, it, { inSheet = false } = {}) {
  const k = KIND[it.kind];
  const acts = actionsFor(it);
  const open = isOpen(it);
  const offline = ctx.data.connection === 'offline' && acts.some((a) => a.tier >= 2);
  const pushed = it.urgency !== 'fyi' || it.kind === 'budget';
  return html`<article class="idetail" aria-labelledby="idt-${it.id}">
    <header class="idetail__head">
      <p class="overline">${icon(k.icon, 'i-sm')} ${k.label}</p>
      ${inSheet ? html`<p class="sr-only" id="idt-${it.id}">${plain(it.title)}</p>` : html`<h2 class="idetail__title" id="idt-${it.id}" tabindex="-1">${codeify(it.title)}</h2>`}
      <div class="idetail__meta">${stateBadge(it)}${who(it)}${srcTag(it)}<span class="mono subtle">${fmtAgo(it.created, { suffix: true })}</span></div>
    </header>
    ${detailBody(ctx, it)}
    ${open ? html`${inSheet ? '' : html`<div class="idetail__acts" role="group" aria-label="Actions">${acts.map((a) => actBtn(ctx, it, a, { sm: false }))}</div>`}
      <p class="ibx-tiers subtle">${acts.filter((a) => a.tier != null).map((a) => html`<span><strong>${a.label.replace('…', '')}</strong> ${a.tier >= 2 ? icon('fingerprint', 'i-sm') : ''}${TIER_NOTE[a.tier]}</span>`)}</p>
      ${offline ? html`<p class="ibx-small" id="ibx-offline">${icon('wifi-off', 'i-sm')} Passkey actions need a connection; they are never queued offline.</p>` : ''}`
      : html`<div class="banner" data-tone="${it.resolved ? 'success' : 'info'}">${icon(it.resolved ? 'succeeded' : 'clock')}<div class="banner__content"><div class="banner__title">${it.resolved ? S.outcome.get(it.id) || 'Resolved' : `Snoozed until ${fmtWhen(it.snoozedUntil)}`}</div><div class="banner__body">${it.resolved ? 'Resolved items leave the queue. Hermes state is the source of truth.' : 'It returns to the queue at that time.'}</div><div class="banner__actions"><button type="button" class="btn btn--secondary btn--sm" data-${raw(it.resolved ? 'reopen' : 'unsnooze')}="${it.id}">${it.resolved ? 'Reopen' : 'Unsnooze'}</button></div></div><span></span></div>`}
    <dl class="kv idetail__kv">
      <dt>source</dt><dd><a href="${ctx.href(srcHref(it))}">${srcLabel(it)}</a></dd>
      <dt>created</dt><dd>${fmtWhen(it.created)}</dd>
      <dt>notified</dt><dd>${pushed ? `Push to iPhone · ${fmtTime(it.created)}` : 'In-app only (FYI digest)'}</dd>
      <dt>id</dt><dd class="mono">${it.id}</dd>
    </dl>
    ${!inSheet && open ? html`<p class="ibx-keys subtle">${kbd('j')}${kbd('k')} move · ${kbd('↵')} open · ${canDone(it) ? html`${kbd('e')} ${doneLabel(it).toLowerCase()} · ` : ''}${kbd('s')} snooze</p>` : ''}
  </article>`;
}

/* Compact (and < 45rem): detail is a bottom sheet / dialog. Deep links open it on load (mobile §6). */
function openDetail(ctx, it, { focus = false, deep = false } = {}) {
  S.read.add(it.id);
  S.focusedId = it.id;
  if (isSplit()) {
    S.selected = it.id;
    setUrl(ctx, `/inbox/${it.id}`);
    S.pendingFocus = focus ? `#idt-${it.id}` : null;
    if (!focus) S.pendingFocus = `[data-id="${it.id}"] .icard__title a`;
    ctx.refresh();
    return;
  }
  const cardEl = document.querySelector(`.ibx [data-id="${it.id}"]`);
  if (cardEl) { cardEl.classList.remove('is-unread'); cardEl.querySelector('.icard__new')?.remove(); cardEl.querySelector('.icard__title .sr-only')?.remove(); }
  if (!deep) setUrl(ctx, `/inbox/${it.id}`, { now: true });
  ctx.openSheet({
    title: plain(it.title),
    className: 'ibx-sheet',
    wide: true,
    detents: ['auto', 'full'],
    body: String(detailHtml(ctx, it, { inSheet: true })),
    // Actions sit in the sheet footer, in thumb reach above the safe area.
    footer: isOpen(it) ? String(html`<div class="idetail__acts ibx-sheet__acts" role="group" aria-label="Actions">${actionsFor(it).map((a) => actBtn(ctx, it, a, { sm: false }))}</div>`) : '',
    initialFocus: '[data-close]',
    onMount(panel, layer) {
      // Decisions are alert dialogs (mobile §9); focus starts on Close so ↵ never approves by accident.
      if (it.urgency === 'decision' && isOpen(it)) panel.setAttribute('role', 'alertdialog');
      panel.addEventListener('click', (e) => onClick(e, ctx, layer));
    },
    onClose() {
      // Restore /inbox once every overlay is gone. Rewriting history while a follow-up dialog (T1/T2) owns an
      // entry would make its close land on a different URL and re-route.
      const sync = () => {
        if (overlayOpen()) { setTimeout(sync, 150); return; }
        overlaysSettled().then(() => setTimeout(() => {
          if (overlayOpen()) { sync(); return; }
          if (!location.hash.startsWith(`#/inbox/${it.id}`)) return;
          if (deep) {
            // A deep link put the shell on /inbox/:id: route back to /inbox so the app bar and breadcrumb follow.
            const q = new URLSearchParams(ctx.query).toString();
            const target = isOpen(it) ? it.id : document.activeElement?.closest?.('.ibx [data-id]')?.dataset.id;
            if (target) S.pendingFocus = `[data-id="${target}"] .icard__title a`;
            location.replace(`#/inbox${q ? '?' + q : ''}`);
          } else setUrl(ctx, '/inbox', { now: true });
        }, 30));
      };
      sync();
    },
  });
}

function paneHtml(ctx, it) {
  if (!it) return html`<div class="ibx-pane__empty">${emptyState({ icon: 'inbox', title: 'Nothing selected', body: 'Pick an item to see the full preview and every action.' })}</div>`;
  return detailHtml(ctx, it);
}

/* ---- Notification settings (mobile §6) ---- */
function notifHtml() {
  const n = S.notif;
  const sw = (id, on, label, sub) => html`<div class="switch-row ibx-sw"><label for="ibx-n-${id}"><strong>${label}</strong>${sub ? html`<br><span class="subtle">${sub}</span>` : ''}</label><button type="button" id="ibx-n-${id}" class="switch" role="switch" aria-checked="${String(!!on)}" data-sw="${id}"></button></div>`;
  const ios = n.device === 'ios';
  let perm;
  if (ios && !n.installed) {
    perm = html`<div class="banner" data-tone="info">${icon('info')}<div class="banner__content"><div class="banner__title">On iPhone, push needs Caduceus on your Home Screen</div>
      <div class="banner__body">iOS only delivers web push to installed apps (iOS 16.4+). It takes four taps:</div>
      <ol class="ibx-steps"><li>Tap ${icon('arrow-up', 'i-sm')} <strong>Share</strong> in Safari's toolbar.</li><li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li><li>Open <strong>Caduceus Dashboard</strong> from the Home Screen and sign in with your passkey.</li><li>Come back here and tap <strong>Allow notifications</strong>.</li></ol>
      <div class="banner__actions"><button type="button" class="btn btn--secondary btn--sm" data-n="installed">I've added it (prototype)</button></div></div><span></span></div>`;
  } else if (n.permission === 'granted') {
    perm = html`<div class="banner" data-tone="success">${icon('succeeded')}<div class="banner__content"><div class="banner__title">Notifications are on for this device</div><div class="banner__body">Approvals open their decision sheet; on iOS the notification itself has no buttons, so the tap <em>is</em> the action.</div><div class="banner__actions"><button type="button" class="btn btn--secondary btn--sm" data-n="test">Send a test</button></div></div><span></span></div>`;
  } else {
    perm = html`<div class="banner" data-tone="neutral">${icon('bell')}<div class="banner__content"><div class="banner__title">Get approvals on this device</div><div class="banner__body">We ask for permission only when you tap, and never while a Caduceus window is visible.</div><div class="banner__actions"><button type="button" class="btn btn--primary btn--sm" data-n="allow">Allow notifications</button></div></div><span></span></div>`;
  }
  return html`<div class="ibx-notif">
    <div class="field"><span class="field__label" id="ibx-dev-l">Preview device (prototype)</span>
      <div class="seg" role="radiogroup" aria-labelledby="ibx-dev-l"><button type="button" role="radio" aria-checked="${String(ios)}" data-dev="ios">iPhone · Safari</button><button type="button" role="radio" aria-checked="${String(!ios)}" data-dev="chromium">Android / desktop</button></div></div>
    <div data-perm>${perm}</div>
    <section class="ibx-d__sec" aria-labelledby="ibx-n-cats"><h3 class="overline" id="ibx-n-cats">Push categories · this device</h3>
      <div class="panel ibx-swlist">${CATS.map((c) => sw(`cat-${c.id}`, n.cats[c.id], c.label, c.sub))}</div></section>
    <section class="ibx-d__sec" aria-labelledby="ibx-n-dig"><h3 class="overline" id="ibx-n-dig">Digest</h3>
      <div class="panel ibx-swlist">${sw('digest', n.digest, 'Daily digest for FYI', 'Categories that are off arrive together once a day')}
        <div class="switch-row ibx-sw"><label for="ibx-dig-at">Digest time</label><input id="ibx-dig-at" class="input input--mono ibx-time" type="time" value="${n.digestAt}"></div></div></section>
    <section class="ibx-d__sec" aria-labelledby="ibx-n-q"><h3 class="overline" id="ibx-n-q">Quiet hours</h3>
      <div class="panel ibx-swlist">${sw('quiet', n.quiet, 'Quiet hours', 'Notifications wait in the Inbox; the badge still updates')}
        <div class="switch-row ibx-sw"><label for="ibx-q-from">From</label><input id="ibx-q-from" class="input input--mono ibx-time" type="time" value="${n.quietFrom}"></div>
        <div class="switch-row ibx-sw"><label for="ibx-q-to">To</label><input id="ibx-q-to" class="input input--mono ibx-time" type="time" value="${n.quietTo}"></div>
        ${sw('break', n.quietBreak, 'Let approvals through', 'Tool approvals and questions still notify during quiet hours')}</div></section>
    <p class="subtle ibx-small">${icon('info', 'i-sm')} The app badge shows only items that need a decision. No push is sent while any Caduceus client is visible.</p>
  </div>`;
}
function openNotif(ctx) {
  ctx.openSheet({
    title: 'Notifications',
    wide: true,
    detents: ['full'],
    body: String(notifHtml()),
    footer: '<button type="button" class="btn btn--primary" data-close>Done</button>',
    onMount(panel) {
      const body = panel.querySelector('[data-body]');
      const n = S.notif;
      const rerender = (focusSel) => { body.innerHTML = String(notifHtml()); if (focusSel) body.querySelector(focusSel)?.focus(); };
      body.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-sw]');
        if (sw) {
          const id = sw.dataset.sw;
          const on = sw.getAttribute('aria-checked') !== 'true';
          sw.setAttribute('aria-checked', String(on));
          if (id.startsWith('cat-')) n.cats[id.slice(4)] = on;
          else if (id === 'digest') n.digest = on;
          else if (id === 'quiet') n.quiet = on;
          else if (id === 'break') n.quietBreak = on;
          return;
        }
        const dev = e.target.closest('[data-dev]');
        if (dev) { n.device = dev.dataset.dev; rerender(`[data-dev="${n.device}"]`); return; }
        const b = e.target.closest('[data-n]');
        if (!b) return;
        if (b.dataset.n === 'installed') { n.installed = true; rerender('[data-n="allow"]'); }
        else if (b.dataset.n === 'allow') {
          b.setAttribute('aria-busy', 'true');
          b.textContent = 'Waiting for the browser prompt…';
          setTimeout(() => { n.permission = 'granted'; rerender('[data-n="test"]'); ctx.toast('Notifications allowed on this device', { detail: 'mock permission prompt' }); }, 900);
        } else if (b.dataset.n === 'test') ctx.toast('Test notification sent', { tone: 'info', detail: '“Approve `git push` on coder?” → opens /inbox/in_approval' });
      });
      body.addEventListener('change', (e) => {
        if (e.target.id === 'ibx-dig-at') n.digestAt = e.target.value;
        if (e.target.id === 'ibx-q-from') n.quietFrom = e.target.value;
        if (e.target.id === 'ibx-q-to') n.quietTo = e.target.value;
      });
    },
  });
}

/* ---- Filters live in the query (IA §7): ?cat= and the shell's ?profile= ---- */
function setFilter(ctx, cat) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (cat && cat !== 'all') q.set('cat', cat); else q.delete('cat');
  const s = q.toString();
  S.pendingFocus = `[data-cat="${cat || 'all'}"]`;
  // A new filter starts a new selection: drop any /inbox/:id.
  location.replace(`#/inbox${s ? '?' + s : ''}`);
}

/* ---- Click delegation (screen root, detail sheet) ---- */
async function onClick(e, ctx, layer) {
  const t = e.target;
  const inSheet = !!layer;
  const leave = async () => { if (inSheet) { layer.close(); await overlaysSettled(); } };
  const b = t.closest('button, a');
  if (b?.dataset.do) {
    const it = findItem(ctx, b.dataset.item);
    if (b.dataset.do === 'open_source') { e.preventDefault(); return perform(ctx, it, 'open_source'); }
    await leave();
    return perform(ctx, it, b.dataset.do, b.dataset.v);
  }
  if (b?.dataset.reopen || b?.dataset.unsnooze) {
    const it = findItem(ctx, b.dataset.reopen || b.dataset.unsnooze);
    await leave();
    it.resolved = false; it.snoozedUntil = null; S.outcome.delete(it.id);
    S.pendingFocus = `[data-id="${it.id}"] .icard__title a`;
    ctx.refresh();
    ctx.toast(b.dataset.reopen ? 'Reopened' : 'Back in the queue', { tone: 'info', detail: plain(it.title) });
    return undefined;
  }
  if (inSheet) return undefined;
  if (b?.dataset.menu) return openMenu(ctx, findItem(ctx, b.dataset.menu), b);
  if (b?.dataset.more) return openDetail(ctx, findItem(ctx, b.dataset.more), { focus: true });
  if (b?.dataset.open && !(e.metaKey || e.ctrlKey || e.shiftKey)) { e.preventDefault(); return openDetail(ctx, findItem(ctx, b.dataset.open), { focus: isSplit() }); }
  if (b?.dataset.cat) return setFilter(ctx, b.dataset.cat);
  if (b?.dataset.act === 'profile') return ctx.openProfileSwitcher();
  if (b?.dataset.act === 'notif') return openNotif(ctx);
  if (b?.dataset.act === 'readall') { allItems(ctx).forEach((i) => S.read.add(i.id)); S.pendingFocus = 'h1'; ctx.refresh(); return ctx.toast('All marked as read', { tone: 'info' }); }
  if (b?.dataset.act === 'hint-x') { S.hintDismissed = true; S.pendingFocus = 'h1'; return ctx.refresh(); }
  if (b?.dataset.bulk) {
    const items = visibleItems(ctx, ctx.query.cat || 'all').filter((i) => (i.urgency === b.dataset.bulk) && canDone(i));
    items.forEach((i) => { i.resolved = true; S.outcome.set(i.id, i.urgency === 'failed' ? 'Dismissed' : 'Done'); });
    S.pendingFocus = 'h1';
    ctx.refresh();
    return ctx.toast(`${b.dataset.bulk === 'failed' ? 'Dismissed' : 'Cleared'} ${items.length} item${items.length === 1 ? '' : 's'}`, { detail: 'on this device', undo: () => { items.forEach((i) => { i.resolved = false; S.outcome.delete(i.id); }); ctx.refresh(); } });
  }
  if (b?.dataset.next) { const it = findItem(ctx, b.dataset.next); if (it) openDetail(ctx, it, { focus: true }); return undefined; }
  // Tap on the card body (not on a control) opens it, like the title link.
  const surf = !b && t.closest('.icard__surface');
  if (surf && !window.getSelection()?.toString()) {
    const id = surf.closest('[data-id]').dataset.id;
    openDetail(ctx, findItem(ctx, id), { focus: isSplit() });
  }
  return undefined;
}

/* ---- Swipe (compact or touch): → done for T0-safe items, ← snooze. Never grants approval. ---- */
function bindSwipe(root, ctx) {
  let st = null;
  let swallow = false;
  const TH = (w) => Math.min(112, w * 0.32);
  root.addEventListener('pointerdown', (e) => {
    const surf = e.target.closest('.icard__surface');
    if (!surf || !e.isPrimary || e.button !== 0) return;
    if (e.pointerType === 'mouse' && !isCompact()) return;
    if (e.target.closest('button, a, input, textarea, select, summary')) return;
    st = { surf, li: surf.parentElement, x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId, w: surf.offsetWidth };
  });
  root.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
      if (Math.abs(dx) < 10) return;
      st.on = true;
      st.surf.setPointerCapture(e.pointerId);
      st.li.classList.add('is-swiping');
    }
    const done = st.li.dataset.done === 'yes';
    const eff = dx > 0 && !done ? dx * 0.15 : dx;
    st.dx = eff;
    st.surf.style.transform = `translateX(${eff}px)`;
    st.li.dataset.swipe = dx > 0 ? 'done' : 'snooze';
    st.li.classList.toggle('is-armed', Math.abs(eff) >= TH(st.w) && (dx < 0 || done));
  });
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (!s.on) return;
    swallow = true;
    setTimeout(() => { swallow = false; }, 0);
    const armed = s.li.classList.contains('is-armed');
    const dir = s.li.dataset.swipe;
    s.li.classList.remove('is-swiping', 'is-armed');
    const it = findItem(ctx, s.li.dataset.id);
    if (armed && dir === 'done') {
      s.surf.style.transform = `translateX(${s.w}px)`;
      s.li.classList.add('is-leaving');
      setTimeout(() => perform(ctx, it, 'done'), 160);
      return;
    }
    s.surf.style.transform = '';
    setTimeout(() => { delete s.li.dataset.swipe; }, 200);
    if (armed && dir === 'snooze') snoozeSheet(ctx, it);
    else if (dir === 'done' && s.li.dataset.done !== 'yes' && Math.abs(e.clientX - s.x) > 60) ctx.toast('Decisions need a tap', { tone: 'info', detail: 'Swipe never approves. Use the buttons or ⋮.' });
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', (e) => { if (st?.on) { st.surf.style.transform = ''; st.li.classList.remove('is-swiping', 'is-armed'); delete st.li.dataset.swipe; } st = null; });
  // A swipe must not also click.
  root.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
}

function visibleItems(ctx, cat) {
  return allItems(ctx).filter((it) => isOpen(it) && inScope(it.profile, ctx.scope) && (cat === 'all' || catOf(it) === cat));
}

export default {
  routes: ['/inbox', '/inbox/:id'],
  title: 'Inbox',
  group: 'top',

  render(ctx) {
    // A real navigation (not our own replaceState, not a refresh) resets selection and deep-link handling.
    if (location.hash !== S.lastHash) {
      S.lastHash = location.hash;
      S.selected = ctx.params.id || null;
      S.deepLink = ctx.params.id || null;
    }
    const cat = CATS.some((c) => c.id === ctx.query.cat) ? ctx.query.cat : 'all';
    const inScopeOpen = allItems(ctx).filter((it) => isOpen(it) && inScope(it.profile, ctx.scope));
    const items = visibleItems(ctx, cat).sort((a, b) => b.created - a.created);
    const by = Object.fromEntries(GROUPS.map((g) => [g.id, items.filter((i) => i.urgency === g.id)]));
    const nDecision = inScopeOpen.filter((i) => i.needsAction).length;
    const nFailed = inScopeOpen.filter((i) => i.urgency === 'failed').length;
    const nFyi = inScopeOpen.filter((i) => i.urgency === 'fyi').length;
    const unread = inScopeOpen.filter(isUnread).length;
    const split = isSplit();
    const scopeLabel = ctx.scope === 'all' ? 'All profiles' : ctx.scope;
    const compact = ctx.size === 'compact';
    if (split && (!S.selected || !findItem(ctx, S.selected))) S.selected = items[0]?.id || null;
    const sel = split && S.selected ? findItem(ctx, S.selected) : null;
    const snoozed = allItems(ctx).filter((i) => !i.resolved && isSnoozed(i) && inScope(i.profile, ctx.scope));
    const doneToday = allItems(ctx).filter((i) => i.resolved && S.outcome.has(i.id) && inScope(i.profile, ctx.scope));
    const live = ctx.data.connection === 'online';
    const catCount = (id) => inScopeOpen.filter((i) => catOf(i) === id).length;

    const readAll = unread ? html`<button type="button" class="btn btn--ghost${compact ? ' btn--sm' : ''}" data-act="readall">${icon('check', 'i-sm')}Mark all read</button>` : '';
    const header = pageHeader({
      title: 'Inbox',
      subtitle: `${nDecision} need${nDecision === 1 ? 's' : ''} a decision · ${nFailed} failed · ${nFyi} FYI${compact ? '' : '. Only decisions count toward the badge.'}`,
      // Compact: the bell moves to the app bar (mount) and "Mark all read" sits on the live line.
      actions: compact ? '' : html`${readAll}<button type="button" class="btn btn--secondary" data-act="notif">${icon('bell', 'i-sm')}Notifications</button>`,
    });
    const filters = html`<div class="ibx__bar">
      <div class="chips-scroll ibx__chips" role="group" aria-label="Filter the Inbox">
        <button type="button" class="chip chip--profile" data-act="profile" aria-label="Profile filter: ${scopeLabel}. Change">${avatar(ctx.scope === 'all' ? 'all' : ctx.scope, { size: 'sm' })}${scopeLabel}${icon('chev-d', 'i-sm')}</button>
        <span class="ibx__sep" aria-hidden="true"></span>
        <button type="button" class="chip" data-cat="all" aria-pressed="${String(cat === 'all')}">All<span class="ibx__n mono">${inScopeOpen.length}</span></button>
        ${CATS.filter((c) => catCount(c.id) || c.id === cat).map((c) => html`<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${String(cat === c.id)}">${c.label}<span class="ibx__n mono">${catCount(c.id)}</span></button>`)}
      </div>
      <div class="ibx__live subtle"><span class="dot${live ? '' : ' dot--hollow'}" data-tone="${live ? 'success' : 'neutral'}" aria-hidden="true"></span>${live ? `Live · checked ${fmtTime(Date.now())}` : `Offline · as of ${fmtTime(Date.now())}`}${compact ? readAll : ''}</div>
    </div>`;

    const groupHtml = (g) => {
      const list = by[g.id];
      if (!list.length) return '';
      const bulk = g.id !== 'decision' && list.some(canDone);
      return html`<section class="section ibx-group" aria-labelledby="ibx-h-${g.id}" data-group="${g.id}">
        <div class="section__head"><h2 class="section__title" id="ibx-h-${g.id}">${icon(g.icon)}${g.title}${g.id === 'decision'
          ? html`<span class="count" aria-hidden="true">${list.length}</span><span class="sr-only">, ${list.length} need you</span>`
          : html`<span class="ibx__n mono">${list.length}</span>`}</h2>
          ${bulk ? html`<button type="button" class="btn btn--ghost btn--sm" data-bulk="${g.id}">${g.id === 'failed' ? 'Dismiss all' : 'Clear all'}</button>` : ''}</div>
        <ul class="ibx-list" role="list">${list.map((it) => card(ctx, it, g, { selected: split ? S.selected : null }))}</ul>
      </section>`;
    };

    const extras = html`${snoozed.length ? html`<details class="ibx-fold"><summary>${icon('clock', 'i-sm')}Snoozed<span class="ibx__n mono">${snoozed.length}</span>${icon('chev-d', 'i-sm chev')}</summary>
        <ul class="list panel">${snoozed.map((i) => html`<li class="ibx-row ibx-row--fold"><span class="truncate">${plain(i.title)}</span><span class="mono subtle">${fmtWhen(i.snoozedUntil)}</span><button type="button" class="btn btn--secondary btn--sm" data-unsnooze="${i.id}">Unsnooze</button></li>`)}</ul></details>` : ''}
      ${doneToday.length ? html`<details class="ibx-fold"><summary>${icon('succeeded', 'i-sm')}Resolved this session<span class="ibx__n mono">${doneToday.length}</span>${icon('chev-d', 'i-sm chev')}</summary>
        <ul class="list panel">${doneToday.map((i) => html`<li class="ibx-row ibx-row--fold"><span class="truncate">${plain(i.title)}</span><span class="subtle">${S.outcome.get(i.id)}</span><button type="button" class="btn btn--secondary btn--sm" data-reopen="${i.id}">Reopen</button></li>`)}</ul></details>` : ''}`;

    let listCol;
    if (!items.length) {
      listCol = cat !== 'all'
        ? html`<div class="panel">${emptyState({ icon: 'filter', title: `Nothing in ${CATS.find((c) => c.id === cat).label}`, body: `No open items for ${scopeLabel}. Other categories may still need you.`, action: html`<button type="button" class="btn btn--secondary" data-cat="all">Show all</button>` })}</div>`
        : html`<div class="panel ibx-clear">${emptyState({ icon: 'succeeded', title: 'All clear', body: `Nothing needs you${ctx.scope === 'all' ? '' : ` on ${scopeLabel}`}. Last checked ${fmtTime(Date.now())}; new approvals, questions and failures appear here live.`, action: html`<button type="button" class="btn btn--secondary" data-act="notif">${icon('bell', 'i-sm')}Notification settings</button>` })}</div>`;
    } else {
      listCol = html`${compact && !S.hintDismissed ? html`<div class="ibx-hint" role="note">${icon('arrow-r', 'i-sm')}<p>Swipe a card <strong>right</strong> to dismiss failures and FYI, <strong>left</strong> to snooze. Decisions always need a tap. Everything is also in ⋮.</p><button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="hint-x" aria-label="Dismiss tip">${icon('x', 'i-sm')}</button></div>` : ''}
        ${GROUPS.map(groupHtml)}`;
    }

    return html`<div class="ibx" data-split="${split ? 'yes' : 'no'}">
      ${header}
      ${filters}
      ${split && items.length
        ? html`<div class="ibx-split"><div class="ibx-col">${listCol}${extras}</div>
            <aside class="ibx-pane panel" aria-label="Item details">${paneHtml(ctx, sel)}</aside></div>`
        : html`<div class="ibx-col">${listCol}${extras}</div>`}
      <p class="ibx__foot subtle">${icon('bell', 'i-sm')}Push, quiet hours and the iPhone install guide live in <button type="button" class="ibx-link" data-act="notif">Notification settings</button>.</p>
    </div>`;
  },

  mount(root, ctx) {
    root.addEventListener('click', (e) => onClick(e, ctx));
    root.addEventListener('focusin', (e) => { const li = e.target.closest('[data-id]'); if (li) S.focusedId = li.dataset.id; });
    bindSwipe(root, ctx);
    if (ctx.size === 'compact') ctx.setAppBar({ actions: [{ icon: 'bell', label: 'Notification settings', iconOnly: true, onClick: () => openNotif(ctx) }] });

    // Keyboard (mobile §8): j / k move, e done, s snooze. Respects the "single-key shortcuts" preference.
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.documentElement.classList.contains('has-overlay')) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      try { if (JSON.parse(localStorage.getItem('hc-proto-prefs') || '{}').singleKey === false) return; } catch { /* default on */ }
      const links = [...root.querySelectorAll('.icard__title a')];
      if (!links.length) return;
      const cur = document.activeElement?.closest?.('[data-id]')?.dataset.id;
      const i = links.findIndex((a) => a.dataset.open === cur);
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const n = links[i < 0 ? 0 : Math.min(links.length - 1, Math.max(0, i + (e.key === 'j' ? 1 : -1)))];
        n.focus();
        n.closest('[data-id]').scrollIntoView({ block: 'nearest' });
      } else if ((e.key === 'e' || e.key === 's') && cur) {
        const it = findItem(ctx, cur);
        if (e.key === 's') { e.preventDefault(); snoozeSheet(ctx, it); }
        else if (canDone(it)) { e.preventDefault(); perform(ctx, it, 'done'); }
      }
    };
    document.addEventListener('keydown', onKey);

    // 45rem list/detail threshold is not a size-class boundary: re-render when it flips.
    const mq = splitMQ();
    const onMq = () => ctx.refresh();
    mq.addEventListener('change', onMq);

    // Clarify countdowns.
    const tick = setInterval(() => {
      root.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = `Uses APA 7 in ${Math.max(0, Math.round((+el.dataset.countdown - Date.now()) / 60000))}m`; });
    }, 30_000);

    // Deep link (what a push notification opens): compact → decision sheet; split → the pane.
    if (S.deepLink) {
      const it = findItem(ctx, S.deepLink);
      S.deepLink = null;
      if (!it) ctx.toast('That item is gone', { tone: 'info', detail: 'It was resolved elsewhere (Telegram, CLI) or never existed.' });
      else if (isSplit()) { S.read.add(it.id); requestAnimationFrame(() => root.querySelector(`#idt-${it.id}`)?.focus()); }
      else requestAnimationFrame(() => openDetail(ctx, it, { deep: true }));
    }
    if (S.pendingFocus) {
      const sel = S.pendingFocus;
      S.pendingFocus = null;
      requestAnimationFrame(() => (root.querySelector(sel) || root.querySelector('h1'))?.focus({ preventScroll: false }));
    }
    return () => { document.removeEventListener('keydown', onKey); mq.removeEventListener('change', onMq); clearInterval(tick); };
  },

  paletteActions(ctx) {
    const cat = ctx.query.cat || 'all';
    const list = visibleItems(ctx, cat).sort((a, b) => b.created - a.created);
    const f = list.find((i) => i.id === S.focusedId) || list.find((i) => i.id === S.selected) || list.find((i) => i.needsAction) || list[0];
    const pa = f && primaryAction(f);
    return [
      pa ? { label: `${['clarify', 'needs_input'].includes(f.kind) ? 'Answer' : f.needsAction ? 'Approve' : 'Resolve'} focused item: ${pa.label}`, sub: `${plain(f.title)}${pa.tier >= 2 ? ' · passkey' : pa.tier === 1 ? ' · confirm' : pa.tier === 0 ? ' · undo for 6 s' : ''}`, icon: 'check', run: () => perform(ctx, f, pa.id) } : null,
      f ? { label: 'Snooze focused item…', sub: plain(f.title), icon: 'clock', run: () => snoozeSheet(ctx, f) } : null,
      { label: 'Filter Inbox by profile…', sub: ctx.scope === 'all' ? 'All profiles' : ctx.scope, icon: 'users', run: () => ctx.openProfileSwitcher() },
      { label: 'Notification settings', icon: 'bell', run: () => openNotif(ctx) },
    ].filter(Boolean);
  },
};
