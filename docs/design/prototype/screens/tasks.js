// Work › Tasks (work-model §2.1–§2.2, §3; mobile §4 "Task / Run"):
//   /work/tasks           dense list with saved filters; table ≥ 840 px, restacked cards below
//   /work/tasks/new       Brief editor + structured fields + dispatch mode (Save draft / Queue / Run now / Schedule)
//   /work/tasks/:id       header actions + tabs Brief · Runs · Activity · Links · Attachments · Settings
//   /work/runs/:runId     step list with live status, tokens/cost per step, worker log, Stream / Worklog / Raw
import {
  html, raw, esc, icon, statusBadge, taskState, avatar, profileTag, emptyState, fuzzy,
  fmtAgo, fmtDur, fmtMoney, fmtTokens, fmtTime, getTask, getProfile, getPlaybook, getSession, inScope, overlaysSettled, ago,
} from '../shared.js';
import {
  ensureCss, liveQuery, setQuery, rerender, STATUS, prioTag, PRIO, assigneeTag, assigneeLabel, blockedReason, tenantOf,
  openTaskMenu, openAssign, openPicker, runNow, nudge, tabsHtml, tabPanelAttrs, bindTabs,
} from './board.js';
import { whenHtml, bindWhen, computeSchedule, specFromCron, fmtFire } from './schedules.js';

ensureCss('tasks');
ensureCss('schedules');

/* ==========================================================================
   Screen-local mock data (extends `data`; never replaces it)
   ========================================================================== */
const REPO = { 'caduceus-dashboard': 'hermes-lab/caduceus-dashboard', 'home-lab': 'hermes-lab/home-lab' };
const COMMENTS = {
  t_1032: [{ by: 'you', at: ago(2870), text: 'Seen twice this week on the WebKit runner only. Might be the resume timer.' }],
  t_1040: [{ by: 'coder', at: ago(400), text: 'Skeleton heights measured from the final rows: 64 px list, 88 px cards.' }, { by: 'you', at: ago(70), text: 'Use the shared .skel-row so density switching works.' }],
  t_1043: [{ by: 'property', at: ago(130), text: 'The lease says 31 Oct but the tenant emailed asking for 7 Nov. Which applies for the bond claim?' }],
  t_1045: [{ by: 'you', at: ago(1700), text: 'Blocked on rate-limit headers so push retries can back off properly.' }, { by: 'coder', at: ago(900), text: 'VAPID keys generated and stored as PUSH_VAPID_*.' }, { by: 'you', at: ago(300), text: 'Presence-aware: no push while any Caduceus client is visible.' }],
  t_1046: [{ by: 'coder', at: ago(95), text: 'Opened PR #212. CI green; 14 files, +420 −388.' }, { by: 'you', at: ago(40), text: 'Looking at the reconnect backoff now.' }],
};
const ATTACH = {
  t_1044: [{ name: 'vector-dbs-2026.md', size: '18 KB', by: 'librarian', at: ago(1440), kind: 'file' }],
  t_1046: [{ name: 'pr-212.diff', size: '41 KB', by: 'coder', at: ago(95), kind: 'code' }],
  t_1049: [{ name: 'rfc9331-notes.md', size: '4 KB', by: 'you', at: ago(300), kind: 'file' }],
  t_1043: [{ name: 'lease-unit-4b.pdf', size: '212 KB', by: 'you', at: ago(400), kind: 'file' }, { name: 'tenant-email-2026-10-02.eml', size: '9 KB', by: 'property', at: ago(150), kind: 'file' }],
};
const TEMPLATES = [
  { id: 'blank', name: 'Blank brief', sub: 'All six sections, empty', icon: 'draft' },
  { id: 'bug', name: 'Bug fix', sub: 'Reproduce → fix → test; PR contract', icon: 'alert', f: { priority: 'P1', skills: ['software/test-driven-dev', 'software/github-pr-workflow'], contract: true, contract_kind: 'repo', goal_mode: true, max_turns: 15 },
    s: { goal: 'Fix: <what is broken>, with a regression test.', context: 'Seen on: <where>. Steps to reproduce:\n- …', constraints: 'Do not change public APIs. Keep the fix minimal.', output: 'A PR with the fix and a failing-then-passing test.', scope: 'May edit the repo worktree only. Pushing needs approval.' } },
  { id: 'research', name: 'Research question', sub: 'Cited answer; one-stage Research brief', icon: 'book', f: { assignee: 'librarian', skills: ['research/web-research', 'research/citation-formatter'], workspace: 'scratch' },
    s: { goal: 'Answer: <question>', context: 'Why this matters / what decision it informs.', references: '- <known sources>', output: 'A Markdown report with 8–15 cited sources, attached to the task.', scope: 'Read-only web access. No sign-ups or purchases.' } },
  { id: 'code-review', name: 'Code review', sub: 'Template = one-stage playbook “Code review”', icon: 'git', f: { skills: ['software/github-pr-workflow'], contract: true, contract_kind: 'pr', contract_value: 'https://github.com/hermes-lab/caduceus-dashboard/pull/' },
    s: { goal: 'Review the PR against the project checklist and post comments.', output: 'Review comments on the PR and a summary comment here.', scope: 'Comment only. Never approve or merge.' } },
  { id: 'chore', name: 'Household chore', sub: 'Home Assistant, no repo', icon: 'home', f: { assignee: 'homeassistant', board: 'home', skills: ['home/home-assistant-control'], workspace: 'scratch', priority: 'P3' },
    s: { goal: '<what should happen at home>', scope: 'May read states and call services in the hallway and kitchen areas only.' } },
];
const SECTIONS = [
  ['goal', 'Goal', 'What is true when this is done? One or two sentences.', 'Return RateLimit-* headers on every /api/sessions response.'],
  ['context', 'Context', 'Background the worker can’t discover on its own.', 'Clients retry too eagerly; RFC 9331 draft headers let them back off.'],
  ['references', 'References', 'Links, files and prior tasks. Attach files below.', '- docs/api.md\n- t_1045 (push notifications depends on this)'],
  ['constraints', 'Constraints', 'Rules, limits, things to avoid.', 'No new dependencies. Keep p95 latency unchanged.'],
  ['output', 'Expected output', 'What to hand back, and where.', 'A PR with tests; a short summary comment on this task.'],
  ['scope', 'Scope & safety', 'What it may touch, and what needs your approval.', 'Edit the worktree only. git push needs approval.'],
];

/** Run steps: rich mocks for the live/failed runs, a generic shape for the rest. */
const STEPS = {
  r_2210: [
    { title: 'Claimed by dispatcher', kind: 'system', status: 'succeeded', at: 0, dur: 2, tokens: 0, cost: 0, out: 'hermes -p coder chat -q "work kanban task t_1049"\nworkspace: worktree kanban/t_1049' },
    { title: 'Read the brief and repo layout', kind: 'tool', tool: 'read_file', args: 'TASK.md, src/api/sessions.ts', status: 'succeeded', at: 2, dur: 14, tokens: 6_800, cost: 0.01, out: 'TASK.md (12 lines)\nsrc/api/sessions.ts (184 lines)' },
    { title: 'Plan the change', kind: 'reasoning', status: 'succeeded', at: 16, dur: 21, tokens: 9_200, cost: 0.01, out: 'Add a small middleware that sets RateLimit-Limit / -Remaining / -Reset from the existing token bucket; test with a fake clock.' },
    { title: 'Edit src/api/middleware/ratelimit.ts', kind: 'tool', tool: 'patch', args: '+38 −0', status: 'succeeded', at: 37, dur: 46, tokens: 14_100, cost: 0.02, out: '+export function rateLimitHeaders(bucket) {\n+  return (req, res, next) => { … }\n+}' },
    { title: 'Write tests', kind: 'tool', tool: 'write_file', args: 'src/api/ratelimit.test.ts', status: 'succeeded', at: 83, dur: 58, tokens: 15_700, cost: 0.02, out: '6 tests: limit, remaining, reset, 429 path, header casing, bucket refill' },
    { title: 'Run tests', kind: 'tool', tool: 'terminal', args: 'pnpm vitest run src/api', status: 'running', at: 141, dur: null, tokens: 18_500, cost: 0.03, out: ' ✓ src/api/ratelimit.test.ts (6)\n ✓ src/api/sessions.test.ts (14)\n ⠋ src/api/auth.test.ts' },
    { title: 'Open PR and wait for CI', kind: 'tool', tool: 'gh', args: 'pr create --fill', status: 'queued', tokens: 0, cost: 0 },
    { title: 'Goal judge', kind: 'judge', status: 'queued', tokens: 0, cost: 0 },
  ],
  r_2214: [
    { title: 'Claimed by dispatcher', kind: 'system', status: 'succeeded', at: 0, dur: 2, tokens: 0, cost: 0, out: 'step search-read · playbook research-brief@2' },
    { title: 'Load search plan from Plan stage', kind: 'tool', tool: 'read_file', args: 'plan.md', status: 'succeeded', at: 2, dur: 6, tokens: 3_100, cost: 0.01, out: '6 queries, 15 target sources' },
    { title: 'Web search (6 queries)', kind: 'tool', tool: 'web_search', args: '"step-up authentication UX" …', status: 'succeeded', at: 8, dur: 94, tokens: 22_400, cost: 0.05, out: '48 results, 17 shortlisted' },
    { title: 'Read sources (9 of ~15)', kind: 'tool', tool: 'web_extract', args: '17 URLs', status: 'running', at: 102, dur: null, tokens: 103_400, cost: 0.25, out: 'Read: NIST 800-63B §5.2 …\nRead: FIDO Alliance UX guidelines …\nRead: GOV.UK sign-in patterns …' },
    { title: 'Draft notes with citations', kind: 'assistant', status: 'queued', tokens: 0, cost: 0 },
  ],
  r_2196: [
    { title: 'Claimed by dispatcher', kind: 'system', status: 'succeeded', at: 0, dur: 2, tokens: 0, cost: 0, out: 'attempt 3 of 3 (circuit breaker armed)' },
    { title: 'Fetch DA index for 14 Elm St', kind: 'tool', tool: 'web_fetch', args: 'eplanning.council.example/DA-2026/0412', status: 'failed', at: 2, dur: 31, tokens: 2_200, cost: 0.0, out: 'HTTPError 403 Forbidden\nserver: cloudflare\ncf-mitigated: challenge' },
    { title: 'Retry with browser user agent', kind: 'tool', tool: 'web_fetch', args: '--ua chrome', status: 'failed', at: 33, dur: 29, tokens: 2_100, cost: 0.01, out: 'HTTPError 403 Forbidden' },
    { title: 'Circuit breaker tripped', kind: 'system', status: 'failed', at: 62, dur: 1, tokens: 0, cost: 0, out: '3 consecutive failures → blocked (gave_up). Retry or reassign from the task.' },
  ],
};
function stepsFor(run) {
  if (STEPS[run.id]) return STEPS[run.id];
  const st = run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : run.status === 'stale' ? 'stale' : run.status === 'blocked' ? 'waiting' : run.status === 'cancelled' ? 'cancelled' : 'succeeded';
  const total = run.duration || 60;
  const t1 = Math.round(run.tokens * 0.15), t2 = run.tokens - t1;
  const c1 = +(run.cost * 0.15).toFixed(2), c2 = +(run.cost - c1).toFixed(2);
  return [
    { title: 'Claimed by dispatcher', kind: 'system', status: 'succeeded', at: 0, dur: 2, tokens: 0, cost: 0, out: `hermes -p ${run.profile} chat -q "work kanban task"` },
    { title: 'Read the brief', kind: 'tool', tool: 'read_file', args: 'TASK.md', status: 'succeeded', at: 2, dur: Math.round(total * 0.1), tokens: t1, cost: c1, out: 'TASK.md' },
    { title: run.summary, kind: st === 'waiting' ? 'clarify' : 'assistant', status: st, at: 2 + Math.round(total * 0.1), dur: st === 'running' ? null : Math.round(total * 0.9), tokens: t2, cost: c2, out: run.error ? `${run.error}\n${run.summary}` : run.summary },
  ];
}
const KIND_ICON = { system: 'cpu', tool: 'tool', reasoning: 'bolt', judge: 'target', assistant: 'chat', clarify: 'question' };
const STEP_TONE = { succeeded: 'success', running: 'running', failed: 'danger', queued: 'neutral', stale: 'stale', waiting: 'warning', cancelled: 'neutral' };
const STEP_GLYPH = { succeeded: 'succeeded', running: 'running', failed: 'failed', queued: 'queued', stale: 'stale', waiting: 'waiting', cancelled: 'cancelled' };

