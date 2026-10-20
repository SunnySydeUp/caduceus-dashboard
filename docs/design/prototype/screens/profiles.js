// Profiles (IA §5, mobile §4 "Agents"): cards → detail tabs; /new = 5-step Profile Builder.
// PROTOTYPE: screen-local mock files (SOUL.md, AGENTS.md, MEMORY.md, USER.md) live in `local` below.
import {
  html, raw, esc, icon, statusBadge, avatarIdx, pageHeader, emptyState, fmtAgo as fmtAgoRaw, fuzzy,
  SOURCES, openLayer, overlaysSettled, uid,
} from '../shared.js';
/** fmtAgo that reads well before " ago" ("a moment ago", never "just now ago"). */
const fmtAgo = (ts, o) => { const s = fmtAgoRaw(ts, o); return s === 'just now' ? 'a moment' : s; };

const CSS_HREF = new URL('./profiles.css', import.meta.url).href;
if (!document.querySelector(`link[href="${CSS_HREF}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS_HREF }));

/* ==========================================================================
   Screen-local mock data
   ========================================================================== */
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'agents' },
  { id: 'identity', label: 'Identity', icon: 'user', file: 'SOUL.md' },
  { id: 'instructions', label: 'Instructions', icon: 'book', file: 'AGENTS.md' },
  { id: 'memory', label: 'Memory', icon: 'database' },
  { id: 'skills', label: 'Skills', icon: 'stack' },
  { id: 'tools', label: 'Tools & MCP', icon: 'plug' },
  { id: 'model', label: 'Model', icon: 'cpu' },
  { id: 'gateway', label: 'Gateway & channels', icon: 'broadcast' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'danger', label: 'Danger zone', icon: 'alert' },
];
const MEM_LIMIT = { 'MEMORY.md': 2200, 'USER.md': 1375 };
const TOOLSETS = [
  ['web', 'Web search & extract', 'search'], ['browser', 'Browser automation', 'browser'], ['terminal', 'Terminal', 'terminal'],
  ['file', 'File read / write', 'file'], ['code_execution', 'Code execution', 'code'], ['vision', 'Vision', 'eye'],
  ['memory', 'Memory', 'database'], ['delegation', 'Subagent delegation', 'subagent'], ['cronjob', 'Cron jobs', 'clock'],
  ['tts', 'Text to speech', 'mic'], ['homeassistant', 'Home Assistant', 'home'],
];
const PERSONA_TOOLS = {
  default: ['web', 'browser', 'file', 'memory', 'cronjob', 'tts', 'vision'],
  coder: ['web', 'terminal', 'file', 'code_execution', 'memory', 'delegation'],
  librarian: ['web', 'browser', 'file', 'memory', 'delegation'],
  property: ['web', 'file', 'memory', 'cronjob'],
  general: ['web', 'memory', 'cronjob', 'tts'],
  homeassistant: ['homeassistant', 'memory', 'cronjob', 'web'],
};
const SOULS = {
  default: `# Who you are\nYou are **Hermes**, the household's everyday assistant. Warm, brief and practical.\n\n## Voice\n- Answer first, then the detail.\n- Use plain words; no corporate filler.\n- On Telegram keep replies under 120 words.\n\n## Boundaries\n- Never send messages to other people without asking.\n- Money moves always need an explicit yes.`,
  coder: `# Who you are\nYou are a careful senior engineer working on \`caduceus-dashboard\` and \`home-lab\`.\n\n## Working style\n- Read the code before changing it.\n- Small commits, one concern each.\n- Tests first when fixing a bug.\n\n## Boundaries\n- Never push to \`main\`; open a PR.\n- Ask before adding a dependency.`,
  librarian: `# Who you are\nYou are a research librarian. You find primary sources and cite every claim.\n\n## Method\n1. Plan the search.\n2. Read, then extract quotes with links.\n3. Synthesise; flag disagreement between sources.\n\n## Style\n- Chicago author-date unless asked.\n- Say when evidence is thin.`,
  property: `# Who you are\nYou manage a small rental portfolio: tenants, leases, council documents and the rent ledger.\n\n## Rules\n- Dates in **D MMM YYYY**.\n- Never contact a tenant directly; draft and ask.\n- Keep the ledger sheet the single source of truth.`,
  general: `# Who you are\nHousehold admin: shopping lists, meal plans, renewals.\n\n## Style\n- Lists over paragraphs.\n- Metric units.`,
  homeassistant: `# Who you are\nYou operate Home Assistant for the house and report on energy.\n\n## Rules\n- Read state before calling a service.\n- Never unlock doors or disarm the alarm.\n- Weekly energy digest every Sunday.`,
};
const AGENTS_MD = (p) => `# ${p.name}: working instructions\n\n## Projects\n- Default workspace: \`~/work\`\n- Use the project's own task runner.\n\n## Conventions\n- Commit messages: imperative, under 72 characters.\n- Prefer editing existing files over creating new ones.\n\n## Escalate\n- Anything that spends money or messages a person.`;
const MEMORY_MD = {
  default: `- User prefers replies before 08:00 to be one line.\n- Bin day is Tuesday; recycling alternate weeks (next: 14 Oct).\n- Car rego renews 2 Nov.\n- Partner is vegetarian; avoid fish recipes.\n- Morning briefing goes to Telegram, not Discord.\n- Uses Fastmail for personal email; household@ is Google.`,
  coder: `- caduceus-dashboard uses pnpm 9 and Vitest; run \`pnpm -w test\`.\n- CI is GitHub Actions; Safari job is flaky on resume.spec.ts.\n- Worktrees live under ~/work/wt/<branch>.\n- The user reviews PRs in the evening; batch questions.`,
};
const USER_MD = `- Name: Sam. Pronouns: they/them.\n- Timezone: Australia/Melbourne.\n- Prefers British spelling.\n- Wants costs shown in AUD.`;

const PERSONAS = [
  { id: 'blank', name: 'Blank', icon: 'file', desc: 'Empty SOUL.md, no skills attached.', model: 'deepseek-v4.1-flash', skills: [], mcps: [], soul: '# Who you are\n' },
  { id: 'engineer', name: 'Software engineer', icon: 'code', desc: 'Repos, worktrees, PRs and CI.', model: 'glm-5.3', skills: ['software/github-pr-workflow', 'software/test-driven-dev'], mcps: ['github'], soul: SOULS.coder },
  { id: 'researcher', name: 'Researcher', icon: 'book', desc: 'Primary sources, citations, briefs.', model: 'deepseek-v4.1', skills: ['research/web-research', 'research/citation-formatter'], mcps: ['filesystem'], soul: SOULS.librarian },
  { id: 'household', name: 'Household admin', icon: 'home', desc: 'Lists, renewals, meal plans.', model: 'deepseek-v4.1-flash', skills: ['writing/plain-language', 'productivity/google-workspace'], mcps: [], soul: SOULS.general },
  { id: 'homeauto', name: 'Home automation', icon: 'bolt', desc: 'Home Assistant control and energy.', model: 'glm-5.3-flash', skills: ['home/home-assistant-control'], mcps: ['home-assistant'], soul: SOULS.homeassistant },
];
const STEPS = [
  { id: 'identity', label: 'Identity' }, { id: 'model', label: 'Model' }, { id: 'skills', label: 'Skills' },
  { id: 'mcps', label: 'MCP servers' }, { id: 'review', label: 'Review' },
];
const PROVIDER_KEY = { deepseek: 'k_deepseek', 'z.ai': 'k_zai', openrouter: 'k_openrouter' };

/* Per-profile files and settings, created lazily (never mutates shared `data` at load). */
const local = {};
function L(p) {
  if (!local[p.name]) {
    const soul = SOULS[p.name] || `# Who you are\n${p.description || ''}`;
    local[p.name] = {
      files: { 'SOUL.md': soul, 'AGENTS.md': AGENTS_MD(p), 'MEMORY.md': MEMORY_MD[p.name] || '- No memories saved yet.', 'USER.md': USER_MD },
      saved: { 'SOUL.md': daysAgo(2), 'AGENTS.md': daysAgo(9), 'MEMORY.md': daysAgo(0.1), 'USER.md': daysAgo(3) },
      autoDescribed: p.name === 'librarian' || p.name === 'homeassistant',
      tools: new Set(PERSONA_TOOLS[p.name] || ['web', 'memory']),
      reasoning: p.name === 'coder' ? 'high' : 'medium',
      fallback: p.provider === 'z.ai' ? 'deepseek-v4.1-flash' : 'glm-5.3-flash',
    };
  }
  return local[p.name];
}
function daysAgo(days) { return Date.now() - days * 864e5; }
const sizeOf = (s) => new Blob([s]).size;
const fmtBytes = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`);
const tab = (id) => TABS.find((t) => t.id === id);

/* Tiny Markdown renderer for previews (escapes first). */
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.t}>`); list = null; } };
  for (const line of String(src).split('\n')) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flush(); const lv = m[1].length + 2; out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list?.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; } list.items.push(inline(m[1])); }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list?.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; } list.items.push(inline(m[1])); }
    else if ((m = line.match(/^>\s?(.*)/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) flush();
    else { flush(); out.push(`<p>${inline(line)}</p>`); }
  }
  flush();
  return raw(out.join(''));
}

/* ==========================================================================
   Shared fragments
   ========================================================================== */
function gatewayLabel(p) {
  const on = p.gateway === 'running';
  return html`<span class="pf-gw"><span class="dot${on ? '' : ' dot--hollow'}" data-tone="${on ? 'success' : 'neutral'}" aria-hidden="true"></span>Gateway ${on ? 'running' : 'stopped'}</span>`;
}
function badges(p, ctx) {
  return html`${p.isDefault ? html`<span class="tag" data-tone="accent">${icon('check', 'i-sm')}Default</span>` : ''}${ctx.profile.name === p.name ? html`<span class="tag" data-tone="success">Active in this tab</span>` : ''}`;
}
function autoTag(p) {
  return L(p).autoDescribed ? html`<span class="tag pf-auto" title="Written by the model from recent sessions">${icon('bolt', 'i-sm')}Auto-described</span>` : '';
}

