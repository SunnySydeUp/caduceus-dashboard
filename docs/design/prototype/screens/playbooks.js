// Playbooks (IA §1 Work › Playbooks, work-model §2.3, mobile §4): library → detail (graph at ≥ 1024 px,
// stage list below) → run form (generated from the inputs schema) → run view (/runs/:rootTaskId).
// Every run is a set of Hermes Kanban tasks tagged workflow_template_id = <playbook>@<version>.
import {
  html, raw, esc, icon, statusBadge, LADDER, profileTag, avatar, pageHeader, emptyState,
  fmtAgo, fmtDur, fmtMoney, fmtTime, ago, uid, getTask, getProfile, overlaysSettled,
} from '../shared.js';

if (!document.getElementById('pb-css')) {
  document.head.append(Object.assign(document.createElement('link'), { id: 'pb-css', rel: 'stylesheet', href: new URL('./playbooks.css', import.meta.url).href }));
}

/* ==========================================================================
   Screen-local definitions (extend the shared `data`; never redefine it)
   ========================================================================== */
const KIND = {
  task: { label: 'Task', icon: 'tasks' },
  research: { label: 'Research', icon: 'search' },
  validate: { label: 'Validate', icon: 'shield' },
  test: { label: 'Test', icon: 'target' },
  gate: { label: 'Human gate', icon: 'flag' },
  group: { label: 'Parallel group', icon: 'stack' },
};
const TONE = { succeeded: 'success', done: 'success', running: 'running', waiting: 'warning', queued: 'neutral', failed: 'danger', cancelled: 'neutral' };
const STATE_LABEL = { succeeded: 'Done', running: 'Running', waiting: 'Waiting for you', queued: 'Queued', failed: 'Failed', cancelled: 'Cancelled' };
const COND_TONE = { on_done: '', on_approve: 'ok', on_fail: 'bad', on_reject: 'bad', always: '' };

const SD_META = {
  intake: { kind: 'task', brief: '## Goal\n{{inputs.goal}}\n\nNormalise the request into a brief with testable acceptance criteria.\nAsk (needs_input) if anything is ambiguous.', contract: 'Brief lists ≥ 3 testable acceptance criteria' },
  requirements: { kind: 'task', skills: ['writing/plain-language'], brief: '## Brief\n{{stages.intake.result}}\n\nList functional and non-functional requirements; link each one to an acceptance criterion.' },
  spec: { kind: 'task', skills: ['writing/plain-language'], brief: 'Write the behaviour spec for {{inputs.goal}}: states, empty/error cases, keyboard and touch.' },
  architecture: { kind: 'research', skills: ['software/frontend-design'], maxAttempts: 3, goal: true, maxTurns: 20, contract: 'architecture-notes.md + ≥ 1 mockup attached', brief: '## Goal\n{{inputs.goal}} in {{inputs.repo}}\n\nWrite architecture notes and 1–2 mockups (compact and large).\nReuse existing components; call out new shared ones.' },
  'design-review': { kind: 'gate', brief: 'Approve the architecture notes and mockups for {{inputs.goal}}.\nReject with a note to send them back to Architecture.' },
  plan: { kind: 'task', brief: 'Break the approved design into ordered, reviewable commits on {{inputs.branch}}.' },
  implement: { kind: 'task', skills: ['software/test-driven-dev', 'software/github-pr-workflow'], maxAttempts: 3, goal: true, maxTurns: 40, contract: 'PR open on {{inputs.repo}}, CI green', brief: '## Plan\n{{stages.plan.result}}\n\nImplement in a worktree on {{inputs.branch}}. Open a PR when the plan is done.' },
  'unit-tests': { kind: 'test', group: 'tests', skills: ['software/test-driven-dev'], model: 'glm-5.3-flash', contract: 'pnpm vitest run exits 0', brief: 'Add or update unit tests for every changed module. Do not change product code.' },
  'integration-tests': { kind: 'test', group: 'tests', skills: ['software/test-driven-dev'], model: 'glm-5.3-flash', contract: 'pnpm test:e2e exits 0', brief: 'Run the end-to-end suite for affected routes at 390, 820 and 1440 px.' },
  'code-review': { kind: 'validate', skills: ['software/github-pr-workflow'], model: 'deepseek-v4.1', brief: 'Review the PR diff against the project checklist.\nEnd with `VERDICT: PASS` or `VERDICT: FAIL` and reasons.' },
  'security-review': { kind: 'validate', skills: ['software/dependency-audit'], model: 'deepseek-v4.1', brief: 'Check auth, input handling and new dependencies. End with a VERDICT line.' },
  qa: { kind: 'test', skills: ['software/frontend-design'], brief: 'Walk the acceptance criteria on a preview build; attach screenshots.' },
  docs: { kind: 'task', skills: ['writing/plain-language'], maxAttempts: 2, brief: 'Update the changelog and user docs for {{inputs.goal}}.' },
  'release-review': { kind: 'gate', brief: 'Approve the release: changelog, QA evidence and rollback plan.' },
  deploy: { kind: 'task', maxAttempts: 2, contract: 'Deploy job green', brief: 'Merge and deploy {{inputs.branch}}; watch the rollout.' },
  verify: { kind: 'validate', contract: 'Smoke checks pass on production', brief: 'Run smoke checks against production. FAIL routes back to Deploy (rollback + redeploy).' },
};
const SPECS = {
  'software-delivery': {
    meta: SD_META, board: 'caduceus', groups: { tests: 'Test suite' },
    edges: [
      ['intake', 'requirements', 'on_done'], ['requirements', 'spec', 'on_done'], ['spec', 'architecture', 'on_done'],
      ['architecture', 'design-review', 'on_done'], ['design-review', 'plan', 'on_approve'], ['design-review', 'architecture', 'on_reject', 3],
      ['plan', 'implement', 'on_done'], ['implement', 'unit-tests', 'on_done'], ['implement', 'integration-tests', 'on_done'],
      ['unit-tests', 'code-review', 'on_done'], ['integration-tests', 'code-review', 'on_done'],
      ['code-review', 'security-review', 'on_done'], ['code-review', 'implement', 'on_fail', 3],
      ['security-review', 'qa', 'on_done'], ['qa', 'docs', 'on_done'], ['docs', 'release-review', 'on_done'],
      ['release-review', 'deploy', 'on_approve'], ['release-review', 'docs', 'on_reject', 2],
      ['deploy', 'verify', 'on_done'], ['verify', 'deploy', 'on_fail', 2],
    ],
    extraInputs: [{ key: 'workers', label: 'Parallel workers', type: 'number', min: 1, max: 4, value: 2, help: 'How many stages may run at once (the test suite runs in parallel).' }],
    estimate: '$4–7',
  },
  'research-brief': {
    board: 'main',
    meta: {
      plan: { kind: 'task', brief: '## Question\n{{inputs.question}}\n\nWrite a search plan: queries, target source types, depth = {{inputs.depth}}.' },
      'search-read': { kind: 'research', skills: ['research/web-research'], goal: true, maxTurns: 30, brief: 'Follow the plan. Read {{inputs.breadth}} primary sources; keep notes with quotes and links.' },
      synthesise: { kind: 'task', skills: ['research/citation-formatter'], maxAttempts: 3, contract: 'Report cites ≥ {{inputs.breadth}} sources', brief: 'Synthesise a cited report that answers {{inputs.question}}. Attach it as report.md.' },
      review: { kind: 'gate', brief: 'Approve the report, or reject with what is missing.' },
    },
    edges: [['plan', 'search-read', 'on_done'], ['search-read', 'synthesise', 'on_done'], ['synthesise', 'review', 'on_done'], ['review', 'synthesise', 'on_reject', 3]],
    numberDefaults: { breadth: { min: 3, max: 40, value: 15 } },
    estimate: '$0.40–0.90',
  },
  'bug-hunt': {
    board: 'caduceus',
    meta: {
      reproduce: { kind: 'test', skills: ['software/test-driven-dev'], contract: 'A failing test reproduces the report', brief: '## Report\n{{inputs.report}}\n\nWrite a failing test that reproduces it in {{inputs.repo}}.' },
      isolate: { kind: 'research', brief: 'Bisect and read the code until the root cause is one sentence long.' },
      fix: { kind: 'task', skills: ['software/test-driven-dev', 'software/github-pr-workflow'], maxAttempts: 3, goal: true, maxTurns: 25, brief: 'Fix the root cause; keep the reproduction test.' },
      verify: { kind: 'validate', contract: 'Reproduction test + full suite pass', brief: 'Run the full suite. VERDICT: FAIL routes back to Fix.' },
    },
    edges: [['reproduce', 'isolate', 'on_done'], ['isolate', 'fix', 'on_done'], ['fix', 'verify', 'on_done'], ['verify', 'fix', 'on_fail', 3]],
    estimate: '$1–3',
  },
  'code-review': { board: 'caduceus', meta: { review: { kind: 'validate', skills: ['software/github-pr-workflow'], model: 'deepseek-v4.1', contract: 'Review posted on {{inputs.pr}}', brief: 'Review {{inputs.pr}} against the project checklist and post inline comments.' } }, estimate: '$0.10–0.30' },
  'dependency-bump': { board: 'caduceus', meta: { bump: { kind: 'task', skills: ['software/dependency-audit'], contract: 'PR open, CI green', brief: 'Bump {{inputs.package}} in {{inputs.repo}}, read the changelog, run the tests, open a PR.' } }, estimate: '$0.10–0.40' },
  'weekly-digest': { board: 'main', meta: { digest: { kind: 'research', skills: ['research/web-research', 'writing/plain-language'], brief: 'Summarise the last {{inputs.since}} days of saved articles ({{inputs.tone}}).' } }, numberDefaults: { since: { min: 1, max: 31, value: 7 } }, estimate: '$0.05–0.15' },
  'lease-check': { board: 'main', meta: { check: { kind: 'validate', skills: ['property/lease-drafter'], brief: 'Compare {{inputs.doc}} for {{inputs.unit}} against the portfolio lease checklist.' } }, estimate: '$0.05' },
};
const LONG_TEXT = new Set(['goal', 'question', 'report']);

/** One-stage Templates that only exist in this screen (a Template is a one-stage Playbook). */
const LOCAL_PLAYBOOKS = [
  { id: 'dependency-bump', name: 'Dependency bump', version: 2, category: 'Engineering', description: 'One-stage template: bump one dependency, read its changelog, run the tests and open a PR.', stages: [{ key: 'bump', title: 'Bump & test', assignee: 'coder' }], inputs: [{ key: 'package', label: 'Package', type: 'text', required: true }, { key: 'repo', label: 'Project', type: 'project', required: true }], runs: 9, lastRun: ago(2900), lastStatus: 'succeeded' },
  { id: 'weekly-digest', name: 'Weekly reading digest', version: 1, category: 'Research', description: 'One-stage template: summarise the saved articles of the week into one digest note.', stages: [{ key: 'digest', title: 'Write digest', assignee: 'librarian' }], inputs: [{ key: 'since', label: 'Days to cover', type: 'number' }, { key: 'tone', label: 'Tone', type: 'select', options: ['brief', 'detailed'] }], runs: 23, lastRun: ago(5800), lastStatus: 'succeeded' },
  { id: 'lease-check', name: 'Lease check', version: 1, category: 'Property', description: 'One-stage template: compare a lease against the portfolio checklist and flag the gaps.', stages: [{ key: 'check', title: 'Check lease', assignee: 'property' }], inputs: [{ key: 'unit', label: 'Unit', type: 'select', options: ['Unit 2A', 'Unit 4B', 'Unit 7C'], required: true }, { key: 'doc', label: 'Lease file', type: 'path', required: true }], runs: 3, lastRun: ago(12000), lastStatus: 'failed' },
];