function findRun(ctx, runId) {
  for (const t of ctx.data.tasks) { const i = t.runs.findIndex((r) => r.id === runId); if (i >= 0) return { task: t, run: t.runs[i], attempt: i + 1 }; }
  return null;
}

/* ---------- Tiny Markdown (brief bodies only: headings, lists, paragraphs, `code`, **bold**) ---------- */
function md(src) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  let out = '', list = false;
  const close = () => { if (list) { out += '</ul>'; list = false; } };
  for (const l of String(src || '').split('\n')) {
    if (/^#{1,4} /.test(l)) { close(); out += `<h3 class="md__h">${inline(l.replace(/^#+ /, ''))}</h3>`; }
    else if (/^[-*] /.test(l)) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(l.slice(2))}</li>`; }
    else if (!l.trim()) close();
    else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return raw(out);
}

/* ==========================================================================
   /work/tasks: list
   ========================================================================== */
const VIEWS = [
  ['all', 'All', 'tasks'], ['mine', 'Mine', 'user'], ['waiting', 'Waiting for me', 'waiting'], ['failed', 'Failed', 'failed'], ['playbook', 'By playbook', 'playbook'], ['project', 'By project', 'briefcase'],
];
const isFailed = (t) => t.gave_up || t.stale || t.runs.at(-1)?.status === 'failed';
const PR = { P0: 0, P1: 1, P2: 2, P3: 3 };
function listTasks(ctx, q) {
  const me = ctx.scope !== 'all' ? ctx.scope : null;
  const s = (q.q || '').trim();
  return ctx.data.tasks.filter((t) => t.status !== 'archived'
    && inScope(t.assignee === 'you' ? null : t.assignee, ctx.scope)
    && (q.view !== 'mine' || t.assignee === 'you' || (me && t.assignee === me) || (!me && (COMMENTS[t.id] || []).some((c) => c.by === 'you')))
    && (q.view !== 'waiting' || taskState(t).state === 'waiting')
    && (q.view !== 'failed' || isFailed(t))
    && (!s || fuzzy(s, `${t.id} ${t.title} ${t.assignee || ''} ${t.project || ''} ${t.playbook || ''}`) >= 0))
    .sort((a, b) => (PR[a.priority] - PR[b.priority]) || b.updated - a.updated);
}
function taskRow(ctx, t) {
  const st = taskState(t);
  const pb = t.playbook && getPlaybook(t.playbook);
  const cost = t.runs.reduce((n, r) => n + (r.cost || 0), 0);
  const reason = blockedReason(t);
  const board = ctx.data.boards.find((b) => b.id === t.board);
  return html`<tr class="tt__row${['waiting', 'failed', 'stale'].includes(st.state) ? ' is-attn' : ''}">
    <td class="tt__main"><a class="tt__link" href="${ctx.href('/work/tasks/' + t.id)}">${t.title}</a>
      <div class="tt__sub"><span class="mono">${t.id}</span>${pb ? html`<span class="tag">${icon('playbook', 'i-sm')}${pb.name}${t.step_key ? ` · ${t.step_key}` : ''}</span>` : ''}${reason ? html`<span class="tt__reason" data-tone="${reason.tone}">${reason.text}</span>` : ''}</div></td>
    <td class="tt__status">${statusBadge(st.state, { label: st.label })}</td>
    <td class="tt__asg">${assigneeTag(t.assignee)}</td>
    <td class="tt__prio">${prioTag(t.priority)}</td>
    <td class="tt__proj"><span class="truncate">${t.project || board?.name || t.board}</span></td>
    <td class="tt__runs mono">${t.runs.length ? html`${t.runs.length} · ${fmtMoney(cost)}` : html`<span class="subtle">—</span>`}</td>
    <td class="tt__upd mono">${fmtAgo(t.updated)}</td>
    <td class="tt__menu"><button type="button" class="btn btn--ghost btn--icon" data-menu="${t.id}" data-fk="menu-${t.id}" aria-haspopup="dialog" aria-label="Actions for ${t.title}">${icon('dots-v')}</button></td>
  </tr>`;
}
function renderList(ctx) {
  const q = liveQuery();
  const view = VIEWS.some(([k]) => k === q.view) ? q.view : 'all';
  const tasks = listTasks(ctx, { ...q, view });
  const counts = Object.fromEntries(VIEWS.map(([k]) => [k, listTasks(ctx, { view: k }).length]));
  let groups = [[null, tasks]];
  if (view === 'playbook') {
    const keys = [...new Set(tasks.map((t) => t.playbook || ''))].sort((a, b) => (!a) - (!b));
    groups = keys.map((k) => [k ? `${getPlaybook(k)?.name} · workflow_template_id=${k}` : 'Not from a playbook', tasks.filter((t) => (t.playbook || '') === k)]);
  } else if (view === 'project') {
    const keys = [...new Set(tasks.map((t) => t.project || ''))].sort((a, b) => (!a) - (!b));
    groups = keys.map((k) => [k ? ctx.data.projects.find((p) => p.id === k)?.name || k : 'No project', tasks.filter((t) => (t.project || '') === k)]);
  }
  const head = html`<thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Assignee</th><th scope="col"><span class="sr-only">Priority</span>Pri</th><th scope="col">Project</th><th scope="col">Runs · cost</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>`;
  return html`<div class="tlist">
    <header class="page-header"><div class="page-header__text"><p class="overline">Work</p><h1 tabindex="-1">Tasks</h1>
      <p class="page-header__sub">${tasks.length} of ${counts.all} tasks · ${counts.waiting} waiting for you · ${counts.failed} failed</p></div>
      ${ctx.size === 'compact' ? '' : html`<div class="page-header__actions"><a class="btn btn--primary" href="${ctx.href('/work/tasks/new')}">${icon('plus')}New task</a></div>`}
    </header>
    <div class="tlist__tools" role="search" aria-label="Filter tasks">
      <div class="input-wrap">${icon('search')}<input class="input" type="search" data-q data-fk="q" value="${q.q || ''}" placeholder="Search tasks, ids, projects" aria-label="Search tasks"></div>
      <div class="chips-scroll" role="group" aria-label="Saved filters" data-keep-scroll="views">${VIEWS.map(([k, l, ic]) => html`<button type="button" class="chip" aria-pressed="${String(view === k)}" data-view="${k}" data-fk="view-${k}">${icon(ic)}${l}<span class="mono subtle">${counts[k]}</span></button>`)}</div>
    </div>
    ${tasks.length ? html`<div class="tt-wrap" data-keep-scroll="tt"><table class="tt">
        <caption class="sr-only">${VIEWS.find(([k]) => k === view)[1]} tasks</caption>${head}
        ${groups.map(([label, ts]) => html`<tbody>${label ? html`<tr class="tt__group"><th colspan="8" scope="rowgroup">${label}<span class="mono subtle">${ts.length}</span></th></tr>` : ''}${ts.map((t) => taskRow(ctx, t))}</tbody>`)}
      </table></div>`
      : emptyState({ icon: view === 'waiting' ? 'succeeded' : 'tasks', title: view === 'waiting' ? 'Nothing is waiting for you' : 'No tasks match', body: view === 'waiting' ? 'Reviews, questions and failures land here.' : 'Try another saved filter or clear the search.', action: q.q ? html`<button type="button" class="btn btn--secondary" data-clearq>Clear search</button>` : '' })}
  </div>`;
}

/* ==========================================================================
   /work/tasks/new: Brief editor
   ========================================================================== */
let draft = null;
function newDraft(ctx, q) {
  const board = ctx.data.boards.find((b) => b.id === q.board) || ctx.data.boards[0];
  const project = board.project || '';
  const assignee = ctx.scope !== 'all' ? ctx.scope : project === 'caduceus-dashboard' ? 'coder' : project === 'home-lab' ? 'homeassistant' : 'default';
  return {
    title: '', s: Object.fromEntries(SECTIONS.map(([k]) => [k, ''])), files: [], template: null,
    board: board.id, assignee, priority: 'P2', model: '', reasoning: 'default', skills: [],
    workspace: project ? 'worktree' : 'scratch', project, path: project ? ctx.data.projects.find((p) => p.id === project)?.repo || '' : '', branch: '',
    runtime: '7200', retries: 2, goal_mode: false, max_turns: 12, contract: false, contract_kind: 'repo', contract_value: REPO[project] || '',
    dispatch: 'queue', spec: specFromCron('0 9 * * 1'), errors: {},
  };
}
function serialize(d) {
  const parts = SECTIONS.filter(([k]) => d.s[k].trim()).map(([k, l]) => `## ${l}\n${d.s[k].trim()}`);
  if (d.files.length) parts.push(`## Attachments\n${d.files.map((f) => `- ${f}`).join('\n')}`);
  return parts.join('\n\n');
}
const DISPATCH = {
  draft: { label: 'Save draft', icon: 'draft', help: 'Creates the task in Triage. Nothing runs; Specify can expand it later.', submit: 'Save draft' },
  queue: { label: 'Queue', icon: 'queued', help: 'Status Ready. The dispatcher runs it when a slot is free on the board.', submit: 'Queue task' },
  run: { label: 'Run now', icon: 'play', help: 'Ready + dispatcher nudge: starts immediately if a slot is free.', submit: 'Run now' },
  schedule: { label: 'Schedule', icon: 'calendar', help: 'A Hermes cron job creates this task at each fire time.', submit: 'Create schedule' },
};
const RUNTIMES = [['900', '15 min'], ['1800', '30 min'], ['3600', '1 hour'], ['7200', '2 hours'], ['14400', '4 hours'], ['0', 'No limit']];
const sel = (v, cur) => (String(v) === String(cur) ? raw('selected') : '');