/* ==========================================================================
   List
   ========================================================================== */
function renderList(ctx) {
  const ps = ctx.data.profiles;
  const running = ps.filter((p) => p.gateway === 'running').length;
  const q = (ctx.query.q || '').trim();
  const shown = q ? ps.filter((p) => fuzzy(q, `${p.name} ${p.description} ${p.model} ${p.provider}`) >= 0) : ps;
  return html`<div class="pf">
    ${pageHeader({
      overline: 'Agents',
      title: 'Profiles',
      subtitle: `${ps.length} profiles · ${running} gateways running · Hermes default: ${ps.find((p) => p.isDefault)?.name}`,
      actions: html`<a class="btn btn--primary" href="${ctx.href('/agents/profiles/new')}">${icon('plus')}New profile</a>`,
    })}
    <div class="pf-tools">
      <div class="input-wrap pf-search">${icon('search')}<input class="input" type="search" placeholder="Filter profiles" aria-label="Filter profiles" value="${q}" data-filter></div>
    </div>
    <ul class="pf-cards" aria-label="Profiles">
      ${shown.map((p) => html`<li class="pf-card">
        <div class="pf-card__top">
          ${avatarLg(p.name)}
          <div class="pf-card__id">
            <h2 class="pf-card__name"><a href="${ctx.href('/agents/profiles/' + p.name)}">${p.name}</a></h2>
            <div class="pf-card__badges">${badges(p, ctx)}</div>
          </div>
          <button type="button" class="btn btn--ghost btn--icon pf-card__more" data-more="${p.name}" aria-label="Actions for ${p.name}" aria-haspopup="dialog">${icon('dots-v')}</button>
        </div>
        <p class="pf-card__desc">${p.description || html`<span class="subtle">No description yet.</span>`}</p>
        <div class="pf-card__flags">${autoTag(p)}</div>
        <dl class="pf-card__meta">
          <div><dt class="sr-only">Gateway</dt><dd>${gatewayLabel(p)}</dd></div>
          <div><dt class="sr-only">Model</dt><dd class="mono truncate">${p.model} · ${p.provider}</dd></div>
          <div><dt class="sr-only">Skills</dt><dd>${icon('stack', 'i-sm')}${p.skills} skills</dd></div>
          <div><dt class="sr-only">Sessions</dt><dd>${icon('chat', 'i-sm')}${p.sessions} sessions</dd></div>
        </dl>
      </li>`)}
      ${q ? '' : html`<li class="pf-card pf-card--new"><a href="${ctx.href('/agents/profiles/new')}">${icon('plus')}<span><strong>New profile</strong><small>Builder: identity, model, skills, MCPs</small></span></a></li>`}
    </ul>
    ${!shown.length ? emptyState({ icon: 'users', title: 'No matching profiles', body: `Nothing matches “${q}”.` }) : ''}
  </div>`;
}
function avatarLg(name) {
  return raw(`<span class="avatar pf-av" data-av="${avatarIdx(name)}" aria-hidden="true">${esc(name[0].toUpperCase())}</span>`);
}

/* ⋮ actions sheet (no hover-only actions; mobile §2). */
function openActions(ctx, p, invoker) {
  const acts = [
    { id: 'open', icon: 'chev-r', label: 'Open profile' },
    { id: 'chat', icon: 'chat', label: `New chat as ${p.name}` },
    ctx.profile.name !== p.name && { id: 'use', icon: 'user', label: 'Use in this tab', sub: 'Sets ?profile= for this tab only' },
    !p.isDefault && { id: 'default', icon: 'fingerprint', label: 'Make default…', sub: 'Tier 2 · writes Hermes active_profile' },
    { id: 'rename', icon: 'draft', label: 'Rename…', sub: 'Undoable' },
    { id: 'export', icon: 'download', label: 'Export…', sub: 'Tier 3' },
    !p.isDefault && { id: 'delete', icon: 'trash', label: 'Delete…', sub: 'Tier 3 · type the name', danger: true },
  ].filter(Boolean);
  ctx.openSheet({
    title: p.name,
    body: String(html`<ul class="pf-acts">${acts.map((a) => html`<li><button type="button" class="pf-act${a.danger ? ' pf-act--danger' : ''}" data-a="${a.id}">${icon(a.icon)}<span><span>${a.label}</span>${a.sub ? html`<small>${a.sub}</small>` : ''}</span></button></li>`)}</ul>`),
    onMount(panel, layer) {
      panel.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.a;
        layer.close();
        await overlaysSettled();
        if (a === 'open') ctx.navigate(`/agents/profiles/${p.name}`);
        else if (a === 'chat') ctx.navigate(`/chat/new?profile=${p.name}`);
        else if (a === 'use') ctx.navigate(`${ctx.path}?profile=${p.name}`);
        else if (a === 'default') makeDefault(ctx, p);
        else if (a === 'rename') rename(ctx, p);
        else if (a === 'export') exportProfile(ctx, p);
        else if (a === 'delete') deleteProfile(ctx, p);
      }));
    },
  });
}

/* ==========================================================================
   Tiered actions (architecture §5)
   ========================================================================== */