const stagesOf = (rows) => rows.map(([key, state, attempt, duration, taskId]) => ({ key, state, attempt, duration, taskId }));
/** Finished runs that only this screen shows (history for the library and the detail's runs list). */
const LOCAL_RUNS = [
  { id: 'pr_1012', rootTaskId: 't_1012', playbook: 'code-review', version: 1, title: 'PR #208 · token meter', profile: 'coder', started: ago(105), state: 'succeeded', cost: 0.21, board: 'caduceus',
    inputs: { pr: 'https://github.com/hermes-lab/caduceus-dashboard/pull/208' }, stages: stagesOf([['review', 'succeeded', 1, 540, 't_1012']]) },
  { id: 'pr_0990', rootTaskId: 't_1044', playbook: 'research-brief', version: 2, title: 'Local vector DBs', profile: 'librarian', started: ago(1600), state: 'succeeded', cost: 0.58, board: 'main',
    inputs: { question: 'Which local vector DB fits a 50k-note archive?', depth: 'standard', breadth: 11 },
    stages: stagesOf([['plan', 'succeeded', 1, 420, 't_1044'], ['search-read', 'succeeded', 1, 2900, 't_1047'], ['synthesise', 'succeeded', 1, 1380, 't_1048'], ['review', 'succeeded', 1, 3600, 't_1042']]) },
  { id: 'pr_0972', rootTaskId: 't_0972', playbook: 'bug-hunt', version: 1, title: 'Resume drops the last token on reconnect', profile: 'coder', started: ago(4300), state: 'failed', cost: 2.31, board: 'caduceus',
    inputs: { report: 'After a reconnect the last streamed token is missing from the transcript.', repo: 'caduceus-dashboard' },
    stages: stagesOf([['reproduce', 'succeeded', 1, 900, 't_0972'], ['isolate', 'succeeded', 1, 1500, 't_0973'], ['fix', 'succeeded', 3, 2400, 't_0978'], ['verify', 'failed', 3, 600, 't_0979']]) },
  { id: 'pr_0951', rootTaskId: 't_0951', playbook: 'software-delivery', version: 3, title: 'Cron output viewer', profile: 'coder', started: ago(9400), state: 'succeeded', cost: 6.48, board: 'caduceus',
    inputs: { goal: 'Show cron run output inline with ANSI colours', repo: 'caduceus-dashboard', branch: 'feat/cron-output', workers: 2 },
    stages: SPEC_KEYS('software-delivery').map((key, i) => ({ key, state: 'succeeded', attempt: 1, duration: 300 + ((i * 397) % 1900), taskId: `t_0${951 + i}` })) },
];
function SPEC_KEYS(id) { return [...new Set(SPECS[id].edges.flat().filter((x) => typeof x === 'string' && !x.startsWith('on_')))]; }

/** Task ids the shared mock leaves blank for stages that already ran. */
const EXTRA_IDS = { pr_1060: { requirements: 't_1057', spec: 't_1058', architecture: 't_1059' } };
const RUN_INPUTS = {
  pr_1060: { goal: 'Let people move many Board cards at once from a sheet (no drag needed)', repo: 'caduceus-dashboard', branch: 'feat/bulk-move', workers: 2 },
  pr_1051: { question: 'How do products present step-up authentication without hurting task flow?', depth: 'standard', breadth: 15 },
};
const RUN_BOARD = { pr_1060: 'caduceus', pr_1051: 'main' };
const OUT = {
  pr_1060: {
    requirements: '7 requirements; 2 open questions answered from the issue thread',
    spec: 'Select mode, “Move to…” target sheet, undo toast; keyboard: Shift+click range',
    architecture: 'Architecture notes + 2 mockups (compact sheet, large popover)',
  },
  pr_0951: { verify: 'Smoke checks green on production' },
  pr_0972: { verify: 'VERDICT: FAIL · reproduction test still flaky (3 of 20 runs); gave up after 3 attempts', fix: 'Attempt 3: buffer flush on resume' },
};
const GATE_INPUT = {
  'pr_1060:design-review': {
    from: 'architecture',
    bullets: [
      'Bulk-move opens as a bottom sheet on phones and a popover from the selection bar on large screens.',
      'New shared component: SelectionBar (count, Move to…, Cancel). Reuses the existing “Move to…” sheet.',
      'Undo: one toast per bulk move (6 s); server call batches up to 50 cards.',
      'Open risk: lanes with WIP limits; the sheet greys out full lanes with a reason.',
    ],
    files: ['architecture-notes.md', 'mockup-compact.png', 'mockup-large.png'],
  },
};

const createdRuns = [];
let taskSeq = 1062;
const nextTaskId = () => { do taskSeq++; while (getTask(`t_${taskSeq}`)); return `t_${taskSeq}`; };
/** UI state that survives ctx.refresh(): large-screen inspector selection and reviewer notes. */
const ui = { sel: {}, notes: {}, focus: null };

/* ==========================================================================
   Model helpers
   ========================================================================== */
const allPlaybooks = (ctx) => [...ctx.data.playbooks, ...LOCAL_PLAYBOOKS];
const findPb = (ctx, id) => allPlaybooks(ctx).find((p) => p.id === id);
const allRuns = (ctx) => [...createdRuns, ...ctx.data.playbookRuns, ...LOCAL_RUNS];
const runsOf = (ctx, id) => allRuns(ctx).filter((r) => r.playbook === id).sort((a, b) => b.started - a.started);
const isTemplate = (pb) => pb.stages.length === 1;
const isActive = (r) => r.state === 'running' || r.state === 'waiting';

function def(pb) {
  const spec = SPECS[pb.id] || {};
  const stages = pb.stages.map((s, index) => {
    const m = spec.meta?.[s.key] || {};
    const kind = s.gate ? 'gate' : m.kind || 'task';
    const human = s.assignee === 'you';
    return {
      ...s, index, kind, gate: s.gate || (kind === 'gate' ? 'gate' : null), group: m.group || null,
      skills: m.skills || [], model: human ? null : m.model || getProfile(s.assignee)?.model, modelIsDefault: !m.model,
      goal: !!m.goal, maxTurns: m.maxTurns || null, contract: m.contract || null, maxAttempts: m.maxAttempts || 1,
      brief: m.brief || `## Goal\n{{inputs.${pb.inputs[0]?.key || 'goal'}}}\n\n${s.title}.`,
    };
  });
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  const edgeRows = spec.edges || stages.slice(1).map((s, i) => [stages[i].key, s.key, stages[i].gate ? 'on_approve' : 'on_done']);
  const edges = edgeRows.map(([from, to, cond, max]) => ({ from, to, cond, max: max || null, back: byKey[to].index <= byKey[from].index }));
  const layerOf = {};
  stages.forEach((s) => { layerOf[s.key] = 0; });
  stages.forEach((s) => edges.filter((e) => !e.back && e.from === s.key).forEach((e) => { layerOf[e.to] = Math.max(layerOf[e.to], layerOf[s.key] + 1); }));
  const layers = [];
  stages.forEach((s) => { (layers[layerOf[s.key]] ||= []).push(s.key); });
  const numDefaults = spec.numberDefaults || {};
  const inputs = [...pb.inputs, ...(spec.extraInputs || [])].map((i) => ({ ...i, ...(numDefaults[i.key] || {}) }));
  return {
    pb, stages, byKey, edges, layers, inputs, groups: spec.groups || {}, board: spec.board || 'main', estimate: spec.estimate,
    tag: `${pb.id}@${pb.version}`, gates: stages.filter((s) => s.gate), loops: edges.filter((e) => e.back),
  };
}
const outEdges = (d, key) => d.edges.filter((e) => e.from === key);
const inEdges = (d, key) => d.edges.filter((e) => e.to === key);

/** Merge a run's stage record with screen-local ids, outputs and timings. */
function rstage(run, key) {
  const st = run.stages.find((x) => x.key === key) || { key, state: 'queued', attempt: 0 };
  if (!st.taskId && EXTRA_IDS[run.id]?.[key] && st.state !== 'queued') st.taskId = EXTRA_IDS[run.id][key];
  return st;
}
function stageStarted(run, st) {
  if (st.started) return st.started;
  const t = st.taskId && getTask(st.taskId);
  return t?.runs?.at(-1)?.started || t?.created || null;
}
function stageSummary(run, st) {
  if (st.state === 'running' && st.started) {
    if (st.attempt <= 1) return 'Claimed by the dispatcher · turn 1';
    return ui.notes[run.id]?.[st.key]?.some((n) => !n.comment) ? `Attempt ${st.attempt}: reworking with the reviewer note in the brief` : `Attempt ${st.attempt}: re-run started by you`;
  }
  if (OUT[run.id]?.[st.key]) return OUT[run.id][st.key];
  const t = st.taskId && getTask(st.taskId);
  return t?.runs?.at(-1)?.summary || '';
}
function lastStatus(ctx, pb) {
  const r = runsOf(ctx, pb.id)[0];
  return r ? { state: r.state, at: r.started, run: r } : pb.lastStatus ? { state: pb.lastStatus, at: pb.lastRun } : null;
}
function currentStage(d, run) {
  return d.stages.find((s) => ['waiting', 'running', 'failed'].includes(rstage(run, s.key).state)) || null;
}
const doneCount = (d, run) => d.stages.filter((s) => rstage(run, s.key).state === 'succeeded').length;
const runPath = (run) => `/work/playbooks/${run.playbook}/runs/${run.rootTaskId}`;
const boardName = (ctx, id) => ctx.data.boards.find((b) => b.id === id)?.name || id;
const codeify = (s) => raw(esc(s).replace(/`([^`]+)`/g, '<code>$1</code>'));
const briefHtml = (s) => raw(esc(s).replace(/\{\{[^}]+\}\}/g, '<span class="pb-var">$&</span>').replace(/`([^`]+)`/g, '<span class="s">$1</span>'));
const condLabel = (e) => `${e.cond}${e.max ? ` · max ${e.max}` : ''}`;
const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');
function setHashQuery(key, val) {
  const [p] = location.hash.split('?');
  const q = hashQuery();
  if (val == null || val === '') q.delete(key); else q.set(key, val);
  const s = q.toString();
  history.replaceState(history.state, '', `${p}${s ? '?' + s : ''}`);
}
const wideGraph = () => matchMedia('(min-width: 1024px)').matches;

/* ==========================================================================
   Fragments
   ========================================================================== */
function attemptTag(s, st) {
  if (!st || !st.attempt || st.state === 'queued') return '';
  if (s.maxAttempts <= 1 && st.attempt <= 1) return '';
  const tone = st.state === 'failed' ? 'danger' : st.attempt > 1 ? 'warning' : '';
  return html`<span class="tag mono" ${tone ? raw(`data-tone="${tone}"`) : ''}>attempt ${st.attempt}${s.maxAttempts > 1 ? `/${s.maxAttempts}` : ''}</span>`;
}
const gateTag = (s) => (s.gate ? html`<span class="tag" data-tone="warning">${icon('flag', 'i-sm')}Gate</span>` : '');
const kindIcon = (s, cls = '') => html`<span class="pb-kicon ${cls}" data-kind="${s.kind}" aria-hidden="true">${icon(KIND[s.kind].icon)}</span>`;

function nodeLabel(d, s, st) {
  const routes = outEdges(d, s.key).map((e) => `${e.cond.replace('_', ' ')}: ${d.byKey[e.to].title}${e.max ? `, up to ${e.max} attempts` : ''}`).join('; ');
  const who = s.assignee === 'you' ? 'assigned to you' : `assignee ${s.assignee}`;
  const state = st ? `. ${STATE_LABEL[st.state] || st.state}${st.attempt > 1 ? `, attempt ${st.attempt}` : ''}` : '';
  return `Stage ${s.index + 1} of ${d.stages.length}: ${s.title}. ${KIND[s.kind].label}, ${who}${state}.${routes ? ` Routes: ${routes}.` : ' Last stage.'}`;
}

/* ---- Graph (≥ 1024 px): HTML nodes over an SVG edge layer; positions computed in mount ---- */
function graphHtml(d, { run, sel, label, pressable }) {
  const first = sel && d.byKey[sel] ? sel : d.stages[0].key;
  return html`<div class="pbg-wrap">
    <div class="pbg" data-graph role="group" aria-label="${label}" aria-describedby="pbg-help">
      <svg class="pbg__svg" aria-hidden="true" focusable="false"></svg>
      ${d.stages.map((s) => {
        const st = run && rstage(run, s.key);
        return html`<button type="button" class="pbg__node${s.gate ? ' is-gate' : ''}" data-stage="${s.key}" data-kind="${s.kind}" ${st ? raw(`data-tone="${TONE[st.state]}" data-state="${st.state}"`) : ''}
          tabindex="${s.key === first ? 0 : -1}" ${pressable ? raw(`aria-pressed="${s.key === sel}"`) : raw('aria-haspopup="dialog"')} aria-label="${nodeLabel(d, s, st)}">
          <span class="pbg__top">${kindIcon(s)}<span class="pbg__title">${s.title}</span></span>
          <span class="pbg__meta">${st
            ? html`${statusBadge(st.state, { variant: 'plain', label: STATE_LABEL[st.state] })}${attemptTag(s, st)}`
            : html`${avatar(s.assignee, { size: 'sm' })}<span class="truncate">${s.assignee}</span>${gateTag(s)}${s.maxAttempts > 1 ? html`<span class="mono pbg__max">≤${s.maxAttempts}×</span>` : ''}`}<span class="pbg__num mono" aria-hidden="true">${String(s.index + 1).padStart(2, '0')}</span></span>
        </button>`;
      })}
    </div>
    <p class="pbg__help subtle" id="pbg-help">${icon('keyboard', 'i-sm')}Arrow keys move between stages; Enter opens the stage. Dashed edges loop back, bounded by max attempts.</p>
  </div>`;
}