function renderNew(ctx) {
  const d = draft;
  const prof = getProfile(d.assignee);
  const compact = ctx.size === 'compact';
  const skillsFor = ctx.data.skills.filter((s) => s.enabled && (s.profiles.includes(d.assignee) || d.skills.includes(s.path)));
  const err = (k) => (d.errors[k] ? html`<p class="field__error" id="err-${k}">${icon('alert', 'i-sm')}${d.errors[k]}</p>` : '');
  const inv = (k) => (d.errors[k] ? raw(`aria-invalid="true" aria-describedby="err-${k}"`) : '');
  const model = ctx.data.models.find((m) => m.id === d.model);
  const tpl = TEMPLATES.find((t) => t.id === d.template);
  const panel = (id, title, body) => html`<section class="nt__panel panel" aria-labelledby="${id}"><h2 class="nt__ph" id="${id}">${title}</h2>${body}</section>`;

  return html`<form class="nt" novalidate data-nt>
    <header class="page-header"><div class="page-header__text"><p class="overline">New task${tpl ? ` · from ${tpl.name}` : ''}</p><h1 tabindex="-1">Write the brief</h1>
      <p class="page-header__sub">Sections become Markdown headings in the task body; Hermes workers read it as-is.</p></div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--secondary" data-tpl data-fk="tpl" aria-haspopup="dialog">${icon('stack')}Start from template</button>
        <button type="button" class="btn btn--ghost" data-preview aria-haspopup="dialog">${icon('eye')}Preview body</button>
      </div>
    </header>

    <div class="nt__grid">
      <div class="nt__main">
        <div class="field nt__title"><label class="field__label" for="nt-title">Title</label>
          <input class="input" id="nt-title" data-d="title" data-fk="title" value="${d.title}" placeholder="Add rate-limit headers to /api/sessions" autocomplete="off" ${inv('title')}>${err('title')}</div>
        ${SECTIONS.map(([k, l, help, ph]) => html`<div class="field nt__sec"><label class="field__label" for="nt-${k}">${l}${k === 'goal' ? html` <span class="subtle">(required)</span>` : ''}</label>
          <p class="field__help" id="nt-${k}-h">${help}</p>
          <textarea class="input" id="nt-${k}" data-s="${k}" data-fk="s-${k}" rows="${k === 'goal' ? 3 : 2}" placeholder="e.g. ${ph}" aria-describedby="nt-${k}-h${d.errors[k] ? ` err-${k}` : ''}" ${d.errors[k] ? raw('aria-invalid="true"') : ''}>${d.s[k]}</textarea>${err(k)}
          ${k === 'references' ? html`<div class="nt__files">${d.files.map((f, i) => html`<span class="chip">${icon('file')}<span class="truncate">${f}</span><button type="button" class="chip__x" data-unfile="${i}" aria-label="Remove ${f}">${icon('x', 'i-sm')}</button></span>`)}
            <label class="btn btn--ghost btn--sm nt__attach">${icon('clip')}Attach files<input type="file" multiple class="sr-only" data-files></label></div>` : ''}
        </div>`)}
      </div>

      <aside class="nt__side" aria-label="Task settings">
        ${panel('nt-p-assign', 'Assignment', html`
          <div class="nt__row">
            <div class="field"><label class="field__label" for="nt-board">Board</label><select class="input" id="nt-board" data-d="board" data-re>${ctx.data.boards.map((b) => html`<option value="${b.id}" ${sel(b.id, d.board)}>${b.name}</option>`)}</select></div>
            <div class="field"><label class="field__label" for="nt-asg">Assignee profile</label><select class="input" id="nt-asg" data-d="assignee" data-re data-fk="asg">${ctx.data.profiles.map((p) => html`<option value="${p.name}" ${sel(p.name, d.assignee)}>${p.name}</option>`)}<option value="you" ${sel('you', d.assignee)}>You (human task)</option></select></div>
          </div>
          <div class="field"><span class="field__label" id="nt-prio-l">Priority</span><div class="seg nt__seg" role="radiogroup" aria-labelledby="nt-prio-l">${Object.keys(PRIO).map((p) => html`<button type="button" role="radio" aria-checked="${String(d.priority === p)}" data-set="priority" data-v="${p}" data-fk="prio-${p}">${p}<span class="sr-only"> ${PRIO[p].label}</span></button>`)}</div></div>`)}

        ${panel('nt-p-exec', 'Model & skills', html`
          <div class="field"><label class="field__label" for="nt-model">Model override</label><select class="input" id="nt-model" data-d="model" data-re data-fk="model"><option value="">Profile default${prof ? ` (${prof.model})` : ''}</option>${ctx.data.models.map((m) => html`<option value="${m.id}" ${sel(m.id, d.model)}>${m.id} · ${m.provider}</option>`)}</select>
            <p class="field__help">${model ? html`model_override=${model.id} · provider_override=${model.provider}` : 'Sent to the worker as model_override / provider_override.'}</p></div>
          <div class="field"><span class="field__label" id="nt-rs-l">Reasoning</span><div class="seg nt__seg" role="radiogroup" aria-labelledby="nt-rs-l">${['default', 'low', 'medium', 'high'].map((r) => html`<button type="button" role="radio" aria-checked="${String(d.reasoning === r)}" data-set="reasoning" data-v="${r}" data-fk="rs-${r}">${r[0].toUpperCase() + r.slice(1)}</button>`)}</div></div>
          <div class="field"><span class="field__label" id="nt-sk-l">Skills</span>
            <div class="nt__chips" role="group" aria-labelledby="nt-sk-l">${skillsFor.length ? skillsFor.map((s) => html`<button type="button" class="chip" aria-pressed="${String(d.skills.includes(s.path))}" data-skill="${s.path}" data-fk="sk-${s.path}">${s.name}</button>`) : html`<span class="subtle">No skills installed on ${d.assignee}.</span>`}
              <button type="button" class="chip" data-addskill aria-haspopup="dialog">${icon('plus')}More</button></div></div>
          <p class="nt__toolsets">${icon('lock', 'i-sm')}<span>Toolsets are per profile: <span class="mono">${d.assignee === 'you' ? '—' : 'terminal, file, web' + (d.assignee === 'coder' ? ', github' : '')}</span>. <a href="${ctx.href('/agents/profiles/' + (d.assignee === 'you' ? 'default' : d.assignee) + '/tools')}">Edit on ${d.assignee === 'you' ? 'the profile' : d.assignee}</a></span></p>`)}

        ${panel('nt-p-ws', 'Workspace', html`
          <div class="seg nt__seg" role="radiogroup" aria-label="Workspace kind">${[['scratch', 'Scratch'], ['dir', 'Directory'], ['worktree', 'Worktree']].map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(d.workspace === k)}" data-set="workspace" data-v="${k}" data-fk="ws-${k}">${l}</button>`)}</div>
          ${d.workspace === 'scratch' ? html`<p class="field__help">A throwaway directory under the profile’s workspace; deleted after Done.</p>` : html`
            <div class="field"><label class="field__label" for="nt-proj">Project</label><select class="input" id="nt-proj" data-d="project" data-re><option value="">None</option>${ctx.data.projects.map((p) => html`<option value="${p.id}" ${sel(p.id, d.project)}>${p.name}</option>`)}</select></div>
            ${d.workspace === 'dir' ? html`<div class="field"><label class="field__label" for="nt-path">Path</label><input class="input input--mono" id="nt-path" data-d="path" value="${d.path}" placeholder="~/code/caduceus-dashboard"></div>`
              : html`<div class="field"><label class="field__label" for="nt-branch">Branch</label><input class="input input--mono" id="nt-branch" data-d="branch" value="${d.branch}" placeholder="kanban/&lt;task id&gt;"><p class="field__help">A git worktree of ${d.project || 'the project'} on this branch.</p></div>`}`}`)}

        ${panel('nt-p-limits', 'Limits', html`
          <div class="nt__row">
            <div class="field"><label class="field__label" for="nt-rt">Max runtime</label><select class="input" id="nt-rt" data-d="runtime">${RUNTIMES.map(([v, l]) => html`<option value="${v}" ${sel(v, d.runtime)}>${l}</option>`)}</select></div>
            <div class="field"><label class="field__label" for="nt-retry">Retries</label><div class="nt__stepper"><button type="button" class="btn btn--secondary btn--icon" data-retry="-1" aria-label="Fewer retries" data-fk="r-">${icon('chev-d')}</button><input class="input mono" id="nt-retry" type="number" min="0" max="5" inputmode="numeric" data-d="retries" value="${d.retries}"><button type="button" class="btn btn--secondary btn--icon" data-retry="1" aria-label="More retries" data-fk="r+">${icon('chev-u')}</button></div></div>
          </div>`)}

        ${panel('nt-p-done', 'Done when', html`
          <div class="switch-row"><span id="nt-goal-l">Goal mode <span class="field__help nt__block">A judge keeps the worker going until the Goal is met.</span></span><button type="button" class="switch" role="switch" aria-checked="${String(d.goal_mode)}" aria-labelledby="nt-goal-l" data-toggle="goal_mode" data-fk="goal"></button></div>
          ${d.goal_mode ? html`<div class="field nt__indent"><label class="field__label" for="nt-turns">Max turns</label><input class="input mono" id="nt-turns" type="number" min="1" max="60" data-d="max_turns" value="${d.max_turns}"></div>` : ''}
          <div class="switch-row"><span id="nt-cc-l">Completion contract <span class="field__help nt__block">For a repo or PR, CI gates must pass.</span></span><button type="button" class="switch" role="switch" aria-checked="${String(d.contract)}" aria-labelledby="nt-cc-l" data-toggle="contract" data-fk="cc"></button></div>
          ${d.contract ? html`<div class="nt__indent stack">
            <div class="seg nt__seg" role="radiogroup" aria-label="Contract kind">${[['local', 'local-only'], ['repo', 'OWNER/REPO'], ['pr', 'PR URL']].map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(d.contract_kind === k)}" data-set="contract_kind" data-v="${k}" data-fk="cc-${k}">${l}</button>`)}</div>
            ${d.contract_kind === 'local' ? html`<p class="field__help">Done when the worker reports success; no CI check.</p>` : html`<div class="field"><label class="field__label" for="nt-ccv">${d.contract_kind === 'repo' ? 'Repository' : 'Pull request URL'}</label><input class="input input--mono" id="nt-ccv" data-d="contract_value" value="${d.contract_value}" placeholder="${d.contract_kind === 'repo' ? 'hermes-lab/caduceus-dashboard' : 'https://github.com/OWNER/REPO/pull/123'}" ${inv('contract_value')}>${err('contract_value')}</div>`}
          </div>` : ''}
          ${!d.goal_mode && !d.contract ? html`<p class="field__help">Neither set: done when the worker marks it done.</p>` : ''}`)}
      </aside>
    </div>

    ${d.dispatch === 'schedule' ? html`<section class="nt__sched panel panel--pad" aria-labelledby="nt-sched-h"><h2 class="nt__ph" id="nt-sched-h">${icon('calendar')}Schedule</h2>${whenHtml(d.spec, 'nt')}</section>` : ''}

    <div class="nt__bar" data-dock role="group" aria-label="Dispatch">
      <div class="seg nt__dispatch" role="radiogroup" aria-label="Dispatch mode">${Object.entries(DISPATCH).map(([k, m]) => html`<button type="button" role="radio" aria-checked="${String(d.dispatch === k)}" data-set="dispatch" data-v="${k}" data-fk="dp-${k}">${compact ? '' : icon(m.icon)}${m.label}</button>`)}</div>
      <p class="nt__dhelp">${DISPATCH[d.dispatch].help}</p>
      <div class="nt__submit">
        <button type="button" class="btn btn--ghost" data-discard>Discard</button>
        <button type="submit" class="btn btn--primary" data-fk="submit">${icon(DISPATCH[d.dispatch].icon)}${DISPATCH[d.dispatch].submit}</button>
      </div>
    </div>
  </form>`;
}

function applyTemplate(ctx, id) {
  const tp = TEMPLATES.find((t) => t.id === id);
  const prev = JSON.parse(JSON.stringify({ ...draft, spec: undefined }));
  const prevSpec = draft.spec;
  const base = newDraft(ctx, { board: tp.f?.board || draft.board });
  draft = { ...base, ...(tp.f || {}), title: draft.title, s: { ...base.s, ...(tp.s || {}) }, template: tp.id, dispatch: draft.dispatch, spec: draft.spec };
  if (tp.f?.contract_kind === 'repo' && !tp.f.contract_value) draft.contract_value = REPO[draft.project] || '';
  rerender(ctx, 'title');
  ctx.toast(`Filled from “${tp.name}”`, { undo: () => { draft = { ...prev, spec: prevSpec }; rerender(ctx); } });
}

function submitNew(ctx) {
  const d = draft;
  d.errors = {};
  if (!d.title.trim()) d.errors.title = 'Give the task a title';
  if (!d.s.goal.trim()) d.errors.goal = 'The Goal is what the worker aims for; add one sentence';
  if (d.contract && d.contract_kind === 'repo' && !/^[\w.-]+\/[\w.-]+$/.test(d.contract_value.trim())) d.errors.contract_value = 'Use OWNER/REPO';
  if (d.contract && d.contract_kind === 'pr' && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(d.contract_value.trim())) d.errors.contract_value = 'Use a full pull request URL';
  const sch = d.dispatch === 'schedule' ? computeSchedule(d.spec) : null;
  const firstErr = Object.keys(d.errors)[0];
  if (firstErr) {
    rerender(ctx);
    const el = document.querySelector(firstErr === 'title' ? '#nt-title' : firstErr === 'contract_value' ? '#nt-ccv' : `#nt-${firstErr}`);
    el?.focus(); el?.scrollIntoView({ block: 'center' });
    return;
  }
  if (sch?.error) { const el = document.querySelector('[data-sb-fields] input, [data-sb-fields] select'); el?.focus(); el?.scrollIntoView({ block: 'center' }); return; }
  const contract = d.contract ? (d.contract_kind === 'local' ? 'local-only' : d.contract_value.trim()) : undefined;
  const fields = {
    board: d.board, title: d.title.trim(), assignee: d.assignee || null, priority: d.priority, skills: [...d.skills],
    model_override: d.model || undefined, reasoning_effort: d.reasoning === 'default' ? undefined : d.reasoning,
    goal_mode: d.goal_mode || undefined, goal_max_turns: d.goal_mode ? +d.max_turns : undefined, completion_contract: contract,
    project: d.project || null, workspace: d.workspace === 'scratch' ? undefined : { kind: d.workspace, path: d.path || undefined, branch: d.branch || undefined },
    max_runtime_seconds: +d.runtime || undefined, max_retries: +d.retries, body: serialize(d),
  };
  if (d.dispatch === 'schedule') {
    const job = { id: `c_nt${Date.now() % 100000}`, name: fields.title, type: 'task', profile: d.assignee === 'you' ? 'default' : d.assignee, schedule: sch.cron, human: sch.human, state: 'active', next: sch.fires[0], lastStatus: null, deliver: 'inbox', creates: { board: d.board, title: fields.title, assignee: d.assignee, brief: fields.body }, runs: [] };
    ctx.data.cron.unshift(job);
    draft = null;
    ctx.navigate('/work/schedules/' + job.id);
    ctx.toast(`Scheduled “${job.name}”`, { detail: `${sch.human} · first ${fmtFire(sch.fires[0])}` });
    return;
  }
  const n = Math.max(...ctx.data.tasks.map((t) => +t.id.slice(2))) + 1;
  const t = { id: `t_${n}`, ...fields, status: d.dispatch === 'draft' ? 'triage' : 'ready', created: Date.now(), updated: Date.now(), runs: [], comments: 0 };
  if (t.workspace?.kind === 'worktree' && !t.workspace.branch) t.workspace.branch = `kanban/${t.id}`;
  ctx.data.tasks.push(t);
  if (d.files.length) ATTACH[t.id] = d.files.map((f) => ({ name: f, size: '—', by: 'you', at: Date.now(), kind: 'file' }));
  draft = null;
  ctx.navigate('/work/tasks/' + t.id);
  if (d.dispatch === 'run') runNow(ctx, t, () => ctx.refresh());
  else ctx.toast(d.dispatch === 'draft' ? `Saved ${t.id} as a draft` : `Queued ${t.id}`, { detail: d.dispatch === 'draft' ? 'In Triage; Specify to expand the brief' : 'Ready; the dispatcher claims it when a slot is free' });
}