function makeDefault(ctx, p) {
  const prev = ctx.data.profiles.find((x) => x.isDefault);
  ctx.openDialog({
    tier: 2, title: `Make ${p.name} the default profile?`,
    body: `Writes Hermes's sticky <span class="mono">active_profile</span>. The CLI, new gateway sessions and devices without a chosen profile will use <strong>${esc(p.name)}</strong> instead of <strong>${esc(prev?.name)}</strong>. Tabs that set <span class="mono">?profile=</span> are unaffected.`,
    profile: p.name, confirmLabel: 'Make default',
  }).then((ok) => {
    if (!ok) return;
    ctx.data.profiles.forEach((x) => { x.isDefault = x === p; });
    ctx.refresh();
    ctx.toast(`${p.name} is now the default profile`, { detail: `was ${prev?.name}` });
  });
}
function renameRefs(d, from, to) {
  const p = d.profiles.find((x) => x.name === from);
  if (p) { p.name = to; p.av = avatarIdx(to); }
  for (const s of d.sessions) if (s.profile === from) s.profile = to;
  for (const t of d.tasks) { if (t.assignee === from) t.assignee = to; for (const r of t.runs) if (r.profile === from) r.profile = to; }
  for (const i of d.inbox) if (i.profile === from) i.profile = to;
  for (const j of d.cron) if (j.profile === from) j.profile = to;
  for (const s of d.skills) s.profiles = s.profiles.map((x) => (x === from ? to : x));
  for (const m of d.mcpServers) m.profiles = m.profiles.map((x) => (x === from ? to : x));
  for (const c of d.channels) c.profiles = c.profiles.map((x) => (x === from ? to : x));
  if (local[from]) { local[to] = local[from]; delete local[from]; }
}
const NAME_RE = /^[a-z][a-z0-9_-]{1,23}$/;
function nameError(d, name, except) {
  if (!name) return 'Enter a name.';
  if (!NAME_RE.test(name)) return 'Use 2–24 lowercase letters, digits, - or _, starting with a letter.';
  if (name !== except && d.profiles.some((x) => x.name === name)) return `A profile called “${name}” already exists.`;
  return '';
}
function rename(ctx, p) {
  const id = uid('rn');
  ctx.openSheet({
    title: `Rename ${p.name}`,
    body: `<div class="field"><label class="field__label" for="${id}">New name</label><input id="${id}" class="input input--mono" value="${esc(p.name)}" autocomplete="off" spellcheck="false" aria-describedby="${id}-h ${id}-e"><p class="field__help" id="${id}-h">Renames <span class="mono">~/.hermes/profiles/${esc(p.name)}</span> and every reference. You can undo for a few seconds.</p><p class="field__error" id="${id}-e" hidden></p></div>`,
    footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-go>Rename</button>',
    initialFocus: 'input',
    onMount(panel, layer) {
      const input = panel.querySelector('input');
      const err = panel.querySelector('.field__error');
      input.select();
      const go = async () => {
        const to = input.value.trim();
        const e = to === p.name ? 'Choose a different name.' : nameError(ctx.data, to, p.name);
        if (e) { err.hidden = false; err.innerHTML = `${icon('alert', 'i-sm')}${esc(e)}`; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        const from = p.name;
        layer.close();
        await overlaysSettled();
        renameRefs(ctx.data, from, to);
        const onDetail = ctx.path.startsWith(`/agents/profiles/${from}`);
        if (onDetail) ctx.navigate(ctx.path.replace(`/agents/profiles/${from}`, `/agents/profiles/${to}`), { replace: true }); else ctx.refresh();
        ctx.toast(`Renamed ${from} → ${to}`, {
          undo: () => {
            renameRefs(ctx.data, to, from);
            const now = location.hash.slice(1).split('?')[0];
            if (now === `/agents/profiles/${to}` || now.startsWith(`/agents/profiles/${to}/`)) ctx.navigate(now.replace(`/agents/profiles/${to}`, `/agents/profiles/${from}`), { replace: true }); else ctx.refresh();
          },
        });
      };
      panel.querySelector('[data-go]').addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  });
}
function exportProfile(ctx, p) {
  ctx.openDialog({
    tier: 3, title: `Export ${p.name}?`, object: p.name, profile: p.name,
    body: `Creates <span class="mono">${esc(p.name)}-2026-10-06.tar.zst</span> with SOUL.md, AGENTS.md, memories, skills and config.yaml. <strong>It also contains this profile's .env keys.</strong>`,
    recoverability: 'Anyone with the archive can use these API keys. Store it like a password.',
    confirmLabel: 'Export',
  }).then((ok) => {
    if (ok) ctx.toast(`Export ready: ${p.name}-2026-10-06.tar.zst`, { detail: '4.2 MB · link valid for 10 minutes', action: { label: 'Download', onClick: () => ctx.toast('Download started (prototype)', { tone: 'info' }) } });
  });
}
function deleteProfile(ctx, p) {
  if (p.isDefault) { ctx.toast('Make another profile default before deleting this one', { tone: 'warning' }); return; }
  ctx.openDialog({
    tier: 3, title: `Delete ${p.name}?`, object: p.name, profile: p.name, danger: true,
    body: `Deletes <span class="mono">~/.hermes/profiles/${esc(p.name)}</span>: ${p.sessions} sessions, memories, skills and config. Its gateway is stopped and its channels are unbound. Kanban tasks assigned to it return to Triage.`,
    recoverability: 'This cannot be undone from Caduceus. Only last night\'s backup (02:30) can restore it.',
    confirmLabel: 'Delete profile',
  }).then((ok) => {
    if (!ok) return;
    const i = ctx.data.profiles.indexOf(p);
    if (i >= 0) ctx.data.profiles.splice(i, 1);
    ctx.navigate('/agents/profiles', { replace: true, keepProfile: false });
    ctx.toast(`Deleted profile ${p.name}`, { tone: 'info', detail: 'Restorable only from backup' });
  });
}
function gatewayAction(ctx, p, verb) {
  const title = verb === 'start' ? `Start the gateway for ${p.name}?` : verb === 'stop' ? `Stop the gateway for ${p.name}?` : `Restart the gateway for ${p.name}?`;
  const body = verb === 'start'
    ? `Starts <span class="mono">hermes gateway</span> for this profile. Bound channels (${p.channels.join(', ') || 'none'}) begin delivering messages again.`
    : verb === 'stop'
      ? `Messages on ${esc(p.channels.join(', ') || 'its channels')} are not answered until it starts again. Running cron jobs for this profile finish first.`
      : 'Live sessions reconnect automatically; in-flight tool calls finish first.';
  ctx.openDialog({ tier: 2, title, body, profile: p.name, danger: verb === 'stop', confirmLabel: verb[0].toUpperCase() + verb.slice(1) }).then((ok) => {
    if (!ok) return;
    if (verb !== 'restart') p.gateway = verb === 'start' ? 'running' : 'stopped';
    ctx.refresh();
    ctx.toast(`Gateway ${verb === 'start' ? 'started' : verb === 'stop' ? 'stopped' : 'restarted'} for ${p.name}`, { tone: verb === 'stop' ? 'info' : 'success' });
  });
}

/* ==========================================================================
   Detail
   ========================================================================== */
const ed = { key: null, draft: '', mode: 'preview' }; // editor state survives re-renders
const edKey = (p, file) => `${p.name}/${file}`;
function edFor(p, file) {
  if (ed.key !== edKey(p, file)) Object.assign(ed, { key: edKey(p, file), draft: L(p).files[file], mode: 'preview' });
  return ed;
}
const isDirty = () => ed.key && (() => { const [n, f] = ed.key.split('/'); return local[n] && local[n].files[f] !== ed.draft; })();

function renderDetail(ctx, p, tabId) {
  const t = tab(tabId) || TABS[0];
  const large = ctx.size === 'large';
  const nav = html`<nav class="pf-tabs" aria-label="Profile sections"><ul>${TABS.map((x) => html`<li><a href="${ctx.href(`/agents/profiles/${p.name}${x.id === 'overview' ? '' : '/' + x.id}`)}" ${x.id === t.id ? raw('aria-current="page"') : ''} class="${x.id === 'danger' ? 'pf-tabs__danger' : ''}">${icon(x.icon, 'i-sm')}<span>${x.label}</span></a></li>`)}</ul></nav>`;
  return html`<div class="pf pf-detail">
    <header class="page-header pf-head">
      ${avatarLg(p.name)}
      <div class="page-header__text">
        <p class="overline">Profile${t.id !== 'overview' ? ` · ${t.label}` : ''}</p>
        <h1 tabindex="-1">${p.name}</h1>
        <div class="pf-head__meta">${badges(p, ctx)}${gatewayLabel(p)}<span class="mono subtle">${p.model} · ${p.provider}</span></div>
      </div>
      <div class="page-header__actions">
        ${ctx.profile.name !== p.name ? html`<a class="btn btn--secondary" href="${ctx.href(`${ctx.path}?profile=${p.name}`)}">${icon('user')}Use in this tab</a>` : ''}
        <a class="btn btn--primary" href="${ctx.href(`/chat/new?profile=${p.name}`)}">${icon('chat')}New chat</a>
      </div>
    </header>
    <div class="pf-body">
      ${nav}
      <section class="pf-panel" aria-labelledby="pf-tab-h">
        <h2 id="pf-tab-h" class="${t.id === 'overview' && !large ? 'sr-only' : 'pf-panel__title'}">${t.label}</h2>
        ${TAB_RENDER[t.id](ctx, p)}
      </section>
    </div>
  </div>`;
}

const TAB_RENDER = {
  overview(ctx, p) {
    const sessions = ctx.data.sessions.filter((s) => s.profile === p.name).sort((a, b) => b.updated - a.updated).slice(0, 4);
    const sr = p.successRate;
    const lo = L(p);
    return html`<div class="pf-ov">
      <div class="pf-stats">
        <div class="panel panel--pad stat"><p class="overline">Sessions</p><p class="stat__value">${p.sessions}</p></div>
        <div class="panel panel--pad stat"><p class="overline">Runs · 7 days</p><p class="stat__value">${p.runs7d}</p></div>
        <div class="panel panel--pad stat"><p class="overline">Success rate</p><p class="stat__value">${sr == null ? '—' : `${Math.round(sr * 100)}%`}</p>
          ${sr == null ? '' : html`<div class="progress" data-tone="${sr >= 0.9 ? 'success' : 'warning'}" role="img" aria-label="${Math.round(sr * 100)}% of runs succeeded"><i style="--p:${Math.round(sr * 100)}%"></i></div>`}</div>
        <div class="panel panel--pad stat"><p class="overline">Skills</p><p class="stat__value">${p.skills}</p></div>
      </div>
      <div class="pf-ov__grid">
        <div class="panel panel--pad pf-box">
          <div class="pf-box__head"><h3>About</h3>${autoTag(p)}</div>
          <p class="muted">${p.description || 'No description yet.'}</p>
          <div class="row pf-row-sm">
            <button type="button" class="btn btn--secondary btn--sm" data-autodesc>${icon('bolt')}${lo.autoDescribed ? 'Regenerate description' : 'Auto-describe'}</button>
            <a class="btn btn--ghost btn--sm" href="${ctx.href(`/agents/profiles/${p.name}/identity`)}">${icon('user')}Edit SOUL.md</a>
          </div>
        </div>
        <div class="panel panel--pad pf-box">
          <div class="pf-box__head"><h3>Gateway</h3>${p.gateway === 'running' ? statusBadge('online', { label: 'Running' }) : statusBadge('offline', { label: 'Stopped' })}</div>
          <p class="muted">${p.channels.length ? `Delivers on ${p.channels.map((c) => SOURCES[c]?.label || c).join(' and ')}.` : 'No channels bound. Chats from Caduceus and CLI still work.'}</p>
          <div class="row pf-row-sm">${p.gateway === 'running'
            ? html`<button type="button" class="btn btn--secondary btn--sm" data-gw="restart">${icon('refresh')}Restart</button><button type="button" class="btn btn--danger-quiet btn--sm" data-gw="stop">${icon('stop')}Stop</button>`
            : html`<button type="button" class="btn btn--primary btn--sm" data-gw="start">${icon('play')}Start gateway</button>`}</div>
        </div>
        <div class="panel panel--pad pf-box">
          <div class="pf-box__head"><h3>Model</h3><a class="section__link" href="${ctx.href(`/agents/profiles/${p.name}/model`)}">Change${icon('chev-r', 'i-sm')}</a></div>
          <dl class="kv"><dt>main</dt><dd class="mono">${p.model}</dd><dt>provider</dt><dd class="mono">${p.provider}</dd><dt>reasoning</dt><dd class="mono">${lo.reasoning}</dd><dt>fallback</dt><dd class="mono">${lo.fallback}</dd></dl>
        </div>
      </div>
      <section class="section" aria-labelledby="pf-recent">
        <div class="section__head"><h3 class="section__title" id="pf-recent">Recent sessions</h3><a class="section__link" href="${ctx.href(`/chat?profile=${p.name}`)}">All${icon('chev-r', 'i-sm')}</a></div>
        ${sessions.length ? html`<ul class="list panel">${sessions.map((s) => html`<li><a class="list-row" href="${ctx.href('/chat/' + s.id)}">
          <span class="list-row__icon">${icon(SOURCES[s.source]?.icon || 'chat')}</span>
          <span class="list-row__main"><span class="list-row__title">${s.title}</span><span class="list-row__sub">${s.preview}</span></span>
          <span class="list-row__end">${s.live ? statusBadge('running', { variant: 'plain' }) : html`<span class="mono">${fmtAgo(s.updated)}</span>`}</span></a></li>`)}</ul>`
          : html`<div class="panel panel--pad subtle">No sessions yet.</div>`}
      </section>
    </div>`;
  },
  identity: (ctx, p) => editorTab(ctx, p, 'SOUL.md', 'Personality, voice and boundaries. Loaded at the start of every session.'),
  instructions: (ctx, p) => editorTab(ctx, p, 'AGENTS.md', 'Working instructions. Hermes also reads HERMES.md and a project\'s own AGENTS.md when present.'),
  memory(ctx, p) {
    const file = ctx.query.file === 'user' ? 'USER.md' : 'MEMORY.md';
    const files = ['MEMORY.md', 'USER.md'];
    return html`<div class="stack">
      <div class="pf-memfiles" role="list">${files.map((f) => {
        const txt = f === ed.key?.split('/')[1] && ed.key.startsWith(p.name + '/') ? ed.draft : L(p).files[f];
        const pct = Math.min(1, txt.length / MEM_LIMIT[f]);
        return html`<a role="listitem" class="panel pf-memfile${f === file ? ' is-on' : ''}" href="${ctx.href(`/agents/profiles/${p.name}/memory${f === 'USER.md' ? '?file=user' : ''}`)}" ${f === file ? raw('aria-current="true"') : ''}>
          <span class="pf-memfile__name">${icon(f === 'USER.md' ? 'user' : 'database', 'i-sm')}<span class="mono">${f}</span></span>
          <span class="pf-memfile__size mono">${fmtBytes(sizeOf(txt))} · ${txt.length.toLocaleString()} / ${MEM_LIMIT[f].toLocaleString()} chars</span>
          <span class="progress" data-tone="${pct > 0.9 ? 'danger' : pct > 0.8 ? 'warning' : 'accent'}" role="img" aria-label="${Math.round(pct * 100)}% of the ${f} limit"><i style="--p:${Math.round(pct * 100)}%"></i></span>
        </a>`;
      })}</div>
      ${editorTab(ctx, p, file, file === 'USER.md' ? 'What Hermes knows about you. Maintained automatically when memory.user_profile_enabled is on.' : 'Durable facts Hermes saved. Over the limit, the oldest entries are summarised.')}
      <p class="subtle pf-note">Provider: <span class="mono">hindsight</span> · <a href="${ctx.href('/agents/memory')}">Memory settings and Hindsight browser</a></p>
    </div>`;
  },
  skills(ctx, p) {
    const q = (ctx.query.q || '').trim();
    const all = ctx.data.skills;
    const on = all.filter((s) => s.profiles.includes(p.name));
    const list = q ? all.filter((s) => fuzzy(q, `${s.path} ${s.description}`) >= 0) : all;
    const bundled = Math.max(0, p.skills - on.length);
    return html`<div class="stack">
      <p class="muted">${on.length} of ${all.length} installed skills enabled for ${p.name}${bundled ? html`, plus ${bundled} bundled core skills that are always on` : ''}. Toggling is undoable.</p>
      <div class="input-wrap">${icon('search')}<input class="input" type="search" placeholder="Filter skills" aria-label="Filter skills" value="${q}" data-qfilter></div>
      <ul class="list panel">${list.map((s) => {
        const en = s.profiles.includes(p.name);
        return html`<li class="list-row pf-skill">
          <span class="list-row__icon">${icon('stack')}</span>
          <span class="list-row__main"><span class="list-row__title mono">${s.path}</span><span class="list-row__sub">${s.description}</span>
            <span class="list-row__meta"><span>${s.source}</span><span class="mono">v${s.version}</span>${s.updateAvailable ? html`<span class="tag" data-tone="info">update ${s.updateAvailable}</span>` : ''}${en ? html`<span>${s.uses7d} uses · 7d</span>` : ''}</span></span>
          <button type="button" class="switch" role="switch" aria-checked="${String(en)}" aria-label="Enable ${s.name} for ${p.name}" data-skill="${s.path}"></button>
        </li>`;
      })}</ul>
      ${!list.length ? emptyState({ icon: 'stack', title: 'No skills match', body: `Nothing matches “${q}”.` }) : ''}
      <a class="section__link" href="${ctx.href('/agents/skills/hub')}">Browse the Skills Hub${icon('chev-r', 'i-sm')}</a>
    </div>`;
  },
  tools(ctx, p) {
    const lo = L(p);
    const mine = ctx.data.mcpServers.filter((m) => m.profiles.includes(p.name));
    const others = ctx.data.mcpServers.filter((m) => !m.profiles.includes(p.name));
    const mstate = (m) => (m.status === 'online' ? statusBadge('online') : m.status === 'needs_auth' ? statusBadge('waiting', { label: 'Needs sign-in' }) : statusBadge('offline'));
    return html`<div class="stack pf-gap-lg">
      <section class="section" aria-labelledby="pf-ts"><div class="section__head"><h3 class="section__title" id="pf-ts">Toolsets <span class="tag">${lo.tools.size} on</span></h3><a class="section__link" href="${ctx.href('/agents/tools')}">Configure${icon('chev-r', 'i-sm')}</a></div>
        <ul class="pf-toolsets panel">${TOOLSETS.map(([id, label, ic]) => html`<li class="switch-row"><span class="pf-toolset">${icon(ic, 'i-sm')}<span>${label}</span><span class="mono subtle">${id}</span></span>
          <button type="button" class="switch" role="switch" aria-checked="${String(lo.tools.has(id))}" aria-label="${label}" data-tool="${id}"></button></li>`)}</ul>
      </section>
      <section class="section" aria-labelledby="pf-mcp"><div class="section__head"><h3 class="section__title" id="pf-mcp">MCP servers <span class="tag">${mine.length} attached</span></h3><a class="section__link" href="${ctx.href('/agents/tools/mcp')}">Manage${icon('chev-r', 'i-sm')}</a></div>
        ${mine.length ? html`<ul class="list panel">${mine.map((m) => html`<li class="list-row"><span class="list-row__icon">${icon(m.transport === 'stdio' ? 'terminal' : 'link')}</span>
          <span class="list-row__main"><span class="list-row__title">${m.name}</span><span class="list-row__sub mono">${m.command || m.url}</span><span class="list-row__meta"><span>${m.transport}</span><span>${m.tools} tools</span><span>auth: ${m.auth}</span></span></span>
          <span class="list-row__end">${mstate(m)}</span></li>`)}</ul>` : html`<div class="panel panel--pad subtle">No MCP servers attached.</div>`}
        ${others.length ? html`<p class="subtle pf-note">Also installed: ${others.map((m, i) => html`${i ? ', ' : ''}<span class="mono">${m.name}</span>`)}. Attach them in Tools &amp; MCP.</p>` : ''}
      </section>
    </div>`;
  },
  model(ctx, p) {
    const lo = L(p);
    const ms = ctx.data.models;
    const key = ctx.data.keys.find((k) => k.id === PROVIDER_KEY[p.provider]);
    return html`<form class="stack pf-form" data-modelform>
      <div class="field"><label class="field__label" for="pf-m-main">Main model</label>
        <select class="input" id="pf-m-main" name="model">${ms.map((m) => html`<option value="${m.id}" ${m.id === p.model ? raw('selected') : ''}>${m.id} · ${m.provider}</option>`)}</select>
        <p class="field__help">Provider key: ${key ? html`<span class="mono">${key.env}</span> ${key.status === 'valid' ? '✓ valid' : '· missing'}` : 'none needed'} · <a href="${ctx.href('/system/keys')}">Keys &amp; Auth</a></p></div>
      <fieldset class="field pf-fieldset"><legend class="field__label">Reasoning effort</legend>
        <div class="seg" role="radiogroup" aria-label="Reasoning effort">${['low', 'medium', 'high'].map((r) => html`<button type="button" role="radio" aria-checked="${String(r === lo.reasoning)}" data-reason="${r}">${r}</button>`)}</div>
        <p class="field__help">Only for models that support it. Chats can override per turn.</p></fieldset>
      <div class="field"><label class="field__label" for="pf-m-fb">Fallback model</label>
        <select class="input" id="pf-m-fb" name="fallback"><option value="">None</option>${ms.map((m) => html`<option value="${m.id}" ${m.id === lo.fallback ? raw('selected') : ''}>${m.id} · ${m.provider}</option>`)}</select>
        <p class="field__help">Used when the main provider errors or rate-limits.</p></div>
      <div class="banner" data-tone="info">${icon('info')}<div class="banner__content"><div class="banner__title">15 auxiliary slots inherit the main model</div><div class="banner__body">Vision, compression, title generation and the rest. Set them in Models.</div><div class="banner__actions"><a class="btn btn--secondary btn--sm" href="${ctx.href('/agents/models')}">Open Models</a></div></div><span></span></div>
      <div class="row pf-formfoot"><button type="submit" class="btn btn--primary" data-modelsave disabled>${icon('lock')}Save model settings…</button><span class="subtle pf-note">Writes config.yaml · Tier 3</span></div>
    </form>`;
  },
  gateway(ctx, p) {
    const chans = ctx.data.channels;
    const bound = chans.filter((c) => c.profiles.includes(p.name));
    const free = chans.filter((c) => !c.profiles.includes(p.name));
    return html`<div class="stack pf-gap-lg">
      <div class="panel panel--pad pf-gwpanel">
        <div class="pf-box__head"><h3>Gateway process</h3>${p.gateway === 'running' ? statusBadge('online', { label: 'Running' }) : statusBadge('offline', { label: 'Stopped' })}</div>
        <dl class="kv"><dt>mode</dt><dd class="mono">per-profile (multiplex off)</dd><dt>pid</dt><dd class="mono">${p.gateway === 'running' ? 40000 + avatarIdx(p.name) * 137 : '—'}</dd><dt>uptime</dt><dd class="mono">${p.gateway === 'running' ? '3m' : '—'}</dd><dt>home channel</dt><dd class="mono">${p.channels[0] || 'none'}</dd></dl>
        <div class="row pf-row-sm">${p.gateway === 'running'
          ? html`<button type="button" class="btn btn--secondary btn--sm" data-gw="restart">${icon('refresh')}Restart</button><button type="button" class="btn btn--danger-quiet btn--sm" data-gw="stop">${icon('stop')}Stop</button>`
          : html`<button type="button" class="btn btn--primary btn--sm" data-gw="start">${icon('play')}Start gateway</button>`}
          <span class="subtle pf-note">Tier 2 · passkey</span></div>
      </div>
      <section class="section" aria-labelledby="pf-ch"><div class="section__head"><h3 class="section__title" id="pf-ch">Bound channels</h3><a class="section__link" href="${ctx.href('/connect/channels')}">All channels${icon('chev-r', 'i-sm')}</a></div>
        ${bound.length ? html`<ul class="list panel">${bound.map((c) => html`<li><a class="list-row" href="${ctx.href('/connect/channels/' + c.platform)}"><span class="list-row__icon">${icon(SOURCES[c.platform]?.icon || 'broadcast')}</span>
          <span class="list-row__main"><span class="list-row__title">${c.name}</span><span class="list-row__sub">${c.allowedUsers} allowed users · shared with ${c.profiles.filter((x) => x !== p.name).join(', ') || 'no other profile'}</span></span>
          <span class="list-row__end">${p.gateway === 'running' ? statusBadge(c.status === 'online' ? 'online' : 'offline') : statusBadge('degraded', { label: 'Not delivering' })}${icon('chev-r', 'list-row__chev')}</span></a></li>`)}</ul>`
          : html`<div class="panel panel--pad subtle">No channels bound to ${p.name}.</div>`}
        ${free.length ? html`<p class="subtle pf-note">Available: ${free.map((c) => c.name).join(', ')}. <a href="${ctx.href('/connect/channels')}">Bind a channel</a></p>` : ''}
      </section>
    </div>`;
  },
  files(ctx, p) {
    const lo = L(p);
    const rows = [
      { name: 'config.yaml', icon: 'sliders', size: 2140, to: `/system/config?view=yaml&profile=${p.name}`, sub: 'Opens in Config · Raw YAML' },
      { name: 'SOUL.md', icon: 'user', size: sizeOf(lo.files['SOUL.md']), to: `/agents/profiles/${p.name}/identity`, sub: `Saved ${fmtAgo(lo.saved['SOUL.md'])} ago` },
      { name: 'AGENTS.md', icon: 'book', size: sizeOf(lo.files['AGENTS.md']), to: `/agents/profiles/${p.name}/instructions`, sub: `Saved ${fmtAgo(lo.saved['AGENTS.md'])} ago` },
      { name: 'memories/MEMORY.md', icon: 'database', size: sizeOf(lo.files['MEMORY.md']), to: `/agents/profiles/${p.name}/memory`, sub: 'Updated by the agent' },
      { name: 'memories/USER.md', icon: 'database', size: sizeOf(lo.files['USER.md']), to: `/agents/profiles/${p.name}/memory?file=user`, sub: 'Updated by the agent' },
      { name: '.env', icon: 'key', size: 412, to: '/system/keys', sub: 'Masked · open Keys & Auth' },
      { name: 'skills/', icon: 'stack', size: null, to: `/agents/profiles/${p.name}/skills`, sub: `${p.skills} skills` },
      { name: 'state.db', icon: 'database', size: p.sessions * 41_000, to: `/chat?profile=${p.name}`, sub: `${p.sessions} sessions` },
    ];
    return html`<div class="stack">
      <p class="muted mono pf-path">~/.hermes/profiles/${p.name}/</p>
      <ul class="list panel">${rows.map((r) => html`<li><a class="list-row" href="${ctx.href(r.to)}"><span class="list-row__icon">${icon(r.icon)}</span>
        <span class="list-row__main"><span class="list-row__title mono">${r.name}</span><span class="list-row__sub">${r.sub}</span></span>
        <span class="list-row__end"><span class="mono">${r.size == null ? '' : r.size > 1e6 ? `${(r.size / 1e6).toFixed(1)} MB` : fmtBytes(r.size)}</span>${icon('chev-r', 'list-row__chev')}</span></a></li>`)}</ul>
    </div>`;
  },
  danger(ctx, p) {
    const rows = [
      { a: 'default', title: 'Make default', body: p.isDefault ? `${p.name} is already the default profile.` : 'Writes Hermes\'s sticky active_profile. Used by the CLI, the gateway and devices without a chosen profile.', tier: 'Tier 2 · passkey', btn: 'Make default…', disabled: p.isDefault, ic: 'fingerprint' },
      { a: 'rename', title: 'Rename', body: 'Renames the profile folder and every reference to it. Undo is available for a few seconds.', tier: 'Tier 0 · undo', btn: 'Rename…', ic: 'draft' },
      { a: 'export', title: 'Export', body: 'Download an archive of this profile, including its .env keys.', tier: 'Tier 3 · type the name', btn: 'Export…', ic: 'download' },
      { a: 'delete', title: 'Delete profile', body: p.isDefault ? 'The default profile cannot be deleted. Make another profile default first.' : `Deletes ${p.sessions} sessions, memories, skills and config. Restorable only from backup.`, tier: 'Tier 3 · type the name', btn: 'Delete…', danger: true, disabled: p.isDefault, ic: 'trash' },
    ];
    return html`<ul class="pf-danger panel">${rows.map((r) => html`<li class="pf-danger__row${r.danger ? ' is-danger' : ''}">
      <div class="pf-danger__text"><h3>${r.title}</h3><p class="muted">${r.body}</p><p class="overline">${r.tier}</p></div>
      <button type="button" class="btn ${r.danger ? 'btn--danger-quiet' : 'btn--secondary'}" data-danger="${r.a}" ${r.disabled ? raw('disabled') : ''}>${icon(r.ic)}${r.btn}</button>
    </li>`)}</ul>`;
  },
};

/* ---- Markdown file editor: inline on medium/large, full-screen layer on compact ---- */
function editorTab(ctx, p, file, help) {
  const e = edFor(p, file);
  const lo = L(p);
  const dirty = lo.files[file] !== e.draft;
  const compact = ctx.size === 'compact';
  const mode = compact ? 'preview' : ctx.size === 'medium' && e.mode === 'split' ? 'edit' : e.mode;
  const modes = ctx.size === 'large' ? ['preview', 'edit', 'split'] : ['preview', 'edit'];
  const tid = uid('ta');
  return html`<div class="pf-ed" data-file="${file}">
    <p class="muted">${help}</p>
    <div class="pf-ed__bar">
      <span class="pf-ed__file">${icon('file', 'i-sm')}<span class="mono">${file}</span><span class="subtle mono">${fmtBytes(sizeOf(e.draft))}</span>${dirty ? html`<span class="tag" data-tone="warning">Unsaved</span>` : html`<span class="subtle">saved ${fmtAgo(lo.saved[file])} ago</span>`}</span>
      ${compact
        ? html`<button type="button" class="btn btn--primary btn--sm" data-fsedit>${icon('draft')}${dirty ? 'Continue editing' : 'Edit'}</button>`
        : html`<div class="seg" role="radiogroup" aria-label="Editor view">${modes.map((m) => html`<button type="button" role="radio" aria-checked="${String(m === mode)}" data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`)}</div>`}
    </div>
    <div class="pf-ed__body" data-mode="${mode}">
      ${mode !== 'preview' ? html`<div class="pf-ed__src"><label class="sr-only" for="${tid}">${file} source</label><textarea id="${tid}" class="input input--mono pf-ed__ta" spellcheck="false" data-src>${e.draft}</textarea></div>` : ''}
      ${mode !== 'edit' ? html`<div class="pf-ed__prev panel panel--pad pf-md" role="region" aria-label="${file} preview" data-prev>${md(e.draft)}</div>` : ''}
    </div>
    ${!compact ? html`<div class="pf-ed__foot${dirty ? ' is-dirty' : ''}" data-edfoot>
      <span class="subtle" data-edstate>${dirty ? 'Unsaved changes' : 'No changes'}</span>
      <button type="button" class="btn btn--secondary btn--sm" data-revert ${dirty ? '' : raw('disabled')}>Revert</button>
      <button type="button" class="btn btn--primary btn--sm" data-save ${dirty ? '' : raw('disabled')}>${icon('check')}Save ${file}</button>
    </div>` : ''}
  </div>`;
}
function saveFile(ctx, p, file) {
  const lo = L(p);
  const prev = lo.files[file];
  const prevAt = lo.saved[file];
  lo.files[file] = ed.draft;
  lo.saved[file] = Date.now();
  ctx.toast(`Saved ${file}`, { detail: `${p.name} · next session uses it`, undo: () => { lo.files[file] = prev; lo.saved[file] = prevAt; ed.draft = prev; ctx.refresh(); } });
}
function openFullscreenEditor(ctx, p, file) {
  const id = uid('fse');
  const lo = L(p);
  let mode = 'edit';
  let saved = false;
  const layer = openLayer({
    kind: 'pfed', escapable: false, labelledby: id, initialFocus: 'textarea',
    content: `<section class="pf-fse" data-panel>
      <header class="pf-fse__head">
        <button type="button" class="btn btn--ghost btn--icon" data-x aria-label="Close editor">${icon('x')}</button>
        <div class="pf-fse__title"><h2 id="${id}" class="mono">${esc(file)}</h2><small>${esc(p.name)}</small></div>
        <button type="button" class="btn btn--primary btn--sm" data-fsave>Save</button>
      </header>
      <div class="pf-fse__seg"><div class="seg" role="radiogroup" aria-label="Editor view"><button type="button" role="radio" aria-checked="true" data-m="edit">Edit</button><button type="button" role="radio" aria-checked="false" data-m="preview">Preview</button></div><span class="subtle mono" data-fsize></span></div>
      <div class="pf-fse__body" data-body>
        <label class="sr-only" for="${id}-ta">${esc(file)} source</label>
        <textarea id="${id}-ta" class="pf-fse__ta mono" spellcheck="false">${esc(ed.draft)}</textarea>
        <div class="pf-fse__prev pf-md" hidden></div>
      </div>
    </section>`,
    onMount(panel, ly) {
      const ta = panel.querySelector('textarea');
      const prev = panel.querySelector('.pf-fse__prev');
      const size = panel.querySelector('[data-fsize]');
      const upd = () => { size.textContent = `${fmtBytes(sizeOf(ta.value))}${ta.value !== lo.files[file] ? ' · unsaved' : ''}`; };
      upd();
      ta.addEventListener('input', () => { ed.draft = ta.value; upd(); });
      panel.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        mode = b.dataset.m;
        panel.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        ta.hidden = mode !== 'edit';
        prev.hidden = mode === 'edit';
        if (mode === 'preview') prev.innerHTML = String(md(ta.value)); else ta.focus();
      }));
      const guardedClose = async () => {
        if (ta.value === lo.files[file]) { ly.close(); return; }
        const ok = await ctx.openDialog({ tier: 1, title: `Discard changes to ${file}?`, body: 'Your edits since the last save are lost.', profile: p.name, danger: true, confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
        if (!ok) { ta.focus(); return; }
        await overlaysSettled();
        ed.draft = lo.files[file];
        saved = true;
        ly.close();
      };
      panel.querySelector('[data-x]').addEventListener('click', guardedClose);
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); guardedClose(); } });
      panel.querySelector('[data-fsave]').addEventListener('click', () => {
        ed.draft = ta.value;
        saved = true;
        saveFile(ctx, p, file);
        ly.close();
      });
    },
    onClose() {
      ctx.refresh();
      requestAnimationFrame(() => document.querySelector('#main [data-fsedit]')?.focus({ preventScroll: true }));
      // Back gesture / hardware back with unsaved edits: keep the draft and offer to resume (unsaved guard).
      if (!saved && ed.draft !== lo.files[file]) ctx.toast(`Unsaved ${file} kept as a draft`, { tone: 'warning', action: { label: 'Resume', onClick: () => openFullscreenEditor(ctx, p, file) } });
    },
  });
  return layer;
}