const G = { NW: 184, NH: 64, CG: 68, VG: 14, RG: 52, LANE: 40, PAD: 34 };
function layoutGraph(d, W) {
  const { NW, NH, CG, VG, RG, LANE, PAD } = G;
  const nL = d.layers.length;
  const cols = Math.max(1, Math.min(nL, Math.floor((W - 2 * PAD + CG) / (NW + CG))));
  const used = cols * NW + (cols - 1) * CG;
  const x0 = Math.max(PAD, Math.round((W - used) / 2));
  const pos = {}, rows = [];
  let y = 0;
  for (let r = 0; r * cols < nL; r++) {
    const ls = d.layers.slice(r * cols, r * cols + cols);
    const stack = Math.max(...ls.map((l) => l.length));
    const h = stack * NH + (stack - 1) * VG;
    const top = y + LANE;
    ls.forEach((l, c) => {
      const lh = l.length * NH + (l.length - 1) * VG;
      l.forEach((k, j) => { pos[k] = { x: x0 + c * (NW + CG), y: top + (h - lh) / 2 + j * (NH + VG), w: NW, h: NH, row: r }; });
    });
    rows.push({ top: y, bottom: top + h });
    y = top + h + RG;
  }
  return { pos, rows, width: Math.max(W, x0 * 2 + used), height: y - RG + 16 };
}
function ortho(pts, r = 10) {
  let p = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const d1 = Math.hypot(bx - ax, by - ay), d2 = Math.hypot(cx - bx, cy - by);
    if (!d1 || !d2) continue;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    p += ` L${bx - ((bx - ax) / d1) * rr},${by - ((by - ay) / d1) * rr} Q${bx},${by} ${bx + ((cx - bx) / d2) * rr},${by + ((cy - by) / d2) * rr}`;
  }
  const last = pts[pts.length - 1];
  return `${p} L${last[0]},${last[1]}`;
}
function drawGraph(el, d, run) {
  const W = el.parentElement.clientWidth;
  const L = layoutGraph(d, W);
  const { pos, rows } = L;
  el.style.blockSize = `${L.height}px`;
  el.style.minInlineSize = L.width > W ? `${L.width}px` : '';
  el.querySelectorAll('.pbg__node').forEach((n) => {
    const p = pos[n.dataset.stage];
    Object.assign(n.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
  });
  el.querySelectorAll('.pbg__group').forEach((g) => g.remove());
  Object.entries(d.groups).forEach(([gid, title]) => {
    const ps = d.stages.filter((s) => s.group === gid).map((s) => pos[s.key]);
    if (!ps.length) return;
    const x1 = Math.min(...ps.map((p) => p.x)) - 10, y1 = Math.min(...ps.map((p) => p.y)) - 24;
    const x2 = Math.max(...ps.map((p) => p.x + p.w)) + 10, y2 = Math.max(...ps.map((p) => p.y + p.h)) + 10;
    const g = document.createElement('div');
    g.className = 'pbg__group';
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
    g.innerHTML = `<span class="overline">Parallel · ${esc(title)}</span>`;
    el.prepend(g);
  });
  const lanes = {};
  const paths = [], labels = [], seen = new Set();
  const label = (x, y, text, tone) => {
    const k = `${Math.round(x)}:${Math.round(y)}:${text}`;
    if (seen.has(k)) return;
    seen.add(k);
    const w = text.length * 6.1 + 10;
    labels.push(`<g class="pbg__lbl${tone ? ' pbg__lbl--' + tone : ''}"><rect x="${x - w / 2}" y="${y - 8}" width="${w}" height="16" rx="8"/><text x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(text)}</text></g>`);
  };
  for (const e of d.edges) {
    const a = pos[e.from], b = pos[e.to];
    const tone = COND_TONE[e.cond];
    let taken = false;
    if (run) {
      const sa = rstage(run, e.from), sb = rstage(run, e.to);
      taken = e.back ? sb.attempt > 1 && sa.attempt >= 1 : sa.state === 'succeeded' && sb.state !== 'queued';
    }
    const cls = `pbg__edge${tone ? ' pbg__edge--' + tone : ''}${e.back ? ' pbg__edge--loop' : ''}${taken ? ' is-taken' : ''}`;
    const marker = `url(#pbg-m-${taken ? 'taken' : tone || 'base'})`;
    let p, lx, ly;
    if (!e.back && a.row === b.row) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 3, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      p = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      lx = mx; ly = (y1 + y2) / 2;
    } else if (!e.back) {
      const xa = a.x + a.w + G.CG / 2, gy = rows[a.row].bottom + G.RG / 2, xb = b.x - G.CG / 2, cy = b.y + b.h / 2;
      p = ortho([[a.x + a.w, a.y + a.h / 2], [xa, a.y + a.h / 2], [xa, gy], [xb, gy], [xb, cy], [b.x - 3, cy]]);
      lx = (xa + xb) / 2; ly = gy;
    } else if (a.row === b.row) {
      const n = (lanes[a.row] = (lanes[a.row] || 0) + 1) - 1;
      const yl = rows[a.row].top + 10 + n * 9;
      const xa = a.x + a.w / 2 + 14, xb = b.x + b.w / 2 - 14;
      p = ortho([[xa, a.y], [xa, yl], [xb, yl], [xb, b.y - 3]]);
      lx = (xa + xb) / 2; ly = yl;
    } else {
      const xa = a.x + a.w / 2 + 14, ya = a.y, xb = b.x + b.w / 2 + 14, yb = b.y + b.h + 3;
      p = `M${xa},${ya} C${xa},${ya - 56} ${xb},${yb + 56} ${xb},${yb}`;
      // label at t = 0.65 (towards the target) so it clears same-row loop labels above the source row
      const t = 0.65, u = 1 - t;
      lx = u ** 3 * xa + 3 * u * u * t * xa + 3 * u * t * t * xb + t ** 3 * xb;
      ly = u ** 3 * ya + 3 * u * u * t * (ya - 56) + 3 * u * t * t * (yb + 56) + t ** 3 * yb;
    }
    paths.push(`<path class="${cls}" d="${p}" marker-end="${marker}"/>`);
    label(lx, ly, condLabel(e), tone);
  }
  const svg = el.querySelector('.pbg__svg');
  svg.setAttribute('width', L.width);
  svg.setAttribute('height', L.height);
  svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
  const mk = (id) => `<marker id="pbg-m-${id}" class="pbg__arrow pbg__arrow--${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.5 L7.5,4 L0,7.5 z"/></marker>`;
  svg.innerHTML = `<defs>${['base', 'ok', 'bad', 'taken'].map(mk).join('')}</defs>${paths.join('')}${labels.join('')}`;
}

/* ---- Stage list (< 1024 px, or the accessible list view on wide screens) ---- */
function stageListHtml(d, { run, sel, pressable }) {
  const items = [];
  for (let i = 0; i < d.stages.length;) {
    const s = d.stages[i];
    if (s.group) { const g = d.stages.filter((x) => x.group === s.group); items.push({ group: s.group, stages: g }); i += g.length; } else { items.push({ stage: s }); i++; }
  }
  const row = (s) => {
    const st = run && rstage(run, s.key);
    const loops = outEdges(d, s.key).filter((e) => e.back);
    const routes = s.gate ? outEdges(d, s.key).filter((e) => !e.back) : [];
    return html`<li class="pbl__item" data-kind="${s.kind}" ${st ? raw(`data-tone="${TONE[st.state]}"`) : ''}>
      <button type="button" class="pbl__row" data-stage="${s.key}" ${pressable ? raw(`aria-pressed="${s.key === sel}"`) : raw('aria-haspopup="dialog"')}>
        ${kindIcon(s, 'pbl__icon')}
        <span class="pbl__main">
          <span class="pbl__title"><span class="pbl__num mono">${s.index + 1}</span>${s.title}</span>
          <span class="pbl__meta">${profileTag(s.assignee)}<span>${KIND[s.kind].label}</span>${gateTag(s)}${st ? html`${statusBadge(st.state, { variant: 'plain', label: STATE_LABEL[st.state] })}${attemptTag(s, st)}` : s.maxAttempts > 1 ? html`<span class="mono">max ${s.maxAttempts} attempts</span>` : ''}</span>
        </span>
        ${icon('chev-r', 'list-row__chev')}
      </button>
      ${routes.map((e) => html`<p class="pbl__route" data-tone="${e.cond === 'on_approve' ? 'success' : 'neutral'}">${icon('check', 'i-sm')}<span class="mono">${e.cond}</span><span>→ ${d.byKey[e.to].title}</span></p>`)}
      ${loops.map((e) => html`<p class="pbl__route pbl__route--loop" data-tone="danger">${icon('refresh', 'i-sm')}<span class="mono">${e.cond}</span><span>↺ ${d.byKey[e.to].title} · max ${e.max} attempts</span></p>`)}
    </li>`;
  };
  return html`<ol class="pbl" aria-label="${d.stages.length} stages in order">${items.map((it) => (it.group
    ? html`<li class="pbl__group"><p class="pbl__glabel overline">${icon('stack', 'i-sm')}Parallel · ${d.groups[it.group]}</p><ol class="pbl pbl--inner">${it.stages.map(row)}</ol></li>`
    : row(it.stage)))}</ol>`;
}

/* ---- Stage inspector (definition) ---- */
function inspectorHtml(d, s) {
  const outs = outEdges(d, s.key), ins = inEdges(d, s.key);
  const human = s.assignee === 'you';
  return html`<div class="pbi">
    <div class="pbi__head">${kindIcon(s, 'pbi__icon')}<div class="pbi__headtext"><p class="overline">Stage ${s.index + 1} of ${d.stages.length} · ${KIND[s.kind].label}</p><p class="mono subtle">current_step_key=${s.key}</p></div></div>
    <dl class="kv pbi__kv">
      <dt>Assignee</dt><dd>${profileTag(s.assignee)}${human ? html` <span class="subtle">· lands in Inbox</span>` : ''}</dd>
      ${s.gate ? html`<dt>Gate type</dt><dd>Review: <strong>Approve</strong> or <strong>Reject + note</strong>. Uses the Kanban <code>review</code> status.</dd>` : ''}
      <dt>Skills</dt><dd>${s.skills.length ? html`<span class="pbi__tags">${s.skills.map((k) => html`<span class="tag mono">${k}</span>`)}</span>` : html`<span class="subtle">None</span>`}</dd>
      <dt>Model</dt><dd>${human ? html`<span class="subtle">Human decision</span>` : html`<span class="mono">${s.model}</span>${s.modelIsDefault ? html` <span class="subtle">· profile default</span>` : html` <span class="subtle">· override</span>`}`}</dd>
      <dt>Goal mode</dt><dd>${human ? html`<span class="subtle">n/a</span>` : s.goal ? html`On · judge checks the goal · max ${s.maxTurns} turns` : html`<span class="subtle">Off</span>`}</dd>
      <dt>Contract</dt><dd>${s.contract ? html`<span class="mono">${s.contract}</span>` : html`<span class="subtle">Task reaches <code>done</code></span>`}</dd>
      <dt>Attempts</dt><dd>${s.maxAttempts > 1 ? `max ${s.maxAttempts}` : '1'}</dd>
    </dl>
    <section class="pbi__sec" aria-label="Routing">
      <h3 class="overline">Routing</h3>
      <ul class="pbi__edges plain">
        ${ins.map((e) => html`<li><span class="pbi__dir">${icon('arrow-r', 'i-sm')}in</span><span class="mono pbi__cond" data-tone="${e.cond === 'on_done' ? 'neutral' : COND_TONE[e.cond] === 'ok' ? 'success' : 'danger'}">${e.cond}</span><span>from ${d.byKey[e.from].title}</span></li>`)}
        ${outs.map((e) => html`<li><span class="pbi__dir">${icon('arrow-r', 'i-sm')}out</span><span class="mono pbi__cond" data-tone="${e.cond === 'on_done' ? 'neutral' : COND_TONE[e.cond] === 'ok' ? 'success' : 'danger'}">${e.cond}</span><span>${e.back ? '↺ ' : '→ '}${d.byKey[e.to].title}${e.max ? html` <span class="subtle">· max ${e.max}</span>` : ''}</span></li>`)}
        ${!outs.length ? html`<li><span class="pbi__dir">${icon('check', 'i-sm')}end</span><span>Run completes</span></li>` : ''}
      </ul>
    </section>
    <section class="pbi__sec" aria-label="Brief template">
      <h3 class="overline">Brief template</h3>
      <div class="code"><div class="code__head">${icon('file', 'i-sm')}<span class="grow">brief.md</span><span>filled per run</span></div><pre>${briefHtml(s.brief)}</pre></div>
    </section>
  </div>`;
}