function bindNew(root, ctx) {
  const form = root.querySelector('[data-nt]');
  if (ctx.size === 'compact') ctx.setAppBar({ title: 'New task' });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitNew(ctx); });
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.s) { draft.s[el.dataset.s] = el.value; if (draft.errors[el.dataset.s]) { delete draft.errors[el.dataset.s]; el.removeAttribute('aria-invalid'); el.parentElement.querySelector('.field__error')?.remove(); } }
    else if (el.dataset.d && el.tagName !== 'SELECT') { draft[el.dataset.d] = el.value; if (draft.errors[el.dataset.d]) { delete draft.errors[el.dataset.d]; el.removeAttribute('aria-invalid'); el.parentElement.querySelector('.field__error')?.remove(); } }
  });
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-files]')) { draft.files.push(...[...el.files].map((f) => f.name)); rerender(ctx); return; }
    if (el.tagName === 'SELECT' && el.dataset.d) {
      draft[el.dataset.d] = el.value;
      if (el.dataset.d === 'project') { draft.path = ctx.data.projects.find((p) => p.id === el.value)?.repo || ''; if (draft.contract_kind === 'repo') draft.contract_value = REPO[el.value] || draft.contract_value; }
      if (el.dataset.d === 'board') { const b = ctx.data.boards.find((x) => x.id === el.value); if (b?.project) draft.project = b.project; }
      if (el.dataset.d === 'assignee') draft.skills = draft.skills.filter((s) => ctx.data.skills.find((k) => k.path === s)?.profiles.includes(el.value));
      if ('re' in el.dataset) rerender(ctx);
    }
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.type === 'submit') return;
    if (b.dataset.set) { draft[b.dataset.set] = b.dataset.v; rerender(ctx, b.dataset.fk); }
    else if (b.dataset.toggle) { draft[b.dataset.toggle] = !draft[b.dataset.toggle]; rerender(ctx, b.dataset.fk); }
    else if (b.dataset.skill) { const p = b.dataset.skill; draft.skills = draft.skills.includes(p) ? draft.skills.filter((x) => x !== p) : [...draft.skills, p]; rerender(ctx, b.dataset.fk); }
    else if (b.dataset.retry) { draft.retries = Math.max(0, Math.min(5, +draft.retries + +b.dataset.retry)); rerender(ctx, b.dataset.fk); }
    else if (b.dataset.unfile) { draft.files.splice(+b.dataset.unfile, 1); rerender(ctx, 'title'); }
    else if (b.hasAttribute('data-tpl')) {
      openPicker(ctx, {
        title: 'Start from template', label: 'Template', current: draft.template || '',
        options: TEMPLATES.map((t) => ({ value: t.id, label: t.name, sub: t.sub, lead: html`<span class="plist__ico">${icon(t.icon)}</span>` })),
        note: 'A template is a one-stage playbook. Multi-stage work belongs in <a href="#/work/playbooks">Playbooks</a>.',
        onPick: (v) => v && applyTemplate(ctx, v),
      });
    } else if (b.hasAttribute('data-preview')) {
      const body = serialize(draft) || '_(empty body)_';
      ctx.openSheet({ title: 'Task body (Markdown)', wide: true, detents: ['half', 'full'], body: `<p class="muted">This is exactly what the worker reads. Structured fields are sent as Kanban columns, not in the body.</p><div class="code"><div class="code__head"><span class="mono">TASK.md</span></div><pre>${esc(body)}</pre></div>` });
    } else if (b.hasAttribute('data-addskill')) {
      const all = ctx.data.skills.filter((s) => s.enabled);
      ctx.openSheet({
        title: 'Add skills', detents: ['half', 'full'],
        body: String(html`<p class="muted">Skills not installed on ${draft.assignee} are loaded for this task only.</p><div class="stack nt__skilllist">${all.map((s) => html`<label class="check"><input type="checkbox" value="${s.path}" ${draft.skills.includes(s.path) ? raw('checked') : ''}><span><strong>${s.name}</strong> <span class="subtle mono">${s.category}</span><br><span class="subtle">${s.description}</span></span></label>`)}</div>`),
        footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-ok>Done</button>',
        onMount(panel, layer) {
          panel.querySelector('[data-ok]').addEventListener('click', async () => {
            draft.skills = [...panel.querySelectorAll('input:checked')].map((i) => i.value);
            layer.close(); await overlaysSettled(); rerender(ctx);
          });
        },
      });
    } else if (b.hasAttribute('data-discard')) {
      const prev = draft;
      draft = newDraft(ctx, liveQuery());
      rerender(ctx, 'title');
      ctx.toast('Draft discarded', { undo: () => { draft = prev; rerender(ctx); } });
    }
  });
  if (draft.dispatch === 'schedule') bindWhen(root.querySelector('.nt__sched'), draft.spec);
}

/* ==========================================================================
   /work/tasks/:id: detail
   ========================================================================== */
const TABS = ['brief', 'runs', 'activity', 'links', 'attachments', 'settings'];
function childrenOf(ctx, t) { return ctx.data.tasks.filter((x) => (x.parents || []).includes(t.id) || (t.parentOf || []).includes(x.id)); }
function parentsOf(ctx, t) { return (t.parents || []).map(getTask).filter(Boolean); }
function eventsFor(ctx, t) {
  const ev = [{ at: t.created, icon: 'plus', tone: 'neutral', title: html`Created${t.createdBy ? html` by <span class="mono">${t.createdBy}</span>` : t.playbookRun ? html` by playbook run <span class="mono">${t.playbookRun}</span>` : ' by you'}` }];
  t.runs.forEach((r, i) => {
    ev.push({ at: r.started, icon: 'play', tone: 'running', title: html`Run <a href="${ctx.href('/work/runs/' + r.id)}">${r.id}</a> started on ${r.profile}${t.runs.length > 1 ? ` (attempt ${i + 1})` : ''}` });
    if (r.status !== 'running') ev.push({ at: r.started + (r.duration || 0) * 1000, icon: STEP_GLYPH[r.status] || 'info', tone: STEP_TONE[r.status] || 'neutral', title: html`Run ${r.id} ${r.status}`, sub: r.error || r.summary });
  });
  (COMMENTS[t.id] || []).forEach((c) => ev.push({ at: c.at, comment: c }));
  ev.push({ at: t.updated, icon: STATUS[t.status]?.icon || 'info', tone: 'accent', title: html`Status is <strong>${STATUS[t.status]?.label || t.status}</strong>` });
  return ev.sort((a, b) => a.at - b.at);
}

function detailActions(ctx, t, compact) {
  const st = taskState(t);
  const failed = isFailed(t);
  const run = t.runs.at(-1);
  const acts = [];
  if ((t.status === 'running' || t.status === 'done') && !t.stale && run) acts.push({ k: 'openrun', label: t.status === 'done' ? 'Open last run' : 'Open run', icon: 'arrow-r', href: '/work/runs/' + run.id, primary: true });
  if (t.status === 'running' && !t.stale) acts.push({ k: 'terminate', label: 'Terminate', icon: 'stop', cls: 'btn--danger-quiet', danger: true });
  if (t.stale) acts.push({ k: 'reclaim', label: 'Reclaim', icon: 'refresh', primary: true });
  if (t.status === 'review') acts.push({ k: 'approve', label: 'Approve', icon: 'check', primary: true }, { k: 'reject', label: 'Reject with note', icon: 'x' });
  if (st.state === 'waiting' && t.block_kind === 'needs_input') acts.push({ k: 'answer', label: 'Answer', icon: 'chat', primary: true });
  if (failed && !t.stale) acts.push({ k: 'retry', label: 'Retry', icon: 'refresh', primary: true });
  if (t.status === 'triage') acts.push({ k: 'specify', label: 'Specify', icon: 'bolt', primary: true });
  if (['triage', 'todo', 'ready'].includes(t.status) || (t.status === 'blocked' && t.block_kind !== 'needs_input' && !failed)) acts.push({ k: 'run', label: 'Run now', icon: 'play', primary: !acts.some((a) => a.primary) });
  if (t.status !== 'triage' && t.status !== 'done') acts.push({ k: 'specify', label: 'Specify', icon: 'bolt' });
  acts.push({ k: 'decompose', label: 'Decompose', icon: 'subagent' }, { k: 'reassign', label: 'Reassign', icon: 'user' });
  const seen = new Set();
  // Primary first, destructive last (never in the primary position; mobile §5).
  const uniq = acts.filter((a) => !seen.has(a.k) && seen.add(a.k)).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || (a.danger ? 1 : 0) - (b.danger ? 1 : 0));
  const primary = uniq.find((a) => a.primary) || uniq[0];
  const btn = (a, cls = '') => (a.href
    ? html`<a class="btn ${a.primary ? 'btn--primary' : 'btn--secondary'} ${cls}" href="${ctx.href(a.href)}">${icon(a.icon)}${a.label}</a>`
    : html`<button type="button" class="btn ${a.primary ? 'btn--primary' : a.cls || 'btn--secondary'} ${cls}" data-tact="${a.k}" data-fk="act-${a.k}">${icon(a.icon)}${a.label}</button>`);
  if (!compact) return html`${uniq.map((a) => btn(a))}`;
  const rest = uniq.filter((a) => a !== primary);
  return { primary: btn(primary, 'btn--block'), rest };
}