/* ==========================================================================
   Profile Builder (/agents/profiles/new)
   ========================================================================== */
let draft = null;
function newDraft() {
  const per = PERSONAS[1];
  return { persona: per.id, name: '', description: '', autoDescribe: true, soul: per.soul, model: per.model, reasoning: 'medium', skills: new Set(per.skills), mcps: new Set(per.mcps), touched: false, errors: {} };
}
function D() { return (draft ??= newDraft()); }
const stepIdx = (ctx) => Math.max(0, STEPS.findIndex((s) => s.id === ctx.query.step));

function renderBuilder(ctx) {
  const d = D();
  const i = stepIdx(ctx);
  const st = STEPS[i];
  const compact = ctx.size === 'compact';
  const body = STEP_RENDER[st.id](ctx, d);
  const stepper = html`<ol class="pf-steps" aria-label="Builder steps">${STEPS.map((s, n) => html`<li class="pf-steps__item${n < i ? ' is-done' : ''}${n === i ? ' is-current' : ''}">
      <a href="${ctx.href(`/agents/profiles/new?step=${s.id}`)}" data-step="${s.id}" ${n === i ? raw('aria-current="step"') : ''} ${n > i && !canReach(ctx, n) ? raw('aria-disabled="true"') : ''}>
        <span class="pf-steps__n" aria-hidden="true">${n < i ? icon('check', 'i-sm') : n + 1}</span><span>${s.label}</span>${n < i ? html`<span class="sr-only"> (done)</span>` : ''}</a></li>`)}</ol>`;
  const foot = html`<div class="pf-wiz__foot">
      ${i > 0 ? html`<button type="button" class="btn btn--secondary" data-prev>${icon('chev-l')}Back</button>` : html`<button type="button" class="btn btn--secondary" data-cancel>Cancel</button>`}
      <span class="pf-wiz__count subtle">Step ${i + 1} of ${STEPS.length}</span>
      ${i < STEPS.length - 1 ? html`<button type="button" class="btn btn--primary" data-next>Next: ${STEPS[i + 1].label}${icon('chev-r')}</button>` : html`<button type="button" class="btn btn--primary" data-create>${icon('check')}Create profile</button>`}
    </div>`;
  if (compact) {
    return html`<div class="pf-fs" role="region" aria-label="New profile builder">
      <header class="pf-fs__head">
        <button type="button" class="btn btn--ghost btn--icon" data-cancel aria-label="Close builder">${icon('x')}</button>
        <div class="pf-fs__title"><h1 tabindex="-1">${st.label}</h1><small>New profile · step ${i + 1} of ${STEPS.length}</small></div>
      </header>
      <div class="progress pf-fs__prog" role="progressbar" aria-label="Builder progress" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${i + 1}"><i style="--p:${((i + 1) / STEPS.length) * 100}%"></i></div>
      <div class="pf-fs__body" data-fsbody>${body}</div>
      ${foot}
    </div>`;
  }
  return html`<div class="pf pf-wiz">
    ${pageHeader({ overline: 'Agents · Profiles', title: 'New profile', subtitle: 'Five steps. Nothing is written until you select Create.' })}
    <div class="pf-wiz__grid">
      <nav class="pf-wiz__nav" aria-label="Builder progress">${stepper}</nav>
      <section class="panel pf-wiz__panel" aria-labelledby="pf-step-h">
        <div class="pf-wiz__panelbody"><h2 id="pf-step-h" class="pf-wiz__h">${i + 1}. ${st.label}</h2>${body}</div>
        ${foot}
      </section>
      ${ctx.size === 'large' ? html`<aside class="pf-wiz__aside" aria-label="Preview">${previewCard(d)}</aside>` : ''}
    </div>
  </div>`;
}
function canReach(ctx, n) { return n === 0 || (!!D().name && !nameError(ctx.data, D().name)); }
function previewCard(d) {
  const nm = d.name || 'new-profile';
  const m = d.model;
  return html`<p class="overline">Card preview</p><div class="pf-card pf-card--preview">
    <div class="pf-card__top">${avatarLg(nm)}<div class="pf-card__id"><p class="pf-card__name">${nm}</p><div class="pf-card__badges"><span class="tag">New</span></div></div></div>
    <p class="pf-card__desc">${d.description || html`<span class="subtle">${d.autoDescribe ? 'Description written automatically after a few sessions.' : 'No description.'}</span>`}</p>
    <div class="pf-card__flags">${d.autoDescribe && !d.description ? html`<span class="tag pf-auto">${icon('bolt', 'i-sm')}Auto-describe on</span>` : ''}</div>
    <dl class="pf-card__meta"><div><dd class="pf-gw"><span class="dot dot--hollow" data-tone="neutral" aria-hidden="true"></span>Gateway stopped</dd></div><div><dd class="mono truncate">${m}</dd></div><div><dd>${icon('stack', 'i-sm')}${d.skills.size} skills</dd></div><div><dd>${icon('plug', 'i-sm')}${d.mcps.size} MCP</dd></div></dl>
  </div>`;
}
const STEP_RENDER = {
  identity(ctx, d) {
    const ne = d.errors.name;
    return html`<div class="stack pf-gap-lg">
      <fieldset class="pf-fieldset"><legend class="field__label">Start from a persona <span class="subtle">(optional)</span></legend>
        <div class="pf-personas" role="radiogroup" aria-label="Persona">${PERSONAS.map((x) => html`<button type="button" role="radio" class="pf-persona" aria-checked="${String(d.persona === x.id)}" data-persona="${x.id}">
          <span class="pf-persona__ic">${icon(x.icon)}</span><span class="pf-persona__t"><strong>${x.name}</strong><small>${x.desc}</small></span></button>`)}</div>
        <p class="field__help">Prefills SOUL.md, model, skills and MCP servers. You can change everything.</p></fieldset>
      <div class="field"><label class="field__label" for="pb-name">Name</label>
        <input id="pb-name" class="input input--mono" value="${d.name}" autocomplete="off" spellcheck="false" placeholder="e.g. travel" aria-describedby="pb-name-h${ne ? ' pb-name-e' : ''}" ${ne ? raw('aria-invalid="true"') : ''} data-f="name">
        <p class="field__help" id="pb-name-h">Lowercase. Becomes <span class="mono">~/.hermes/profiles/${d.name || '…'}</span> and <span class="mono">hermes -p ${d.name || '…'}</span>.</p>
        ${ne ? html`<p class="field__error" id="pb-name-e">${icon('alert', 'i-sm')}${ne}</p>` : ''}</div>
      <div class="field"><label class="field__label" for="pb-desc">Description</label>
        <textarea id="pb-desc" class="input" rows="2" placeholder="What is this profile for?" data-f="description">${d.description}</textarea>
        <label class="check"><input type="checkbox" ${d.autoDescribe ? raw('checked') : ''} data-f="autoDescribe"><span>Auto-describe from the first sessions if left empty</span></label></div>
      <details class="pf-soul" ${d.soul !== PERSONAS.find((x) => x.id === d.persona)?.soul ? raw('open') : ''}><summary>${icon('chev-r', 'i-sm')}SOUL.md starter <span class="subtle mono">${fmtBytes(sizeOf(d.soul))}</span></summary>
        <label class="sr-only" for="pb-soul">SOUL.md</label><textarea id="pb-soul" class="input input--mono" rows="8" spellcheck="false" data-f="soul">${d.soul}</textarea></details>
    </div>`;
  },
  model(ctx, d) {
    const keyOk = (prov) => ctx.data.keys.find((k) => k.id === PROVIDER_KEY[prov])?.status === 'valid';
    return html`<div class="stack pf-gap-lg">
      <div class="plist" role="radiogroup" aria-label="Main model">${ctx.data.models.map((m) => html`<button type="button" class="plist__row pf-model" role="radio" aria-checked="${String(d.model === m.id)}" data-model="${m.id}">
        <span class="list-row__icon">${icon('cpu')}</span>
        <span class="plist__main"><span class="plist__name mono">${m.id}${keyOk(m.provider) ? html`<span class="tag" data-tone="success">key ok</span>` : html`<span class="tag" data-tone="warning">no key</span>`}</span>
          <span class="plist__sub">${m.provider} · ${Math.round(m.context / 1000)}k context · $${m.priceIn} in / $${m.priceOut} out per 1M</span></span>
        <span></span><span class="plist__check">${d.model === m.id ? icon('check') : ''}</span></button>`)}</div>
      <fieldset class="field pf-fieldset"><legend class="field__label">Reasoning effort</legend>
        <div class="seg" role="radiogroup" aria-label="Reasoning effort">${['low', 'medium', 'high'].map((r) => html`<button type="button" role="radio" aria-checked="${String(d.reasoning === r)}" data-reason="${r}">${r}</button>`)}</div></fieldset>
    </div>`;
  },
  skills(ctx, d) {
    const cats = [...new Set(ctx.data.skills.map((s) => s.category))];
    return html`<div class="stack">
      <p class="muted"><strong>${d.skills.size}</strong> selected. Bundled core skills are always on.</p>
      ${cats.map((c) => html`<fieldset class="pf-fieldset pf-skillcat"><legend class="overline">${c}</legend>
        ${ctx.data.skills.filter((s) => s.category === c).map((s) => html`<label class="check pf-check"><input type="checkbox" data-skillpick="${s.path}" ${d.skills.has(s.path) ? raw('checked') : ''}><span><span class="mono">${s.name}</span><small>${s.description}</small></span></label>`)}
      </fieldset>`)}
    </div>`;
  },
  mcps(ctx, d) {
    return html`<div class="stack">
      <p class="muted">Attach MCP servers that are already installed. Adding a new stdio server runs a local command and is Tier 3: do that in <a href="${ctx.href('/agents/tools/mcp')}">Tools &amp; MCP</a>.</p>
      ${ctx.data.mcpServers.map((m) => html`<label class="check pf-check"><input type="checkbox" data-mcppick="${m.name}" ${d.mcps.has(m.name) ? raw('checked') : ''}><span><span class="pf-check__t"><strong>${m.name}</strong><span class="tag">${m.transport}</span>${m.status === 'needs_auth' ? html`<span class="tag" data-tone="warning">needs sign-in</span>` : m.status === 'offline' ? html`<span class="tag">offline</span>` : ''}</span><small class="mono">${m.command || m.url} · ${m.tools} tools</small></span></label>`)}
    </div>`;
  },
  review(ctx, d) {
    const per = PERSONAS.find((x) => x.id === d.persona);
    const sec = (step, label, content) => html`<div class="pf-rev__row"><dt>${label}</dt><dd>${content}</dd><dd class="pf-rev__edit"><a href="${ctx.href(`/agents/profiles/new?step=${step}`)}" data-step="${step}" aria-label="Edit ${label}">Edit</a></dd></div>`;
    return html`<div class="stack pf-gap-lg">
      <dl class="pf-rev">
        ${sec('identity', 'Name', html`<span class="mono">${d.name}</span>`)}
        ${sec('identity', 'Persona', per?.name)}
        ${sec('identity', 'Description', d.description || (d.autoDescribe ? 'Auto-describe after the first sessions' : '—'))}
        ${sec('model', 'Model', html`<span class="mono">${d.model}</span> · reasoning ${d.reasoning}`)}
        ${sec('skills', 'Skills', d.skills.size ? html`<span class="pf-chiplist">${[...d.skills].map((s) => html`<span class="tag mono">${s.split('/')[1]}</span>`)}</span>` : 'Bundled only')}
        ${sec('mcps', 'MCP servers', d.mcps.size ? html`<span class="pf-chiplist">${[...d.mcps].map((s) => html`<span class="tag mono">${s}</span>`)}</span>` : 'None')}
      </dl>
      <div class="code"><div class="code__head"><span class="grow">SOUL.md</span><span>${fmtBytes(sizeOf(d.soul))}</span></div><div class="pf-md pf-rev__soul">${md(d.soul)}</div></div>
      <p class="subtle pf-note">Creates <span class="mono">~/.hermes/profiles/${d.name}</span>. The gateway stays stopped until you start it.</p>
    </div>`;
  },
};

