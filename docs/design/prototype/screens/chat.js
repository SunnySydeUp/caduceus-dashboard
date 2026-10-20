// Chat (IA §4, mobile §3–§5, §9): sessions pane · transcript (role=log) · approval / clarify cards ·
// composer (chips, config ring, busy split control, queue, slash menu) · context panel · terminal mode.
// PROTOTYPE: mock data only. Module state (`st`) survives re-renders and navigation until reload.
import {
  html, raw, esc, icon, statusBadge, avatar, profileTag, emptyState, kbd,
  fmtAgo, fmtDur, fmtMoney, fmtTokens, fmtTime, fmtWhen, ago, NOW, SOURCES, getSession, getProfile, getInboxItem, inScope,
  overlaysSettled,
} from '../shared.js';

// Screen stylesheet, injected once. `cssReady` lets mount() measure after the first load.
const cssReady = new Promise((resolve) => {
  const existing = document.getElementById('cx-css');
  if (existing) { resolve(); return; }
  const link = Object.assign(document.createElement('link'), { id: 'cx-css', rel: 'stylesheet', href: new URL('./chat.css', import.meta.url).href });
  link.addEventListener('load', resolve, { once: true });
  link.addEventListener('error', resolve, { once: true });
  document.head.append(link);
});

/* ==========================================================================
   Constants and screen-local mock data (extends `data`, never edits it)
   ========================================================================== */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const codeify = (s) => raw(esc(s).replace(/`([^`]+)`/g, '<code>$1</code>'));
const SRC_ORDER = ['caduceus', 'cli', 'telegram', 'discord', 'cron', 'kanban', 'claude-code'];
const SRC_SHORT = { kanban: 'Kanban' };
const MODES = [{ id: 'worklog', label: 'Worklog' }, { id: 'stream', label: 'Stream' }, { id: 'final', label: 'Final only' }];
const REASONING = ['Low', 'Medium', 'High', 'Max'];
const TOOLSETS = [
  { id: 'terminal', label: 'Terminal', sub: 'Shell commands, approval-gated' },
  { id: 'file', label: 'Files', sub: 'Read, search and patch' },
  { id: 'web', label: 'Web', sub: 'Search and fetch' },
  { id: 'browser', label: 'Browser', sub: 'Headless Chromium' },
  { id: 'memory', label: 'Memory', sub: 'MEMORY.md and USER.md' },
  { id: 'delegate', label: 'Subagents', sub: 'delegate_task' },
  { id: 'mcp-github', label: 'GitHub (MCP)', sub: 'Issues, PRs and checks' },
];
const PROMPTS = [
  { name: 'PR review checklist', text: 'Review the diff on this branch against our checklist: tests, error handling, logging and docs. List blocking issues first.' },
  { name: 'Changelog entry', text: 'Summarise what changed in this session as a changelog entry with Added / Changed / Fixed sections.' },
  { name: 'Research brief', text: 'Write a one-page research brief with 5–8 cited sources, a comparison table and a recommendation.' },
  { name: 'Daily standup', text: 'From my Kanban board and yesterday’s sessions, draft a standup: done, doing, blocked.' },
];
const SUGGEST = [
  { icon: 'git', title: 'Review my open PRs', sub: 'caduceus-dashboard · 2 open', text: 'Review my open pull requests on caduceus-dashboard and tell me which one to merge first.' },
  { icon: 'inbox', title: 'What needs me today?', sub: 'Inbox, board and schedules', text: 'Summarise what needs my attention today across the Inbox, the board and today’s schedules.' },
  { icon: 'book', title: 'Draft a research brief', sub: 'Uses the Research brief prompt', text: PROMPTS[2].text },
  { icon: 'calendar', title: 'Plan this week’s meals', sub: 'general · Telegram delivery', text: 'Plan dinners for this week around what is already in the pantry and send the list to Telegram.' },
];
const BUSY = {
  steer: { label: 'Steer', icon: 'steer', sub: 'Inject guidance at the next step' },
  queue: { label: 'Queue', icon: 'queued', sub: 'Send after this turn finishes' },
  interrupt: { label: 'Interrupt and send', icon: 'bolt', sub: 'Stop this turn, then send' },
};
const CTX_TABS = [{ id: 'files', label: 'Files' }, { id: 'artifacts', label: 'Artifacts' }, { id: 'todo', label: 'Todo' }, { id: 'run', label: 'Run' }, { id: 'preview', label: 'Preview' }];
const SLASH = [
  { cmd: '/model', desc: 'Switch the model for this chat' },
  { cmd: '/reasoning', desc: 'Set reasoning effort' },
  { cmd: '/prompts', desc: 'Insert a saved prompt' },
  { cmd: '/compress', desc: 'Summarise older turns to free context' },
  { cmd: '/goal', desc: 'Set a goal the agent works towards', args: true },
  { cmd: '/fork', desc: 'Fork this chat into a new session' },
  { cmd: '/usage', desc: 'Tokens, cost and cache for this chat' },
  { cmd: '/skills', desc: 'Load a skill into context', args: true },
  { cmd: '/new', desc: 'Start a new chat' },
];

// Extra transcripts for sessions the shared data only summarises.
const LOCAL_TRANSCRIPTS = {
  s_3b91d0: [
    { type: 'user', at: ago(41), text: 'Draft the related-work section for the RAG evaluation survey. Cover RAGAS, ARES and the 2025–26 benchmark papers, about 600 words with citations.' },
    { type: 'reasoning', at: ago(40.7), seconds: 7, text: 'Three clusters: reference-free metrics (RAGAS, ARES), benchmark suites, and human-judgement studies. Check the reading list first, then search for 2026 work.' },
    { type: 'tool', at: ago(40), name: 'search_files', args: '"RAG eval" ~/notes/reading', status: 'succeeded', duration: 0.2, output: 'reading/rag/ragas.md\nreading/rag/ares-2024.md\nreading/rag/benchmarks.md' },
    { type: 'tool', at: ago(38), name: 'web_search', args: 'retrieval-augmented generation evaluation benchmark 2026', status: 'succeeded', duration: 2.8, output: '1. CRAG-2: a comprehensive RAG benchmark (2026)\n2. Judging the judges: LLM evaluators for RAG (2025)\n3. RAGChecker: fine-grained diagnosis (2024)\n… 11 more' },
    { type: 'tool', at: ago(30), name: 'read_url', args: 'arxiv.org/abs/2601.04417', status: 'succeeded', duration: 1.9, output: 'CRAG-2 · 4,409 QA pairs · 5 domains · dynamic facts' },
    { type: 'assistant', at: ago(6), profile: 'librarian', model: 'deepseek-v4.1', blocks: [{ p: 'I have 14 candidate papers in three clusters: reference-free metrics, benchmark suites and human-judgement studies. The outline is ready and the first two paragraphs are drafted.' }] },
    { type: 'clarify', at: ago(5), id: 'clar_3b91', inboxId: 'in_clarify', question: 'Which citation style should the brief use?', detail: 'The reading list mixes styles, so I paused before formatting 14 references.', choices: ['APA 7', 'Chicago author-date', 'IEEE', 'Plain links'], countdown: 600, fallback: 'APA 7' },
  ],
  s_c47e22: [
    { type: 'user', at: ago(4), via: 'telegram', text: 'Summarise the council planning docs for 14 Elm St. Flag anything about height, parking or heritage.' },
    { type: 'tool', at: ago(3.8), name: 'download', args: 'eplanning · DA-2026/0412 (7 PDFs)', status: 'succeeded', duration: 6.2, output: 'Saved 7 files to ~/Documents/property/14-elm/da-2026-0412/' },
    { type: 'tool', at: ago(3), name: 'read_pdf', args: '01-statement-of-environmental-effects.pdf', status: 'succeeded', duration: 14.1, output: '42 pages · 11,840 words extracted' },
    { type: 'tool', at: ago(2), name: 'read_pdf', args: '02-architectural-plans.pdf', status: 'succeeded', duration: 9.4, output: '18 sheets · height plane diagram on A-301' },
    { type: 'tool', at: ago(0.5), name: 'read_pdf', args: '03-traffic-and-parking.pdf', status: 'running', startedAt: ago(0.5) },
  ],
};

const CTX_8F2C = {
  branch: 'feat/x',
  files: [
    { path: 'src/webhooks/dispatch.ts', state: 'Modified', add: 6, rem: 2 },
    { path: 'src/webhooks/backoff.ts', state: 'Added', add: 4, rem: 0 },
    { path: 'src/webhooks/dispatch.test.ts', state: 'Modified', add: 3, rem: 1 },
    { path: 'src/config/schema.ts', state: 'Read' },
  ],
  artifacts: [
    { icon: 'git', title: 'Commit 3e9a1c7', sub: 'feat(webhooks): exponential backoff with jitter', preview: 'commit' },
    { icon: 'log', title: 'Test run · 15 passed', sub: 'pnpm vitest run src/webhooks · 2.1 s', preview: 'tests' },
    { icon: 'file', title: 'backoff.ts', sub: 'New file · 4 lines', preview: 'src/webhooks/backoff.ts' },
  ],
};
const PREVIEW_TEXT = {
  'src/webhooks/dispatch.test.ts': { diff: { file: 'src/webhooks/dispatch.test.ts', add: 3, remove: 1, lines: [
    { t: 'ctx', ln: 41, text: '  it("retries with backoff", async () => {' },
    { t: 'rem', ln: 42, text: '    const d = makeDispatcher();' },
    { t: 'add', ln: 42, text: '    const d = makeDispatcher({ random: () => 0.5 });' },
    { t: 'add', ln: 43, text: '    // seeded: first wait is exactly 1000 ms' },
    { t: 'add', ln: 44, text: '    await vi.advanceTimersByTimeAsync(1000);' },
    { t: 'ctx', ln: 45, text: '    expect(deliver).toHaveBeenCalledTimes(2);' },
  ] } },
  'src/config/schema.ts': { log: '231  webhooks: z.object({\n232    max_attempts: z.number().default(5),\n233    retry_cap_s: z.number().default(60),\n234  }),' },
  commit: { log: 'commit 3e9a1c7 (HEAD -> feat/x)\nAuthor: coder (hermes) <coder@hermes.local>\n\n    feat(webhooks): exponential backoff with jitter\n\n src/webhooks/backoff.ts       | 4 ++++\n src/webhooks/dispatch.test.ts | 4 +++-\n src/webhooks/dispatch.ts      | 8 +++++---\n 3 files changed, 38 insertions(+), 4 deletions(-)' },
};

/* ==========================================================================
   Module state
   ========================================================================== */
const st = {
  sources: new Set(), project: null, q: '', cross: null, crossScope: null,
  mode: 'worklog', terminal: false, termVerified: false, ctxOpen: null, ctxTab: 'files', prevSrc: 'file', prevFile: 'src/webhooks/dispatch.ts',
  unread: new Set(['s_c47e22', 's_kw_1049', 's_3b91d0']),
  drafts: {}, extra: {}, runs: {}, queue: {}, decided: {}, cfg: {}, attach: {}, det: new Map(), deadline: {},
  autoSheet: new Set(), showArchived: false, paneScroll: 0, newN: 0, term: [],
};
let live = null; // { root, ctx, sid, s } for the mounted render
let pop = null; // open popover menu
let qid = 0;

/* ---- derived data ---- */
const byUpdated = (a, b) => b.updated - a.updated;
function genericTranscript(s) {
  const prompt = s.source === 'kanban' ? `Work on ${s.title.replace(/^kanban · /, '')}. Follow the task brief and report back.`
    : s.source === 'cron' ? `Scheduled run: ${s.title}` : s.title;
  const out = [{ type: 'user', at: s.started, text: prompt, via: s.source === 'caduceus' ? null : s.source }];
  if (s.id.startsWith('s_new_')) return [];
  out.push({ type: 'assistant', at: s.updated, profile: s.profile, model: s.model, streaming: !!(s.live && s.liveState === 'running'), blocks: [{ p: s.preview }] });
  return out;
}
function blocksFor(ctx, s) {
  const base = ctx.data.transcripts[s.id] || LOCAL_TRANSCRIPTS[s.id] || genericTranscript(s);
  return base.concat(st.extra[s.id] || []);
}
const extra = (sid) => (st.extra[sid] ||= []);
function runOf(s) {
  return (st.runs[s.id] ||= { busy: !!(s.live && (s.liveState === 'running' || s.liveState === 'waiting')), token: 0, stopped: false });
}
function pendingFor(ctx, s) {
  if (!runOf(s).busy) return null;
  const bl = blocksFor(ctx, s);
  for (let i = bl.length - 1; i >= 0; i--) {
    const b = bl[i];
    if ((b.type === 'approval' || b.type === 'clarify') && !st.decided[b.id]) return b;
  }
  return null;
}
function liveState(ctx, s) {
  const r = runOf(s);
  if (!r.busy) return null;
  return pendingFor(ctx, s) ? 'waiting' : 'running';
}
function cfgFor(ctx, s) {
  const key = s ? s.id : 'new';
  if (!st.cfg[key]) {
    const prof = s ? s.profile : (ctx.query.profile && getProfile(ctx.query.profile) ? ctx.query.profile : ctx.profile.name);
    const proj = s?.project ? ctx.data.projects.find((p) => p.id === s.project) : ctx.data.projects.find((p) => p.profile === prof);
    st.cfg[key] = {
      profile: prof, model: s ? s.model : getProfile(prof).model, reasoning: 'High',
      workspace: proj ? proj.repo : '~', toolsets: new Set(['terminal', 'file', 'web', 'memory', 'delegate', 'mcp-github']),
    };
  }
  return st.cfg[key];
}
function usageFor(ctx, s) {
  const c = cfgFor(ctx, s);
  const m = ctx.data.models.find((x) => x.id === c.model) || { context: 128_000 };
  const pct = s ? Math.max(1, Math.round((s.context || 0.02) * 100)) : 0;
  return { pct, used: Math.round((pct / 100) * m.context), window: m.context, cost: s ? s.cost : 0, cache: s ? (s.id === 's_8f2c1a' ? 72 : 58) : 0, tokens: s ? s.tokens : 0 };
}
function effScope(ctx) {
  if (st.crossScope !== ctx.scope) { st.cross = null; st.crossScope = ctx.scope; }
  return st.cross === null ? ctx.scope : st.cross ? 'all' : ctx.profile.name;
}
function visibleSessions(ctx) {
  const scope = effScope(ctx);
  return ctx.data.sessions.filter((s) => inScope(s.profile, scope)
    && (!st.sources.size || st.sources.has(s.source))
    && (!st.project || s.project === st.project));
}
function dateGroup(ts) {
  const now = new Date(NOW);
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= t0) return 'Today';
  if (ts >= t0 - 864e5) return 'Yesterday';
  if (ts >= t0 - 6 * 864e5) return 'Previous 7 days';
  return 'Older';
}

/* ---- text helpers ---- */
function hl(src) {
  const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|\b(export|function|const|let|return|await|async|import|from|if|for|new|throw|of)\b|\b(number|string|boolean|void)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : m[4] ? 't' : m[5] ? 'n' : 'f';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function markTerms(text, terms) {
  const re = new RegExp(`(${terms.map(reEsc).join('|')})`, 'gi');
  return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}
function corpus(ctx, s) {
  const out = [{ where: 'Title', text: s.title }, { where: 'Preview', text: s.preview }];
  for (const b of blocksFor(ctx, s)) {
    if (b.type === 'user') out.push({ where: 'You', text: b.text });
    else if (b.type === 'reasoning') out.push({ where: 'Reasoning', text: b.text });
    else if (b.type === 'tool') { out.push({ where: b.name, text: b.args }); if (b.output) out.push({ where: `${b.name} output`, text: b.output }); }
    else if (b.type === 'subagent') out.push({ where: 'Subagent', text: b.summary });
    else if (b.type === 'assistant') for (const x of b.blocks) {
      if (x.p) out.push({ where: b.profile, text: x.p });
      if (x.code) out.push({ where: x.code.file, text: x.code.text });
      if (x.table) out.push({ where: 'Table', text: x.table.rows.map((r) => r.join(' ')).join(' · ') });
    } else if (b.type === 'approval') out.push({ where: 'Approval', text: b.command });
  }
  return out;
}
function search(ctx, list) {
  const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const s of list) {
    const docs = corpus(ctx, s);
    const all = docs.map((d) => d.text.toLowerCase()).join('\n');
    if (!terms.every((t) => all.includes(t))) continue;
    const score = terms.reduce((n, t) => n + all.split(t).length - 1, 0);
    const doc = docs.find((d, i) => i > 0 && d.text.toLowerCase().includes(terms[0])) || docs[0];
    const flat = doc.text.replace(/`/g, '').replace(/\s+/g, ' ');
    const at = flat.toLowerCase().indexOf(terms[0]);
    const a = Math.max(0, at - 18), z = Math.min(flat.length, at + terms[0].length + 80);
    const snip = `${a ? '…' : ''}${flat.slice(a, z)}${z < flat.length ? '…' : ''}`;
    hits.push({ s, score, where: doc.where, snip: raw(markTerms(snip, terms)) });
  }
  return hits.sort((x, y) => y.score - x.score || y.s.updated - x.s.updated);
}