function renderDetail(ctx, t) {
  const q = liveQuery();
  const tab = TABS.includes(q.tab) ? q.tab : 'brief';
  const st = taskState(t);
  const board = ctx.data.boards.find((b) => b.id === t.board);
  const pb = t.playbook && getPlaybook(t.playbook);
  const reason = blockedReason(t);
  const parents = parentsOf(ctx, t), kids = childrenOf(ctx, t);
  const files = ATTACH[t.id] || [];
  const comments = COMMENTS[t.id] || [];
  const compact = ctx.size === 'compact';
  const acts = detailActions(ctx, t, compact);
  const prof = t.assignee && getProfile(t.assignee);
  const cost = t.runs.reduce((n, r) => n + (r.cost || 0), 0);
  const tokens = t.runs.reduce((n, r) => n + (r.tokens || 0), 0);
  const kvs = (rows) => html`<dl class="kv">${rows.filter(([, v]) => v).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;

  let panel;
  if (tab === 'brief') {
    panel = html`<div class="td__brief">
      <section class="td__body panel panel--pad" aria-labelledby="h-body">
        <div class="section__head"><h2 class="section__title" id="h-body">Brief</h2><button type="button" class="btn btn--ghost btn--sm" data-tact="editbrief">${icon('draft')}Edit</button></div>
        ${t.body ? html`<div class="md">${md(t.body)}</div>` : html`<p class="muted">No brief yet. ${t.status === 'triage' ? 'Specify writes one from the title.' : ''}</p>`}
      </section>
      <section class="td__fields panel panel--pad" aria-labelledby="h-fields">
        <h2 class="section__title" id="h-fields">Fields</h2>
        ${kvs([
          ['assignee', assigneeTag(t.assignee)],
          ['model', t.model_override ? html`<span class="mono">${t.model_override}</span> <span class="subtle">override</span>` : prof ? html`<span class="mono">${prof.model}</span> <span class="subtle">profile default</span>` : ''],
          ['reasoning', t.reasoning_effort || 'default'],
          ['skills', t.skills.length ? html`<span class="td__chips">${t.skills.map((s) => html`<span class="tag mono">${s.split('/').pop()}</span>`)}</span>` : html`<span class="subtle">none</span>`],
          ['workspace', t.workspace ? html`<span class="mono">${t.workspace.kind}${t.workspace.branch ? ` · ${t.workspace.branch}` : ''}${t.workspace.path ? ` · ${t.workspace.path}` : ''}</span>` : html`<span class="mono">scratch</span>`],
          ['done when', t.goal_mode || t.completion_contract ? html`${t.goal_mode ? html`<span class="tag" data-tone="accent">${icon('target', 'i-sm')}Goal · max ${t.goal_max_turns} turns</span> ` : ''}${t.completion_contract ? html`<span class="tag" data-tone="success">${icon('git', 'i-sm')}${t.completion_contract}</span>` : ''}` : html`<span class="subtle">worker marks done</span>`],
          ['tenant', tenantOf(t) && html`<span class="mono">${tenantOf(t)}</span>`],
          ['playbook', pb && html`<a href="${ctx.href('/work/playbooks/' + pb.id)}">${pb.name}</a> <span class="mono subtle">${t.step_key || ''}</span>`],
          ['toolsets', prof && html`<span class="mono">terminal, file, web${t.assignee === 'coder' ? ', github' : ''}</span> <a href="${ctx.href('/agents/profiles/' + prof.name + '/tools')}">edit</a>`],
        ])}
      </section>
    </div>`;
  } else if (tab === 'runs') {
    panel = t.runs.length ? html`<ol class="truns" reversed>${[...t.runs].reverse().map((r, i) => html`<li class="trun panel${r.status === 'failed' ? ' is-failed' : ''}">
        <div class="trun__top"><a class="trun__link" href="${ctx.href('/work/runs/' + r.id)}"><span class="mono">${r.id}</span> · attempt ${t.runs.length - i}</a>${statusBadge(r.status === 'blocked' ? 'waiting' : r.status, { variant: 'plain' })}</div>
        <p class="trun__sum">${r.summary}</p>
        ${r.error ? html`<p class="trun__err">${icon('failed', 'i-sm')}<span class="mono">${r.error}</span></p>` : ''}
        <p class="trun__meta mono">${profileTag(r.profile)}<span>${fmtAgo(r.started, { suffix: true })}</span><span>${r.status === 'running' ? html`<span data-elapsed="${r.started}">${fmtDur((Date.now() - r.started) / 1000)}</span>` : fmtDur(r.duration)}</span><span>${fmtTokens(r.tokens)} tok</span><span>${fmtMoney(r.cost)}</span>${r.step ? html`<span>step ${r.step}</span>` : ''}</p>
      </li>`)}</ol>
      <p class="subtle td__total mono">${t.runs.length} run${t.runs.length === 1 ? '' : 's'} · ${fmtTokens(tokens)} tokens · ${fmtMoney(cost)}</p>`
      : emptyState({ icon: 'play', title: 'No runs yet', body: t.assignee && t.assignee !== 'you' ? `Run now hands it to ${t.assignee} immediately.` : 'Human tasks are not dispatched.', action: t.assignee && t.assignee !== 'you' ? html`<button type="button" class="btn btn--primary" data-tact="run">${icon('play')}Run now</button>` : '' });
  } else if (tab === 'activity') {
    panel = html`<ol class="timeline tact" aria-label="Events and comments">${eventsFor(ctx, t).map((e) => (e.comment
      ? html`<li class="step tact__c"><span class="step__icon tact__av">${avatar(e.comment.by === 'you' ? 'you' : e.comment.by, { size: 'sm' })}</span><div class="step__body"><div class="step__head"><span class="step__title">${assigneeLabel(e.comment.by)}</span><span class="subtle">commented</span><span class="step__time mono">${fmtAgo(e.comment.at, { suffix: true })}</span></div><p class="tact__text">${e.comment.text}</p></div></li>`
      : html`<li class="step"><span class="step__icon" data-tone="${e.tone}">${icon(e.icon)}</span><div class="step__body"><div class="step__head"><span class="step__title">${e.title}</span><span class="step__time mono">${fmtAgo(e.at, { suffix: true })}</span></div>${e.sub ? html`<p class="subtle tact__sub">${e.sub}</p>` : ''}</div></li>`))}</ol>
      <form class="tcomp panel" data-comment>
        <label class="sr-only" for="tc-text">Comment</label>
        <textarea class="input" id="tc-text" rows="2" data-fk="comment" placeholder="${t.block_kind === 'needs_input' ? 'Answer the question; posting unblocks the task' : 'Comment or steer the next run…'}"></textarea>
        <div class="tcomp__foot"><span class="subtle tcomp__hint">Workers read comments on their next run. ${raw('<kbd>⌘</kbd><kbd>↵</kbd>')} posts.</span><button type="submit" class="btn btn--primary btn--sm">${icon('send')}Post</button></div>
      </form>`;
  } else if (tab === 'links') {
    const row = (x, rel) => html`<li><div class="list-row"><span class="list-row__icon">${icon(rel === 'parent' ? 'arrow-up' : 'subagent')}</span>
      <span class="list-row__main"><a class="list-row__title" href="${ctx.href('/work/tasks/' + x.id)}">${x.title}</a><span class="list-row__meta"><span class="mono">${x.id}</span>${statusBadge(taskState(x).state, { label: taskState(x).label, variant: 'plain' })}</span></span>
      <button type="button" class="btn btn--ghost btn--icon" data-unlink="${x.id}" data-rel="${rel}" aria-label="Remove link to ${x.id}">${icon('x')}</button></div></li>`;
    panel = html`<div class="tlinks">
      <section aria-labelledby="h-par"><div class="section__head"><h2 class="section__title" id="h-par">Parents <span class="mono subtle">${parents.length}</span></h2></div>
        ${parents.length ? html`<ul class="list panel">${parents.map((x) => row(x, 'parent'))}</ul>` : html`<p class="subtle">No parents. This task can start as soon as it is Ready.</p>`}</section>
      <section aria-labelledby="h-kid"><div class="section__head"><h2 class="section__title" id="h-kid">Children <span class="mono subtle">${kids.length}</span></h2></div>
        ${kids.length ? html`<ul class="list panel">${kids.map((x) => row(x, 'child'))}</ul>` : html`<p class="subtle">No children. Decompose splits this task into linked subtasks.</p>`}</section>
      ${t.playbookRun ? html`<p class="tlinks__pb">${icon('playbook')}Part of playbook run <a href="${ctx.href(`/work/playbooks/${t.playbook}/runs/${ctx.data.playbookRuns.find((r) => r.id === t.playbookRun)?.rootTaskId || t.id}`)}">${t.playbookRun}</a></p>` : ''}
      <div class="row"><button type="button" class="btn btn--secondary" data-tact="link" aria-haspopup="dialog">${icon('link')}Add link…</button><button type="button" class="btn btn--ghost" data-tact="decompose">${icon('subagent')}Decompose…</button></div>
    </div>`;
  } else if (tab === 'attachments') {
    panel = html`<div class="tfiles">${files.length ? html`<ul class="list panel">${files.map((f, i) => html`<li><div class="list-row"><span class="list-row__icon">${icon(f.kind === 'code' ? 'code' : 'file')}</span>
        <span class="list-row__main"><span class="list-row__title mono">${f.name}</span><span class="list-row__sub">${f.size} · added by ${assigneeLabel(f.by)} · ${fmtAgo(f.at, { suffix: true })}</span></span>
        <span class="list-row__end"><button type="button" class="btn btn--ghost btn--icon" data-dl="${i}" aria-label="Download ${f.name}">${icon('download')}</button><button type="button" class="btn btn--ghost btn--icon" data-rmfile="${i}" aria-label="Remove ${f.name}">${icon('trash')}</button></span></div></li>`)}</ul>`
      : emptyState({ icon: 'clip', title: 'No attachments', body: 'Files attached here are copied into the worker’s workspace on its next run.' })}
      <label class="btn btn--secondary tfiles__add">${icon('clip')}Attach files<input type="file" multiple class="sr-only" data-attach></label></div>`;
  } else {
    panel = html`<form class="tset" data-settings>
      <section class="panel panel--pad stack" aria-labelledby="h-exec"><h2 class="section__title" id="h-exec">Execution</h2>
        <div class="nt__row">
          <div class="field"><label class="field__label" for="ts-rt">Max runtime</label><select class="input" id="ts-rt" data-ts="max_runtime_seconds">${RUNTIMES.map(([v, l]) => html`<option value="${v}" ${sel(v, t.max_runtime_seconds || 7200)}>${l}</option>`)}</select></div>
          <div class="field"><label class="field__label" for="ts-rr">Max retries</label><select class="input" id="ts-rr" data-ts="max_retries">${[0, 1, 2, 3, 4, 5].map((n) => html`<option value="${n}" ${sel(n, t.max_retries ?? 2)}>${n}</option>`)}</select></div>
        </div>
        ${kvs([['idempotency_key', html`<span class="mono">${t.id}-${(t.created || 0).toString(36).slice(-6)}</span>`], ['board', board?.name], ['created', new Date(t.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })]])}
      </section>
      <section class="panel panel--pad stack" aria-labelledby="h-notify"><h2 class="section__title" id="h-notify">Deliver results</h2>
        <p class="field__help">Home-channel subscriptions: post the result when this task finishes.</p>
        ${[['telegram', 'Telegram'], ['discord', 'Discord']].map(([k, l]) => html`<div class="switch-row"><span id="sub-${k}">${l}</span><button type="button" class="switch" role="switch" aria-checked="${String(!!t[`sub_${k}`])}" aria-labelledby="sub-${k}" data-sub="${k}" data-fk="sub-${k}"></button></div>`)}
      </section>
      <section class="panel panel--pad stack" aria-labelledby="h-arch"><h2 class="section__title" id="h-arch">Archive</h2>
        <p class="muted">Archived tasks leave the board but keep their runs and transcripts. Undo from the toast, or restore from Tasks.</p>
        <div><button type="button" class="btn btn--danger-quiet" data-tact="archive">${icon('archive')}Archive task</button></div>
      </section>
    </form>`;
  }

  return html`<div class="td">
    <header class="page-header td__head">
      <div class="page-header__text">
        <p class="overline"><span class="mono">${t.id}</span> · <a href="${ctx.href('/work/board/' + t.board)}">${board?.name || t.board}</a></p>
        <h1 tabindex="-1">${t.title}</h1>
        <div class="td__meta">${statusBadge(st.state, { label: st.label })}${prioTag(t.priority)}${assigneeTag(t.assignee)}${pb ? html`<span class="tag">${icon('playbook', 'i-sm')}${pb.name}</span>` : ''}${t.project ? html`<span class="tag mono">${t.project}</span>` : ''}</div>
      </div>
      ${compact ? '' : html`<div class="page-header__actions td__acts">${acts}</div>`}
    </header>
    ${compact ? html`<div class="td__cacts">${acts.primary}${acts.rest.length ? html`<button type="button" class="btn btn--secondary btn--icon" data-more aria-haspopup="dialog" aria-label="More task actions">${icon('dots-v')}</button>` : ''}</div>` : ''}
    ${reason ? html`<div class="banner" data-tone="${reason.tone === 'blocked' ? 'neutral' : reason.tone}">${icon(reason.icon)}<div class="banner__content"><div class="banner__title">${st.label}</div><div class="banner__body">${reason.text}</div></div><span></span></div>` : ''}
    ${tabsHtml([
      { key: 'brief', label: 'Brief' }, { key: 'runs', label: 'Runs', count: t.runs.length }, { key: 'activity', label: 'Activity', count: comments.length || null },
      { key: 'links', label: 'Links', count: parents.length + kids.length || null }, { key: 'attachments', label: 'Attachments', count: files.length || null }, { key: 'settings', label: 'Settings' },
    ], tab, 'Task sections')}
    <div class="td__panel" ${tabPanelAttrs(tab)}>${panel}</div>
  </div>`;
}

function bindDetail(root, ctx, t) {
  const after = () => rerender(ctx);
  bindTabs(root, (k) => setQuery(ctx, { tab: k === 'brief' ? null : k }, `tab-${k}`));
  const run = () => t.runs.at(-1);
  const act = async (k) => {
    if (k === 'run') runNow(ctx, t, after);
    else if (k === 'terminate') {
      const ok = await ctx.openDialog({ tier: 2, title: `Terminate ${t.id}?`, body: `Stops run <span class="mono">${esc(run()?.id)}</span> after the current tool call and moves the task to <strong>Todo</strong>, so the dispatcher won’t pick it up again. Partial work stays in the ${t.workspace?.kind || 'scratch'} workspace.`, profile: t.assignee, danger: true, confirmLabel: 'Terminate run' });
      if (!ok) return;
      const r = run(); if (r) { r.status = 'cancelled'; r.duration = Math.round((Date.now() - r.started) / 1000); }
      t.status = 'todo'; t.updated = Date.now(); after();
      ctx.toast(`Terminated ${r?.id}`, { tone: 'info', detail: `${t.id} → Todo` });
    } else if (k === 'reclaim') {
      const ok = await ctx.openDialog({ tier: 1, title: `Reclaim ${t.id}?`, body: 'Terminates the silent worker and returns the task to <strong>Ready</strong>. The dispatcher picks it up on the next tick.', profile: t.assignee, confirmLabel: 'Reclaim' });
      if (!ok) return;
      t.status = 'ready'; t.stale = undefined; if (run()) run().status = 'cancelled'; after();
      ctx.toast(`Reclaimed ${t.id}`, { detail: 'Back in Ready' });
    } else if (k === 'retry') {
      const prev = { status: t.status, gave_up: t.gave_up, block_kind: t.block_kind };
      t.status = 'ready'; t.gave_up = undefined; t.block_kind = undefined; t.updated = Date.now(); after();
      ctx.toast(`Retrying ${t.id}`, { detail: 'Circuit breaker reset; back in Ready', undo: () => { Object.assign(t, prev); after(); } });
    } else if (k === 'approve') {
      const prev = t.status; t.status = 'done'; t.updated = Date.now(); after();
      ctx.toast(`Approved ${t.id}`, { detail: t.playbookRun ? 'The next playbook stage starts' : 'Marked done', undo: () => { t.status = prev; after(); } });
    } else if (k === 'reject' || k === 'answer') {
      ctx.openSheet({
        title: k === 'reject' ? 'Reject with a note' : 'Answer and unblock',
        body: `${k === 'answer' ? `<p class="muted">${esc(run()?.summary || '')}</p>` : '<p class="muted">The note is posted as a comment and inlined into the rework attempt’s brief.</p>'}<div class="field"><label class="field__label" for="rj">${k === 'reject' ? 'What needs to change?' : 'Your answer'}</label><textarea id="rj" class="input" rows="4"></textarea></div>`,
        footer: `<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-ok>${k === 'reject' ? 'Reject and rework' : 'Send answer'}</button>`,
        initialFocus: 'textarea',
        onMount(panel, layer) {
          panel.querySelector('[data-ok]').addEventListener('click', async () => {
            const text = panel.querySelector('textarea').value.trim() || (k === 'reject' ? 'Needs another pass.' : 'Use 7 Nov.');
            (COMMENTS[t.id] ||= []).push({ by: 'you', at: Date.now(), text }); t.comments = (t.comments || 0) + 1;
            t.status = 'ready'; t.block_kind = undefined; t.updated = Date.now();
            layer.close(); await overlaysSettled(); after();
            ctx.toast(k === 'reject' ? `Sent ${t.id} back for rework` : `Answered; ${t.id} unblocked`, { detail: 'Comment posted · Ready' });
          });
        },
      });
    } else if (k === 'specify') {
      const proposal = `## Goal\n${t.title}.\n\n## Context\n${(t.body || '').replace(/^##.*$/gm, '').trim() || 'Gathered from the board and linked tasks.'}\n\n## Constraints\n- Keep changes small and reviewable\n- Ask before anything irreversible\n\n## Expected output\nA short report comment and, for code, a PR.\n\n## Scope & safety\nWorkspace only; approvals for push and external writes.`;
      ctx.openSheet({
        title: 'Specify with AI', wide: true, detents: ['full'],
        body: `<p class="muted">Proposed brief from <span class="mono">/tasks/${esc(t.id)}/specify</span> (${esc(t.assignee || 'default')}, ≈ $0.01). Review before accepting.</p><div class="code"><div class="code__head"><span class="mono">proposed body</span></div><pre>${esc(proposal)}</pre></div>`,
        footer: '<button type="button" class="btn btn--secondary" data-close>Discard</button><button type="button" class="btn btn--primary" data-ok>Accept brief</button>',
        onMount(panel, layer) {
          panel.querySelector('[data-ok]').addEventListener('click', async () => {
            const prev = { body: t.body, status: t.status };
            t.body = proposal; if (t.status === 'triage') t.status = 'todo'; t.updated = Date.now();
            layer.close(); await overlaysSettled(); after();
            ctx.toast('Brief updated', { detail: prev.status === 'triage' ? 'Triage → Todo' : undefined, undo: () => { Object.assign(t, prev); after(); } });
          });
        },
      });
    } else if (k === 'decompose') {
      const subs = [`Research: ${t.title}`, `Implement: ${t.title}`, `Verify: ${t.title}`];
      ctx.openSheet({
        title: 'Decompose into subtasks',
        body: String(html`<p class="muted">Each subtask is linked as a child of <span class="mono">${t.id}</span>; this task waits for them (dependency).</p>
          <div class="stack">${subs.map((s, i) => html`<label class="check"><input type="checkbox" checked value="${i}"><span>${s}</span></label>`)}</div>`),
        footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-ok>Create subtasks</button>',
        onMount(panel, layer) {
          panel.querySelector('[data-ok]').addEventListener('click', async () => {
            const picked = [...panel.querySelectorAll('input:checked')].map((i) => subs[+i.value]);
            let n = Math.max(...ctx.data.tasks.map((x) => +x.id.slice(2)));
            const made = picked.map((title) => ({ id: `t_${++n}`, board: t.board, title, status: 'todo', assignee: t.assignee, priority: t.priority, skills: [...t.skills], project: t.project, parents: [], created: Date.now(), updated: Date.now(), body: `## Goal\n${title}`, runs: [], comments: 0 }));
            ctx.data.tasks.push(...made);
            t.parentOf = [...(t.parentOf || []), ...made.map((m) => m.id)];
            layer.close(); await overlaysSettled(); setQuery(ctx, { tab: 'links' }, 'tab-links');
            ctx.toast(`Created ${made.length} subtasks`, { detail: made.map((m) => m.id).join(', ') });
          });
        },
      });
    } else if (k === 'reassign') openAssign(ctx, [t], after);
    else if (k === 'link') {
      const others = ctx.data.tasks.filter((x) => x.id !== t.id && !(t.parents || []).includes(x.id) && x.status !== 'archived');
      openPicker(ctx, {
        title: `Add a parent to ${t.id}`, label: 'Parent task',
        options: others.map((x) => ({ value: x.id, label: x.title, sub: `${x.id} · ${taskState(x).label}`, lead: html`<span class="plist__ico">${icon('tasks')}</span>` })),
        note: `${esc(t.id)} waits until its parents are Done.`,
        onPick: (v) => { if (!v) return; t.parents = [...(t.parents || []), v]; after(); ctx.toast(`Linked ${v} → ${t.id}`, { undo: () => { t.parents = t.parents.filter((x) => x !== v); after(); } }); },
      });
    } else if (k === 'editbrief') {
      ctx.openSheet({
        title: 'Edit brief', wide: true, detents: ['full'],
        body: `<div class="field"><label class="field__label" for="eb">Task body (Markdown)</label><textarea id="eb" class="input input--mono" rows="14">${esc(t.body || '')}</textarea><p class="field__help">Saved to the task body; the next run reads the new version.</p></div>`,
        footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-ok>Save brief</button>',
        initialFocus: 'textarea',
        onMount(panel, layer) {
          panel.querySelector('[data-ok]').addEventListener('click', async () => {
            const prev = t.body; t.body = panel.querySelector('textarea').value; t.updated = Date.now();
            layer.close(); await overlaysSettled(); after();
            ctx.toast('Brief saved', { undo: () => { t.body = prev; after(); } });
          });
        },
      });
    } else if (k === 'archive') {
      const prev = t.status; t.status = 'archived';
      ctx.navigate('/work/tasks');
      ctx.toast(`Archived ${t.id}`, { undo: () => { t.status = prev; ctx.refresh(); } });
    }
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tact) act(b.dataset.tact);
    else if (b.hasAttribute('data-more')) {
      const { rest } = detailActions(ctx, t, true);
      ctx.openSheet({
        title: 'Task actions',
        body: String(html`<ul class="tmenu" role="list">${rest.map((a) => html`<li>${a.href ? html`<a class="tmenu__item" href="${ctx.href(a.href)}">${icon(a.icon)}<span class="tmenu__label">${a.label}</span>${icon('chev-r', 'i-sm')}</a>` : html`<button type="button" class="tmenu__item${a.k === 'terminate' ? ' tmenu__item--danger' : ''}" data-m="${a.k}">${icon(a.icon)}<span class="tmenu__label">${a.label}</span></button>`}</li>`)}</ul>`),
        onMount(panel, layer) {
          panel.querySelectorAll('[data-m]').forEach((x) => x.addEventListener('click', async () => { layer.close(); await overlaysSettled(); act(x.dataset.m); }));
        },
      });
    } else if (b.dataset.unlink) {
      const id = b.dataset.unlink;
      const snap = { parents: t.parents, parentOf: t.parentOf, kid: getTask(id).parents };
      if (b.dataset.rel === 'parent') t.parents = (t.parents || []).filter((x) => x !== id);
      else { t.parentOf = (t.parentOf || []).filter((x) => x !== id); getTask(id).parents = (getTask(id).parents || []).filter((x) => x !== t.id); }
      after();
      ctx.toast(`Unlinked ${id}`, { undo: () => { t.parents = snap.parents; t.parentOf = snap.parentOf; getTask(id).parents = snap.kid; after(); } });
    } else if (b.dataset.rmfile) {
      const list = ATTACH[t.id]; const [f] = list.splice(+b.dataset.rmfile, 1); after();
      ctx.toast(`Removed ${f.name}`, { undo: () => { list.splice(+b.dataset.rmfile, 0, f); after(); } });
    } else if (b.dataset.dl) ctx.toast(`Downloading ${(ATTACH[t.id] || [])[+b.dataset.dl]?.name}`, { tone: 'info', detail: 'Mock download (prototype)' });
    else if (b.dataset.sub) { const k = `sub_${b.dataset.sub}`; t[k] = !t[k]; rerender(ctx, b.dataset.fk); ctx.toast(t[k] ? `Results will post to ${b.dataset.sub}` : `Stopped posting to ${b.dataset.sub}`, { tone: 'info' }); }
  });
  root.querySelector('[data-attach]')?.addEventListener('change', (e) => {
    const names = [...e.target.files].map((f) => f.name);
    (ATTACH[t.id] ||= []).push(...names.map((name) => ({ name, size: '—', by: 'you', at: Date.now(), kind: 'file' })));
    after(); ctx.toast(`Attached ${names.length} file${names.length === 1 ? '' : 's'}`);
  });
  root.querySelector('[data-settings]')?.addEventListener('change', (e) => {
    const k = e.target.dataset.ts; if (!k) return;
    t[k] = +e.target.value; ctx.toast('Saved', { detail: `${k} = ${e.target.value}` });
  });
  const cf = root.querySelector('[data-comment]');
  if (cf) {
    const ta = cf.querySelector('textarea');
    const post = () => {
      const text = ta.value.trim(); if (!text) { ta.focus(); return; }
      (COMMENTS[t.id] ||= []).push({ by: 'you', at: Date.now(), text }); t.comments = (t.comments || 0) + 1; t.updated = Date.now();
      const unblock = t.block_kind === 'needs_input';
      if (unblock) { t.status = 'ready'; t.block_kind = undefined; }
      rerender(ctx, 'comment');
      ctx.toast(unblock ? `Answered; ${t.id} unblocked` : 'Comment posted', { detail: unblock ? 'Back in Ready' : undefined });
    };
    cf.addEventListener('submit', (e) => { e.preventDefault(); post(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } });
  }
}