let keptScroll = null;
function mountBuilder(root, ctx) {
  const d = D();
  const i = stepIdx(ctx);
  const go = (n) => ctx.navigate(`/agents/profiles/new?step=${STEPS[n].id}`, { replace: true });
  const validate = () => {
    d.errors.name = nameError(ctx.data, d.name.trim());
    return !d.errors.name;
  };
  // Re-render without losing the builder's scroll position (compact owns its scroller) or focus.
  const refreshKeep = (focusSel) => {
    keptScroll = root.querySelector('[data-fsbody]')?.scrollTop ?? null;
    ctx.refresh();
    document.querySelector(`#main ${focusSel}`)?.focus({ preventScroll: true });
  };
  root.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    d.touched = true;
    d[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'name' && d.errors.name) { d.errors.name = ''; e.target.removeAttribute('aria-invalid'); root.querySelector('#pb-name-e')?.remove(); }
    if (f === 'name') { root.querySelectorAll('.pf-wiz__aside .pf-card__name').forEach((n) => { n.textContent = d.name || 'new-profile'; }); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.skillpick) { t.checked ? d.skills.add(t.dataset.skillpick) : d.skills.delete(t.dataset.skillpick); d.touched = true; refreshKeep(`[data-skillpick="${t.dataset.skillpick}"]`); }
    if (t.dataset.mcppick) { t.checked ? d.mcps.add(t.dataset.mcppick) : d.mcps.delete(t.dataset.mcppick); d.touched = true; refreshKeep(`[data-mcppick="${t.dataset.mcppick}"]`); }
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.persona) {
      const per = PERSONAS.find((x) => x.id === b.dataset.persona);
      Object.assign(d, { persona: per.id, soul: per.soul, model: per.model, skills: new Set(per.skills), mcps: new Set(per.mcps), touched: true });
      refreshKeep(`[data-persona="${per.id}"]`);
    } else if (b.dataset.model) { d.model = b.dataset.model; d.touched = true; refreshKeep(`[data-model="${d.model}"]`); }
    else if (b.dataset.reason) { d.reasoning = b.dataset.reason; refreshKeep(`[data-reason="${d.reasoning}"]`); }
    else if (b.dataset.step) {
      e.preventDefault();
      const n = STEPS.findIndex((s) => s.id === b.dataset.step);
      if (n > 0 && !validate()) { go(0); return; }
      go(n);
    } else if ('next' in b.dataset) {
      if (i === 0 && !validate()) { ctx.refresh(); document.getElementById('pb-name')?.focus(); return; }
      go(i + 1);
    } else if ('prev' in b.dataset) go(i - 1);
    else if ('cancel' in b.dataset) {
      if (d.touched) {
        const ok = await ctx.openDialog({ tier: 1, title: 'Discard this new profile?', body: 'Nothing has been written yet. Your choices in the builder are lost.', danger: true, confirmLabel: 'Discard', cancelLabel: 'Keep building' });
        if (!ok) return;
        await overlaysSettled();
      }
      draft = null;
      ctx.navigate('/agents/profiles');
    } else if ('create' in b.dataset) {
      if (!validate()) { go(0); return; }
      b.disabled = true;
      b.innerHTML = '<span class="spinner" aria-hidden="true"></span>Creating…';
      await new Promise((r) => setTimeout(r, 700));
      const prov = ctx.data.models.find((m) => m.id === d.model)?.provider;
      const np = { name: d.name.trim(), model: d.model, provider: prov, isDefault: false, gateway: 'stopped', description: d.description.trim(), channels: [], sessions: 0, skills: 18 + d.skills.size, successRate: null, runs7d: 0, av: avatarIdx(d.name.trim()) };
      ctx.data.profiles.push(np);
      ctx.data.skills.forEach((s) => { if (d.skills.has(s.path)) s.profiles.push(np.name); });
      ctx.data.mcpServers.forEach((m) => { if (d.mcps.has(m.name)) m.profiles.push(np.name); });
      const lo = L(np);
      lo.files['SOUL.md'] = d.soul;
      lo.autoDescribed = !np.description && d.autoDescribe;
      lo.reasoning = d.reasoning;
      lo.saved = { 'SOUL.md': Date.now(), 'AGENTS.md': Date.now(), 'MEMORY.md': Date.now(), 'USER.md': Date.now() };
      lo.files['MEMORY.md'] = '- No memories saved yet.';
      draft = null;
      ctx.navigate(`/agents/profiles/${np.name}`, { replace: true });
      ctx.toast(`Created profile ${np.name}`, { detail: `${np.model} · ${d.skills.size} skills · ${d.mcps.size} MCP`, action: { label: 'Start a chat', onClick: () => ctx.navigate(`/chat/new?profile=${np.name}`) } });
    }
  });
  const body = root.querySelector('[data-fsbody]');
  if (body) body.scrollTop = keptScroll ?? 0;
  keptScroll = null;
  if (ctx.size === 'compact') document.documentElement.classList.add('pf-fs-open');
  return () => document.documentElement.classList.remove('pf-fs-open');
}