/* ==========================================================================
   Sessions pane
   ========================================================================== */
function rowHtml(ctx, s, { cur, hit, showProfile }) {
  const src = SOURCES[s.source] || { label: s.source, icon: 'chat' };
  const unread = st.unread.has(s.id);
  const state = liveState(ctx, s);
  const draft = st.drafts[s.id];
  const bits = [state === 'waiting' ? 'Live, waiting for you' : state === 'running' ? 'Live, running' : '', unread ? 'Unread' : '', s.pinned ? 'Pinned' : '', draft ? 'Has a draft' : ''].filter(Boolean).join(', ');
  return html`<li class="cx-row${unread ? ' is-unread' : ''}" data-sid="${s.id}">
    <span class="cx-row__under cx-row__under--start" aria-hidden="true">${icon('archive')}${s.archived ? 'Restore' : 'Archive'}</span>
    <span class="cx-row__under cx-row__under--end" aria-hidden="true">${s.pinned ? 'Unpin' : 'Pin'}${icon('pin')}</span>
    <div class="cx-row__fg">
      <a class="cx-row__link" href="${ctx.href('/chat/' + s.id)}" draggable="false" ${cur === s.id ? raw('aria-current="page"') : ''}>
        <span class="cx-row__icon" aria-hidden="true">${icon(src.icon)}${state ? html`<span class="dot${state === 'running' ? ' pulse' : ''}" data-tone="${state === 'waiting' ? 'warning' : 'running'}"></span>` : ''}</span>
        <span class="cx-row__main">
          <span class="cx-row__title">${s.title}</span>
          ${hit ? html`<span class="cx-row__sub cx-row__snip"><span class="cx-row__where mono">${hit.where}</span> ${hit.snip}</span>`
            : draft ? html`<span class="cx-row__sub"><span class="cx-row__draft">Draft:</span> ${draft}</span>`
            : html`<span class="cx-row__sub">${s.preview}</span>`}
          <span class="cx-row__meta">${state === 'waiting' ? statusBadge('waiting', { variant: 'plain' }) : ''}${showProfile ? profileTag(s.profile) : ''}<span>${src.label}</span>${s.project ? html`<span class="mono cx-row__proj">${s.project}</span>` : ''}</span>
        </span>
        <span class="cx-row__end"><span class="mono">${fmtAgo(s.updated)}</span><span class="cx-row__flags">${s.pinned ? icon('pin', 'i-sm') : ''}${unread ? html`<span class="cx-unread"></span>` : ''}</span></span>
        ${bits ? html`<span class="sr-only">. ${bits}</span>` : ''}
      </a>
      <button type="button" class="btn btn--ghost btn--icon btn--sm cx-row__more" data-act="row-menu" aria-haspopup="menu" aria-label="Actions for ${s.title}">${icon('dots-v')}</button>
    </div>
  </li>`;
}
function listInner(ctx) {
  const cur = ctx.params.id;
  const list = visibleSessions(ctx);
  const showProfile = effScope(ctx) === 'all';
  const H = ctx.path === '/chat' ? 'h2' : 'h3';
  const filtered = st.sources.size || st.project;
  if (st.q.trim()) {
    const hits = search(ctx, list);
    return html`<p class="cx-results">${hits.length} session${hits.length === 1 ? ' matches' : 's match'} “${st.q.trim()}”${filtered ? ' with filters' : ''}</p>
      ${hits.length ? html`<ul class="cx-rows">${hits.map((h) => rowHtml(ctx, h.s, { cur, hit: h, showProfile }))}</ul>`
        : emptyState({ icon: 'search', title: 'No matches', body: 'Search covers titles, messages, tool arguments and output in every session you can see.', action: filtered ? html`<button type="button" class="btn btn--secondary btn--sm" data-act="clear-filters">Clear filters</button>` : '' })}`;
  }
  const active = list.filter((s) => !s.archived);
  const archived = list.filter((s) => s.archived).sort(byUpdated);
  const groups = [];
  const pinned = active.filter((s) => s.pinned).sort(byUpdated);
  if (pinned.length) groups.push(['Pinned', pinned]);
  for (const s of active.filter((x) => !x.pinned).sort(byUpdated)) {
    const g = dateGroup(s.updated);
    let e = groups.find((x) => x[0] === g);
    if (!e) groups.push(e = [g, []]);
    e[1].push(s);
  }
  return html`${groups.length ? groups.map(([g, items], i) => html`<section class="cx-group" aria-labelledby="cx-g${i}">
      ${raw(`<${H} class="overline cx-group__h" id="cx-g${i}">`)}${g === 'Pinned' ? icon('pin', 'i-sm') : ''}${g}${raw(`</${H}>`)}
      <ul class="cx-rows">${items.map((s) => rowHtml(ctx, s, { cur, showProfile }))}</ul></section>`)
    : emptyState({ icon: 'chat', title: 'No sessions here', body: filtered ? 'Nothing matches these filters.' : 'Start a chat and it will show up here, along with CLI, Telegram, Discord, cron and Kanban sessions.', action: filtered ? html`<button type="button" class="btn btn--secondary btn--sm" data-act="clear-filters">Clear filters</button>` : html`<a class="btn btn--primary btn--sm" href="${ctx.href('/chat/new')}">${icon('plus')}New chat</a>` })}
    ${archived.length ? html`<details class="cx-arch" data-act="arch" ${st.showArchived ? raw('open') : ''}><summary>${icon('chev-r', 'i-sm chev')}${icon('archive', 'i-sm')}Archived <span class="mono">${archived.length}</span></summary>
      <ul class="cx-rows">${archived.map((s) => rowHtml(ctx, s, { cur, showProfile }))}</ul></details>` : ''}`;
}
function paneHtml(ctx, { h1 }) {
  const H = h1 ? 'h1' : 'h2';
  const scope = effScope(ctx);
  const all = scope === 'all';
  return html`<section class="cx-pane" aria-labelledby="cx-pane-h">
    <div class="cx-pane__head">
      ${raw(`<${H} id="cx-pane-h" tabindex="-1" class="cx-pane__title${h1 && ctx.size !== 'large' ? ' sr-only' : ''}">`)}${h1 ? 'Chat' : 'Sessions'}${raw(`</${H}>`)}
      ${ctx.size === 'large' ? html`<a class="btn btn--primary btn--sm" href="${ctx.href('/chat/new')}" aria-keyshortcuts="Meta+Shift+O Control+Shift+O">${icon('plus')}New chat</a>` : ''}
    </div>
    <div class="cx-pane__tools">
      <div class="input-wrap cx-search">${icon('search')}<input class="input" type="search" id="cx-q" placeholder="Search titles and messages" aria-label="Search sessions" value="${st.q}" autocomplete="off" spellcheck="false" data-act="q"></div>
      <div class="chips-scroll cx-filters" role="group" aria-label="Filter by source">
        ${SRC_ORDER.map((k) => html`<button type="button" class="chip" data-src="${k}" aria-pressed="${String(st.sources.has(k))}">${icon(SOURCES[k].icon)}${SRC_SHORT[k] || SOURCES[k].label}</button>`)}
      </div>
      <div class="chips-scroll cx-filters" role="group" aria-label="Filter by project">
        ${ctx.data.projects.map((p) => html`<button type="button" class="chip" data-proj="${p.id}" aria-pressed="${String(st.project === p.id)}">${icon('folder')}${p.name}</button>`)}
      </div>
      <div class="switch-row cx-cross">
        <span class="cx-cross__text" id="cx-cross-l"><span>All profiles</span><span class="subtle">${all ? 'Sessions from every profile' : `Only ${scope}`}</span></span>
        <button type="button" class="switch" role="switch" aria-checked="${String(all)}" aria-labelledby="cx-cross-l" data-act="cross"></button>
      </div>
    </div>
    <p class="sr-only" role="status" data-r="liststatus"></p>
    <div class="cx-pane__list" data-r="list">${listInner(ctx)}</div>
  </section>`;
}

/* ==========================================================================
   Transcript blocks
   ========================================================================== */
const TOOLST = {
  succeeded: { icon: 'succeeded', tone: 'success', label: 'Succeeded' },
  failed: { icon: 'failed', tone: 'danger', label: 'Failed' },
  running: { icon: 'running', tone: 'running', label: 'Running', spin: true },
  cancelled: { icon: 'cancelled', tone: 'neutral', label: 'Cancelled' },
};
const TODO_ST = {
  ...TOOLST,
  waiting: { icon: 'waiting', tone: 'warning', label: 'Waiting for you' },
  queued: { icon: 'queued', tone: 'neutral', label: 'Queued' },
};
/** Base (shared-data) blocks are immutable: a running one reads as cancelled once the run stopped or went idle. */
function baseStopped(s, b) { const r = runOf(s); return !b.live && (r.stoppedBase || !r.busy); }
function toolStatus(s, b) { return b.status === 'running' && baseStopped(s, b) ? 'cancelled' : b.status; }
function logPre(text, cls = '') {
  const lines = String(text).split('\n').map((l) => (/(×|✗|\bfailed\b|→ expected)/.test(l) ? `<span class="cx-err">${esc(l)}</span>` : esc(l)));
  return raw(`<pre class="log${cls ? ' ' + cls : ''}">${lines.join('\n')}</pre>`);
}
function diffHtml(d, { open = true } = {}) {
  return html`<div class="code cx-diff">
    <div class="code__head">${icon('file', 'i-sm')}<span class="grow truncate">${d.file}</span><span class="cx-plus" aria-label="${d.add} added">+${d.add}</span><span class="cx-minus" aria-label="${d.remove} removed">−${d.remove}</span>${open ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="preview" data-file="${d.file}">Open</button>` : ''}</div>
    <div class="diff">${d.lines.map((l) => html`<span class="${l.t === 'ctx' ? '' : l.t}"><span class="ln">${l.ln}</span><span class="sg">${l.t === 'add' ? '+' : l.t === 'rem' ? '−' : ' '}</span><span>${l.text}</span></span>`)}</div>
  </div>`;
}
function codeHtml(c) {
  return html`<div class="code cx-code"><div class="code__head">${icon('code', 'i-sm')}<span class="grow truncate">${c.file}</span><span>${c.lang}</span><button type="button" class="btn btn--ghost btn--sm" data-act="copy-code">${icon('copy', 'i-sm')}Copy</button></div><pre><code>${raw(hl(c.text))}</code></pre></div>`;
}
function tableHtml(t) {
  return html`<div class="cx-table" role="region" aria-label="Table" tabindex="0"><table><thead><tr>${t.head.map((x) => html`<th scope="col">${x}</th>`)}</tr></thead><tbody>${t.rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>`;
}
function msgActions(ctx, kind, i) {
  if (ctx.size !== 'large') return html`<div class="msg-actions cx-acts"><button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="msg-menu" data-bi="${i}" aria-haspopup="menu" aria-label="Message actions">${icon('dots-v')}</button></div>`;
  const b = (act, ic, label) => html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="${act}" data-bi="${i}" aria-label="${label}">${icon(ic)}</button>`;
  return html`<div class="msg-actions cx-acts">${b('m-copy', 'copy', 'Copy')}${kind === 'user' ? b('m-edit', 'draft', 'Edit') : ''}${b('m-fork', 'git', 'Fork from here')}${kind === 'agent' ? [b('m-regen', 'refresh', 'Regenerate'), b('m-read', 'broadcast', 'Read aloud')] : ''}</div>`;
}
function userHtml(ctx, s, b, i) {
  return html`<div class="cx-msg cx-msg--user" data-bi="${i}">
    <div class="msg-user">${codeify(b.text)}</div>
    ${b.attachments?.length ? html`<div class="cx-msg__att">${b.attachments.map((a) => html`<span class="tag">${icon('clip', 'i-sm')}${a}</span>`)}</div>` : ''}
    <div class="cx-msg__foot">${b.via ? html`<span class="srctag">${icon(SOURCES[b.via]?.icon || 'chat', 'i-sm')}via ${SOURCES[b.via]?.label || b.via}</span>` : ''}${b.note ? html`<span class="subtle">${b.note}</span>` : ''}<time class="mono subtle">${fmtTime(b.at)}</time>${msgActions(ctx, 'user', i)}</div>
  </div>`;
}
function agentHtml(ctx, s, b, i) {
  const streaming = b.streaming && !baseStopped(s, b);
  const stopped = b.stopped || (b.streaming && !streaming);
  return html`<div class="msg-agent cx-msg cx-msg--agent${streaming ? ' is-streaming' : ''}" data-bi="${i}">
    <div class="msg-agent__by">${avatar(b.profile, { size: 'sm' })}<span class="cx-by__name">${b.profile}</span><span class="mono">${b.model}</span><time class="mono">${fmtTime(b.at)}</time></div>
    <div class="cx-prose">${b.blocks.length ? b.blocks.map((x, k) => x.p ? html`<p>${codeify(x.p)}${streaming && k === b.blocks.length - 1 ? raw('<span class="cx-caret" aria-hidden="true"></span>') : ''}</p>` : x.table ? tableHtml(x.table) : x.code ? codeHtml(x.code) : '') : html`<p class="thinking">${icon('running', 'spin')}Thinking</p>`}</div>
    ${stopped ? html`<p class="cx-note">${icon('stop', 'i-sm')}Stopped by you. Partial output kept.</p>` : ''}
    ${streaming ? '' : msgActions(ctx, 'agent', i)}
  </div>`;
}
function detOpen(key, dflt) { return st.det.has(key) ? st.det.get(key) : dflt; }
function thinkHtml(s, b, i) {
  const key = `${s.id}:${i}`;
  return html`<details class="cx-think" data-det="${key}" ${detOpen(key, false) ? raw('open') : ''}><summary class="thinking">${icon('chev-r', 'i-sm chev')}Thought for ${b.seconds}s</summary><div class="cx-think__body">${codeify(b.text)}</div></details>`;
}
function toolHtml(s, b, i) {
  const status = toolStatus(s, b);
  const t = TOOLST[status];
  const key = `${s.id}:${i}`;
  const dur = status === 'failed' ? html`<span class="tool__dur cx-fail">${b.reason || 'failed'}</span>`
    : status === 'running' ? html`<span class="tool__dur" data-elapsed="${b.startedAt}">${fmtDur((Date.now() - b.startedAt) / 1000)}</span>`
    : status === 'cancelled' ? html`<span class="tool__dur">cancelled</span>`
    : html`<span class="tool__dur">${b.duration}s</span>`;
  return html`<details class="tool cx-tool${status === 'failed' ? ' tool--failed' : ''}" data-det="${key}" ${detOpen(key, status === 'failed') ? raw('open') : ''}>
    <summary>${icon('chev-r', 'i-sm chev')}<span class="cx-tst" data-tone="${t.tone}">${icon(t.icon, t.spin ? 'spin' : '')}<span class="sr-only">${t.label}: </span></span><span class="tool__name">${b.name}</span><span class="tool__args truncate">${b.args}</span>${dur}</summary>
    <div class="tool__body">${b.diff ? diffHtml(b.diff) : b.output ? logPre(b.output) : html`<p class="subtle cx-tool__wait">${status === 'running' ? 'Output streams here when the tool writes it.' : 'No output.'}</p>`}</div>
  </details>`;
}
function subHtml(s, b) {
  return html`<article class="cx-sub" aria-labelledby="cx-sub-${b.id}">
    <div class="cx-sub__top"><span class="cx-sub__icon" aria-hidden="true">${icon('subagent')}</span><span class="overline">Subagent · ${b.id}</span>${statusBadge(b.status, { detail: fmtDur(b.duration) })}</div>
    <h3 class="cx-sub__title" id="cx-sub-${b.id}">${b.title}</h3>
    <div class="cx-sub__meta">${profileTag(b.profile)}<span class="mono">${b.model}</span><span>${b.tools} tool calls</span><span class="mono">${fmtTokens(b.tokens)} tokens</span></div>
    <p class="cx-sub__sum">${codeify(b.summary)}</p>
    <div><button type="button" class="btn btn--secondary btn--sm" data-act="ctx-tab" data-tab="run">${icon('subagent')}View in Run panel</button></div>
  </article>`;
}
function eventHtml(ctx, s, b) {
  if (b.type === 'event') return html`<div class="cx-event" data-tone="${b.tone}">${icon(b.icon)}<span>${codeify(b.text)}</span><time class="mono">${fmtTime(b.at)}</time></div>`;
  const d = st.decided[b.id];
  const what = b.type === 'approval' ? html`<code>${b.command}</code>` : html`“${b.question}”`;
  if (d) return html`<div class="cx-event" data-tone="${d.tone}">${icon(d.tone === 'danger' ? 'failed' : d.tone === 'neutral' ? 'cancelled' : 'succeeded')}<span>${d.verb}: ${what}${d.reason ? html` · “${d.reason}”` : ''}</span><time class="mono">${fmtTime(d.at)}</time></div>`;
  return html`<div class="cx-event" data-tone="warning">${icon('waiting')}<span>${b.type === 'approval' ? html`Waiting for your approval to run ${what}` : html`Waiting for your answer: ${what}`}</span>${ctx.size === 'compact' ? '' : html`<button type="button" class="btn btn--ghost btn--sm" data-act="focus-card">Review</button>`}</div>`;
}
function streamHtml(s, b) {
  const t = fmtTime(b.at);
  if (b.type === 'reasoning') return html`<div class="cx-sline cx-sline--think"><span class="cx-sline__t">${t}</span><span class="cx-sline__g" aria-hidden="true">∴</span><span class="cx-sline__x"><span class="sr-only">Reasoning: </span>${codeify(b.text)}</span></div>`;
  if (b.type === 'subagent') return html`<div class="cx-sline" data-tone="success"><span class="cx-sline__t">${t}</span><span class="cx-sline__g">${icon('subagent', 'i-sm')}</span><span class="cx-sline__x"><b>subagent</b> ${b.id} · ${b.title} · ${fmtDur(b.duration)}<br><span class="cx-sline__out">${codeify(b.summary)}</span></span></div>`;
  const status = toolStatus(s, b);
  const ts = TOOLST[status];
  return html`<div class="cx-sline" data-tone="${ts.tone}"><span class="cx-sline__t">${t}</span><span class="cx-sline__g">${icon(ts.icon, `i-sm${ts.spin ? ' spin' : ''}`)}<span class="sr-only">${ts.label}</span></span><span class="cx-sline__x"><b>${b.name}</b> ${b.args}</span><span class="cx-sline__d">${status === 'failed' ? b.reason : status === 'running' ? raw(`<span data-elapsed="${b.startedAt}">${fmtDur((Date.now() - b.startedAt) / 1000)}</span>`) : status === 'cancelled' ? 'cancelled' : `${b.duration}s`}</span></div>
    ${b.diff ? diffHtml(b.diff, { open: false }) : b.output ? logPre(b.output, 'cx-sline__pre') : ''}`;
}
function logInner(ctx, s) {
  const blocks = blocksFor(ctx, s);
  const mode = st.mode;
  const out = [html`<p class="cx-start"><span class="overline">${fmtWhen(s.started)} · ${SOURCES[s.source]?.label || s.source}</span></p>`];
  let hidden = 0, stream = [];
  const flush = () => {
    if (hidden) { out.push(html`<button type="button" class="cx-hidden" data-act="mode" data-mode="worklog">${icon('log', 'i-sm')}${hidden} step${hidden === 1 ? '' : 's'} hidden · Show worklog</button>`); hidden = 0; }
    if (stream.length) { out.push(html`<div class="cx-stream" aria-label="Activity stream" role="group">${stream}</div>`); stream = []; }
  };
  blocks.forEach((b, i) => {
    const step = b.type === 'reasoning' || b.type === 'tool' || b.type === 'subagent';
    if (step && mode === 'final') { hidden++; return; }
    if (step && mode === 'stream') { stream.push(streamHtml(s, b)); return; }
    flush();
    if (b.type === 'user') out.push(userHtml(ctx, s, b, i));
    else if (b.type === 'assistant') out.push(agentHtml(ctx, s, b, i));
    else if (b.type === 'reasoning') out.push(thinkHtml(s, b, i));
    else if (b.type === 'tool') out.push(toolHtml(s, b, i));
    else if (b.type === 'subagent') out.push(subHtml(s, b));
    else out.push(eventHtml(ctx, s, b));
  });
  flush();
  return html`${out}`;
}