/* ==========================================================================
   /work/runs/:runId: run view
   ========================================================================== */
const LOG_TAIL = {
  running: ['pnpm vitest run src/api', ' RUN  v3.2.1 ~/worktrees/kanban/t_1049', ' ✓ src/api/ratelimit.test.ts  (6 tests) 41ms', ' ✓ src/api/sessions.test.ts  (14 tests) 212ms'],
  live: [' ✓ src/api/auth.test.ts  (9 tests) 88ms', ' ✓ src/api/health.test.ts  (3 tests) 12ms', ' Test Files  4 passed (4)', '      Tests  32 passed (32)', 'git add -A && git commit -m "feat(api): RateLimit-* headers"', '[kanban/t_1049 4be0c1a] feat(api): RateLimit-* headers', 'heartbeat ok · turn 5/12'],
};
function workerLog(task, run, steps) {
  const lines = [`[${fmtTime(run.started)}] worker ${run.profile} claimed ${task.id} (run ${run.id})`];
  for (const s of steps) {
    if (s.status === 'queued') continue;
    const at = run.started + (s.at || 0) * 1000;
    lines.push(`[${fmtTime(at)}] ${s.kind === 'tool' ? `tool ${s.tool} ${s.args || ''}` : s.kind}: ${s.title}`);
    for (const o of String(s.out || '').split('\n').slice(0, 3)) lines.push(`           ${o}`);
    if (s.status === 'failed') lines.push(`[${fmtTime(at + (s.dur || 0) * 1000)}] ERROR step failed`);
  }
  if (run.status === 'running' && run.id === 'r_2210') lines.push(...LOG_TAIL.running.map((l) => `           ${l}`));
  if (run.status === 'stale') lines.push(`[${fmtTime(run.started + run.duration * 1000)}] (no heartbeat since)`);
  return lines;
}
function stepTone(s) { return STEP_TONE[s.status] || 'neutral'; }