/* ==========================================================================
   Module
   ========================================================================== */
const profileFor = (ctx) => ctx.data.profiles.find((x) => x.name === ctx.params.name);

export default {
  routes: ['/agents/profiles', '/agents/profiles/new', '/agents/profiles/:name', '/agents/profiles/:name/:tab'],
  title(ctx) {
    if (ctx.path === '/agents/profiles/new') return 'New profile';
    if (ctx.params.name) { const t = tab(ctx.params.tab); return t && t.id !== 'overview' ? `${ctx.params.name} · ${t.label}` : ctx.params.name; }
    return 'Profiles';
  },
  group: 'agents',
  render(ctx) {
    if (ctx.path === '/agents/profiles/new') return renderBuilder(ctx);
    if (ctx.params.name) {
      const p = profileFor(ctx);
      if (!p) return html`${pageHeader({ title: 'Profile not found' })}${emptyState({ icon: 'users', title: `No profile called “${ctx.params.name}”`, body: 'It may have been renamed or deleted.', action: html`<a class="btn btn--primary" href="${ctx.href('/agents/profiles')}">All profiles</a>` })}`;
      if (ctx.params.tab && !tab(ctx.params.tab)) return html`${pageHeader({ title: 'Tab not found' })}${emptyState({ icon: 'folder', title: `No “${ctx.params.tab}” tab`, body: 'Choose a section of this profile.', action: html`<a class="btn btn--primary" href="${ctx.href('/agents/profiles/' + p.name)}">Overview</a>` })}`;
      return renderDetail(ctx, p, ctx.params.tab || 'overview');
    }
    return renderList(ctx);
  },
  mount(root, ctx) {
    if (ctx.path === '/agents/profiles/new') return mountBuilder(root, ctx);
    const p = ctx.params.name ? profileFor(ctx) : null;
    // URL-held filters: update in place (no re-render while typing)
    const setQ = (v) => {
      const q = new URLSearchParams(location.hash.split('?')[1] || '');
      if (v) q.set('q', v); else q.delete('q');
      history.replaceState(history.state, '', `#${ctx.path}${q.toString() ? '?' + q : ''}`);
    };
    root.querySelector('[data-filter]')?.addEventListener('input', (e) => {
      const v = e.target.value.trim();
      setQ(v);
      root.querySelectorAll('.pf-card:not(.pf-card--new)').forEach((li) => {
        const name = li.querySelector('.pf-card__name').textContent;
        const pr = ctx.data.profiles.find((x) => x.name === name);
        li.hidden = !!v && fuzzy(v, `${pr.name} ${pr.description} ${pr.model} ${pr.provider}`) < 0;
      });
      const nw = root.querySelector('.pf-card--new');
      if (nw) nw.hidden = !!v;
    });
    root.querySelector('[data-qfilter]')?.addEventListener('input', (e) => {
      const v = e.target.value.trim();
      setQ(v);
      root.querySelectorAll('.pf-skill').forEach((li) => {
        const s = ctx.data.skills.find((x) => x.path === li.querySelector('[data-skill]').dataset.skill);
        li.hidden = !!v && fuzzy(v, `${s.path} ${s.description}`) < 0;
      });
    });
    // Keep the active tab visible in the horizontal scroller
    root.querySelector('.pf-tabs [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });

    // Editor wiring (medium / large inline)
    const edRoot = root.querySelector('.pf-ed');
    if (edRoot && p) {
      const file = edRoot.dataset.file;
      const lo = L(p);
      const ta = edRoot.querySelector('[data-src]');
      const prev = edRoot.querySelector('[data-prev]');
      const foot = edRoot.querySelector('[data-edfoot]');
      const sync = () => {
        const dirty = lo.files[file] !== ed.draft;
        if (foot) {
          foot.classList.toggle('is-dirty', dirty);
          foot.querySelector('[data-edstate]').textContent = dirty ? 'Unsaved changes' : 'No changes';
          foot.querySelector('[data-save]').disabled = !dirty;
          foot.querySelector('[data-revert]').disabled = !dirty;
        }
        const tag = edRoot.querySelector('.pf-ed__file .tag, .pf-ed__file .subtle:last-child');
        if (tag) tag.outerHTML = dirty ? '<span class="tag" data-tone="warning">Unsaved</span>' : `<span class="subtle">saved ${fmtAgo(lo.saved[file])} ago</span>`;
      };
      ta?.addEventListener('input', () => { ed.draft = ta.value; if (prev) prev.innerHTML = String(md(ta.value)); sync(); });
      edRoot.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { ed.mode = b.dataset.mode; ctx.refresh(); root.ownerDocument.querySelector(`.pf-ed [data-mode="${ed.mode}"]`)?.focus(); }));
      edRoot.querySelector('[data-save]')?.addEventListener('click', () => { saveFile(ctx, p, file); ctx.refresh(); });
      edRoot.querySelector('[data-revert]')?.addEventListener('click', () => { ed.draft = lo.files[file]; ctx.refresh(); });
      edRoot.querySelector('[data-fsedit]')?.addEventListener('click', () => openFullscreenEditor(ctx, p, file));
    }
    // Unsaved guard for in-app links while an inline editor is dirty
    const guard = async (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || !isDirty() || !root.querySelector('.pf-ed')) return;
      e.preventDefault();
      e.stopPropagation();
      const [, f] = ed.key.split('/');
      const ok = await ctx.openDialog({ tier: 1, title: `Leave without saving ${f}?`, body: 'Your unsaved edits are discarded.', profile: p?.name, danger: true, confirmLabel: 'Discard and leave', cancelLabel: 'Stay' });
      if (!ok) return;
      await overlaysSettled();
      const [n] = ed.key.split('/');
      ed.draft = local[n].files[f];
      location.hash = a.getAttribute('href');
    };
    document.addEventListener('click', guard, true);
    const unload = (e) => { if (isDirty() && root.querySelector('.pf-ed')) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);

    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.more) openActions(ctx, ctx.data.profiles.find((x) => x.name === b.dataset.more), b);
      else if (b.dataset.gw) gatewayAction(ctx, p, b.dataset.gw);
      else if (b.dataset.danger) ({ default: makeDefault, rename, export: exportProfile, delete: deleteProfile })[b.dataset.danger](ctx, p);
      else if ('autodesc' in b.dataset) {
        ctx.openDialog({ tier: 1, title: `${L(p).autoDescribed ? 'Regenerate' : 'Write'} the description for ${p.name}?`, body: 'Asks the profile\'s model to summarise its SOUL.md and last 20 sessions in one sentence. Costs about $0.002.', profile: p.name, confirmLabel: 'Describe' }).then((ok) => {
          if (!ok) return;
          const prevDesc = p.description;
          const prevAuto = L(p).autoDescribed;
          p.description = `${prevDesc.replace(/\.$/, '')}; summarised from ${Math.min(20, p.sessions)} recent sessions.`;
          L(p).autoDescribed = true;
          ctx.refresh();
          ctx.toast('Description updated', { detail: p.name, undo: () => { p.description = prevDesc; L(p).autoDescribed = prevAuto; ctx.refresh(); } });
        });
      } else if (b.dataset.skill) {
        const s = ctx.data.skills.find((x) => x.path === b.dataset.skill);
        const toggle = () => {
          const on = s.profiles.includes(p.name);
          s.profiles = on ? s.profiles.filter((x) => x !== p.name) : [...s.profiles, p.name];
          p.skills += on ? -1 : 1;
          return !on;
        };
        const nowOn = toggle();
        ctx.refresh();
        document.querySelector(`[data-skill="${s.path}"]`)?.focus();
        ctx.toast(`${nowOn ? 'Enabled' : 'Disabled'} ${s.name} for ${p.name}`, { undo: () => { toggle(); ctx.refresh(); } });
      } else if (b.dataset.tool) {
        const lo = L(p);
        const id = b.dataset.tool;
        const flip = () => (lo.tools.has(id) ? (lo.tools.delete(id), false) : (lo.tools.add(id), true));
        const on = flip();
        b.setAttribute('aria-checked', String(on));
        root.querySelector('#pf-ts .tag').textContent = `${lo.tools.size} on`;
        ctx.toast(`${on ? 'Enabled' : 'Disabled'} ${id} toolset`, { detail: `${p.name} · next session`, undo: () => { flip(); ctx.refresh(); } });
      } else if (b.dataset.reason && b.closest('[data-modelform]')) {
        b.parentElement.querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        root.querySelector('[data-modelsave]').disabled = false;
      }
    });
    const mf = root.querySelector('[data-modelform]');
    if (mf) {
      mf.addEventListener('change', () => { mf.querySelector('[data-modelsave]').disabled = false; });
      mf.addEventListener('submit', (e) => {
        e.preventDefault();
        const lo = L(p);
        const model = mf.elements.model.value;
        const fb = mf.elements.fallback.value;
        const rs = mf.querySelector('[data-reason][aria-checked="true"]').dataset.reason;
        const changes = [model !== p.model && `model.default: ${p.model} → ${model}`, rs !== lo.reasoning && `agent.reasoning_effort: ${lo.reasoning} → ${rs}`, fb !== lo.fallback && `fallback_model.model: ${lo.fallback || '—'} → ${fb || '—'}`].filter(Boolean);
        ctx.openDialog({
          tier: 3, title: `Save model settings for ${p.name}?`, object: p.name, profile: p.name,
          body: `Writes <span class="mono">profiles/${esc(p.name)}/config.yaml</span>:<br>${changes.map((c) => `<span class="mono">${esc(c)}</span>`).join('<br>') || 'No changes.'}`,
          recoverability: 'Restorable: the previous file is kept as config.yaml.bak.',
          confirmLabel: 'Save config',
        }).then((ok) => {
          if (!ok) return;
          p.model = model;
          p.provider = ctx.data.models.find((m) => m.id === model)?.provider || p.provider;
          lo.reasoning = rs;
          lo.fallback = fb;
          ctx.refresh();
          ctx.toast('Model settings saved', { detail: `${p.name} · applies to new sessions` });
        });
      });
    }
    return () => { document.removeEventListener('click', guard, true); window.removeEventListener('beforeunload', unload); };
  },
  paletteActions(ctx) {
    const acts = [{ label: 'New profile…', icon: 'plus', sub: 'Profile Builder', run: () => ctx.navigate('/agents/profiles/new') }];
    const p = ctx.params.name && profileFor(ctx);
    if (p && !p.isDefault) acts.push({ label: `Make ${p.name} default…`, icon: 'fingerprint', sub: 'Tier 2', run: () => makeDefault(ctx, p) });
    if (p) acts.push({ label: `Edit ${p.name} SOUL.md`, icon: 'user', run: () => ctx.navigate(`/agents/profiles/${p.name}/identity`) });
    return acts;
  },
};