/* ==========================================================================
   Live-run cards (approval, clarify, queued)
   ========================================================================== */
function approvalCard(ctx, s, b, inSheet) {
  const p = inSheet ? 'cxs' : 'cxa';
  const Q = inSheet ? 'h3' : 'h2';
  return html`<section class="approval cx-apr" ${inSheet ? '' : raw(`role="alertdialog" aria-modal="false" aria-labelledby="${p}-t" aria-describedby="${p}-d"`)} tabindex="-1" data-apr="${b.id}">
    <div class="approval__head">${statusBadge('waiting')}${b.flags.map((f) => html`<span class="tag" data-tone="warning">${icon('alert', 'i-sm')}${f}</span>`)}<span class="subtle mono cx-apr__meta">${s.id} · ${fmtAgo(b.at, { suffix: true })}</span></div>
    ${raw(`<${Q} class="cx-apr__q" id="${p}-t">`)}Allow <span class="mono">${b.tool}</span> to run this command?${raw(`</${Q}>`)}
    <pre class="log cx-apr__cmd" aria-label="Command">${b.command}</pre>
    <dl class="cx-apr__kv"><div><dt>cwd</dt><dd class="mono">${b.cwd}</dd></div><div><dt>profile</dt><dd>${profileTag(s.profile)}</dd></div><div><dt>rule</dt><dd>${codeify(b.reason)}</dd></div></dl>
    <p class="cx-apr__desc" id="${p}-d">${b.consequence}</p>
    <div class="approval__actions cx-apr__acts">
      <button type="button" class="btn btn--primary" data-apr-act="once" aria-keyshortcuts="Enter">${icon('check')}Allow once${ctx.size === 'compact' ? '' : html` <kbd class="cx-kbd-on">↵</kbd>`}</button>
      <button type="button" class="btn btn--secondary" data-apr-act="session">This session</button>
      <button type="button" class="btn btn--secondary" data-apr-act="always">${icon('fingerprint')}Always…</button>
      <button type="button" class="btn btn--danger-quiet" data-apr-act="deny" aria-expanded="false" aria-controls="${p}-deny">Deny…</button>
    </div>
    <div class="cx-deny" id="${p}-deny" hidden>
      <div class="field"><label class="field__label" for="${p}-reason">Reason for denying</label>
        <textarea class="input" id="${p}-reason" rows="2" placeholder="e.g. Open a PR from a fork instead"></textarea>
        <p class="field__help">Sent to the agent so it can choose another way. The command does not run.</p></div>
      <div class="cx-deny__acts"><button type="button" class="btn btn--ghost btn--sm" data-apr-act="deny-cancel">Back</button><button type="button" class="btn btn--danger btn--sm" data-apr-act="deny-confirm">Deny with reason</button></div>
    </div>
  </section>`;
}
function clarifyCard(ctx, s, b, inSheet) {
  const p = inSheet ? 'cxs' : 'cxa';
  const Q = inSheet ? 'h3' : 'h2';
  const left = Math.max(0, Math.round((deadlineOf(b) - Date.now()) / 1000));
  return html`<section class="approval cx-apr cx-clar" ${inSheet ? '' : raw(`role="alertdialog" aria-modal="false" aria-labelledby="${p}-t" aria-describedby="${p}-d"`)} tabindex="-1" data-clar="${b.id}">
    <div class="approval__head">${statusBadge('waiting', { label: 'Question for you' })}${profileTag(s.profile)}<span class="cx-count mono" data-countdown="${b.id}" title="Time left before the default is used">${icon('clock', 'i-sm')}<span>${fmtDur(left)}</span></span></div>
    ${raw(`<${Q} class="cx-apr__q" id="${p}-t">`)}${b.question}${raw(`</${Q}>`)}
    <p class="cx-apr__desc" id="${p}-d">${b.detail} If nobody answers, it continues with <strong>${b.fallback}</strong>.</p>
    <div class="cx-choices" role="group" aria-label="Suggested answers">${b.choices.map((c) => html`<button type="button" class="chip" data-clar-choice="${c}">${c}</button>`)}</div>
    <form class="cx-clar__free" data-clar-form>
      <label class="sr-only" for="${p}-free">Answer in your own words</label>
      <input class="input" id="${p}-free" placeholder="Or type your own answer…" autocomplete="off">
      <button type="submit" class="btn btn--primary">Send</button>
    </form>
  </section>`;
}
function deadlineOf(b) { return (st.deadline[b.id] ||= b.at + b.countdown * 1000); }
function pendBar(b) {
  return html`<div class="cx-pend" data-tone="warning">${icon('waiting')}<div class="cx-pend__text"><strong>${b.type === 'approval' ? 'Approval needed' : 'Question for you'}</strong><span class="truncate">${b.type === 'approval' ? html`<code>${b.command}</code>` : b.question}</span></div><button type="button" class="btn btn--primary btn--sm" data-act="open-pending">Review</button></div>`;
}
function queuedCard(s, m, k) {
  const busy = runOf(s).busy;
  return html`<div class="cx-queued" role="group" aria-label="Queued message ${k + 1}" data-q="${m.id}">
    <div class="cx-queued__head">${statusBadge('queued', { label: busy ? 'Queued · sends after this turn' : 'Queued' })}</div>
    ${m.editing ? html`<label class="sr-only" for="cx-q-${m.id}">Edit queued message</label><textarea class="input cx-queued__edit" id="cx-q-${m.id}" rows="2">${m.text}</textarea>`
      : html`<p class="cx-queued__text">${m.text}</p>`}
    <div class="cx-queued__acts">${m.editing
      ? html`<button type="button" class="btn btn--ghost btn--sm" data-q-act="edit-cancel">Cancel edit</button><button type="button" class="btn btn--primary btn--sm" data-q-act="save">Save</button>`
      : html`<button type="button" class="btn btn--ghost btn--sm" data-q-act="edit">${icon('draft', 'i-sm')}Edit</button><button type="button" class="btn btn--ghost btn--sm" data-q-act="cancel">${icon('x', 'i-sm')}Cancel</button>${busy ? '' : html`<button type="button" class="btn btn--primary btn--sm" data-q-act="send">${icon('send', 'i-sm')}Send now</button>`}`}</div>
  </div>`;
}
function cardsInner(ctx, s) {
  if (!s) return '';
  const p = pendingFor(ctx, s);
  const out = [];
  if (p) out.push(ctx.size === 'compact' ? pendBar(p) : p.type === 'approval' ? approvalCard(ctx, s, p) : clarifyCard(ctx, s, p));
  (st.queue[s.id] || []).forEach((m, k) => out.push(queuedCard(s, m, k)));
  return html`${out}`;
}

/* ==========================================================================
   Composer
   ========================================================================== */
const shortModel = (m) => m.replace(/^deepseek-/, 'ds-');
function chipsInner(ctx, s) {
  const c = cfgFor(ctx, s);
  const u = usageFor(ctx, s);
  const n = c.toolsets.size;
  return html`<button type="button" class="chip chip--profile wide-only" data-pick="profile" aria-haspopup="menu" aria-label="Profile: ${c.profile}. Change">${avatar(c.profile, { size: 'sm' })}${c.profile}</button>
    <button type="button" class="chip wide-only" data-pick="model" aria-haspopup="menu" aria-label="Model: ${c.model}. Change"><span class="mono">${c.model}</span></button>
    <button type="button" class="chip wide-only" data-pick="reasoning" aria-haspopup="menu" aria-label="Reasoning effort: ${c.reasoning}. Change">${icon('bolt')}${c.reasoning}</button>
    <button type="button" class="chip wide-only" data-pick="workspace" aria-haspopup="menu" aria-label="Workspace: ${c.workspace}. Change">${icon('folder')}<span class="mono cx-chip-ws">${c.workspace}</span></button>
    <button type="button" class="chip wide-only" data-pick="context" aria-haspopup="dialog" aria-label="Context ${u.pct}% used, ${fmtMoney(u.cost)} spent, cache hit ${u.cache}%. Details"><span class="ring" style="--v:${u.pct}" aria-hidden="true"></span><span class="mono">${u.pct}% · ${fmtMoney(u.cost)} · cache ${u.cache}%</span></button>
    <button type="button" class="chip wide-only" data-pick="prompts" aria-haspopup="dialog">${icon('book')}Prompts</button>
    <button type="button" class="chip wide-only" data-pick="toolsets" aria-haspopup="menu" aria-label="Toolsets: ${n} on. Change">${icon('tool')}${n} toolsets</button>
    <button type="button" class="chip narrow-only" data-act="config" aria-haspopup="dialog" aria-label="Chat settings: ${c.profile}, ${c.model}, ${c.reasoning} reasoning, context ${u.pct}% used">${icon('sliders')}<span class="mono">${shortModel(c.model)}</span> · ${c.reasoning} · ${u.pct}%</button>`;
}
function ringInner(ctx, s) {
  const c = cfgFor(ctx, s);
  const u = usageFor(ctx, s);
  return html`<button type="button" class="btn btn--ghost cx-ringbtn" data-act="config" aria-haspopup="dialog" aria-label="Chat settings: ${c.profile}, ${c.model}, ${c.reasoning} reasoning, context ${u.pct}% used"><span class="ring cx-ring" style="--v:${u.pct}" aria-hidden="true"></span><span class="mono cx-ringbtn__pct" aria-hidden="true">${u.pct}%</span></button>`;
}
function sendInner(ctx, s) {
  if (!s || !runOf(s).busy) return html`<button type="submit" class="btn btn--primary btn--icon cx-sendbtn" aria-label="Send" aria-keyshortcuts="Meta+Enter Control+Enter">${icon('send')}</button>`;
  const compact = ctx.size === 'compact';
  return html`<div class="cx-split" role="group" aria-label="Agent is working. Send options">
      <button type="submit" class="btn btn--primary btn--sm cx-split__main" aria-keyshortcuts="Meta+Enter Control+Enter">${icon('steer')}Steer</button>
      <button type="button" class="btn btn--primary btn--sm btn--icon cx-split__more" data-act="busy-menu" aria-haspopup="menu" aria-expanded="false" aria-label="More ways to send while the agent works">${icon('chev-d')}</button>
    </div>
    ${compact ? '' : html`<button type="button" class="btn btn--secondary btn--sm" data-act="queue">${icon('queued')}Queue</button>`}
    <button type="button" class="btn btn--danger-quiet ${compact ? 'btn--icon' : 'btn--sm'} cx-stop" data-act="stop" aria-label="Stop the run">${icon('stop')}${compact ? '' : html`<span class="cx-stop__l">Stop</span>`}</button>`;
}
function attachInner(key) {
  const a = st.attach[key] || [];
  return html`${a.map((n, i) => html`<span class="chip cx-att">${icon('clip', 'i-sm')}<span class="truncate">${n}</span><button type="button" class="chip__x" data-att-rm="${i}" aria-label="Remove ${n}">${icon('x', 'i-sm')}</button></span>`)}`;
}
function composerHtml(ctx, s) {
  const key = s ? s.id : 'new';
  const c = cfgFor(ctx, s);
  const compact = ctx.size === 'compact';
  return html`<form class="composer cx-composer${compact ? ' cx-composer--compact' : ''}" data-composer novalidate>
    <ul class="menu cx-slash" id="cx-slash" role="listbox" aria-label="Slash commands" hidden></ul>
    <div class="cx-attachments" data-r="attach">${attachInner(key)}</div>
    <div class="cx-ptt" data-ptt hidden role="status"></div>
    <label class="sr-only" for="cx-input">Message ${c.profile}</label>
    <textarea id="cx-input" rows="1" placeholder="Message ${c.profile}…" aria-describedby="cx-hint" aria-autocomplete="list" aria-controls="cx-slash" aria-expanded="false" data-r-ph enterkeyhint="enter"></textarea>
    <span id="cx-hint" class="sr-only">Type / for commands. ${MOD}+Enter sends.</span>
    <div class="composer__foot">
      <button type="button" class="btn btn--ghost btn--icon" data-act="attach" aria-haspopup="menu" aria-label="Attach">${icon('clip')}</button>
      ${compact ? html`<button type="button" class="btn btn--ghost btn--icon cx-mic" data-act="mic" aria-pressed="false" aria-label="Voice. Hold to talk, or tap to dictate">${icon('mic')}</button>
        <span data-r="ring">${ringInner(ctx, s)}</span>` : html`<div class="composer__chips" data-r="chips">${chipsInner(ctx, s)}</div>`}
      <span class="cx-draft" data-r="draft" role="status">${st.drafts[key] ? 'Draft saved' : ''}</span>
      ${compact ? '' : html`<button type="button" class="btn btn--ghost btn--icon cx-mic" data-act="mic" aria-pressed="false" aria-label="Dictate">${icon('mic')}</button>`}
      <div class="cx-send" data-r="send">${sendInner(ctx, s)}</div>
    </div>
  </form>`;
}