/* ==========================================================================
   Library
   ========================================================================== */
function miniStrip(pb) {
  return html`<span class="pbcard__strip" aria-hidden="true">${pb.stages.map((s) => html`<i class="${s.gate ? 'is-gate' : ''}"></i>`)}</span>`;
}
function libraryCard(ctx, pb) {
  const tpl = isTemplate(pb);
  const last = lastStatus(ctx, pb);
  const gates = pb.stages.filter((s) => s.gate).length;
  const profiles = [...new Set(pb.stages.map((s) => s.assignee))];
  const hay = `${pb.name} ${pb.category} ${pb.description} ${pb.stages.map((s) => s.title).join(' ')}`;
  return html`<li class="pbcard" data-kind="${tpl ? 'template' : 'playbook'}" data-hay="${hay}">
    <div class="pbcard__top">
      <span class="pbcard__icon" aria-hidden="true">${icon(tpl ? 'file' : 'playbook')}</span>
      <span class="tag">${pb.category}</span>${tpl ? html`<span class="tag" data-tone="accent">Template</span>` : ''}
      <span class="mono pbcard__ver">v${pb.version}</span>
    </div>
    <h3 class="pbcard__title"><a href="${ctx.href('/work/playbooks/' + pb.id)}">${pb.name}</a></h3>
    <p class="pbcard__desc">${pb.description}</p>
    ${miniStrip(pb)}
    <p class="pbcard__facts"><span>${pb.stages.length} ${pb.stages.length === 1 ? 'stage' : 'stages'}</span>${gates ? html`<span>${gates} ${gates === 1 ? 'gate' : 'gates'}</span>` : ''}<span>${pb.runs} runs</span><span class="pbcard__avs" aria-label="Profiles: ${profiles.join(', ')}">${profiles.map((p) => avatar(p, { size: 'sm' }))}</span></p>
    <div class="pbcard__foot">
      <span class="pbcard__last">${last ? html`<span class="subtle">Last run</span>${statusBadge(last.state, { variant: 'plain', label: STATE_LABEL[last.state] || undefined })}<span class="mono subtle">${fmtAgo(last.at)}</span>` : html`<span class="subtle">Never run</span>`}</span>
      <button type="button" class="btn btn--secondary btn--sm" data-run="${pb.id}" aria-label="Run ${pb.name}">${icon('play')}Run</button>
    </div>
  </li>`;
}
function activeRunRow(ctx, run) {
  const pb = findPb(ctx, run.playbook);
  const d = def(pb);
  const cur = currentStage(d, run);
  const done = doneCount(d, run);
  const cst = cur && rstage(run, cur.key);
  return html`<li class="pbrow">
    <span class="list-row__icon" aria-hidden="true">${icon('playbook')}</span>
    <div class="pbrow__main">
      <a class="pbrow__title" href="${ctx.href(runPath(run))}">${run.title}</a>
      <div class="pbrow__meta">${statusBadge(run.state, { variant: 'plain' })}<span>${pb.name}</span><span>Stage ${cur ? cur.index + 1 : done} of ${d.stages.length}${cur ? ` · ${cur.title}` : ''}</span><span class="mono">${run.rootTaskId}</span>${profileTag(run.profile)}</div>
      <div class="progress" data-tone="${TONE[run.state]}" role="img" aria-label="${done} of ${d.stages.length} stages done"><i style="--p:${Math.round((done / d.stages.length) * 100)}%"></i></div>
    </div>
    <div class="pbrow__end">
      ${cst?.state === 'running' ? html`<span class="mono pbrow__el" data-elapsed="${stageStarted(run, cst)}" aria-label="Stage elapsed">${fmtDur((Date.now() - stageStarted(run, cst)) / 1000)}</span>` : ''}
      ${run.state === 'waiting'
        ? html`<a class="btn btn--primary btn--sm" href="${ctx.href(runPath(run))}">${icon('flag')}Review gate</a>`
        : html`<a class="btn btn--secondary btn--sm" href="${ctx.href(runPath(run))}">Open run</a>`}
    </div>
  </li>`;
}
function renderLibrary(ctx) {
  const q = ctx.query.q || '';
  const kind = ['playbooks', 'templates'].includes(ctx.query.kind) ? ctx.query.kind : 'all';
  const pbs = allPlaybooks(ctx);
  const nT = pbs.filter(isTemplate).length;
  const active = allRuns(ctx).filter(isActive);
  const seg = (v, label, n) => html`<button type="button" role="radio" aria-checked="${String(kind === v)}" data-kind-filter="${v}">${label}<span class="pblib__n mono">${n}</span></button>`;
  return html`<div class="pblib">
    ${pageHeader({
      title: 'Playbooks',
      subtitle: 'Reusable multi-stage workflows. Every run is a set of Hermes Kanban tasks, tagged with the playbook’s workflow_template_id.',
      actions: ctx.size === 'compact' ? '' : html`<button type="button" class="btn btn--primary" data-run-picker>${icon('play')}Run playbook…</button>`,
    })}
    ${active.length ? html`<section class="section" aria-labelledby="pb-active" id="pb-active-sec">
      <div class="section__head"><h2 class="section__title" id="pb-active" tabindex="-1">${icon('running')}Active runs <span class="count count--accent" aria-hidden="true">${active.length}</span></h2>
        <a class="section__link" href="${ctx.href('/work/board?workflow_template_id=any')}">On the Board${icon('chev-r', 'i-sm')}</a></div>
      <ul class="list panel">${active.map((r) => activeRunRow(ctx, r))}</ul>
    </section>` : ''}
    <section class="section" aria-labelledby="pb-lib">
      <div class="section__head"><h2 class="section__title" id="pb-lib">Library</h2><span class="subtle pblib__count" aria-live="polite" data-count></span></div>
      <div class="toolbar pblib__tools">
        <div class="input-wrap pblib__search">${icon('search')}<label class="sr-only" for="pb-q">Search playbooks and templates</label><input id="pb-q" class="input" type="search" placeholder="Search playbooks, stages…" value="${q}" autocomplete="off"></div>
        <div class="seg" role="radiogroup" aria-label="Show">${seg('all', 'All', pbs.length)}${seg('playbooks', 'Playbooks', pbs.length - nT)}${seg('templates', 'Templates', nT)}</div>
      </div>
      <ul class="cards plain pblib__cards" data-cards>${pbs.map((pb) => libraryCard(ctx, pb))}</ul>
      <div data-empty hidden>${emptyState({ icon: 'search', title: 'No playbooks match', body: 'Try a stage name such as “review”, or clear the filters.', action: html`<button type="button" class="btn btn--secondary" data-clear>Clear search</button>` })}</div>
      <p class="pblib__note subtle">${icon('info', 'i-sm')}A Template is a one-stage Playbook. Definitions live in <code>HERMES_HOME/caduceus/playbooks/*.yaml</code>.</p>
    </section>
  </div>`;
}
function mountLibrary(root, ctx) {
  const input = root.querySelector('#pb-q');
  const cards = [...root.querySelectorAll('[data-cards] > li')];
  const count = root.querySelector('[data-count]');
  const empty = root.querySelector('[data-empty]');
  let kind = root.querySelector('[data-kind-filter][aria-checked="true"]').dataset.kindFilter;
  const apply = () => {
    const q = input.value.trim();
    let n = 0;
    cards.forEach((c) => {
      const hay = c.dataset.hay.toLowerCase();
      const ok = (kind === 'all' || (kind === 'templates') === (c.dataset.kind === 'template')) && (!q || q.toLowerCase().split(/\s+/).every((t) => hay.includes(t)));
      c.hidden = !ok;
      if (ok) n++;
    });
    count.textContent = `${n} of ${cards.length}`;
    empty.hidden = n > 0;
  };
  input.addEventListener('input', () => { setHashQuery('q', input.value.trim()); apply(); });
  root.querySelectorAll('[data-kind-filter]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kindFilter;
    root.querySelectorAll('[data-kind-filter]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    setHashQuery('kind', kind === 'all' ? '' : kind);
    apply();
  }));
  root.querySelector('[data-clear]').addEventListener('click', () => {
    input.value = ''; kind = 'all';
    root.querySelectorAll('[data-kind-filter]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.kindFilter === 'all')));
    setHashQuery('q', ''); setHashQuery('kind', '');
    apply(); input.focus();
  });
  apply();
  if (hashQuery().get('focus') === 'runs') {
    requestAnimationFrame(() => {
      const h = root.querySelector('#pb-active');
      if (h) { h.scrollIntoView({ block: 'start' }); h.focus({ preventScroll: true }); }
    });
  }
}

/* ==========================================================================
   Detail
   ========================================================================== */
function runListRow(ctx, d, run) {
  const done = doneCount(d, run);
  return html`<li><a class="list-row" href="${ctx.href(runPath(run))}">
    <span class="list-row__main"><span class="list-row__title">${run.title}</span>
      <span class="list-row__meta">${statusBadge(run.state, { variant: 'plain' })}<span>${done}/${d.stages.length} stages</span><span class="mono">${run.rootTaskId}</span><span>${fmtMoney(run.cost)}</span></span></span>
    <span class="list-row__end"><span class="mono">${fmtAgo(run.started)}</span>${icon('chev-r', 'list-row__chev')}</span>
  </a></li>`;
}
function renderDetail(ctx, pb) {
  const d = def(pb);
  const tpl = isTemplate(pb);
  const large = ctx.size === 'large';
  const graphOk = wideGraph() && !tpl;
  const view = graphOk && hashQuery().get('view') !== 'list' ? 'graph' : 'list';
  const sel = large ? ui.sel[pb.id] : null;
  const runs = runsOf(ctx, pb.id);
  const typeLabel = { text: 'Text', select: 'Select', number: 'Number', project: 'Repo path', url: 'URL', path: 'File path' };
  return html`<div class="pbd-page">
    ${pageHeader({
      overline: `${pb.category} · ${tpl ? 'Template' : 'Playbook'} · v${pb.version}`,
      title: pb.name,
      subtitle: pb.description,
      actions: html`<button type="button" class="btn btn--primary" data-run="${pb.id}">${icon('play')}Run${ctx.size === 'compact' ? '' : ` ${tpl ? 'template' : 'playbook'}`}…</button><button type="button" class="btn btn--secondary" data-yaml>${icon('code')}YAML</button>`,
    })}
    <ul class="pbd__facts plain" aria-label="Summary">
      <li><strong>${d.stages.length}</strong> ${d.stages.length === 1 ? 'stage' : 'stages'}</li>
      ${d.gates.length ? html`<li><strong>${d.gates.length}</strong> human ${d.gates.length === 1 ? 'gate' : 'gates'}</li>` : ''}
      ${d.loops.length ? html`<li><strong>${d.loops.length}</strong> bounded ${d.loops.length === 1 ? 'loop' : 'loops'}</li>` : ''}
      <li><strong>${pb.runs}</strong> runs</li>
      <li class="pbd__kanban">${icon('tasks', 'i-sm')}Runs create Kanban tasks tagged <code>workflow_template_id=${d.tag}</code></li>
    </ul>
    <div class="pbd${sel ? ' has-inspector' : ''}" data-pbd>
      <section class="section pbd__stages" aria-labelledby="pb-stages">
        <div class="section__head"><h2 class="section__title" id="pb-stages">Stages</h2>
          ${graphOk ? html`<div class="seg" role="radiogroup" aria-label="Stage view"><button type="button" role="radio" aria-checked="${String(view === 'graph')}" data-view="graph">${icon('playbook')}Graph</button><button type="button" role="radio" aria-checked="${String(view === 'list')}" data-view="list">${icon('rows')}List</button></div>` : ''}
        </div>
        ${view === 'graph' ? graphHtml(d, { sel, pressable: large, label: `${pb.name} stage graph, ${d.stages.length} stages` }) : html`<div class="panel pbl-panel">${stageListHtml(d, { sel, pressable: large })}</div>`}
      </section>
      ${large ? html`<aside class="pbd__inspector panel" aria-labelledby="pbi-h" data-inspector ${sel ? '' : raw('hidden')}>${sel ? inspectorPanel(d, d.byKey[sel]) : ''}</aside>` : ''}
    </div>
    <div class="pbd__more">
      <section class="section" aria-labelledby="pb-inputs">
        <div class="section__head"><h2 class="section__title" id="pb-inputs">Inputs schema</h2><span class="subtle">Generates the run form</span></div>
        <div class="dl-wrap panel"><table class="dl"><thead><tr><th scope="col">Key</th><th scope="col">Label</th><th scope="col">Type</th><th scope="col">Required</th></tr></thead>
          <tbody>${d.inputs.map((i) => html`<tr><td class="cell-main"><span class="mono">${i.key}</span></td><td data-label="Label">${i.label}</td><td data-label="Type">${typeLabel[i.type] || i.type}${i.options ? html` <span class="subtle">(${i.options.join(' / ')})</span>` : ''}</td><td data-label="Required">${i.required ? html`<span class="tag" data-tone="accent">Required</span>` : html`<span class="subtle">Optional</span>`}</td></tr>`)}</tbody></table></div>
      </section>
      <section class="section" aria-labelledby="pb-runs">
        <div class="section__head"><h2 class="section__title" id="pb-runs">Runs</h2><a class="section__link" href="${ctx.href(`/work/tasks?workflow_template_id=${d.tag}`)}">As tasks${icon('chev-r', 'i-sm')}</a></div>
        ${runs.length ? html`<ul class="list panel">${runs.map((r) => runListRow(ctx, d, r))}</ul>` : html`<div class="panel panel--pad subtle">${pb.runs ? `${pb.runs} earlier runs (last ${fmtAgo(pb.lastRun, { suffix: true })}) are not in the mock history.` : 'No runs yet.'} New runs appear here and on the Board.</div>`}
      </section>
    </div>
  </div>`;
}
const inspectorPanel = (d, s) => html`<header class="pbd__ihead"><h2 id="pbi-h">${s.title}</h2><button type="button" class="btn btn--ghost btn--icon" data-close-inspector aria-label="Close stage inspector">${icon('x')}</button></header>${inspectorHtml(d, s)}`;