function renderRun(ctx, found) {
  const { task: t, run: r, attempt } = found;
  const q = liveQuery();
  const density = ['stream', 'worklog', 'raw'].includes(q.density) ? q.density : 'stream';
  const steps = stepsFor(r);
  const live = r.status === 'running';
  const session = r.sessionId && getSession(r.sessionId);
  const model = t.model_override || getProfile(r.profile)?.model;
  const runState = r.status === 'blocked' ? 'waiting' : r.status;
  const log = workerLog(t, r, steps);
  const stepMeta = (s) => html`<span class="rstep__meta mono">${s.status === 'running' ? html`<span data-elapsed="${r.started + (s.at || 0) * 1000}">${fmtDur((Date.now() - r.started) / 1000 - (s.at || 0))}</span>` : s.dur != null ? fmtDur(s.dur) : '—'}<span aria-hidden="true">·</span><span data-step-tok="${steps.indexOf(s)}">${fmtTokens(s.tokens || 0)}</span> tok<span aria-hidden="true">·</span>${fmtMoney(s.cost || 0)}</span>`;

  let body;
  if (density === 'stream') {
    body = html`<ol class="timeline rsteps" aria-label="Steps">${steps.map((s, i) => html`<li class="step rstep" data-status="${s.status}">
      <span class="step__icon" data-tone="${stepTone(s)}">${icon(STEP_GLYPH[s.status] || 'queued', s.status === 'running' ? 'spin' : '')}</span>
      <div class="step__body">
        <button type="button" class="rstep__btn" data-step="${i}" data-fk="step-${i}" aria-haspopup="dialog" ${s.status === 'queued' ? raw('aria-disabled="true"') : ''}>
          <span class="rstep__head"><span class="rstep__title">${s.title}</span><span class="sr-only">, ${s.status}</span>${s.status !== 'queued' ? icon('chev-r', 'i-sm') : ''}</span>
          <span class="rstep__sub">${icon(KIND_ICON[s.kind] || 'tool', 'i-sm')}${s.kind === 'tool' ? html`<span class="mono">${s.tool}</span>${s.args ? html`<span class="mono subtle truncate">${s.args}</span>` : ''}` : html`<span>${s.kind === 'judge' ? 'goal judge' : s.kind}</span>`}</span>
          ${s.status !== 'queued' ? stepMeta(s) : html`<span class="rstep__meta subtle">queued</span>`}
        </button>
      </div>
    </li>`)}</ol>`;
  } else if (density === 'worklog') {
    body = html`<div class="rwork panel" role="region" aria-label="Worklog table, scrolls sideways" tabindex="0"><table class="rwork__t"><caption class="sr-only">Worklog</caption>
      <thead><tr><th scope="col">#</th><th scope="col">Time</th><th scope="col">Step</th><th scope="col">Status</th><th scope="col" class="num">Dur</th><th scope="col" class="num">Tokens</th><th scope="col" class="num">Cost</th></tr></thead>
      <tbody>${steps.map((s, i) => html`<tr data-status="${s.status}">
        <td class="mono subtle">${i + 1}</td><td class="mono">${s.at != null && s.status !== 'queued' ? fmtTime(r.started + s.at * 1000) : '—'}</td>
        <td><button type="button" class="rwork__btn" data-step="${i}" data-fk="wstep-${i}" ${s.status === 'queued' ? raw('aria-disabled="true"') : ''}>${s.kind === 'tool' ? html`<span class="mono">${s.tool}</span> ` : ''}${s.title}</button></td>
        <td>${statusBadge(s.status === 'waiting' ? 'waiting' : s.status, { variant: 'plain' })}</td>
        <td class="mono num">${s.status === 'running' ? html`<span data-elapsed="${r.started + (s.at || 0) * 1000}">…</span>` : s.dur != null ? fmtDur(s.dur) : '—'}</td>
        <td class="mono num" data-step-tok="${i}">${fmtTokens(s.tokens || 0)}</td><td class="mono num">${fmtMoney(s.cost || 0)}</td>
      </tr>`)}</tbody>
      <tfoot><tr><td></td><td></td><th scope="row">Total</th><td></td><td class="mono num">${fmtDur(live ? (Date.now() - r.started) / 1000 : r.duration)}</td><td class="mono num" data-run-tok>${fmtTokens(r.tokens)}</td><td class="mono num">${fmtMoney(r.cost)}</td></tr></tfoot>
    </table></div>`;
  } else {
    body = html`<pre class="log rraw" role="log" aria-label="Raw worker log" tabindex="0" data-log>${log.join('\n')}</pre>`;
  }

  const actions = html`
    ${live ? html`<button type="button" class="btn btn--danger-quiet" data-ract="terminate">${icon('stop')}Terminate</button>` : ''}
    ${r.status === 'stale' && t.stale ? html`<button type="button" class="btn btn--primary" data-ract="reclaim">${icon('refresh')}Reclaim</button>` : ''}
    ${['failed', 'cancelled', 'stale'].includes(r.status) && !live ? html`<button type="button" class="btn btn--secondary" data-ract="retry">${icon('refresh')}Retry task</button>` : ''}
    ${session ? html`<a class="btn btn--secondary" href="${ctx.href('/chat/' + session.id)}">${icon('chat')}Open session</a>` : ''}`;

  return html`<div class="rv">
    <header class="page-header"><div class="page-header__text">
      <p class="overline">Run <span class="mono">${r.id}</span> · attempt ${attempt} of <a href="${ctx.href('/work/tasks/' + t.id)}">${t.id}</a></p>
      <h1 tabindex="-1">${t.title}</h1>
      <div class="td__meta">${statusBadge(runState, { label: live ? `Running · ${r.step || 'work'}` : undefined })}${profileTag(r.profile)}${model ? html`<span class="tag mono">${model}</span>` : ''}${t.goal_mode && r.turn ? html`<span class="tag" data-tone="accent">${icon('target', 'i-sm')}turn ${r.turn}/${t.goal_max_turns}</span>` : ''}</div>
    </div>${ctx.size === 'compact' ? '' : html`<div class="page-header__actions">${actions}</div>`}</header>

    <dl class="rv__stats">
      <div><dt>Elapsed</dt><dd class="mono">${live ? html`<span data-elapsed="${r.started}">${fmtDur((Date.now() - r.started) / 1000)}</span>` : fmtDur(r.duration)}</dd></div>
      <div><dt>Tokens</dt><dd class="mono" data-run-tok>${fmtTokens(r.tokens)}</dd></div>
      <div><dt>Cost</dt><dd class="mono" data-run-cost>${fmtMoney(r.cost)}</dd></div>
      <div><dt>Steps</dt><dd class="mono">${steps.filter((s) => s.status === 'succeeded').length}/${steps.length}</dd></div>
    </dl>
    ${ctx.size === 'compact' && (live || r.status !== 'succeeded' || session) ? html`<div class="rv__cacts">${actions}</div>` : ''}
    ${r.error ? html`<div class="banner" data-tone="danger">${icon('failed')}<div class="banner__content"><div class="banner__title">${r.error}</div><div class="banner__body">${r.summary}</div></div><span></span></div>` : ''}

    <section class="rv__steps" aria-labelledby="rv-h">
      <div class="section__head rv__bar"><h2 class="section__title" id="rv-h">${density === 'raw' ? 'Worker log' : 'Steps'}</h2>
        <div class="seg" role="radiogroup" aria-label="Density">${[['stream', 'Stream'], ['worklog', 'Worklog'], ['raw', 'Raw']].map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(density === k)}" data-density="${k}" data-fk="d-${k}">${l}</button>`)}</div>
      </div>
      ${body}
    </section>
    ${density !== 'raw' ? html`<details class="tool rv__log" ${live ? raw('open') : ''}>
      <summary>${icon('chev-r', 'chev')}<span class="tool__name">Worker log</span><span class="tool__args">${live ? 'live tail' : `${log.length} lines`}</span>${live ? html`<span class="dot pulse" data-tone="running" aria-hidden="true"></span>` : ''}</summary>
      <div class="tool__body"><pre class="log" role="log" aria-label="Worker log tail" data-log>${log.slice(-10).join('\n')}</pre></div>
    </details>` : ''}
  </div>`;
}

function openStepSheet(ctx, t, r, s, i) {
  const live = s.status === 'running';
  ctx.openSheet({
    title: `Step ${i + 1} · ${s.title}`, wide: true, detents: ['half', 'full'],
    body: String(html`<div class="rss">
      <div class="td__meta">${statusBadge(s.status === 'waiting' ? 'waiting' : s.status)}<span class="tag mono">${s.kind === 'tool' ? s.tool : s.kind}</span><span class="mono subtle">${s.dur != null ? fmtDur(s.dur) : live ? 'running' : '—'} · ${fmtTokens(s.tokens || 0)} tok · ${fmtMoney(s.cost || 0)}</span></div>
      <div class="rss__log" role="log" aria-label="Step transcript">
        ${s.kind === 'reasoning' || s.kind === 'judge' ? html`<div class="rss__think"><p class="overline">${s.kind === 'judge' ? 'Judge' : 'Reasoning'}</p><p>${s.out || '…'}</p></div>`
          : s.kind === 'tool' ? html`<details class="tool${s.status === 'failed' ? ' tool--failed' : ''}" open><summary>${icon('chev-r', 'chev')}<span class="tool__name">${s.tool}</span><span class="tool__args truncate">${s.args || ''}</span><span class="tool__dur">${s.dur != null ? fmtDur(s.dur) : '…'}</span></summary>
              <div class="tool__body"><pre class="log">${s.out || ''}${live ? '\n▍' : ''}</pre></div></details>`
          : html`<div class="rss__msg"><p class="overline">${s.kind === 'system' ? 'Dispatcher' : r.profile}</p><pre class="log">${s.out || s.title}</pre></div>`}
      </div>
      ${r.sessionId ? html`<p class="subtle">Full transcript: <a href="${ctx.href('/chat/' + r.sessionId)}">session ${r.sessionId}</a> (same tool cards as Chat).</p>` : ''}
    </div>`),
  });
}

function bindRun(root, ctx, found) {
  const { task: t, run: r } = found;
  ctx.setAppBar({ back: '/work/tasks/' + t.id, title: `Run ${r.id}` });
  const steps = stepsFor(r);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.density) setQuery(ctx, { density: b.dataset.density === 'stream' ? null : b.dataset.density }, `d-${b.dataset.density}`);
    else if (b.dataset.step) { if (b.getAttribute('aria-disabled') !== 'true') openStepSheet(ctx, t, r, steps[+b.dataset.step], +b.dataset.step); }
    else if (b.dataset.ract === 'terminate') {
      const ok = await ctx.openDialog({ tier: 2, title: `Terminate ${r.id}?`, body: `Stops the worker after the current tool call. <strong>${esc(t.id)}</strong> moves to Todo; partial work stays in the workspace.`, profile: r.profile, danger: true, confirmLabel: 'Terminate run' });
      if (!ok) return;
      r.status = 'cancelled'; r.duration = Math.round((Date.now() - r.started) / 1000);
      steps.forEach((s) => { if (s.status === 'running') { s.status = 'cancelled'; s.dur = Math.round((Date.now() - r.started) / 1000 - (s.at || 0)); } });
      t.status = 'todo'; t.updated = Date.now(); ctx.refresh();
      ctx.toast(`Terminated ${r.id}`, { tone: 'info', detail: `${t.id} → Todo` });
    } else if (b.dataset.ract === 'reclaim') {
      const ok = await ctx.openDialog({ tier: 1, title: `Reclaim ${t.id}?`, body: 'Terminates the silent worker and returns the task to <strong>Ready</strong>.', profile: t.assignee, confirmLabel: 'Reclaim' });
      if (!ok) return;
      t.status = 'ready'; t.stale = undefined; r.status = 'cancelled'; ctx.refresh();
      ctx.toast(`Reclaimed ${t.id}`, { detail: 'Back in Ready' });
    } else if (b.dataset.ract === 'retry') {
      t.status = 'ready'; t.gave_up = undefined; t.block_kind = undefined; t.stale = undefined; t.updated = Date.now();
      ctx.navigate('/work/tasks/' + t.id);
      ctx.toast(`Retrying ${t.id}`, { detail: 'Back in Ready' });
    }
  });
  const tick = setInterval(() => root.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); }), 1000);
  // Live simulation: tokens/cost grow on the running step; the log tail streams.
  let feed = 0;
  const sim = r.status === 'running' ? setInterval(() => {
    const si = steps.findIndex((s) => s.status === 'running');
    if (si < 0) return;
    const add = 600 + Math.round(Math.random() * 900);
    steps[si].tokens += add; r.tokens += add; r.cost = +(r.cost + add * 0.0000014).toFixed(4); steps[si].cost = +(steps[si].cost + add * 0.0000014).toFixed(4);
    root.querySelectorAll(`[data-step-tok="${si}"]`).forEach((el) => { el.textContent = fmtTokens(steps[si].tokens); });
    root.querySelectorAll('[data-run-tok]').forEach((el) => { el.textContent = fmtTokens(r.tokens); });
    root.querySelectorAll('[data-run-cost]').forEach((el) => { el.textContent = fmtMoney(r.cost); });
    const line = r.id === 'r_2210' ? LOG_TAIL.live[feed % LOG_TAIL.live.length] : `heartbeat ok · ${fmtTokens(r.tokens)} tokens`;
    feed++;
    root.querySelectorAll('[data-log]').forEach((el) => {
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      el.textContent += `\n[${fmtTime(Date.now())}] ${line.trim()}`;
      if (atEnd) el.scrollTop = el.scrollHeight;
    });
  }, 2500) : 0;
  root.querySelectorAll('[data-log]').forEach((el) => { el.scrollTop = el.scrollHeight; });
  return () => { clearInterval(tick); clearInterval(sim); };
}

/* ==========================================================================
   Module
   ========================================================================== */
const notFound = (ctx, what) => html`<div class="empty"><div class="empty__icon">${icon('tasks')}</div><h1 tabindex="-1">${what} not found</h1><p>It may have been archived or never existed.</p><a class="btn btn--secondary" href="${ctx.href('/work/tasks')}">All tasks</a></div>`;
const which = (ctx) => (ctx.path.startsWith('/work/runs/') ? 'run' : ctx.path === '/work/tasks/new' ? 'new' : ctx.params.id ? 'detail' : 'list');

export default {
  routes: ['/work/tasks', '/work/tasks/new', '/work/tasks/:id', '/work/runs/:runId'],
  title: (ctx) => {
    const w = which(ctx);
    if (w === 'new') return 'New task';
    if (w === 'detail') return getTask(ctx.params.id)?.title || 'Task';
    if (w === 'run') return `Run ${ctx.params.runId}`;
    return 'Tasks';
  },
  group: 'work',
  render(ctx) {
    const w = which(ctx);
    if (w === 'new') {
      if (!draft) draft = newDraft(ctx, liveQuery());
      return renderNew(ctx);
    }
    if (w === 'detail') { const t = getTask(ctx.params.id); return t ? renderDetail(ctx, t) : notFound(ctx, 'Task'); }
    if (w === 'run') { const f = findRun(ctx, ctx.params.runId); return f ? renderRun(ctx, f) : notFound(ctx, 'Run'); }
    return renderList(ctx);
  },
  mount(root, ctx) {
    const w = which(ctx);
    if (w === 'new') { bindNew(root, ctx); return undefined; }
    if (w === 'detail') { const t = getTask(ctx.params.id); if (!t) return undefined; bindDetail(root, ctx, t); const tick = setInterval(() => root.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); }), 1000); return () => clearInterval(tick); }
    if (w === 'run') { const f = findRun(ctx, ctx.params.runId); return f ? bindRun(root, ctx, f) : undefined; }
    // List
    if (ctx.size === 'compact') ctx.setAppBar({ actions: [{ icon: 'plus', label: 'New task', onClick: () => ctx.navigate('/work/tasks/new') }] });
    let qt = 0;
    root.querySelector('[data-q]')?.addEventListener('input', (e) => { clearTimeout(qt); const v = e.target.value; qt = setTimeout(() => setQuery(ctx, { q: v.trim() || null }, 'q'), 180); });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.view) setQuery(ctx, { view: b.dataset.view === 'all' ? null : b.dataset.view }, `view-${b.dataset.view}`);
      else if (b.dataset.menu) openTaskMenu(ctx, getTask(b.dataset.menu), { after: () => rerender(ctx) });
      else if (b.hasAttribute('data-clearq')) setQuery(ctx, { q: null }, 'q');
    });
    root.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.tt__row');
      if (!row) return;
      e.preventDefault();
      openTaskMenu(ctx, getTask(row.querySelector('[data-menu]').dataset.menu), { after: () => rerender(ctx) });
    });
    return () => clearTimeout(qt);
  },
  paletteActions(ctx) {
    const w = which(ctx);
    const acts = [];
    if (w === 'detail') {
      const t = getTask(ctx.params.id);
      if (t && ['triage', 'todo', 'ready'].includes(t.status)) acts.push({ label: `Run ${t.id} now`, icon: 'play', run: () => runNow(ctx, t, () => ctx.refresh()) });
      if (t) acts.push({ label: `Open ${t.id} on the board`, icon: 'work', run: () => ctx.navigate('/work/board/' + t.board) });
    }
    if (w === 'run') { const f = findRun(ctx, ctx.params.runId); if (f) acts.push({ label: `Back to ${f.task.id}`, icon: 'tasks', run: () => ctx.navigate('/work/tasks/' + f.task.id) }); }
    if (w !== 'new') acts.push({ label: 'New task', icon: 'plus', run: () => ctx.navigate('/work/tasks/new') });
    acts.push({ label: 'Run dispatcher (nudge)', icon: 'bolt', sub: 'Caduceus Dashboard board', run: () => nudge(ctx, 'caduceus', () => ctx.refresh()) });
    if (w === 'list') acts.push({ label: 'Filter tasks', icon: 'filter', run: async () => { await overlaysSettled(); setTimeout(() => document.querySelector('#main [data-q]')?.focus(), 60); } });
    else acts.push({ label: 'Filter board', icon: 'filter', run: () => ctx.navigate('/work/board') });
    return acts;
  },
};