/* ==========================================================================
   Context panel
   ========================================================================== */
function usageHtml(ctx, s) {
  const u = usageFor(ctx, s);
  return html`<div class="cx-usage">
    <span class="ring cx-ring-lg" style="--v:${u.pct}" role="img" aria-label="Context ${u.pct}% used"><span class="mono">${u.pct}%</span></span>
    <dl class="kv"><dt>context</dt><dd class="mono">${fmtTokens(u.used)} of ${fmtTokens(u.window)}</dd><dt>spent</dt><dd class="mono">${fmtMoney(u.cost)} this chat</dd><dt>cache hit</dt><dd class="mono">${u.cache}%</dd><dt>tokens</dt><dd class="mono">${fmtTokens(u.tokens)} total</dd></dl>
  </div>`;
}
function todoFor(ctx, s) {
  if (s.id !== 's_8f2c1a') return [];
  const d = st.decided.apr_8f2c;
  const pushed = d && d.tone === 'success' && !runOf(s).busy;
  return [
    { t: 'Add backoff(attempt) helper with full jitter', st: 'succeeded' },
    { t: 'Thread the attempt count through deliver()', st: 'succeeded' },
    { t: 'Make the backoff test deterministic (subagent)', st: 'succeeded' },
    { t: 'Commit to feat/x', st: 'succeeded' },
    { t: 'Push feat/x to origin', st: pushed ? 'succeeded' : d?.tone === 'danger' ? 'cancelled' : d ? 'running' : 'waiting' },
    { t: 'Open a PR and link t_1049', st: 'queued' },
  ];
}
function previewInner(ctx, s) {
  const files = s.id === 's_8f2c1a' ? CTX_8F2C.files.map((f) => f.path).concat('commit') : [];
  const seg = html`<div class="seg cx-seg-full" role="radiogroup" aria-label="Preview source">${[['file', 'File'], ['tool', 'Tool output'], ['web', 'Web']].map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(st.prevSrc === k)}" tabindex="${st.prevSrc === k ? '0' : '-1'}" data-prev="${k}">${l}</button>`)}</div>`;
  let body;
  if (st.prevSrc === 'web') body = emptyState({ icon: 'browser', title: 'No page open', body: 'When the agent uses the browser toolset, the page renders here beside the transcript.' });
  else if (st.prevSrc === 'tool') {
    const tools = blocksFor(ctx, s).filter((b) => b.type === 'tool' && b.output).slice(-3).reverse();
    body = tools.length ? tools.map((b) => html`<div class="cx-prevtool"><p class="cx-prevtool__h">${icon(TOOLST[toolStatus(s, b)].icon, 'i-sm')}<span class="mono truncate">${b.name} · ${b.args}</span></p>${logPre(b.output)}</div>`)
      : emptyState({ icon: 'terminal', title: 'No tool output yet', body: 'Output from terminal, file and web tools appears here.' });
  } else if (!files.length) body = emptyState({ icon: 'file', title: 'No files to preview', body: 'Files the agent reads or changes in this chat open here.' });
  else {
    const f = files.includes(st.prevFile) ? st.prevFile : files[0];
    const diffBlock = blocksFor(ctx, s).find((b) => b.diff && b.diff.file === f);
    const codeBlock = f === 'src/webhooks/backoff.ts' ? blocksFor(ctx, s).find((b) => b.type === 'assistant' && b.blocks.some((x) => x.code))?.blocks.find((x) => x.code).code : null;
    const pt = PREVIEW_TEXT[f];
    body = html`<div class="field"><label class="field__label" for="cx-prev-file">File</label><select class="input input--mono" id="cx-prev-file" data-prev-file>${files.map((x) => html`<option value="${x}" ${x === f ? raw('selected') : ''}>${x === 'commit' ? 'Commit 3e9a1c7' : x}</option>`)}</select></div>
      ${diffBlock ? diffHtml(diffBlock.diff, { open: false }) : codeBlock ? codeHtml(codeBlock) : pt?.diff ? diffHtml(pt.diff, { open: false }) : pt?.log ? logPre(pt.log) : ''}`;
  }
  return html`${seg}<div class="cx-prev">${body}</div>`;
}
function ctxBody(ctx, s) {
  const t = st.ctxTab;
  const rich = s.id === 's_8f2c1a';
  if (t === 'files') {
    if (!rich) return emptyState({ icon: 'file', title: 'No files touched', body: 'Files the agent reads or changes in this chat are listed here.' });
    const ch = CTX_8F2C.files.filter((f) => f.state !== 'Read');
    return html`<p class="cx-ctx__sum">${icon('git', 'i-sm')}<span class="mono">${CTX_8F2C.branch}</span> · ${ch.length} changed · <span class="cx-plus">+${ch.reduce((n, f) => n + f.add, 0)}</span> <span class="cx-minus">−${ch.reduce((n, f) => n + f.rem, 0)}</span></p>
      <ul class="cx-clist">${CTX_8F2C.files.map((f) => html`<li><button type="button" class="cx-crow" data-act="preview" data-file="${f.path}">
        ${icon('file')}<span class="cx-crow__main"><span class="mono truncate">${f.path.split('/').pop()}</span><span class="cx-crow__sub mono truncate">${f.path}</span></span>
        <span class="cx-crow__end">${f.state === 'Read' ? html`<span class="tag">Read</span>` : html`<span class="tag" data-tone="${f.state === 'Added' ? 'success' : 'info'}">${f.state}</span><span class="mono"><span class="cx-plus">+${f.add}</span> <span class="cx-minus">−${f.rem}</span></span>`}</span></button></li>`)}</ul>`;
  }
  if (t === 'artifacts') {
    const arts = rich ? CTX_8F2C.artifacts : s.id === 's_kw_1044' ? [{ icon: 'file', title: 'vector-dbs-2026.md', sub: 'Report · 11 sources', preview: null }] : [];
    if (!arts.length) return emptyState({ icon: 'package', title: 'No artifacts yet', body: 'Reports, commits, images and files the agent produces are collected here.' });
    return html`<ul class="cx-clist">${arts.map((a) => html`<li><button type="button" class="cx-crow" data-act="preview" data-file="${a.preview || ''}">${icon(a.icon)}<span class="cx-crow__main"><span class="truncate">${a.title}</span><span class="cx-crow__sub truncate">${a.sub}</span></span><span class="cx-crow__end">${icon('chev-r', 'i-sm')}</span></button></li>`)}</ul>`;
  }
  if (t === 'todo') {
    const todo = todoFor(ctx, s);
    if (!todo.length) return emptyState({ icon: 'tasks', title: 'No todo list', body: 'When the agent plans multi-step work, its checklist shows here and updates live.' });
    const done = todo.filter((x) => x.st === 'succeeded').length;
    return html`<p class="cx-ctx__sum">${done} of ${todo.length} done</p><div class="progress" role="img" aria-label="${done} of ${todo.length} done"><i style="--p:${Math.round((done / todo.length) * 100)}%"></i></div>
      <ul class="cx-todo">${todo.map((x) => { const L = TODO_ST[x.st]; return html`<li class="cx-todo__item" data-state="${x.st}"><span class="cx-tst" data-tone="${L.tone}">${icon(L.icon, L.spin ? 'spin' : '')}</span><span class="cx-todo__text">${x.t}${x.st === 'succeeded' ? html`<span class="sr-only"> (done)</span>` : html` <span class="tag" data-tone="${L.tone}">${L.label}</span>`}</span></li>`; })}</ul>`;
  }
  if (t === 'run') {
    const bl = blocksFor(ctx, s);
    const subs = bl.filter((b) => b.type === 'subagent');
    const goal = bl.find((b) => b.type === 'user');
    const ls = liveState(ctx, s);
    return html`<section class="cx-run" aria-labelledby="cx-run-goal"><h3 class="overline" id="cx-run-goal">Goal</h3><p>${goal ? goal.text : 'No goal yet.'}</p><div class="cx-run__meta">${statusBadge(ls || 'done', { label: ls ? undefined : 'Idle' })}<span class="subtle">${bl.filter((b) => b.type === 'tool').length} tool calls · started ${fmtAgo(s.started, { suffix: true })}</span></div></section>
      <section class="cx-run" aria-labelledby="cx-run-sub"><h3 class="overline" id="cx-run-sub">Subagents</h3>${subs.length ? html`<ul class="cx-clist">${subs.map((b) => html`<li class="cx-crow cx-crow--static">${icon('subagent')}<span class="cx-crow__main"><span class="truncate">${b.title}</span><span class="cx-crow__sub mono">${b.id} · ${b.model} · ${fmtTokens(b.tokens)} tok</span>${statusBadge(b.status, { variant: 'plain', detail: fmtDur(b.duration) })}</span></li>`)}</ul>` : html`<p class="subtle">No subagents in this chat.</p>`}</section>
      <section class="cx-run" aria-labelledby="cx-run-use"><h3 class="overline" id="cx-run-use">Usage</h3>${usageHtml(ctx, s)}<p class="subtle cx-run__note">${icon('coin', 'i-sm')}Weekly spend is at 82% of budget. Chats are never blocked; unattended work pauses at 100%.</p></section>`;
  }
  return previewInner(ctx, s);
}
function ctxInner(ctx, s, idp) {
  return html`<div class="cx-tabs" role="tablist" aria-label="Context">${CTX_TABS.map((t) => html`<button type="button" role="tab" id="${idp}-tab-${t.id}" aria-selected="${String(st.ctxTab === t.id)}" aria-controls="${idp}-panel" tabindex="${st.ctxTab === t.id ? '0' : '-1'}" data-ctx-tab="${t.id}">${t.label}</button>`)}</div>
    <div class="cx-tabpanel" role="tabpanel" id="${idp}-panel" aria-labelledby="${idp}-tab-${st.ctxTab}" tabindex="0">${ctxBody(ctx, s)}</div>`;
}
/** Event wiring shared by the right panel and the context sheet. */
function bindCtx(box, ctx, s, idp) {
  const rerender = (focusSel) => { box.innerHTML = String(ctxInner(ctx, s, idp)); if (focusSel) box.querySelector(focusSel)?.focus(); };
  box.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ctx-tab]');
    if (tab) { st.ctxTab = tab.dataset.ctxTab; rerender(`[data-ctx-tab="${st.ctxTab}"]`); return; }
    const pv = e.target.closest('[data-act="preview"]');
    if (pv) {
      const f = pv.dataset.file;
      if (!f) { ctx.toast('Opens in Workspace → Files', { tone: 'info', detail: 'Not prototyped' }); return; }
      st.ctxTab = 'preview';
      if (f === 'tests') st.prevSrc = 'tool'; else { st.prevSrc = 'file'; st.prevFile = f; }
      rerender('[data-ctx-tab="preview"]');
      return;
    }
    const pr = e.target.closest('[data-prev]');
    if (pr) { st.prevSrc = pr.dataset.prev; rerender(`[data-prev="${st.prevSrc}"]`); }
  });
  box.addEventListener('change', (e) => { if (e.target.matches('[data-prev-file]')) { st.prevFile = e.target.value; rerender('[data-prev-file]'); } });
  box.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[role=tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = CTX_TABS.findIndex((t) => t.id === tab.dataset.ctxTab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? CTX_TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + CTX_TABS.length) % CTX_TABS.length;
    st.ctxTab = CTX_TABS[n].id;
    rerender(`[data-ctx-tab="${st.ctxTab}"]`);
  });
}
function openCtxSheet(ctx, s) {
  ctx.openSheet({
    title: 'Context', wide: true, detents: ['half', 'full'], className: 'cx-ctxsheet',
    body: `<div class="cx-ctxbox" data-ctxbox>${ctxInner(ctx, s, 'cxs')}</div>`,
    initialFocus: `[data-ctx-tab="${st.ctxTab}"]`,
    onMount(panel) { bindCtx(panel.querySelector('[data-ctxbox]'), ctx, s, 'cxs'); },
  });
}

/* ==========================================================================
   Terminal mode (large only)
   ========================================================================== */
function termLines(s) {
  const base = [
    ['dim', `hermes ${'0.14.0'} · profile ${s.profile} · ${s.model} · ${s.project ? '~/code/' + s.project : '~'}`],
    ['dim', `session ${s.id} resumed · ${s.messages} messages · PTY over /api/pty (mock)`],
    ['rule', '─'.repeat(64)],
    ['cmd', '› git status -sb'],
    ['out', '## feat/x...origin/main [ahead 2]'],
    ['out', ' M src/webhooks/dispatch.ts'],
    ['cmd', '› pnpm vitest run src/webhooks --reporter=dot'],
    ['ok', '··············· 15 passed (2.1s)'],
    ['warn', '⏸  approval required: git push origin feat/x    [a] allow once  [s] session  [d] deny'],
  ];
  return base.concat(st.term.map((l) => ['cmd', `› ${l}`], []).flatMap((x) => [x, ['dim', 'prototype: commands are not sent anywhere']]));
}
function terminalHtml(ctx, s) {
  return html`<section class="cx-main cx-termwrap" aria-labelledby="cx-title">
    <header class="cx-head"><div class="cx-head__text"><h1 id="cx-title" tabindex="-1" class="cx-head__title">${s.title}</h1>
      <div class="cx-head__meta">${icon('terminal', 'i-sm')}<span>Terminal mode · embedded TUI</span><span class="tag" data-tone="success">${icon('fingerprint', 'i-sm')}Step-up verified</span></div></div>
      <div class="cx-head__tools"><button type="button" class="btn btn--secondary btn--sm" data-act="term-off">${icon('chat')}Back to chat</button></div></header>
    <div class="cx-term" role="log" aria-label="Terminal output" tabindex="0" data-r="term">${termLines(s).map(([k, t]) => html`<div class="cx-term__l cx-term__l--${k}">${t}</div>`)}</div>
    <form class="cx-term__in" data-term-form><span class="mono" aria-hidden="true">❯</span><label class="sr-only" for="cx-term-input">Terminal input</label><input id="cx-term-input" class="mono" autocomplete="off" spellcheck="false" placeholder="Type a command (not sent in the prototype)"></form>
  </section>`;
}

/* ==========================================================================
   Views
   ========================================================================== */
function headMeta(ctx, s) {
  const ls = liveState(ctx, s);
  const compact = ctx.size === 'compact';
  return html`${ls === 'waiting' ? html`<button type="button" class="cx-attn" data-act="${compact ? 'open-pending' : 'focus-card'}" aria-label="Waiting for you. Review">${statusBadge('waiting')}</button>`
      : ls ? statusBadge(ls) : runOf(s).stopped ? statusBadge('cancelled', { label: 'Stopped' }) : ''}
    ${profileTag(s.profile)}${compact ? '' : html`<span class="srctag">${icon(SOURCES[s.source]?.icon || 'chat', 'i-sm')}${SOURCES[s.source]?.label}</span><span class="mono subtle">${s.model}</span>${s.project ? html`<span class="mono subtle">${s.project}</span>` : ''}`}`;
}
function headHtml(ctx, s) {
  const compact = ctx.size === 'compact';
  const modeLabel = MODES.find((m) => m.id === st.mode).label;
  return html`<header class="cx-head">
    <div class="cx-head__text">
      <h1 id="cx-title" tabindex="-1" class="cx-head__title">${s.title}</h1>
      <div class="cx-head__meta" data-r="headmeta">${headMeta(ctx, s)}</div>
    </div>
    <div class="cx-head__tools">
      ${compact ? html`<button type="button" class="btn btn--ghost btn--sm cx-modebtn" data-act="mode-menu" aria-haspopup="menu" aria-label="Activity mode: ${modeLabel}. Change">${icon('rows')}<span>${modeLabel}</span>${icon('chev-d', 'i-sm')}</button>`
        : html`<div class="seg cx-modes" role="radiogroup" aria-label="Activity mode">${MODES.map((m) => html`<button type="button" role="radio" aria-checked="${String(st.mode === m.id)}" tabindex="${st.mode === m.id ? '0' : '-1'}" data-mode="${m.id}">${m.label}</button>`)}</div>`}
      ${ctx.size === 'large' && !st.ctxOpen ? html`<button type="button" class="btn btn--ghost btn--icon" data-act="ctx-open" aria-label="Show context panel" aria-expanded="false" aria-controls="cx-ctx">${icon('sidebar-expand')}</button>` : ''}
    </div>
  </header>`;
}
function sessionHtml(ctx, s) {
  if (st.terminal && ctx.size === 'large') return terminalHtml(ctx, s);
  return html`<section class="cx-main" aria-labelledby="cx-title">
    ${headHtml(ctx, s)}
    <div class="cx-scroll" data-scroll tabindex="0" aria-label="Transcript">
      <div class="cx-log chat" role="log" aria-live="off" aria-label="Conversation with ${s.profile}" data-r="log" data-mode="${st.mode}">${logInner(ctx, s)}</div>
    </div>
    <div class="cx-dock">
      <button type="button" class="cx-jump" data-act="jump" hidden>${icon('chev-d', 'i-sm')}Jump to latest</button>
      <div class="cx-dock__inner">
        <div class="cx-cards" data-r="cards">${cardsInner(ctx, s)}</div>
        ${composerHtml(ctx, s)}
      </div>
    </div>
    <p class="sr-only" role="status" data-announce></p>
  </section>`;
}
function newHtml(ctx) {
  const c = cfgFor(ctx, null);
  const p = getProfile(c.profile);
  return html`<section class="cx-main cx-main--new" aria-labelledby="cx-new-h">
    <div class="cx-scroll" data-scroll>
      <div class="cx-new">
        <div class="cx-new__hero">
          ${avatar(c.profile)}
          <h1 id="cx-new-h" tabindex="-1">New chat</h1>
          <p class="muted">${p.description}</p>
          <div class="cx-new__chips" data-r="newchips">${newChips(ctx)}</div>
        </div>
        <h2 class="overline cx-new__sh" id="cx-sugg-h">Suggestions</h2>
        <ul class="cx-suggest" aria-labelledby="cx-sugg-h">${SUGGEST.map((x, i) => html`<li><button type="button" class="cx-sugg" data-sugg="${i}"><span class="cx-sugg__icon" aria-hidden="true">${icon(x.icon)}</span><span class="cx-sugg__main"><span class="cx-sugg__title">${x.title}</span><span class="cx-sugg__sub">${x.sub}</span></span></button></li>`)}</ul>
      </div>
    </div>
    <div class="cx-dock"><div class="cx-dock__inner">${composerHtml(ctx, null)}</div></div>
  </section>`;
}
function newChips(ctx) {
  const c = cfgFor(ctx, null);
  return html`<button type="button" class="chip chip--profile" data-pick="profile" aria-haspopup="menu" aria-label="Profile: ${c.profile}. Change">${avatar(c.profile, { size: 'sm' })}${c.profile}${icon('chev-d', 'i-sm')}</button>
    <button type="button" class="chip" data-pick="model" aria-haspopup="menu" aria-label="Model: ${c.model}. Change"><span class="mono">${c.model}</span>${icon('chev-d', 'i-sm')}</button>
    <button type="button" class="chip" data-pick="reasoning" aria-haspopup="menu" aria-label="Reasoning effort: ${c.reasoning}. Change">${icon('bolt')}${c.reasoning}${icon('chev-d', 'i-sm')}</button>`;
}
function homeHtml(ctx) {
  const waiting = ctx.data.sessions.filter((s) => liveState(ctx, s) === 'waiting');
  return html`<section class="cx-main cx-main--home" aria-label="No session open">
    ${emptyState({ icon: 'chat', title: 'Pick a session or start a new one', body: `Sessions from Caduceus, CLI, Telegram, Discord, cron and Kanban workers all live in the list. ${waiting.length} ${waiting.length === 1 ? 'is' : 'are'} waiting for you.`, action: html`<div class="row cx-home__acts"><a class="btn btn--primary" href="${ctx.href('/chat/new')}">${icon('plus')}New chat</a>${kbd(MOD === '⌘' ? '⇧⌘O' : 'Ctrl+Shift+O')}</div>` })}
  </section>`;
}
function ctxAside(ctx, s) {
  return html`<aside class="cx-ctx" id="cx-ctx" aria-labelledby="cx-ctx-h">
    <div class="cx-ctx__head"><h2 class="cx-ctx__title" id="cx-ctx-h">Context</h2><button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="ctx-close" aria-label="Hide context panel" aria-expanded="true" aria-controls="cx-ctx">${icon('sidebar-collapse')}</button></div>
    <div class="cx-ctxbox" data-ctxbox>${ctxInner(ctx, s, 'cxp')}</div>
  </aside>`;
}

/* ==========================================================================
   Popover menus (large/medium) and action sheets (compact)
   ========================================================================== */
function closePop(focusBack = true) {
  if (!pop) return;
  const p = pop; pop = null;
  p.el.remove();
  document.removeEventListener('keydown', p.onKey, true);
  document.removeEventListener('pointerdown', p.onDown, true);
  window.removeEventListener('resize', p.onResize);
  p.anchor?.setAttribute('aria-expanded', 'false');
  if (focusBack && p.anchor?.isConnected) p.anchor.focus();
}
function itemHtml(it, i) {
  if (it.sep) return '<div class="menu__sep" role="separator"></div>';
  if (it.heading) return `<p class="overline cx-pop__h" role="presentation">${esc(it.heading)}</p>`;
  const role = it.check !== undefined ? 'menuitemcheckbox' : it.checked !== undefined ? 'menuitemradio' : 'menuitem';
  const on = it.check ?? it.checked;
  return `<button type="button" class="menu__item cx-pop__item${it.danger ? ' menu__item--danger' : ''}" role="${role}"${on !== undefined ? ` aria-checked="${!!on}"` : ''} data-i="${i}" tabindex="-1">${it.icon ? icon(it.icon) : ''}<span class="cx-pop__label"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${on !== undefined ? `<span class="cx-pop__check">${on ? icon('check', 'i-sm') : ''}</span>` : ''}</button>`;
}
function openMenu(ctx, anchor, { title, items }) {
  closePop(false);
  const act = (it, btn, close) => {
    if (it.check !== undefined) { it.check = !it.check; it.run?.(it.check); btn.setAttribute('aria-checked', String(it.check)); btn.querySelector('.cx-pop__check').innerHTML = it.check ? String(icon('check', 'i-sm')) : ''; return; }
    close(); it.run?.();
  };
  if (ctx.size === 'compact') {
    ctx.openSheet({
      title, className: 'cx-actsheet',
      body: `<div class="cx-actlist" role="menu" aria-label="${esc(title)}">${items.map(itemHtml).join('')}</div>`,
      onMount(panel, layer) {
        panel.querySelectorAll('[data-i]').forEach((b) => b.setAttribute('tabindex', '0'));
        panel.addEventListener('click', (e) => {
          const b = e.target.closest('[data-i]');
          if (b) act(items[+b.dataset.i], b, () => { layer.close(); });
        });
      },
    });
    return;
  }
  const el = document.createElement('div');
  el.className = 'menu cx-pop';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', title);
  el.innerHTML = items.map(itemHtml).join('');
  document.body.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const up = below < hgt && above > below;
    el.style.maxBlockSize = `${Math.max(160, up ? above - 6 : below - 6)}px`;
    el.style.insetInlineStart = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`;
    el.style.insetBlockStart = `${up ? Math.max(8, r.top - Math.min(hgt, above) - 6) : r.bottom + 6}px`;
  };
  place();
  const btns = () => [...el.querySelectorAll('[data-i]')];
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
    if (e.key === 'Tab') { closePop(false); return; }
    if (!el.contains(document.activeElement)) return;
    const all = btns(); const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); all[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); all[all.length - 1].focus(); }
  };
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(false); };
  const onResize = () => closePop(false);
  pop = { el, anchor, onKey, onDown, onResize };
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onResize);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) act(items[+b.dataset.i], b, () => closePop());
  });
  (el.querySelector('[aria-checked="true"]') || btns()[0])?.focus();
}