function yamlOf(d) {
  const lines = [`id: ${d.pb.id}`, `name: ${d.pb.name}`, `version: ${d.pb.version}`, 'inputs:'];
  d.inputs.forEach((i) => lines.push(`  - { key: ${i.key}, type: ${i.type}${i.required ? ', required: true' : ''}${i.options ? `, options: [${i.options.join(', ')}]` : ''} }`));
  lines.push('stages:');
  d.stages.forEach((s) => {
    lines.push(`  - key: ${s.key}`, `    title: ${s.title}`, `    assignee: ${s.assignee}`);
    if (s.gate) lines.push('    gate: review');
    if (s.skills.length) lines.push(`    skills: [${s.skills.join(', ')}]`);
    if (s.goal) lines.push(`    goal_mode: { max_turns: ${s.maxTurns} }`);
    if (s.contract) lines.push(`    completion_contract: "${s.contract}"`);
    if (s.maxAttempts > 1) lines.push(`    max_attempts: ${s.maxAttempts}`);
  });
  lines.push('edges:');
  d.edges.forEach((e) => lines.push(`  - { from: ${e.from}, to: ${e.to}, when: ${e.cond} }`));
  return lines.join('\n');
}

function openStageInspector(ctx, d, key) {
  const s = d.byKey[key];
  const body = String(inspectorHtml(d, s));
  if (ctx.size === 'compact') return ctx.openSheet({ title: s.title, body, detents: ['half', 'full'] });
  return ctx.openDrawer({ title: s.title, body, side: 'end' });
}

function mountDetail(root, ctx, pb) {
  const d = def(pb);
  const large = ctx.size === 'large';
  root.querySelector('[data-yaml]').addEventListener('click', () => ctx.openSheet({
    title: `${pb.id}.yaml`, wide: true, detents: ['full'],
    body: String(html`<p class="muted">Human-editable definition in <code>HERMES_HOME/caduceus/playbooks/</code>. Editing is not part of the prototype.</p><div class="code"><div class="code__head">${icon('file', 'i-sm')}<span class="grow">${pb.id}.yaml</span><span>v${pb.version}</span></div><pre>${yamlOf(d)}</pre></div>`),
  }));
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    if (b.getAttribute('aria-checked') === 'true') return;
    setHashQuery('view', b.dataset.view === 'list' ? 'list' : '');
    ui.focus = `[data-view="${b.dataset.view}"]`;
    ctx.refresh();
  }));
  const aside = root.querySelector('[data-inspector]');
  const wrap = root.querySelector('[data-pbd]');
  const select = (key, btn) => {
    if (!large) { openStageInspector(ctx, d, key); return; }
    const same = ui.sel[pb.id] === key;
    ui.sel[pb.id] = same ? null : key;
    root.querySelectorAll('[data-stage]').forEach((x) => x.setAttribute('aria-pressed', String(!same && x.dataset.stage === key)));
    wrap.classList.toggle('has-inspector', !same);
    aside.hidden = same;
    aside.innerHTML = same ? '' : String(inspectorPanel(d, d.byKey[key]));
    btn?.focus({ preventScroll: true });
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stage]');
    if (b) { select(b.dataset.stage, b); return; }
    if (e.target.closest('[data-close-inspector]')) {
      const key = ui.sel[pb.id];
      ui.sel[pb.id] = null;
      wrap.classList.remove('has-inspector');
      aside.hidden = true; aside.innerHTML = '';
      root.querySelectorAll('[data-stage]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      root.querySelector(`[data-stage="${key}"]`)?.focus();
    }
  });
  return mountGraph(root, d, null);
}

/** Lays out the graph (if present), re-lays it out on resize and wires roving arrow-key focus. */
function mountGraph(root, d, run) {
  const el = root.querySelector('[data-graph]');
  if (!el) return null;
  const draw = () => drawGraph(el, d, run);
  draw();
  const ro = new ResizeObserver(() => { if (el.isConnected) draw(); });
  ro.observe(el.parentElement);
  el.addEventListener('keydown', (e) => {
    const nodes = [...el.querySelectorAll('.pbg__node')];
    const i = nodes.indexOf(document.activeElement);
    if (i < 0) return;
    const map = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let j = null;
    if (e.key in map) j = (i + map[e.key] + nodes.length) % nodes.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = nodes.length - 1;
    if (j == null) return;
    e.preventDefault();
    nodes.forEach((n, k) => { n.tabIndex = k === j ? 0 : -1; });
    nodes[j].focus();
  });
  el.addEventListener('focusin', (e) => {
    const n = e.target.closest('.pbg__node');
    if (n) el.querySelectorAll('.pbg__node').forEach((x) => { x.tabIndex = x === n ? 0 : -1; });
  });
  return () => ro.disconnect();
}

/* ==========================================================================
   Run form (generated from the inputs schema)
   ========================================================================== */
function fieldHtml(ctx, inp, fid, d) {
  const id = `${fid}-${inp.key}`;
  const err = html`<p class="field__error" id="${id}-err" hidden>${icon('alert', 'i-sm')}<span>${inp.label} is required</span></p>`;
  const req = inp.required ? raw('required aria-required="true"') : '';
  const label = html`<label class="field__label" for="${id}">${inp.label}${inp.required ? '' : html` <span class="subtle">(optional)</span>`}</label>`;
  const help = (t) => (t ? html`<p class="field__help" id="${id}-help">${t}</p>` : '');
  const desc = raw(`aria-describedby="${id}-help ${id}-err"`);
  if (inp.type === 'select') {
    return html`<div class="field">${label}<select id="${id}" name="${inp.key}" class="input" ${req} ${desc}>${inp.options.map((o, i) => html`<option ${i === (inp.options.length > 2 ? 1 : 0) ? raw('selected') : ''}>${o}</option>`)}</select>${help(inp.help || `One of ${inp.options.length} options`)}${err}</div>`;
  }
  if (inp.type === 'project') {
    const projects = ctx.data.projects;
    const pre = projects.find((p) => p.boards.includes(d.board)) || projects[0];
    return html`<div class="field">${label}<select id="${id}" name="${inp.key}" class="input" data-project ${req} ${desc}>${projects.map((p) => html`<option value="${p.id}" data-repo="${p.repo}" data-board="${p.boards[0]}" ${p === pre ? raw('selected') : ''}>${p.name} — ${p.repo}</option>`)}</select>
      <p class="field__help" id="${id}-help">Repo path <span class="mono" data-repo-path>${pre.repo}</span> · each stage works in its own worktree</p>${err}</div>`;
  }
  if (inp.type === 'number') {
    return html`<div class="field pbform__num">${label}<input id="${id}" name="${inp.key}" class="input" type="number" inputmode="numeric" min="${inp.min ?? 1}" max="${inp.max ?? 99}" step="1" value="${inp.value ?? ''}" ${req} ${desc}>${help(inp.help || `${inp.min ?? 1}–${inp.max ?? 99}`)}${err}</div>`;
  }
  if (inp.type === 'path') {
    return html`<div class="field">${label}<input id="${id}" name="${inp.key}" class="input input--mono" type="text" autocomplete="off" spellcheck="false" placeholder="~/Documents/property/leases/4B.pdf" ${req} ${desc}>${help('Path inside the profile workspace')}${err}</div>`;
  }
  if (inp.type === 'url') {
    return html`<div class="field">${label}<input id="${id}" name="${inp.key}" class="input input--mono" type="url" inputmode="url" autocomplete="off" placeholder="https://github.com/hermes-lab/caduceus-dashboard/pull/…" ${req} ${desc}>${help('Pull request to review')}${err}</div>`;
  }
  if (LONG_TEXT.has(inp.key)) {
    return html`<div class="field">${label}<textarea id="${id}" name="${inp.key}" class="input" rows="3" ${req} ${desc} placeholder="${inp.key === 'goal' ? 'What should exist when this is done?' : inp.key === 'question' ? 'What do you want answered?' : 'What happens, and what did you expect?'}"></textarea>${help(`Filled into every stage brief as {{inputs.${inp.key}}}`)}${err}</div>`;
  }
  return html`<div class="field">${label}<input id="${id}" name="${inp.key}" class="input${inp.key === 'branch' || inp.key === 'package' ? ' input--mono' : ''}" type="text" autocomplete="off" ${inp.key === 'branch' ? raw('placeholder="feat/…" spellcheck="false"') : ''} ${req} ${desc}>${help(inp.key === 'branch' ? 'Defaults to kanban/<root task id>' : '')}${err}</div>`;
}
function createsHtml(ctx, d, board) {
  const n = d.stages.length;
  let id = taskSeq;
  const ids = d.stages.slice(0, 3).map(() => { do id++; while (getTask(`t_${id}`)); return `t_${id}`; });
  return html`<p>${icon('tasks', 'i-sm')}<span><strong>${n} Hermes Kanban ${n === 1 ? 'task' : 'tasks'}</strong> on <strong data-board-name>${boardName(ctx, board)}</strong>, tagged <code>workflow_template_id=${d.tag}</code> and <code>current_step_key</code>.</span></p>
    <ol class="pbcreate__list plain">${d.stages.slice(0, 3).map((s, i) => html`<li><span class="mono">${ids[i]}</span><span class="pbcreate__t">${s.title}</span><span class="subtle">${i === 0 ? 'created now · ready' : `created when ${d.stages[i - 1].title} is done`}</span></li>`)}
      ${n > 3 ? html`<li class="subtle pbcreate__more">+ ${n - 3} more, created as their predecessors finish</li>` : ''}</ol>
    ${d.gates.length ? html`<p>${icon('flag', 'i-sm')}<span>${d.gates.length} ${d.gates.length === 1 ? 'gate asks' : 'gates ask'} <strong>you</strong> in Inbox: ${d.gates.map((g) => g.title).join(', ')}.</span></p>` : ''}
    ${d.loops.length ? html`<p>${icon('refresh', 'i-sm')}<span>${d.loops.length} ${d.loops.length === 1 ? 'loop' : 'loops'}, each bounded by max attempts.</span></p>` : ''}
    ${d.estimate ? html`<p>${icon('coin', 'i-sm')}<span>Estimated ${d.estimate}, from ${d.pb.runs} earlier runs.</span></p>` : ''}`;
}
function openRunForm(ctx, pb) {
  const d = def(pb);
  const fid = uid('pbrun');
  const body = html`<form id="${fid}" class="pbform" novalidate>
    <p class="muted pbform__intro">${pb.description}</p>
    ${d.inputs.map((inp) => fieldHtml(ctx, inp, fid, d))}
    <div class="field"><label class="field__label" for="${fid}-board">Board</label><select id="${fid}-board" class="input" name="__board">${ctx.data.boards.map((b) => html`<option value="${b.id}" ${b.id === d.board ? raw('selected') : ''}>${b.name}${b.dispatcher === 'paused' ? ' (dispatcher paused)' : ''}</option>`)}</select><p class="field__help">Tasks land here and run under its dispatcher.</p></div>
    <section class="pbcreate" aria-labelledby="${fid}-c"><h3 id="${fid}-c" class="overline">What this creates</h3><div data-creates>${createsHtml(ctx, d, d.board)}</div></section>
  </form>`;
  const footer = `<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="submit" form="${fid}" class="btn btn--primary">${icon('play')}Start run</button>`;
  ctx.openSheet({
    title: `Run ${pb.name}`, body: String(body), footer, detents: ['full'], wide: true, className: 'pbform-sheet',
    initialFocus: 'input:not([type=hidden]), textarea, select',
    onMount(panel, layer) {
      const form = panel.querySelector('form');
      const boardSel = form.querySelector('[name="__board"]');
      const creates = form.querySelector('[data-creates]');
      const proj = form.querySelector('[data-project]');
      boardSel.addEventListener('change', () => { creates.innerHTML = String(createsHtml(ctx, d, boardSel.value)); });
      proj?.addEventListener('change', () => {
        const o = proj.selectedOptions[0];
        form.querySelector('[data-repo-path]').textContent = o.dataset.repo;
        boardSel.value = o.dataset.board; creates.innerHTML = String(createsHtml(ctx, d, boardSel.value));
      });
      form.addEventListener('input', (e) => {
        const f = e.target;
        if (f.getAttribute('aria-invalid') === 'true' && f.value.trim()) { f.removeAttribute('aria-invalid'); form.querySelector(`#${f.id}-err`).hidden = true; }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bad = [];
        const values = {};
        d.inputs.forEach((inp) => {
          const f = form.elements[inp.key];
          const v = f.value.trim();
          values[inp.key] = v;
          const invalid = (inp.required && !v) || (f.type === 'number' && v && !f.checkValidity()) || (f.type === 'url' && v && !f.checkValidity());
          f.toggleAttribute('aria-invalid', invalid);
          if (invalid) f.setAttribute('aria-invalid', 'true');
          const err = form.querySelector(`#${f.id}-err`);
          if (err) { err.hidden = !invalid; err.querySelector('span').textContent = inp.required && !v ? `${inp.label} is required` : `Enter a valid ${inp.label.toLowerCase()}`; }
          if (invalid) bad.push(f);
        });
        if (bad.length) { bad[0].focus(); return; }
        const run = createRun(ctx, d, values, boardSel.value);
        layer.close();
        await overlaysSettled();
        ctx.navigate(runPath(run));
        ctx.toast(`Started ${pb.name}`, { detail: `${d.stages.length} ${d.stages.length === 1 ? 'task' : 'tasks'} · root ${run.rootTaskId} · ${boardName(ctx, run.board)}` });
      });
    },
  });
}
function createRun(ctx, d, values, board) {
  const root = nextTaskId();
  const titleSrc = values.goal || values.question || values.report || values.pr || values.package || values.unit || values[d.inputs[0]?.key] || d.pb.name;
  const first = d.stages[0];
  const run = {
    id: `pr_${root.slice(2)}`, rootTaskId: root, playbook: d.pb.id, version: d.pb.version, title: titleSrc.length > 60 ? titleSrc.slice(0, 57) + '…' : titleSrc,
    profile: first.assignee === 'you' ? ctx.profile.name : first.assignee, started: Date.now(), state: 'running', cost: 0, board, inputs: values,
    stages: d.stages.map((s, i) => ({ key: s.key, state: i === 0 ? 'running' : 'queued', attempt: i === 0 ? 1 : 0, taskId: i === 0 ? root : null, started: i === 0 ? Date.now() : null })),
  };
  createdRuns.unshift(run);
  return run;
}
function openRunPicker(ctx) {
  const pbs = allPlaybooks(ctx);
  ctx.openSheet({
    title: 'Run a playbook', detents: ['half', 'full'],
    body: String(html`<ul class="plist plain" aria-label="Playbooks and templates">${pbs.map((pb) => html`<li><button type="button" class="plist__row" data-pick="${pb.id}">
      <span class="pb-kicon" data-kind="${isTemplate(pb) ? 'task' : 'group'}" aria-hidden="true">${icon(isTemplate(pb) ? 'file' : 'playbook')}</span>
      <span class="plist__main"><span class="plist__name">${pb.name}${isTemplate(pb) ? html`<span class="tag" data-tone="accent">Template</span>` : ''}</span><span class="plist__sub">${pb.stages.length} ${pb.stages.length === 1 ? 'stage' : 'stages'} · ${pb.category} · ${pb.inputs.length} ${pb.inputs.length === 1 ? 'input' : 'inputs'}</span></span>
      <span></span>${icon('chev-r')}</button></li>`)}</ul>`),
    onMount(panel, layer) {
      panel.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
        layer.close();
        await overlaysSettled();
        openRunForm(ctx, findPb(ctx, b.dataset.pick));
      }));
    },
  });
}