/* ==========================================================================
   Simulation (mock agent behaviour)
   ========================================================================== */
function announce(text) {
  const el = live?.root.querySelector('[data-announce]');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}
function upd(...names) {
  if (!live) return;
  const { root, ctx } = live;
  const s = live.sid ? getSession(live.sid) : null;
  const focusIn = (el) => el.contains(document.activeElement);
  for (const n of names) {
    root.querySelectorAll(`[data-r="${n}"]`).forEach((el) => {
      if (n === 'log') {
        if (!s) return;
        const sc = root.querySelector('[data-scroll]');
        const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
        el.innerHTML = String(logInner(ctx, s));
        el.dataset.mode = st.mode;
        if (near) sc.scrollTop = sc.scrollHeight; else root.querySelector('.cx-jump').hidden = false;
        return;
      }
      const had = focusIn(el);
      const R = { list: () => listInner(ctx), cards: () => cardsInner(ctx, s), send: () => sendInner(ctx, s), chips: () => chipsInner(ctx, s), ring: () => ringInner(ctx, s), headmeta: () => s && headMeta(ctx, s), attach: () => attachInner(s ? s.id : 'new'), newchips: () => newChips(ctx) };
      if (!R[n]) return;
      el.innerHTML = String(R[n]() || '');
      if (had) root.querySelector('#cx-input')?.focus();
    });
  }
  if (names.includes('cards') || names.includes('log')) {
    const box = root.querySelector('.cx-ctx [data-ctxbox]');
    if (box && s && (st.ctxTab === 'todo' || st.ctxTab === 'run') && !box.contains(document.activeElement)) box.innerHTML = String(ctxInner(ctx, s, 'cxp'));
  }
}
function refreshRun(sid) {
  if (live?.sid === sid) upd('log', 'cards', 'send', 'headmeta');
  upd('list');
}
function later(s, tok, ms, fn) {
  setTimeout(() => { if (runOf(s).token !== tok) return; fn(); refreshRun(s.id); }, ms);
}
function replyText(text) {
  if (/changelog/i.test(text)) return 'Added an entry under Unreleased → Changed in `CHANGELOG.md`: “Webhook retries now use exponential backoff with full jitter (cap `webhooks.retry_cap_s`, default 60 s).” (Prototype reply: nothing actually ran.)';
  const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return `On it: “${short}”. This is a prototype reply, so nothing actually ran. In the real Caduceus the answer streams here token by token, and each tool call appears above it in the worklog.`;
}
/** Mock turn: a tool call, then a streamed reply. `opts.tool` / `opts.final` override the defaults. */
function simulateTurn(ctx, s, text, opts = {}) {
  const r = runOf(s);
  r.busy = true; r.stopped = false; r.token++;
  const tok = r.token;
  s.live = true; s.liveState = 'running'; s.updated = Date.now();
  const c = cfgFor(ctx, s);
  const x = extra(s.id);
  const tool = { type: 'tool', live: true, at: Date.now(), name: opts.tool?.name || 'search_files', args: opts.tool?.args || `"${(text.match(/\w{4,}/) || ['task'])[0].toLowerCase()}" ${c.workspace}`, status: 'running', startedAt: Date.now() };
  x.push(tool);
  refreshRun(s.id);
  later(s, tok, opts.tool?.ms || 1600, () => {
    tool.status = 'succeeded'; tool.duration = +((Date.now() - tool.startedAt) / 1000).toFixed(1);
    tool.output = opts.tool?.output || '3 matches (mock output)';
    x.push(tool.reply = { type: 'assistant', live: true, at: Date.now(), profile: c.profile, model: c.model, streaming: true, blocks: [{ p: (opts.final || replyText(text)).split('. ')[0] + '.' }] });
  });
  later(s, tok, (opts.tool?.ms || 1600) + 1700, () => {
    const a = tool.reply;
    a.streaming = false; a.blocks = [{ p: opts.final || replyText(text) }];
    r.busy = false; s.live = false; s.liveState = 'done'; s.updated = Date.now(); s.preview = a.blocks[0].p.replace(/`/g, '');
    s.messages += 2;
    if (live?.sid !== s.id) st.unread.add(s.id);
    announce(`${c.profile} replied`);
    opts.done?.();
    setTimeout(() => flushQueue(ctx, s), 400);
  });
}
function sendNow(ctx, s, text, attachments) {
  extra(s.id).push({ type: 'user', at: Date.now(), text, attachments });
  s.preview = text; s.messages++;
  simulateTurn(ctx, s, text);
}
function flushQueue(ctx, s) {
  const q = st.queue[s.id];
  if (!q?.length || runOf(s).busy) return;
  const m = q.shift();
  ctx.toast('Sent queued message', { tone: 'info', detail: m.text.slice(0, 48) });
  sendNow(ctx, s, m.text);
  if (live?.sid === s.id) upd('cards');
}
function stopRun(ctx, s, { quiet = false } = {}) {
  const r = runOf(s);
  r.token++; r.busy = false; r.stopped = true; r.stoppedBase = true;
  for (const b of st.extra[s.id] || []) {
    if (b.type === 'tool' && b.status === 'running') { b.status = 'cancelled'; }
    if (b.type === 'assistant' && b.streaming) { b.streaming = false; b.stopped = true; }
  }
  const p = blocksFor(ctx, s).find((b) => (b.type === 'approval' || b.type === 'clarify') && !st.decided[b.id]);
  if (p) { st.decided[p.id] = { verb: 'Cancelled', tone: 'neutral', at: Date.now() }; const it = getInboxItem(p.inboxId); if (it) it.resolved = true; }
  extra(s.id).push({ type: 'event', at: Date.now(), tone: 'neutral', icon: 'stop', text: 'Stopped by you. Partial output kept.' });
  s.live = false; s.liveState = 'cancelled';
  if (!quiet) ctx.toast('Run stopped', { tone: 'info', detail: `${s.id} · transcript kept` });
  if (p) refreshAll(); else refreshRun(s.id);
}
/** Full re-render (chrome badges change), keeping focus on the composer. */
async function refreshAll(focusComposer = true) {
  if (!live) return;
  await overlaysSettled();
  const ctx = live.ctx;
  ctx.refresh();
  if (focusComposer) requestAnimationFrame(() => document.getElementById('cx-input')?.focus({ preventScroll: true }));
}
async function decideApproval(ctx, s, b, kind, reason) {
  if (st.decided[b.id]) return;
  if (kind === 'always') {
    const ok = await ctx.openDialog({ tier: 2, title: 'Always allow git push on coder?', body: 'Future commands matching <span class="mono">git push*</span> run without asking on this profile. You can revoke it in Config → Approvals.', profile: s.profile, confirmLabel: 'Always allow' });
    if (!ok) return;
  }
  const verb = { once: 'Allowed once', session: 'Allowed for this session', always: 'Always allowed', deny: 'Denied' }[kind];
  st.decided[b.id] = { verb, tone: kind === 'deny' ? 'danger' : 'success', reason, at: Date.now() };
  const it = getInboxItem(b.inboxId); if (it) it.resolved = true;
  closeSheetIfOpen();
  if (kind === 'deny') {
    simulateTurn(ctx, s, '', { tool: { name: 'terminal', args: 'git log --oneline origin/main..feat/x', output: '3e9a1c7 feat(webhooks): exponential backoff with jitter\n91b02de test(webhooks): seed backoff random', ms: 900 }, final: `Understood, I won't push.${reason ? ` Noted: “${reason}”.` : ''} The 2 commits stay local on \`feat/x\`; tell me how you'd like to publish them.` });
  } else {
    simulateTurn(ctx, s, '', { tool: { name: 'terminal', args: b.command, output: 'To github.com:hermes-lab/caduceus-dashboard.git\n * [new branch]      feat/x -> feat/x\nbranch \'feat/x\' set up to track \'origin/feat/x\'.', ms: 1800 }, final: 'Pushed `feat/x` (2 commits) to origin. CI started on push. Want me to open a PR and link it to t_1049?' });
  }
  ctx.toast(`${verb}: ${b.command}`, { tone: kind === 'deny' ? 'info' : 'success', detail: `${s.profile} · ${s.id}` });
  refreshAll();
}
function answerClarify(ctx, s, b, answer, timedOut) {
  if (st.decided[b.id]) return;
  st.decided[b.id] = { verb: timedOut ? 'No answer, used default' : 'Answered', tone: 'success', reason: answer, at: Date.now() };
  const it = getInboxItem(b.inboxId); if (it) it.resolved = true;
  closeSheetIfOpen();
  extra(s.id).push({ type: 'user', at: Date.now(), text: answer, note: `Answer to “${b.question}”` });
  simulateTurn(ctx, s, answer, { tool: { name: 'format_citations', args: `${answer} · 14 references`, output: '14 references formatted', ms: 1300 }, final: `Using ${answer}. I formatted all 14 references and finished the related-work draft (612 words). It's in \`reading/rag/related-work.md\`.` });
  ctx.toast(`Answered “${answer}”`, { detail: `${s.profile} · ${s.id}` });
  refreshAll();
}
let sheetLayer = null;
function closeSheetIfOpen() { if (sheetLayer && !sheetLayer.closed) sheetLayer.close(); sheetLayer = null; }
function openPendingSheet(ctx, s) {
  const b = pendingFor(ctx, s);
  if (!b) return;
  st.autoSheet.add(b.id);
  const isApr = b.type === 'approval';
  sheetLayer = ctx.openSheet({
    title: isApr ? 'Approval needed' : 'Question for you',
    className: 'cx-pendsheet',
    body: String(isApr ? approvalCard(ctx, s, b, true) : clarifyCard(ctx, s, b, true)),
    initialFocus: isApr ? '[data-apr-act="once"]' : '[data-clar-choice]',
    onClose: () => { sheetLayer = null; },
    onMount(panel, layer) {
      panel.setAttribute('role', 'alertdialog');
      panel.setAttribute('aria-describedby', 'cxs-d');
      panel.addEventListener('click', (e) => pendingClick(e, ctx, s));
      panel.addEventListener('submit', (e) => pendingSubmit(e, ctx, s));
    },
  });
}
function pendingClick(e, ctx, s) {
  const b = pendingFor(ctx, s);
  if (!b) return false;
  const a = e.target.closest('[data-apr-act]');
  if (a) {
    const card = a.closest('.cx-apr');
    const deny = card.querySelector('.cx-deny');
    const k = a.dataset.aprAct;
    if (k === 'deny') { deny.hidden = false; a.setAttribute('aria-expanded', 'true'); deny.querySelector('textarea').focus({ preventScroll: true }); deny.querySelector('.cx-deny__acts').scrollIntoView({ block: 'nearest' }); }
    else if (k === 'deny-cancel') { deny.hidden = true; card.querySelector('[data-apr-act="deny"]').setAttribute('aria-expanded', 'false'); card.querySelector('[data-apr-act="deny"]').focus(); }
    else if (k === 'deny-confirm') decideApproval(ctx, s, b, 'deny', deny.querySelector('textarea').value.trim());
    else decideApproval(ctx, s, b, k);
    return true;
  }
  const ch = e.target.closest('[data-clar-choice]');
  if (ch) { answerClarify(ctx, s, b, ch.dataset.clarChoice); return true; }
  return false;
}
function pendingSubmit(e, ctx, s) {
  if (!e.target.matches('[data-clar-form]')) return false;
  e.preventDefault();
  const b = pendingFor(ctx, s);
  const v = e.target.querySelector('input').value.trim();
  if (!v) { e.target.querySelector('input').focus(); return true; }
  if (b) answerClarify(ctx, s, b, v);
  return true;
}

/* ==========================================================================
   Pickers and sheets
   ========================================================================== */
function applyCfg(ctx, s, patch) {
  const c = cfgFor(ctx, s);
  Object.assign(c, patch);
  if (patch.profile && !s) c.model = getProfile(patch.profile).model;
  upd('chips', 'ring', 'newchips');
  const ta = live?.root.querySelector('#cx-input');
  if (ta) { ta.placeholder = `Message ${c.profile}…`; live.root.querySelector('label[for="cx-input"]').textContent = `Message ${c.profile}`; }
}
function pickerItems(ctx, s, kind) {
  const c = cfgFor(ctx, s);
  if (kind === 'profile') return ctx.data.profiles.map((p) => ({ label: p.name, sub: `${p.model}${p.isDefault ? ' · default' : ''}`, checked: c.profile === p.name, run: () => { applyCfg(ctx, s, { profile: p.name }); if (s && p.name !== s.profile) ctx.toast(`Next message goes to ${p.name}`, { tone: 'info' }); } }));
  if (kind === 'model') return ctx.data.models.map((m) => ({ label: m.id, sub: `${m.provider} · ${fmtTokens(m.context)} context · $${m.priceIn}/$${m.priceOut} per M`, checked: c.model === m.id, run: () => applyCfg(ctx, s, { model: m.id }) }));
  if (kind === 'reasoning') return REASONING.map((r) => ({ label: r, sub: { Low: 'Fastest, cheapest', Medium: 'Balanced', High: 'Default for coding', Max: 'Slowest; long chains of thought' }[r], checked: c.reasoning === r, run: () => applyCfg(ctx, s, { reasoning: r }) }));
  if (kind === 'workspace') return ctx.data.projects.map((p) => ({ label: p.repo, sub: p.name, checked: c.workspace === p.repo, run: () => applyCfg(ctx, s, { workspace: p.repo }) })).concat({ label: '~', sub: 'Home directory (no project)', checked: c.workspace === '~', run: () => applyCfg(ctx, s, { workspace: '~' }) });
  if (kind === 'toolsets') return TOOLSETS.map((t) => ({ label: t.label, sub: t.sub, check: c.toolsets.has(t.id), run: (on) => { if (on) c.toolsets.add(t.id); else c.toolsets.delete(t.id); upd('chips', 'ring'); } }));
  return [];
}
const PICK_TITLE = { profile: 'Profile', model: 'Model', reasoning: 'Reasoning effort', workspace: 'Workspace', toolsets: 'Toolsets' };
function openContextSheet(ctx, s) {
  ctx.openSheet({
    title: 'Context usage',
    body: s ? `${usageHtml(ctx, s)}<p class="subtle">Compressing summarises older turns into a short brief so the model keeps working with room to spare. The full transcript is kept.</p>`
      : '<p class="subtle">A new chat starts with an empty context window.</p>',
    footer: s ? '<button type="button" class="btn btn--secondary" data-close>Close</button><button type="button" class="btn btn--primary" data-compress>Compress now</button>' : '<button type="button" class="btn btn--primary" data-close>Close</button>',
    onMount(panel, layer) {
      panel.querySelector('[data-compress]')?.addEventListener('click', () => { layer.close(); s.context = Math.max(0.06, (s.context || 0) / 3); upd('chips', 'ring'); ctx.toast('Context compressed', { detail: `now ${Math.round(s.context * 100)}% · transcript kept` }); });
    },
  });
}
function openPrompts(ctx) {
  ctx.openSheet({
    title: 'Saved prompts', detents: ['half', 'full'],
    body: `<ul class="cx-prompts">${PROMPTS.map((p, i) => `<li><button type="button" class="cx-prompt" data-prompt="${i}"><span class="cx-prompt__name">${esc(p.name)}</span><span class="cx-prompt__text">${esc(p.text)}</span><span class="cx-prompt__ins">${icon('plus', 'i-sm')}Insert</span></button></li>`).join('')}</ul><p class="field__help">Manage saved prompts in Settings › Prompts.</p>`,
    onMount(panel, layer) {
      panel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-prompt]');
        if (!b) return;
        layer.close();
        insertText(PROMPTS[+b.dataset.prompt].text, true);
      });
    },
  });
}
function insertText(text, replace) {
  setTimeout(() => {
    const ta = document.getElementById('cx-input');
    if (!ta) return;
    ta.value = replace || !ta.value.trim() ? text : `${ta.value.replace(/\s+$/, '')}\n${text}`;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, 60);
}
function openConfig(ctx, s) {
  const c = cfgFor(ctx, s);
  const compact = ctx.size === 'compact';
  const sel = (id, label, key, opts, mono) => `<div class="field"><label class="field__label" for="${id}">${label}</label><select id="${id}" class="input${mono ? ' input--mono' : ''}" data-cf="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}"${c[key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  const body = `
    ${sel('cf-profile', 'Profile', 'profile', ctx.data.profiles.map((p) => [p.name, `${p.name}${p.isDefault ? ' (default)' : ''}`]))}
    ${sel('cf-model', 'Model', 'model', ctx.data.models.map((m) => [m.id, `${m.id} · ${m.provider}`]), true)}
    <div class="field"><span class="field__label" id="cf-r-l">Reasoning effort</span><div class="seg cx-seg-full" role="radiogroup" aria-labelledby="cf-r-l">${REASONING.map((r) => `<button type="button" role="radio" aria-checked="${c.reasoning === r}" tabindex="${c.reasoning === r ? 0 : -1}" data-cf-r="${r}">${r}</button>`).join('')}</div></div>
    ${sel('cf-ws', 'Workspace', 'workspace', ctx.data.projects.map((p) => [p.repo, `${p.repo}  (${p.name})`]).concat([['~', '~  (no project)']]), true)}
    <fieldset class="cx-fs"><legend class="field__label">Toolsets</legend>${TOOLSETS.map((t) => `<div class="switch-row"><span id="cf-t-${t.id}"><span>${esc(t.label)}</span><br><small class="subtle">${esc(t.sub)}</small></span><button type="button" class="switch" role="switch" aria-checked="${c.toolsets.has(t.id)}" aria-labelledby="cf-t-${t.id}" data-cf-t="${t.id}"></button></div>`).join('')}</fieldset>
    <section class="cx-cfgctx" aria-labelledby="cf-ctx-h"><h3 id="cf-ctx-h">Context</h3>${s ? usageHtml(ctx, s) : '<p class="subtle">Empty: this chat has not started.</p>'}
      ${s ? '<button type="button" class="btn btn--secondary btn--sm" data-cf-compress>Compress now</button>' : ''}</section>
    <button type="button" class="btn btn--secondary btn--block" data-cf-prompts>${icon('book')}Saved prompts…</button>`;
  ctx.openSheet({
    title: 'Chat settings', detents: compact ? ['full'] : ['auto'], className: 'cx-cfgsheet',
    body, footer: '<button type="button" class="btn btn--primary" data-close>Done</button>',
    onMount(panel, layer) {
      panel.addEventListener('change', (e) => {
        const k = e.target.dataset.cf;
        if (!k) return;
        applyCfg(ctx, s, { [k]: e.target.value });
        if (k === 'profile' && !s) panel.querySelector('#cf-model').value = cfgFor(ctx, s).model;
      });
      panel.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-cf-r]');
        if (r) { panel.querySelectorAll('[data-cf-r]').forEach((b) => { const on = b === r; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }); applyCfg(ctx, s, { reasoning: r.dataset.cfR }); return; }
        const t = e.target.closest('[data-cf-t]');
        if (t) { const on = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', String(on)); if (on) c.toolsets.add(t.dataset.cfT); else c.toolsets.delete(t.dataset.cfT); upd('chips', 'ring'); return; }
        if (e.target.closest('[data-cf-compress]')) { s.context = Math.max(0.06, (s.context || 0) / 3); panel.querySelector('.cx-usage').outerHTML = String(usageHtml(ctx, s)); upd('chips', 'ring'); ctx.toast('Context compressed', { detail: 'transcript kept' }); return; }
        if (e.target.closest('[data-cf-prompts]')) openPrompts(ctx);
      });
    },
  });
}
function openPicker(ctx, s, kind, anchor) {
  if (kind === 'context') return openContextSheet(ctx, s);
  if (kind === 'prompts') return openPrompts(ctx);
  openMenu(ctx, anchor, { title: PICK_TITLE[kind], items: pickerItems(ctx, s, kind) });
}

/* ==========================================================================
   Module
   ========================================================================== */
export default {
  routes: ['/chat', '/chat/new', '/chat/:id'],
  title: (ctx) => (ctx.params.id ? getSession(ctx.params.id)?.title || 'Chat' : ctx.path === '/chat/new' ? 'New chat' : 'Chat'),
  group: 'top',
  layout: 'fill',

  render(ctx) {
    closePop(false);
    const size = ctx.size;
    const large = size === 'large';
    const id = ctx.params.id;
    const view = id ? 'session' : ctx.path === '/chat/new' ? 'new' : 'list';
    const s = id ? getSession(id) : null;
    if (s) st.unread.delete(s.id);
    if (st.ctxOpen === null) st.ctxOpen = window.innerWidth >= 1600;
    const showPane = large || view === 'list';
    const showMain = large || view !== 'list';
    const showCtx = large && view === 'session' && s && st.ctxOpen;
    let main = '';
    if (showMain) {
      if (view === 'session') main = s ? sessionHtml(ctx, s) : html`<section class="cx-main cx-main--home" aria-labelledby="cx-nf">${raw(`<h1 id="cx-nf" tabindex="-1" class="sr-only">Session not found</h1>`)}${emptyState({ icon: 'search', title: 'Session not found', body: `No session with the ID ${id} exists on this install, or it was deleted.`, action: html`<a class="btn btn--primary" href="${ctx.href('/chat')}">All sessions</a>` })}</section>`;
      else if (view === 'new') main = newHtml(ctx);
      else main = homeHtml(ctx);
    }
    const cols = [showPane && 'pane', showMain && 'main', showCtx && 'ctx'].filter(Boolean).join('-');
    return html`<div class="cx" data-cols="${cols}" data-view="${view}" data-size="${size}">
      ${showPane ? paneHtml(ctx, { h1: view === 'list' }) : ''}
      ${main}
      ${showCtx ? ctxAside(ctx, s) : ''}
    </div>`;
  },

  mount(root, ctx) {
    const id = ctx.params.id;
    const s = id ? getSession(id) : null;
    const key = s ? s.id : 'new';
    const view = id ? 'session' : ctx.path === '/chat/new' ? 'new' : 'list';
    live = { root, ctx, sid: s?.id || null };
    const compact = ctx.size === 'compact';
    const timers = [];

    /* ---- app bar ---- */
    if (view === 'list' && !compact && ctx.size !== 'large') ctx.setAppBar({ actions: [{ icon: 'plus', label: 'New chat', primary: true, onClick: () => ctx.navigate('/chat/new') }] });
    else if (view === 'list' && compact) ctx.setAppBar({ actions: [{ icon: 'plus', label: 'New chat', onClick: () => ctx.navigate('/chat/new') }] });
    else if (s) {
      const actions = [];
      if (ctx.size === 'large') actions.push({ icon: 'terminal', label: st.terminal ? 'Exit terminal' : 'Terminal', primary: st.terminal, onClick: () => toggleTerminal() });
      else actions.push({ icon: 'sidebar-expand', label: 'Context', onClick: () => openCtxSheet(ctx, s) });
      ctx.setAppBar({ title: s.title, actions });
    } else if (view === 'new') ctx.setAppBar({ title: 'New chat' });

    async function toggleTerminal() {
      if (!st.terminal && !st.termVerified) {
        const ok = await ctx.openDialog({ tier: 2, title: `Open a terminal on ${s.profile}?`, body: `Commands run as the Hermes user in <span class="mono">${esc(cfgFor(ctx, s).workspace)}</span>. The terminal is the explicit, step-up-gated home for shell access.`, profile: s.profile, confirmLabel: 'Open terminal' });
        if (!ok) return;
        st.termVerified = true;
      }
      st.terminal = !st.terminal;
      await overlaysSettled();
      ctx.refresh();
      requestAnimationFrame(() => document.getElementById(st.terminal ? 'cx-term-input' : 'cx-input')?.focus());
    }

    /* ---- sessions pane ---- */
    const paneList = root.querySelector('.cx-pane__list');
    if (paneList) {
      paneList.scrollTop = st.paneScroll;
      paneList.addEventListener('scroll', () => { st.paneScroll = paneList.scrollTop; }, { passive: true });
      const curRow = paneList.querySelector('[aria-current="page"]');
      if (curRow && ctx.size === 'large') {
        const r = curRow.getBoundingClientRect(), pr = paneList.getBoundingClientRect();
        if (r.top < pr.top || r.bottom > pr.bottom) curRow.scrollIntoView({ block: 'nearest' });
      }
    }
    const listStatus = (msg) => { const el = root.querySelector('[data-r="liststatus"]'); if (el) el.textContent = msg; };
    const refreshList = (msg) => { upd('list'); if (msg) listStatus(msg); };
    const q = root.querySelector('#cx-q');
    let qTimer = null;
    q?.addEventListener('input', () => {
      st.q = q.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        refreshList();
        const n = root.querySelectorAll('[data-r="list"] .cx-row').length;
        listStatus(st.q.trim() ? `${n} session${n === 1 ? '' : 's'} found` : 'Showing all sessions');
        syncQuery();
      }, 120);
    });
    q?.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; st.q = ''; refreshList('Search cleared'); syncQuery(); } });
    function syncQuery() {
      const u = new URLSearchParams(ctx.query);
      if (st.q.trim()) u.set('q', st.q.trim()); else u.delete('q');
      const qs = u.toString();
      history.replaceState(history.state, '', `#${ctx.path}${qs ? '?' + qs : ''}`);
    }
    if (ctx.query.q && !st.q && q) { st.q = ctx.query.q; q.value = st.q; refreshList(); }

    function setArchived(sx, on) {
      sx.archived = on;
      refreshList();
      ctx.toast(on ? `Archived “${sx.title}”` : `Restored “${sx.title}”`, { undo: () => { sx.archived = !on; refreshList(); } });
    }
    function setPinned(sx, on) {
      sx.pinned = on;
      refreshList();
      ctx.toast(on ? `Pinned “${sx.title}”` : `Unpinned “${sx.title}”`, { undo: () => { sx.pinned = !on; refreshList(); } });
    }
    function rowMenu(sx, anchor) {
      openMenu(ctx, anchor, {
        title: sx.title,
        items: [
          { label: 'Open', icon: 'arrow-r', run: () => ctx.navigate('/chat/' + sx.id) },
          { label: sx.pinned ? 'Unpin' : 'Pin', icon: 'pin', run: () => setPinned(sx, !sx.pinned) },
          { label: st.unread.has(sx.id) ? 'Mark as read' : 'Mark as unread', icon: 'eye', run: () => { if (st.unread.has(sx.id)) st.unread.delete(sx.id); else st.unread.add(sx.id); refreshList(); } },
          { label: 'Rename…', icon: 'draft', run: () => renameSession(sx) },
          { sep: true },
          { label: sx.archived ? 'Restore from archive' : 'Archive', icon: 'archive', run: () => setArchived(sx, !sx.archived) },
        ],
      });
    }
    function renameSession(sx) {
      ctx.openSheet({
        title: 'Rename session',
        body: `<div class="field"><label class="field__label" for="cx-rn">Title</label><input id="cx-rn" class="input" value="${esc(sx.title)}" autocomplete="off"></div>`,
        footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-save>Save</button>',
        initialFocus: '#cx-rn',
        onMount(panel, layer) {
          const save = () => {
            const v = panel.querySelector('#cx-rn').value.trim();
            if (!v) return;
            const old = sx.title; sx.title = v; layer.close();
            ctx.toast('Renamed', { detail: v, undo: () => { sx.title = old; refreshAll(false); } });
            refreshAll(false);
          };
          panel.querySelector('[data-save]').addEventListener('click', save);
          panel.querySelector('#cx-rn').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        },
      });
    }

    /* ---- swipe rows (compact): → archive, ← pin; ⋮ is the visible alternative ---- */
    let swipe = null, swallowClick = false;
    if (compact && paneList) {
      paneList.addEventListener('pointerdown', (e) => {
        const fg = e.target.closest('.cx-row__fg');
        if (!fg || e.target.closest('.cx-row__more') || e.button > 0) return;
        swipe = { fg, row: fg.closest('.cx-row'), x0: e.clientX, y0: e.clientY, dx: 0, on: false, id: e.pointerId };
      });
      paneList.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
        if (!swipe.on) {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
          if (Math.abs(dx) < 10) return;
          swipe.on = true; swipe.fg.setPointerCapture(e.pointerId); swipe.row.classList.add('is-swiping');
        }
        swipe.dx = dx;
        swipe.fg.style.transform = `translateX(${dx}px)`;
        swipe.row.dataset.swipe = dx > 0 ? 'start' : 'end';
        swipe.row.classList.toggle('is-armed', Math.abs(dx) > 96);
      });
      const end = () => {
        if (!swipe) return;
        const { fg, row, dx, on } = swipe;
        swipe = null;
        if (!on) return;
        swallowClick = true; setTimeout(() => { swallowClick = false; }, 300);
        row.classList.remove('is-swiping', 'is-armed');
        fg.style.transform = '';
        const sx = getSession(row.dataset.sid);
        if (dx > 96) setArchived(sx, !sx.archived);
        else if (dx < -96) setPinned(sx, !sx.pinned);
      };
      paneList.addEventListener('pointerup', end);
      paneList.addEventListener('pointercancel', end);
    }
    root.addEventListener('click', (e) => { if (swallowClick && e.target.closest('.cx-row')) { e.preventDefault(); e.stopPropagation(); } }, true);

    /* ---- long-press: rows and messages (touch); contextmenu covers right-click ---- */
    let lp = null;
    root.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.cx-row__fg, .cx-msg');
      if (!t || e.pointerType !== 'touch') return;
      const x0 = e.clientX, y0 = e.clientY;
      lp = { t, x0, y0, timer: setTimeout(() => { lp = null; navigator.vibrate?.(8); longPress(t); swallowClick = true; setTimeout(() => { swallowClick = false; }, 400); }, 520) };
    });
    root.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.x0, e.clientY - lp.y0) > 8) { clearTimeout(lp.timer); lp = null; } });
    ['pointerup', 'pointercancel'].forEach((ev) => root.addEventListener(ev, () => { if (lp) { clearTimeout(lp.timer); lp = null; } }));
    root.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('.cx-row__fg, .cx-msg');
      if (!t || e.target.closest('a[href]:not(.cx-row__link), input, textarea, pre, code')) return;
      e.preventDefault();
      longPress(t);
    });
    function longPress(t) {
      if (t.matches('.cx-row__fg')) rowMenu(getSession(t.closest('.cx-row').dataset.sid), t.querySelector('.cx-row__more'));
      else messageMenu(+t.dataset.bi, t.querySelector('[data-act="msg-menu"]') || t);
    }

    /* ---- transcript ---- */
    const dockEl = root.querySelector('.cx-dock');
    const dockRO = dockEl ? new ResizeObserver(() => document.documentElement.style.setProperty('--cx-dock-h', `${dockEl.offsetHeight}px`)) : null;
    dockRO?.observe(dockEl);
    const sc = root.querySelector('[data-scroll]');
    const jump = root.querySelector('.cx-jump');
    if (sc && s) {
      sc.scrollTop = sc.scrollHeight;
      cssReady.then(() => requestAnimationFrame(() => { if (sc.isConnected) sc.scrollTop = sc.scrollHeight; }));
      sc.addEventListener('scroll', () => { if (jump) jump.hidden = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160; }, { passive: true });
      root.addEventListener('toggle', (e) => { const d = e.target; if (d.dataset?.det) st.det.set(d.dataset.det, d.open); }, true);
    }
    if (paneList) {
      root.addEventListener('toggle', (e) => { if (e.target.matches?.('.cx-arch')) st.showArchived = e.target.open; }, true);
    }
    function blockAt(i) { return blocksFor(ctx, s)[i]; }
    function plainOf(b) {
      if (b.type === 'user') return b.text;
      return b.blocks.map((x) => x.p || (x.code ? x.code.text : x.table ? [x.table.head, ...x.table.rows].map((r) => r.join('\t')).join('\n') : '')).join('\n\n');
    }
    async function copy(text, what = 'Copied') {
      try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked in the prototype */ }
      ctx.toast(what, { tone: 'success' });
    }
    function msgAction(act, i) {
      const b = blockAt(i);
      if (!b) return;
      if (act === 'm-copy') copy(plainOf(b), 'Message copied');
      else if (act === 'm-edit') editMessage(b);
      else if (act === 'm-fork') ctx.toast('Forked from this message', { tone: 'success', detail: `new session from ${s.id} · ${fmtTime(b.at)}`, action: { label: 'Open', onClick: () => ctx.navigate(`/chat/new?prompt=${encodeURIComponent(plainOf(b).slice(0, 80))}`) } });
      else if (act === 'm-regen') { if (runOf(s).busy) { ctx.toast('Wait for the current turn, or Stop it first', { tone: 'warning' }); return; } simulateTurn(ctx, s, 'regenerate', { final: 'Regenerated (prototype): same facts, tighter wording. Backoff waits min(cap, 2^attempt) s with full jitter; 15/15 tests pass; next step is the push.' }); }
      else if (act === 'm-read') ctx.toast('Reading aloud', { tone: 'info', detail: `${plainOf(b).split(/\s+/).length} words · system voice`, action: { label: 'Stop', onClick: () => {} } });
    }
    function messageMenu(i, anchor) {
      const b = blockAt(i);
      if (!b) return;
      const user = b.type === 'user';
      openMenu(ctx, anchor, {
        title: user ? 'Your message' : `${b.profile}’s reply`,
        items: [
          { label: 'Copy', icon: 'copy', run: () => msgAction('m-copy', i) },
          ...(user ? [{ label: 'Edit and resend', icon: 'draft', run: () => msgAction('m-edit', i) }] : []),
          { label: 'Fork from here', icon: 'git', run: () => msgAction('m-fork', i) },
          ...(!user ? [{ label: 'Regenerate', icon: 'refresh', run: () => msgAction('m-regen', i) }, { label: 'Read aloud', icon: 'broadcast', run: () => msgAction('m-read', i) }] : []),
        ],
      });
    }
    function editMessage(b) {
      ctx.openSheet({
        title: 'Edit message',
        body: `<div class="field"><label class="field__label" for="cx-edit">Message</label><textarea id="cx-edit" class="input" rows="5">${esc(b.text)}</textarea><p class="field__help">Resending forks the conversation from here. The original branch stays in the session history.</p></div>`,
        footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-save>Resend</button>',
        initialFocus: '#cx-edit',
        onMount(panel, layer) {
          panel.querySelector('[data-save]').addEventListener('click', () => {
            const v = panel.querySelector('#cx-edit').value.trim();
            layer.close();
            if (!v) return;
            if (runOf(s).busy) stopRun(ctx, s, { quiet: true });
            sendNow(ctx, s, v);
            ctx.toast('Edited and resent', { detail: 'forked from the original message' });
          });
        },
      });
    }

    /* ---- composer ---- */
    const form = root.querySelector('[data-composer]');
    const ta = root.querySelector('#cx-input');
    const slash = root.querySelector('#cx-slash');
    const ptt = root.querySelector('[data-ptt]');
    let slashItems = [], slashI = 0, draftTimer = null;
    const grow = () => { ta.style.blockSize = 'auto'; ta.style.blockSize = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4))}px`; };
    const draftEl = () => root.querySelector('[data-r="draft"]');
    if (ta) {
      ta.value = st.drafts[key] || (view === 'new' && ctx.query.prompt) || '';
      grow();
      ta.addEventListener('input', () => {
        grow();
        updateSlash();
        clearTimeout(draftTimer);
        const v = ta.value;
        draftTimer = setTimeout(() => {
          const had = !!st.drafts[key];
          if (v.trim()) st.drafts[key] = v; else delete st.drafts[key];
          draftEl().textContent = v.trim() ? 'Draft saved' : '';
          if (had !== !!st.drafts[key]) upd('list');
        }, 500);
      });
      ta.addEventListener('keydown', (e) => {
        if (!slash.hidden) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSlash(slashI + (e.key === 'ArrowDown' ? 1 : -1)); return; }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runSlash(slashItems[slashI]); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSlash(); return; }
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
      });
      ta.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement) || document.activeElement !== ta) hideSlash(); }, 150));
    }
    function updateSlash() {
      const m = ta.value.match(/^\/(\S*)$/);
      if (!m) { hideSlash(); return; }
      slashItems = SLASH.filter((c) => c.cmd.startsWith('/' + m[1].toLowerCase()));
      if (!slashItems.length) { hideSlash(); return; }
      slash.innerHTML = slashItems.map((c, i) => `<li role="option" id="cx-sl-${i}" class="menu__item cx-slash__item" data-sl="${i}" aria-selected="false"><span class="mono">${esc(c.cmd)}</span><span class="subtle">${esc(c.desc)}</span></li>`).join('');
      slash.hidden = false;
      ta.setAttribute('aria-expanded', 'true');
      setSlash(0);
    }
    function setSlash(i) {
      slashI = (i + slashItems.length) % slashItems.length;
      slash.querySelectorAll('[role=option]').forEach((o, k) => o.setAttribute('aria-selected', String(k === slashI)));
      ta.setAttribute('aria-activedescendant', `cx-sl-${slashI}`);
      slash.querySelector(`#cx-sl-${slashI}`)?.scrollIntoView({ block: 'nearest' });
    }
    function hideSlash() {
      if (!slash || slash.hidden) return;
      slash.hidden = true; ta.setAttribute('aria-expanded', 'false'); ta.removeAttribute('aria-activedescendant');
    }
    slash?.addEventListener('mousedown', (e) => e.preventDefault());
    slash?.addEventListener('click', (e) => { const o = e.target.closest('[data-sl]'); if (o) runSlash(slashItems[+o.dataset.sl]); });
    function runSlash(c) {
      hideSlash();
      if (!c) return;
      if (c.args) { ta.value = `${c.cmd} `; ta.focus(); return; }
      ta.value = ''; grow();
      const anchor = root.querySelector('[data-pick="model"]') || root.querySelector('[data-act="config"]') || ta;
      if (c.cmd === '/model') openPicker(ctx, s, 'model', anchor);
      else if (c.cmd === '/reasoning') openPicker(ctx, s, 'reasoning', root.querySelector('[data-pick="reasoning"]') || anchor);
      else if (c.cmd === '/prompts') openPrompts(ctx);
      else if (c.cmd === '/usage') openContextSheet(ctx, s);
      else if (c.cmd === '/compress') { if (s) { s.context = Math.max(0.06, (s.context || 0) / 3); upd('chips', 'ring'); } ctx.toast('Context compressed', { detail: 'older turns summarised · transcript kept' }); }
      else if (c.cmd === '/fork') ctx.toast('Forked into a new session', { detail: s ? `from ${s.id}` : 'empty chat', action: { label: 'Open', onClick: () => ctx.navigate('/chat/new') } });
      else if (c.cmd === '/new') ctx.navigate('/chat/new');
      ta.focus();
    }
    function hint(msg) { const d = draftEl(); if (d) { d.textContent = msg; setTimeout(() => { if (d.textContent === msg) d.textContent = st.drafts[key] ? 'Draft saved' : ''; }, 2200); } ta.focus(); }
    function takeText() {
      const v = ta.value.trim();
      clearTimeout(draftTimer);
      ta.value = ''; grow();
      delete st.drafts[key];
      draftEl().textContent = '';
      const att = st.attach[key] || [];
      st.attach[key] = [];
      upd('attach');
      return { v, att };
    }
    function submit(kind) {
      hideSlash();
      if (!ta.value.trim()) { hint(kind === 'send' ? 'Type a message first' : `Type a message to ${kind === 'queue' ? 'queue' : 'steer'}`); return; }
      if (view === 'new') return createSession();
      const r = runOf(s);
      const { v, att } = takeText();
      if (!r.busy) { sendNow(ctx, s, v, att); upd('list'); return; }
      if (kind === 'queue') {
        (st.queue[s.id] ||= []).push({ id: `q${++qid}`, text: v });
        upd('cards');
        ctx.toast('Queued', { tone: 'info', detail: 'sends when this turn finishes' });
      } else if (kind === 'interrupt') {
        stopRun(ctx, s, { quiet: true });
        sendNow(ctx, s, v, att);
        ctx.toast('Interrupted and sent', { tone: 'info' });
      } else {
        extra(s.id).push({ type: 'event', at: Date.now(), tone: 'accent', icon: 'steer', text: `Steer: “${v}” · applies at the next step` });
        upd('log');
        ctx.toast('Steer sent', { tone: 'info', detail: 'applies at the next step' });
      }
      ta.focus();
    }
    function createSession() {
      const c = cfgFor(ctx, null);
      const { v, att } = takeText();
      const nid = `s_new_${++st.newN}`;
      const proj = ctx.data.projects.find((p) => p.repo === c.workspace);
      const ns = { id: nid, title: v.length > 56 ? `${v.slice(0, 54)}…` : v, preview: v, source: 'caduceus', profile: c.profile, model: c.model, live: true, liveState: 'running', pinned: false, project: proj?.id || null, updated: Date.now(), started: Date.now(), messages: 1, tokens: 1_200, cost: 0, context: 0.02 };
      ctx.data.sessions.unshift(ns);
      st.cfg[nid] = { ...c, toolsets: new Set(c.toolsets) };
      delete st.cfg.new;
      extra(nid).push({ type: 'user', at: Date.now(), text: v, attachments: att });
      simulateTurn(ctx, ns, v);
      ctx.navigate('/chat/' + nid);
    }
    form?.addEventListener('submit', (e) => { e.preventDefault(); submit(s && runOf(s).busy ? 'steer' : 'send'); });

    /* ---- voice: hold to talk (compact) or tap to dictate ---- */
    const mic = root.querySelector('[data-act="mic"]');
    let rec = null;
    function pttShow(text, hold) {
      ptt.hidden = false;
      ptt.innerHTML = `<span class="cx-ptt__dot" aria-hidden="true"></span><span class="cx-ptt__wave" aria-hidden="true">${'<i></i>'.repeat(14)}</span><span class="mono" data-ptt-t>0:00</span><span class="cx-ptt__hint">${esc(text)}</span>`;
      ptt.classList.toggle('is-hold', !!hold);
    }
    function recStart(hold) {
      rec = { hold, t0: Date.now(), cancel: false };
      mic.setAttribute('aria-pressed', 'true');
      mic.classList.add('is-rec');
      pttShow(hold ? 'Release to send · slide away to cancel' : 'Dictating… tap the mic to stop', hold);
      rec.tick = setInterval(() => { const el = ptt.querySelector('[data-ptt-t]'); if (el) el.textContent = fmtDur((Date.now() - rec.t0) / 1000).replace(/^(\d+)s$/, '0:$1').replace(/^0:(\d)$/, '0:0$1'); }, 250);
    }
    function recStop(send) {
      if (!rec) return;
      clearInterval(rec.tick);
      const r = rec; rec = null;
      mic.setAttribute('aria-pressed', 'false');
      mic.classList.remove('is-rec');
      ptt.hidden = true;
      if (r.cancel) { ctx.toast('Voice message cancelled', { tone: 'info' }); return; }
      const text = 'Also add a changelog entry for the backoff change.';
      ta.value = ta.value.trim() ? `${ta.value.trim()} ${text}` : text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      if (send && r.hold) form.requestSubmit(); else ta.focus();
    }
    if (mic) {
      let holdTimer = null, down = null;
      mic.addEventListener('pointerdown', (e) => {
        if (!compact || e.button > 0) return;
        down = { x: e.clientX, y: e.clientY };
        mic.setPointerCapture(e.pointerId);
        holdTimer = setTimeout(() => { holdTimer = null; recStart(true); }, 280);
      });
      mic.addEventListener('pointermove', (e) => {
        if (!rec?.hold || !down) return;
        const far = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 64;
        rec.cancel = far;
        ptt.classList.toggle('is-cancel', far);
        const h = ptt.querySelector('.cx-ptt__hint'); if (h) h.textContent = far ? 'Release to cancel' : 'Release to send · slide away to cancel';
      });
      mic.addEventListener('pointerup', () => {
        if (!compact) return;
        down = null;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; mic.dataset.tap = '1'; return; }
        if (rec?.hold) { recStop(true); mic.dataset.swallow = '1'; }
      });
      mic.addEventListener('click', () => {
        if (mic.dataset.swallow) { delete mic.dataset.swallow; return; }
        if (compact && !mic.dataset.tap) return;
        delete mic.dataset.tap;
        if (rec) recStop(false); else recStart(false);
      });
    }

    /* ---- delegated clicks ---- */
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-ctxbox]')) return; // context panel wires itself
      if (s && pendingClick(e, ctx, s)) return;
      const src = e.target.closest('[data-src]');
      if (src) { const k = src.dataset.src; if (st.sources.has(k)) st.sources.delete(k); else st.sources.add(k); src.setAttribute('aria-pressed', String(st.sources.has(k))); refreshList(`${visibleSessions(ctx).length} sessions shown`); return; }
      const pj = e.target.closest('[data-proj]');
      if (pj) { st.project = st.project === pj.dataset.proj ? null : pj.dataset.proj; root.querySelectorAll('[data-proj]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.proj === st.project))); refreshList(`${visibleSessions(ctx).length} sessions shown`); return; }
      const md = e.target.closest('[data-mode]');
      if (md) { setMode(md.dataset.mode); return; }
      const pk = e.target.closest('[data-pick]');
      if (pk) { openPicker(ctx, s, pk.dataset.pick, pk); return; }
      const sg = e.target.closest('[data-sugg]');
      if (sg) { insertText(SUGGEST[+sg.dataset.sugg].text, true); return; }
      const qa = e.target.closest('[data-q-act]');
      if (qa) { queuedAction(qa); return; }
      const rm = e.target.closest('[data-att-rm]');
      if (rm) { st.attach[key].splice(+rm.dataset.attRm, 1); upd('attach'); ta.focus(); return; }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'cross') { st.cross = a.getAttribute('aria-checked') !== 'true'; st.crossScope = ctx.scope; const all = effScope(ctx) === 'all'; a.setAttribute('aria-checked', String(all)); root.querySelector('#cx-cross-l .subtle').textContent = all ? 'Sessions from every profile' : `Only ${effScope(ctx)}`; refreshList(all ? 'Showing all profiles' : `Showing ${effScope(ctx)} only`); }
      else if (act === 'clear-filters') { st.sources.clear(); st.project = null; root.querySelectorAll('[data-src],[data-proj]').forEach((b) => b.setAttribute('aria-pressed', 'false')); refreshList('Filters cleared'); }
      else if (act === 'row-menu') rowMenu(getSession(a.closest('.cx-row').dataset.sid), a);
      else if (act === 'msg-menu') messageMenu(+a.dataset.bi, a);
      else if (act.startsWith('m-')) msgAction(act, +a.dataset.bi);
      else if (act === 'mode-menu') openMenu(ctx, a, { title: 'Activity mode', items: MODES.map((m) => ({ label: m.label, sub: { worklog: 'Cards for every step', stream: 'Raw chronological event stream', final: 'Only messages and final answers' }[m.id], checked: st.mode === m.id, run: () => setMode(m.id) })) });
      else if (act === 'jump') { sc.scrollTo({ top: sc.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); a.hidden = true; ta?.focus({ preventScroll: true }); }
      else if (act === 'copy-code') copy(a.closest('.code').querySelector('pre').textContent, 'Code copied');
      else if (act === 'preview') { st.ctxTab = 'preview'; st.prevSrc = 'file'; st.prevFile = a.dataset.file; showCtx(); }
      else if (act === 'ctx-tab') { st.ctxTab = a.dataset.tab; showCtx(); }
      else if (act === 'ctx-open') { st.ctxOpen = true; ctx.refresh(); requestAnimationFrame(() => root.isConnected || document.querySelector('[data-act="ctx-close"]')?.focus()); }
      else if (act === 'ctx-close') { st.ctxOpen = false; ctx.refresh(); requestAnimationFrame(() => document.querySelector('[data-act="ctx-open"]')?.focus()); }
      else if (act === 'focus-card') { const c = root.querySelector('.cx-apr'); c?.scrollIntoView({ block: 'nearest' }); c?.focus(); }
      else if (act === 'open-pending') openPendingSheet(ctx, s);
      else if (act === 'config') openConfig(ctx, s);
      else if (act === 'attach') openMenu(ctx, a, { title: 'Attach', items: [
        { label: 'Upload from this device…', icon: 'download', run: () => addAttach('screenshot-2026-10-06.png') },
        { label: 'Add from workspace…', icon: 'folder', run: () => addAttach('src/webhooks/dispatch.ts') },
        { label: 'Paste from clipboard', icon: 'copy', run: () => addAttach('clipboard.txt') },
      ] });
      else if (act === 'busy-menu') openMenu(ctx, a, { title: 'Send while the agent works', items: Object.entries(BUSY).map(([k, m]) => ({ label: m.label, sub: m.sub, icon: m.icon, run: () => submit(k) })).concat([{ sep: true }, { label: 'Stop the run', icon: 'stop', danger: true, run: () => stopRun(ctx, s) }]) });
      else if (act === 'queue') submit('queue');
      else if (act === 'stop') stopRun(ctx, s);
      else if (act === 'term-off') toggleTerminal();
    });
    root.addEventListener('submit', (e) => {
      if (s && pendingSubmit(e, ctx, s)) return;
      if (e.target.matches('[data-term-form]')) {
        e.preventDefault();
        const inp = e.target.querySelector('input');
        if (!inp.value.trim()) return;
        st.term.push(inp.value.trim()); inp.value = '';
        const box = root.querySelector('[data-r="term"]');
        box.innerHTML = String(html`${termLines(s).map(([k, t]) => html`<div class="cx-term__l cx-term__l--${k}">${t}</div>`)}`);
        box.scrollTop = box.scrollHeight;
      }
    });
    root.addEventListener('keydown', (e) => {
      // ↵ on a focused approval card = Allow once (mobile §8)
      if (e.key === 'Enter' && e.target.matches?.('.cx-apr[data-apr]')) { e.preventDefault(); const b = pendingFor(ctx, s); if (b) decideApproval(ctx, s, b, 'once'); }
    });
    function addAttach(name) { (st.attach[key] ||= []).push(name); upd('attach'); ta?.focus(); ctx.toast('Attached', { detail: name }); }
    function setMode(m) {
      st.mode = m;
      root.querySelectorAll('.cx-modes [data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      const mb = root.querySelector('.cx-modebtn');
      if (mb) { const l = MODES.find((x) => x.id === m).label; mb.querySelector('span').textContent = l; mb.setAttribute('aria-label', `Activity mode: ${l}. Change`); }
      upd('log');
      if (sc) sc.scrollTop = sc.scrollHeight;
    }
    live.setMode = setMode;
    function showCtx() {
      if (ctx.size === 'large') {
        if (!st.ctxOpen) { st.ctxOpen = true; ctx.refresh(); requestAnimationFrame(() => document.querySelector(`[data-ctx-tab="${st.ctxTab}"]`)?.focus()); return; }
        const box = root.querySelector('.cx-ctx [data-ctxbox]');
        box.innerHTML = String(ctxInner(ctx, s, 'cxp'));
        box.querySelector(`[data-ctx-tab="${st.ctxTab}"]`)?.focus();
      } else openCtxSheet(ctx, s);
    }
    function queuedAction(btn) {
      const id = btn.closest('[data-q]').dataset.q;
      const list = st.queue[s.id] || [];
      const m = list.find((x) => x.id === id);
      if (!m) return;
      const k = btn.dataset.qAct;
      if (k === 'edit') { m.editing = true; upd('cards'); root.querySelector(`#cx-q-${id}`)?.focus(); return; }
      if (k === 'edit-cancel') { m.editing = false; upd('cards'); root.querySelector(`[data-q="${id}"] [data-q-act="edit"]`)?.focus(); return; }
      if (k === 'save') { const v = root.querySelector(`#cx-q-${id}`).value.trim(); m.editing = false; if (v) m.text = v; upd('cards'); ctx.toast('Queued message updated', { tone: 'info' }); root.querySelector(`[data-q="${id}"] [data-q-act="edit"]`)?.focus(); return; }
      list.splice(list.indexOf(m), 1);
      if (k === 'cancel') {
        ta.value = ta.value.trim() ? `${ta.value.trim()}\n${m.text}` : m.text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        upd('cards');
        ta.focus();
        ctx.toast('Queued message cancelled', { tone: 'info', detail: 'text returned to the composer' });
      } else if (k === 'send') { upd('cards'); sendNow(ctx, s, m.text); }
    }

    /* ---- context panel (large) ---- */
    const box = root.querySelector('.cx-ctx [data-ctxbox]');
    if (box && s) bindCtx(box, ctx, s, 'cxp');

    /* ---- compact: approval / clarify arrive as a bottom sheet ---- */
    if (compact && s) {
      const p = pendingFor(ctx, s);
      if (p && !st.autoSheet.has(p.id)) timers.push(setTimeout(() => { if (live?.root === root) openPendingSheet(ctx, s); }, 250));
    }

    /* ---- tickers: elapsed tool time, clarify countdown ---- */
    timers.push(setInterval(() => {
      document.querySelectorAll('.cx [data-elapsed], .cx-pendsheet [data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); });
      document.querySelectorAll('[data-countdown]').forEach((el) => {
        const b = blocksFor(ctx, s).find((x) => x.id === el.dataset.countdown);
        if (!b) return;
        const left = Math.round((deadlineOf(b) - Date.now()) / 1000);
        el.querySelector('span').textContent = fmtDur(Math.max(0, left));
        if (left <= 0 && !st.decided[b.id] && live?.root === root) answerClarify(ctx, s, b, b.fallback, true);
      });
    }, 1000));

    return () => {
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      clearTimeout(draftTimer); clearTimeout(qTimer);
      if (rec) clearInterval(rec.tick);
      dockRO?.disconnect();
      document.documentElement.style.removeProperty('--cx-dock-h');
      closePop(false);
      if (live?.root === root) live = null;
    };
  },

  paletteActions(ctx) {
    const cur = MODES.find((m) => m.id === st.mode);
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    return [
      { label: 'New chat', icon: 'plus', sub: `as ${ctx.profile.name}`, run: () => ctx.navigate('/chat/new') },
      { label: 'Search sessions', icon: 'search', sub: 'Full text: titles, messages, tool output', run: async () => {
        if (ctx.size !== 'large' && ctx.path !== '/chat') ctx.navigate('/chat');
        await overlaysSettled();
        setTimeout(() => document.getElementById('cx-q')?.focus(), 80);
      } },
      { label: `Activity mode: switch to ${next.label}`, icon: 'rows', sub: `Now ${cur.label} · Worklog → Stream → Final only`, run: () => {
        st.mode = next.id;
        if (live?.setMode) live.setMode(next.id);
        ctx.toast(`Activity mode: ${next.label}`, { tone: 'info' });
      } },
    ];
  },
};