/* ==========================================================================
   Run view
   ========================================================================== */
function gateCard(ctx, d, run, g) {
  const st = rstage(run, g.key);
  const gi = GATE_INPUT[`${run.id}:${g.key}`];
  const from = d.byKey[gi?.from] || d.byKey[inEdges(d, g.key).find((e) => !e.back)?.from];
  const fromSt = from && rstage(run, from.key);
  const rej = outEdges(d, g.key).find((e) => e.cond === 'on_reject');
  const appr = outEdges(d, g.key).find((e) => e.cond === 'on_approve');
  const target = rej && d.byKey[rej.to];
  const tSt = target && rstage(run, target.key);
  const nextAttempt = (tSt?.attempt || 0) + 1;
  const exhausted = rej && nextAttempt > rej.max;
  const since = stageStarted(run, st) || run.started;
  return html`<section class="approval pbgate" role="alertdialog" aria-labelledby="pbgate-h" aria-describedby="pbgate-d">
    <div class="approval__head">${statusBadge('waiting', { label: 'Gate waiting for you', detail: fmtAgo(since) })}
      <span class="pbgate__where subtle">Stage ${g.index + 1} of ${d.stages.length}</span>
      ${st.taskId ? html`<a class="mono pbgate__task" href="${ctx.href('/work/tasks/' + st.taskId)}" aria-label="Kanban task ${st.taskId}">${st.taskId}</a>` : ''}</div>
    <h2 id="pbgate-h" class="pbgate__title">${icon('flag')}${g.title}</h2>
    <div id="pbgate-d" class="pbgate__out">
      ${from ? html`<p class="pbgate__from"><span class="overline">Output of ${from.title}</span>${fromSt?.taskId ? html`<a class="mono pb-tid" href="${ctx.href('/work/tasks/' + fromSt.taskId)}">${fromSt.taskId}</a>` : ''}${fromSt?.attempt ? html`<span class="subtle">attempt ${fromSt.attempt}</span>` : ''}</p>` : ''}
      ${gi ? html`<ul class="pbgate__bullets">${gi.bullets.map((b) => html`<li>${b}</li>`)}</ul>
        <div class="pbgate__files" role="list" aria-label="Attachments">${gi.files.map((f) => html`<a role="listitem" class="chip" href="${ctx.href('/workspace/artifacts')}">${icon(f.endsWith('.png') ? 'eye' : 'file', 'i-sm')}${f}</a>`)}</div>`
        : html`<p>${stageSummary(run, fromSt || st) || 'Output attached to the previous stage’s task.'}</p>`}
    </div>
    <div class="field pbgate__note">
      <label class="field__label" for="pbgate-note">Note ${rej ? html`<span class="subtle">(required to reject)</span>` : html`<span class="subtle">(optional)</span>`}</label>
      <textarea id="pbgate-note" class="input" rows="3" placeholder="${rej ? `What should ${target.title} change?` : 'Comment for the record'}" aria-describedby="pbgate-feed pbgate-err"></textarea>
      <p class="field__error" id="pbgate-err" hidden>${icon('alert', 'i-sm')}Add a note: it becomes the rework brief.</p>
      ${rej ? html`<p class="pbgate__feed" id="pbgate-feed">${icon('arrow-r', 'i-sm')}<span>On <strong>Reject</strong>, this note is posted as a comment on <span class="mono">${st.taskId || 'the gate task'}</span> and <strong>inlined into the brief of ${target.title} · attempt ${Math.min(nextAttempt, rej.max)} of ${rej.max}</strong>, a new Kanban task. ${exhausted ? html`<strong class="pbgate__warn">${target.title} has used all ${rej.max} attempts: rejecting fails the run.</strong>` : ''}</span></p>` : html`<p class="field__help" id="pbgate-feed">Posted as a comment on the gate task.</p>`}
      ${rej ? html`<details class="pbgate__preview"><summary>${icon('chev-r', 'i-sm chev')}Preview the rework brief</summary><div class="code"><div class="code__head">${icon('file', 'i-sm')}<span class="grow">${target.key} · attempt ${Math.min(nextAttempt, rej.max)} · brief.md</span></div><pre data-rework>${briefHtml(target.brief)}${'\n\n'}<span class="pb-var">## Reviewer note (from ${g.title})</span>${'\n'}<span data-note-echo class="subtle">Your note appears here.</span></pre></div></details>` : ''}
    </div>
    <div class="approval__actions">
      <button type="button" class="btn btn--primary" data-approve="${g.key}">${icon('check')}Approve</button>
      ${rej ? html`<button type="button" class="btn btn--danger-quiet" data-reject="${g.key}">${icon('refresh')}Reject + send note</button>` : ''}
      ${st.taskId ? html`<a class="btn btn--ghost" href="${ctx.href('/work/tasks/' + st.taskId)}">Open task</a>` : ''}
    </div>
    <p class="pbgate__then subtle">${appr ? html`Approve → <strong>${d.byKey[appr.to].title}</strong> starts as a new task for ${profileTag(d.byKey[appr.to].assignee)}.` : 'Approve → the run completes.'} Also in <a href="${ctx.href('/inbox')}">Inbox</a>.</p>
  </section>`;
}
function stageDetailLine(ctx, run, s, st) {
  const started = stageStarted(run, st);
  if (st.state === 'running' && started) return html`<span class="mono pbtl__el" data-elapsed="${started}" aria-label="Elapsed">${fmtDur((Date.now() - started) / 1000)}</span>`;
  if (st.state === 'waiting') return html`<span class="mono">${started ? fmtAgo(started) : ''}</span>`;
  if (st.duration) return html`<span class="mono">${fmtDur(st.duration)}</span>`;
  return '';
}
function taskLink(ctx, st, prevText) {
  if (st.taskId) return html`<a class="mono pb-tid" href="${ctx.href('/work/tasks/' + st.taskId)}" aria-label="Kanban task ${st.taskId}">${st.taskId}</a>`;
  return html`<span class="subtle pb-tid">${prevText}</span>`;
}
function notesHtml(run, key) {
  const ns = ui.notes[run.id]?.[key] || [];
  return ns.map((n) => html`<blockquote class="pbnote">${icon('chat', 'i-sm')}<div><p class="overline">${n.comment ? 'Your comment' : `Reviewer note · ${n.from}`}</p><p>${n.text}</p><p class="pbnote__where">${n.comment ? html`Posted on <span class="mono">${n.taskId}</span>` : html`Inlined into the brief of <span class="mono">${n.taskId}</span>`}</p></div></blockquote>`);
}
function timelineHtml(ctx, d, run) {
  return html`<ol class="timeline pbtl">${d.stages.map((s) => {
    const st = rstage(run, s.key);
    const prev = inEdges(d, s.key).find((e) => !e.back);
    const summary = st.state !== 'queued' ? stageSummary(run, st) : '';
    const lad = LADDER[st.state] || LADDER.queued;
    return html`<li class="step pbtl__step" data-state="${st.state}">
      <span class="step__icon" data-tone="${TONE[st.state]}" aria-hidden="true">${icon(lad.glyph, lad.spin ? 'spin' : '')}</span>
      <div class="step__body">
        <div class="step__head">
          <button type="button" class="pbtl__title" data-open-stage="${s.key}" aria-haspopup="dialog"><span class="pbl__num mono">${s.index + 1}</span>${s.title}</button>
          ${statusBadge(st.state, { variant: st.state === 'waiting' ? 'attn' : 'plain', label: STATE_LABEL[st.state] })}${attemptTag(s, st)}${gateTag(s)}
          <span class="step__time">${stageDetailLine(ctx, run, s, st)}</span>
        </div>
        <div class="pbtl__meta">${profileTag(s.assignee)}<span>${KIND[s.kind].label}${s.group ? ' · parallel' : ''}</span>${taskLink(ctx, st, prev ? `created when ${d.byKey[prev.from].title} is done` : 'not created')}</div>
        ${summary ? html`<p class="pbtl__sum">${summary}</p>` : ''}
        ${notesHtml(run, s.key)}
      </div>
    </li>`;
  })}</ol>`;
}
function compactHtml(ctx, d, run) {
  return html`<ol class="pbcmp plain">${d.stages.map((s) => {
    const st = rstage(run, s.key);
    const lad = LADDER[st.state] || LADDER.queued;
    return html`<li><button type="button" class="pbcmp__cell" data-open-stage="${s.key}" data-tone="${TONE[st.state]}" data-state="${st.state}" aria-haspopup="dialog" aria-label="${nodeLabel(d, s, st)}">
      <span class="pbcmp__top"><span class="mono pbcmp__n">${s.index + 1}</span>${icon(lad.glyph, lad.spin ? 'spin' : 'i-sm')}${s.gate ? icon('flag', 'i-sm') : ''}</span>
      <span class="pbcmp__t">${s.title}</span>
      <span class="pbcmp__s mono">${st.taskId || (st.state === 'queued' ? 'not created' : '')}${st.attempt > 1 ? ` · ×${st.attempt}` : ''}</span>
    </button></li>`;
  })}</ol>`;
}
function rawLog(ctx, d, run) {
  const lines = [];
  const at = (ts) => new Date(ts).toTimeString().slice(0, 8);
  let t = run.started;
  const push = (ts, ev, id, rest) => lines.push(`${at(ts)}  ${ev.padEnd(15)} ${String(id || '—').padEnd(7)} ${rest}`);
  for (const s of d.stages) {
    const st = rstage(run, s.key);
    if (st.state === 'queued') continue;
    const started = stageStarted(run, st) || t;
    push(started, 'task.created', st.taskId, `workflow_template_id=${d.tag} current_step_key=${s.key} attempt=${st.attempt || 1}`);
    if (s.gate) push(started + 1000, 'task.status', st.taskId, `review assignee=you (inbox)`);
    else push(started + 4000, 'task.claimed', st.taskId, `by ${s.assignee} dispatcher=${run.board || d.board}`);
    (ui.notes[run.id]?.[s.key] || []).forEach((n) => push(started + 2000, 'comment.added', n.taskId, `reviewer note: ${n.text.slice(0, 60)}`));
    if (st.state === 'succeeded') {
      const end = started + (st.duration || 60) * 1000;
      push(end, 'task.done', st.taskId, s.gate ? 'approved' : `result: ${stageSummary(run, st).slice(0, 60) || 'ok'}`);
      outEdges(d, s.key).filter((e) => !e.back && rstage(run, e.to).state !== 'queued').forEach((e) => push(end + 500, 'route', st.taskId, `${e.cond} → ${e.to}`));
      t = end;
    } else if (st.state === 'failed') push(started + (st.duration || 60) * 1000, 'task.blocked', st.taskId, `gave_up attempt=${st.attempt} ${stageSummary(run, st).slice(0, 50)}`);
    else if (st.state === 'running') push(Date.now() - 20000, 'run.heartbeat', st.taskId, `turn ${getTask(st.taskId)?.runs?.at(-1)?.turn || 1}`);
  }
  return lines.join('\n');
}
function runAside(ctx, d, run) {
  const ins = run.inputs || RUN_INPUTS[run.id] || {};
  const tasks = d.stages.map((s) => ({ s, st: rstage(run, s.key) })).filter((x) => x.st.taskId);
  const created = tasks.length;
  return html`<section class="section" aria-labelledby="pbr-facts"><h2 class="section__title" id="pbr-facts">Run</h2>
      <dl class="kv panel panel--pad pbr__kv">
        <dt>Playbook</dt><dd><a href="${ctx.href('/work/playbooks/' + d.pb.id)}">${d.pb.name}</a> <span class="mono subtle">v${run.version}</span></dd>
        <dt>Root task</dt><dd><a class="mono" href="${ctx.href('/work/tasks/' + run.rootTaskId)}">${run.rootTaskId}</a></dd>
        <dt>Board</dt><dd>${boardName(ctx, run.board || RUN_BOARD[run.id] || d.board)}</dd>
        <dt>Profile</dt><dd>${profileTag(run.profile)}</dd>
        <dt>Started</dt><dd>${fmtTime(run.started)} <span class="subtle">· ${fmtAgo(run.started, { suffix: true })}</span></dd>
        <dt>Cost</dt><dd class="mono">${fmtMoney(run.cost)}</dd>
      </dl></section>
    <section class="section" aria-labelledby="pbr-inputs"><h2 class="section__title" id="pbr-inputs">Inputs</h2>
      <dl class="kv panel panel--pad pbr__kv">${d.inputs.filter((i) => ins[i.key] != null && ins[i.key] !== '').map((i) => html`<dt>${i.key}</dt><dd>${i.type === 'project' ? html`<span class="mono">${ctx.data.projects.find((p) => p.id === ins[i.key])?.repo || ins[i.key]}</span>` : ins[i.key]}</dd>`)}</dl></section>
    <section class="section" aria-labelledby="pbr-tasks"><h2 class="section__title" id="pbr-tasks">Kanban tasks <span class="subtle pbr__of">${created} of ${d.stages.length} created</span></h2>
      <ul class="list panel">${tasks.map(({ s, st }) => html`<li><a class="list-row pbr__task" href="${ctx.href('/work/tasks/' + st.taskId)}"><span class="mono">${st.taskId}</span><span class="list-row__main"><span class="list-row__title">${s.title}</span></span>${statusBadge(st.state, { variant: 'plain', label: STATE_LABEL[st.state] })}</a></li>`)}</ul></section>`;
}
function failedBanner(ctx, d, run, s) {
  const st = rstage(run, s.key);
  const loop = outEdges(d, s.key).find((e) => e.back);
  const from = loop ? d.byKey[loop.to] : s;
  return html`<div class="banner" data-tone="danger">${icon('failed')}
    <div class="banner__content"><div class="banner__title">${s.title} failed${st.attempt ? ` after ${st.attempt} ${st.attempt === 1 ? 'attempt' : 'attempts'}` : ''}</div>
      <div class="banner__body">${(stageSummary(run, st) || 'The stage’s task gave up').replace(/([^.!?])$/, '$1.')} The run stopped${s.index < d.stages.length - 1 ? `; the ${d.stages.length - s.index - 1} later stages were not created` : ''}.</div>
      <div class="banner__actions"><button type="button" class="btn btn--secondary btn--sm" data-rerun-from="${from.key}">${icon('refresh')}Re-run from ${from.title}…</button>${st.taskId ? html`<a class="btn btn--ghost btn--sm" href="${ctx.href('/work/tasks/' + st.taskId)}">Open task ${st.taskId}</a>` : ''}</div></div><span></span></div>`;
}
function renderRun(ctx, pb, run) {
  const d = def(pb);
  const done = doneCount(d, run);
  const cur = currentStage(d, run);
  const gate = d.stages.find((s) => rstage(run, s.key).state === 'waiting');
  const views = [['timeline', 'Timeline', 'rows'], ['compact', 'Compact', 'tasks'], ['raw', 'Raw', 'code']];
  if (wideGraph() && !isTemplate(pb)) views.push(['graph', 'Graph', 'playbook']);
  let view = hashQuery().get('view') || 'timeline';
  if (!views.some(([v]) => v === view)) view = 'timeline';
  const created = d.stages.filter((s) => rstage(run, s.key).taskId).length;
  const tag = d.tag.replace(/@\d+$/, `@${run.version}`);
  const live = isActive(run);
  return html`<div class="pbr-page">
    ${pageHeader({
      overline: html`<a href="${ctx.href('/work/playbooks/' + pb.id)}">${pb.name}</a> · v${run.version} · Playbook run`,
      title: run.title,
      subtitle: html`${statusBadge(run.state)} <span>${done} of ${d.stages.length} stages done${cur ? html` · ${cur.title}` : ''}</span>`,
      actions: html`<button type="button" class="btn btn--secondary" data-rerun>${icon('refresh')}Re-run from stage…</button>`,
    })}
    <p class="pbr__kanban">${icon('tasks', 'i-sm')}<span>This run <strong>is ${d.stages.length} Hermes Kanban ${d.stages.length === 1 ? 'task' : 'tasks'}</strong> (${created} created so far), tagged <code>workflow_template_id=${tag}</code>. Root task <a class="mono" href="${ctx.href('/work/tasks/' + run.rootTaskId)}">${run.rootTaskId}</a> · <a href="${ctx.href(`/work/board/${run.board || RUN_BOARD[run.id] || d.board}?workflow_template_id=${tag}`)}">Show on Board</a></span></p>
    <div class="pbprog" aria-hidden="true">${d.stages.map((s) => html`<i data-tone="${TONE[rstage(run, s.key).state]}" class="${s.gate ? 'is-gate' : ''}"></i>`)}</div>
    <div class="pbr">
      <div class="pbr__main">
        ${gate ? gateCard(ctx, d, run, gate) : ''}
        ${run.state === 'failed' && cur ? failedBanner(ctx, d, run, cur) : ''}
        <section class="section" aria-labelledby="pbr-stages">
          <div class="section__head pbr__shead"><h2 class="section__title" id="pbr-stages">Stages ${live ? html`<span class="pbr__live"><span class="dot pulse" data-tone="running" aria-hidden="true"></span>Live</span>` : ''}</h2>
            <div class="seg" role="radiogroup" aria-label="Stage view">${views.map(([v, label, ic]) => html`<button type="button" role="radio" aria-checked="${String(v === view)}" data-rview="${v}">${icon(ic)}<span>${label}</span></button>`)}</div></div>
          ${view === 'timeline' ? html`<div class="panel panel--pad">${timelineHtml(ctx, d, run)}</div>`
            : view === 'compact' ? compactHtml(ctx, d, run)
            : view === 'raw' ? html`<pre class="log pbraw" role="log" aria-label="Kanban events for this run" tabindex="0">${rawLog(ctx, d, run)}</pre>`
            : graphHtml(d, { run, label: `${run.title}: stage graph with live states` })}
        </section>
      </div>
      <aside class="pbr__aside" aria-label="Run details">${runAside(ctx, d, run)}</aside>
    </div>
  </div>`;
}

function snapshot(ctx, run, gateTaskId) {
  const saved = JSON.stringify({ state: run.state, cost: run.cost, stages: run.stages, notes: ui.notes[run.id] || {} });
  const inbox = ctx.data.inbox.find((i) => i.playbookRun === run.id && i.kind === 'review');
  const task = gateTaskId && getTask(gateTaskId);
  const extra = [inbox, task].filter(Boolean).map((o) => [o, { ...o }]);
  const seq = taskSeq;
  return () => {
    const s = JSON.parse(saved);
    run.state = s.state; run.cost = s.cost; run.stages.splice(0, run.stages.length, ...s.stages); ui.notes[run.id] = s.notes;
    extra.forEach(([o, v]) => { Object.keys(o).forEach((k) => { if (!(k in v)) delete o[k]; }); Object.assign(o, v); });
    taskSeq = seq;
    ctx.refresh();
  };
}
function resolveGateInbox(ctx, run, taskId) {
  const inbox = ctx.data.inbox.find((i) => i.playbookRun === run.id && i.kind === 'review' && !i.resolved);
  if (inbox) inbox.resolved = true;
  const t = taskId && getTask(taskId);
  if (t) t.status = 'done';
}
function startStage(run, key) {
  const st = rstage(run, key);
  st.state = 'running'; st.attempt = (st.attempt || 0) + 1; st.taskId = nextTaskId(); st.started = Date.now(); st.duration = null;
  return st;
}
function approveGate(ctx, d, run, key, note) {
  const st = rstage(run, key);
  const undo = snapshot(ctx, run, st.taskId);
  const gateTask = st.taskId;
  st.state = 'succeeded'; st.duration = (Date.now() - (stageStarted(run, st) || run.started)) / 1000;
  if (note) ((ui.notes[run.id] ||= {})[key] ||= []).push({ comment: true, from: 'you', taskId: gateTask, text: note });
  const nexts = outEdges(d, key).filter((e) => e.cond === 'on_approve').map((e) => startStage(run, e.to));
  run.state = nexts.length ? 'running' : 'succeeded';
  resolveGateInbox(ctx, run, gateTask);
  ctx.refresh();
  const nx = nexts[0];
  ctx.toast(`Approved ${d.byKey[key].title}`, { detail: nx ? `${gateTask} → done · ${d.byKey[nx.key].title} started as ${nx.taskId}` : `${gateTask} → done · run complete`, undo });
}
function rejectGate(ctx, d, run, key, note) {
  const st = rstage(run, key);
  const rej = outEdges(d, key).find((e) => e.cond === 'on_reject');
  const gateTask = st.taskId;
  const undo = snapshot(ctx, run, gateTask);
  const target = rstage(run, rej.to);
  resolveGateInbox(ctx, run, gateTask);
  if ((target.attempt || 0) + 1 > rej.max) {
    st.state = 'failed'; run.state = 'failed';
    ctx.refresh();
    ctx.toast(`${d.byKey[rej.to].title} used all ${rej.max} attempts`, { tone: 'danger', detail: `Run failed · note posted on ${gateTask}`, undo });
    return;
  }
  st.state = 'queued'; st.taskId = null; st.started = null;
  const nt = startStage(run, rej.to);
  ((ui.notes[run.id] ||= {})[rej.to] ||= []).push({ from: d.byKey[key].title, taskId: nt.taskId, text: note });
  run.state = 'running';
  ctx.refresh();
  ctx.toast(`Sent back to ${d.byKey[rej.to].title}`, { tone: 'info', detail: `Note posted on ${gateTask} · inlined into ${nt.taskId} (attempt ${nt.attempt} of ${rej.max})`, undo });
}
async function rerunFrom(ctx, d, run, key) {
  const s = d.byKey[key];
  const st = rstage(run, key);
  const later = d.stages.length - s.index - 1;
  const ok = await ctx.openDialog({
    tier: 1, title: `Re-run from ${s.title}?`,
    body: `Creates a new Kanban task for <strong>${esc(s.title)}</strong> (attempt ${(st.attempt || 0) + 1})${later ? ` and re-creates the ${later} later ${later === 1 ? 'stage' : 'stages'} as their predecessors finish` : ''}. Results before it are kept${st.taskId ? `; <span class="mono">${esc(st.taskId)}</span> stays for history` : ''}. Run: <strong>${esc(run.title)}</strong>.`,
    profile: run.profile, confirmLabel: 'Re-run from here',
  });
  if (!ok) return;
  const gateSt = d.stages.map((x) => rstage(run, x.key)).find((x) => x.state === 'waiting');
  const undo = snapshot(ctx, run, gateSt?.taskId);
  if (gateSt && d.byKey[gateSt.key].index > s.index) {
    resolveGateInbox(ctx, run, null);
    const t = getTask(gateSt.taskId);
    if (t) t.status = 'archived';
  }
  d.stages.slice(s.index + 1).forEach((x) => { const y = rstage(run, x.key); if (y.state !== 'queued') { y.state = 'queued'; y.taskId = null; y.started = null; y.duration = null; } });
  const nt = startStage(run, key);
  run.state = 'running';
  ctx.refresh();
  ctx.toast(`Re-running from ${s.title}`, { detail: `${nt.taskId} · attempt ${nt.attempt}`, undo });
}
function openRerunPicker(ctx, d, run) {
  const eligible = d.stages.filter((s) => ['succeeded', 'failed', 'running', 'waiting'].includes(rstage(run, s.key).state));
  ctx.openSheet({
    title: 'Re-run from stage', detents: ['half', 'full'],
    body: String(html`<p class="muted">Pick where to restart. Later stages are re-created; earlier results are kept.</p>
      <div class="plist" role="radiogroup" aria-label="Stage">${d.stages.map((s) => {
        const st = rstage(run, s.key);
        const ok = eligible.includes(s);
        return html`<button type="button" class="plist__row" role="radio" aria-checked="false" data-pick="${s.key}" ${ok ? '' : raw('disabled')}>
          ${kindIcon(s)}<span class="plist__main"><span class="plist__name">${s.index + 1}. ${s.title}</span><span class="plist__sub">${STATE_LABEL[st.state]}${st.taskId ? ` · ${st.taskId}` : ''}${st.attempt > 1 ? ` · attempt ${st.attempt}` : ''}</span></span><span></span><span class="plist__check">${icon('check')}</span></button>`;
      })}</div>`),
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-go disabled>Continue…</button>',
    onMount(panel, layer) {
      let pick = null;
      const go = panel.querySelector('[data-go]');
      panel.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        pick = b.dataset.pick;
        panel.querySelectorAll('[data-pick]').forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.querySelector('.plist__check').style.visibility = x === b ? 'visible' : 'hidden'; });
        go.disabled = false;
      }));
      panel.querySelectorAll('.plist__check').forEach((c) => { c.style.visibility = 'hidden'; });
      go.addEventListener('click', async () => { layer.close(); await overlaysSettled(); rerunFrom(ctx, d, run, pick); });
    },
  });
}
function openRunStage(ctx, d, run, key) {
  const s = d.byKey[key];
  const st = rstage(run, key);
  const t = st.taskId && getTask(st.taskId);
  const lastRun = t?.runs?.at(-1);
  const started = stageStarted(run, st);
  const prev = inEdges(d, key).find((e) => !e.back);
  const body = String(html`<div class="pbsheet">
    <div class="row">${statusBadge(st.state, { label: STATE_LABEL[st.state], variant: st.state === 'waiting' ? 'attn' : '' })}${attemptTag(s, st)}${gateTag(s)}</div>
    <dl class="kv">
      <dt>Kanban task</dt><dd>${st.taskId ? html`<a class="mono" href="${ctx.href('/work/tasks/' + st.taskId)}">${st.taskId}</a>` : html`<span class="subtle">Not created yet${prev ? ` · created when ${d.byKey[prev.from].title} is done` : ''}</span>`}</dd>
      <dt>Assignee</dt><dd>${profileTag(s.assignee)}</dd>
      <dt>Kind</dt><dd>${KIND[s.kind].label}</dd>
      ${started ? html`<dt>Started</dt><dd>${fmtTime(started)} <span class="subtle">· ${fmtAgo(started, { suffix: true })}</span></dd>` : ''}
      ${st.state === 'running' && started ? html`<dt>Elapsed</dt><dd class="mono">${fmtDur((Date.now() - started) / 1000)}</dd>` : st.duration ? html`<dt>Duration</dt><dd class="mono">${fmtDur(st.duration)}</dd>` : ''}
      ${lastRun?.sessionId ? html`<dt>Transcript</dt><dd><a href="${ctx.href('/chat/' + lastRun.sessionId)}">Worker session <span class="mono">${lastRun.sessionId}</span></a></dd>` : ''}
    </dl>
    ${st.state !== 'queued' && stageSummary(run, st) ? html`<div class="pbsheet__out"><p class="overline">Output</p><p>${stageSummary(run, st)}</p></div>` : ''}
    ${notesHtml(run, key)}
    <details class="pbsheet__def"><summary>${icon('chev-r', 'i-sm chev')}Stage definition</summary>${inspectorHtml(d, s)}</details>
  </div>`);
  const canRerun = ['succeeded', 'failed', 'running', 'waiting'].includes(st.state);
  const footer = `${st.taskId ? `<a class="btn btn--secondary" href="${esc(ctx.href('/work/tasks/' + st.taskId))}">Open task ${esc(st.taskId)}</a>` : ''}${canRerun ? `<button type="button" class="btn btn--secondary" data-rerun-here>${icon('refresh')}Re-run from here…</button>` : ''}`;
  const opts = {
    title: `${s.index + 1}. ${s.title}`, body, footer,
    onMount(panel, layer) {
      panel.querySelector('[data-rerun-here]')?.addEventListener('click', async () => { layer.close(); await overlaysSettled(); rerunFrom(ctx, d, run, key); });
    },
  };
  if (ctx.size === 'compact') return ctx.openSheet({ ...opts, detents: ['half', 'full'] });
  return ctx.openSheet({ ...opts, wide: true });
}
function mountRun(root, ctx, pb, run) {
  const d = def(pb);
  root.querySelector('[data-rerun]').addEventListener('click', () => openRerunPicker(ctx, d, run));
  root.querySelectorAll('[data-rview]').forEach((b) => b.addEventListener('click', () => {
    if (b.getAttribute('aria-checked') === 'true') return;
    setHashQuery('view', b.dataset.rview === 'timeline' ? '' : b.dataset.rview);
    ui.focus = `[data-rview="${b.dataset.rview}"]`;
    ctx.refresh();
  }));
  const note = root.querySelector('#pbgate-note');
  const echo = root.querySelector('[data-note-echo]');
  note?.addEventListener('input', () => {
    if (echo) { echo.textContent = note.value.trim() || 'Your note appears here.'; echo.classList.toggle('subtle', !note.value.trim()); }
    if (note.value.trim()) { note.removeAttribute('aria-invalid'); root.querySelector('#pbgate-err').hidden = true; }
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.rerunFrom) rerunFrom(ctx, d, run, t.dataset.rerunFrom);
    else if (t.dataset.approve) approveGate(ctx, d, run, t.dataset.approve, note?.value.trim());
    else if (t.dataset.reject) {
      const v = note.value.trim();
      if (!v) {
        note.setAttribute('aria-invalid', 'true');
        root.querySelector('#pbgate-err').hidden = false;
        note.focus();
        return;
      }
      rejectGate(ctx, d, run, t.dataset.reject, v);
    } else if (t.dataset.openStage || (t.dataset.stage && t.closest('[data-graph]'))) openRunStage(ctx, d, run, t.dataset.openStage || t.dataset.stage);
  });
  const g = mountGraph(root, d, run);
  return () => g?.();
}

/* ==========================================================================
   Module
   ========================================================================== */
function resolveRoute(ctx) {
  const { id, rootTaskId } = ctx.params;
  const pb = id ? findPb(ctx, id) : null;
  const run = rootTaskId ? allRuns(ctx).find((r) => r.rootTaskId === rootTaskId && r.playbook === id) : null;
  return { id, rootTaskId, pb, run };
}
function notFound(ctx, what, idv) {
  return html`${pageHeader({ title: `${what} not found` })}${emptyState({ icon: 'playbook', title: `No ${what.toLowerCase()} “${idv}”`, body: 'It may have been renamed, or its run belongs to another playbook.', action: html`<a class="btn btn--secondary" href="${ctx.href('/work/playbooks')}">Back to Playbooks</a>` })}`;
}

export default {
  routes: ['/work/playbooks', '/work/playbooks/:id', '/work/playbooks/:id/runs/:rootTaskId'],
  group: 'work',
  title(ctx) {
    const { id, rootTaskId, pb, run } = resolveRoute(ctx);
    if (rootTaskId) return run ? run.title : 'Run not found';
    if (id) return pb ? pb.name : 'Playbook not found';
    return 'Playbooks';
  },
  render(ctx) {
    const { id, rootTaskId, pb, run } = resolveRoute(ctx);
    if (!id) return renderLibrary(ctx);
    if (!pb) return notFound(ctx, 'Playbook', id);
    if (rootTaskId) return run ? renderRun(ctx, pb, run) : notFound(ctx, 'Run', rootTaskId);
    return renderDetail(ctx, pb);
  },
  mount(root, ctx) {
    const { id, rootTaskId, pb, run } = resolveRoute(ctx);
    const cleanups = [];
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-run], [data-run-picker]');
      if (!b) return;
      if (b.hasAttribute('data-run-picker')) openRunPicker(ctx); else openRunForm(ctx, findPb(ctx, b.dataset.run));
    });
    if (!id) mountLibrary(root, ctx);
    else if (pb && !rootTaskId) {
      cleanups.push(mountDetail(root, ctx, pb));
      if (ctx.size === 'compact') ctx.setAppBar({ actions: [{ icon: 'play', label: `Run ${pb.name}`, onClick: () => openRunForm(ctx, pb) }] });
    } else if (pb && run) cleanups.push(mountRun(root, ctx, pb, run));
    if (ui.focus) {
      const sel = ui.focus; ui.focus = null;
      requestAnimationFrame(() => root.querySelector(sel)?.focus({ preventScroll: true }));
    }
    const mq = matchMedia('(min-width: 1024px)');
    const onMq = () => ctx.refresh();
    mq.addEventListener('change', onMq);
    const tick = setInterval(() => {
      root.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); });
    }, 1000);
    return () => { clearInterval(tick); mq.removeEventListener('change', onMq); cleanups.forEach((c) => c?.()); };
  },
  paletteActions(ctx) {
    const { pb, run } = resolveRoute(ctx);
    const active = allRuns(ctx).filter(isActive).length;
    const acts = [
      { label: 'Run playbook…', icon: 'play', sub: 'Pick a playbook or template, then fill its inputs', run: () => openRunPicker(ctx) },
      { label: 'Open running playbooks', icon: 'playbook', sub: `${active} active ${active === 1 ? 'run' : 'runs'}`, run: () => ctx.navigate('/work/playbooks?focus=runs') },
    ];
    if (pb && !run) acts.unshift({ label: `Run ${pb.name}…`, icon: 'play', sub: `${pb.stages.length} stages · ${pb.inputs.length} inputs`, run: () => openRunForm(ctx, pb) });
    if (pb && run) acts.unshift({ label: 'Re-run from stage…', icon: 'refresh', sub: `${run.title} · Tier 1`, run: () => openRerunPicker(ctx, def(pb), run) });
    return acts;
  },
};
