// Config (mobile §4 "Config", industry §12 #15): search-first settings with @modified / @profile /
// @restart-required filters, per-field deep links and reset, sticky save bar (T3 write), Raw YAML.
// PROTOTYPE: the schema below extends `data.config` (same category ids, so palette deep links resolve).
import { html, raw, esc, icon, pageHeader, emptyState, fuzzy, overlaysSettled } from '../shared.js';

const CSS_HREF = new URL('./config.css', import.meta.url).href;
if (!document.querySelector(`link[href="${CSS_HREF}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS_HREF }));

/* ==========================================================================
   Schema (screen-local; built from data.config + extra mock fields)
   ========================================================================== */
const ORDER = [
  ['general', 'General', 'settings'], ['agent', 'Agent', 'agents'], ['model', 'Model', 'cpu'], ['terminal', 'Terminal', 'terminal'],
  ['display', 'Display', 'monitor'], ['memory', 'Memory', 'database'], ['compression', 'Context compression', 'stack'],
  ['delegation', 'Delegation', 'subagent'], ['cron', 'Cron', 'clock'], ['gateway', 'Gateway', 'server'], ['security', 'Security', 'shield'], ['voice', 'Voice', 'mic'],
];
const EXTRA = {
  general: [
    { key: 'timezone', type: 'text', value: 'Australia/Melbourne', default: '', help: 'IANA timezone for schedules and timestamps. Empty uses the host clock.' },
    { key: 'locale', type: 'select', options: ['en-US', 'en-GB', 'en-AU'], value: 'en-AU', default: 'en-US', help: 'Date, number and spelling conventions in replies.' },
    { key: 'checkpoints.enabled', type: 'boolean', value: true, default: true, help: 'Shadow-git snapshot before file edits so you can roll back.' },
    { key: 'checkpoints.max_snapshots', type: 'number', value: 50, default: 50, min: 1, max: 500, help: 'Snapshots kept per working directory.' },
  ],
  agent: [
    { key: 'agent.disabled_toolsets', type: 'list', value: ['image_gen'], default: [], help: 'Toolsets this profile never loads, even if a skill asks for them.' },
  ],
  terminal: [
    { key: 'terminal.cwd', type: 'text', value: '~/work', default: '.', help: 'Working directory for new shells.' },
    { key: 'terminal.docker_image', type: 'text', value: 'nikolaik/python-nodejs:python3.11-nodejs20', default: 'nikolaik/python-nodejs:python3.11-nodejs20', help: 'Image used when the backend is docker.', restartRequired: true },
  ],
  display: [
    { key: 'display.show_reasoning', type: 'boolean', value: false, default: false, help: 'Show the model\'s reasoning blocks on chat platforms.' },
    { key: 'display.streaming', type: 'boolean', value: true, default: true, help: 'Stream tokens to platforms that support message edits.' },
    { key: 'display.skin', type: 'select', options: ['default', 'ares', 'mono', 'slate'], value: 'default', default: 'default', help: 'CLI colour skin. Caduceus has its own appearance settings.' },
  ],
  memory: [
    { key: 'memory.memory_char_limit', type: 'number', value: 2200, default: 2200, min: 500, max: 20000, unit: 'chars', help: 'Size limit for MEMORY.md before older entries are summarised.' },
    { key: 'memory.user_char_limit', type: 'number', value: 1375, default: 1375, min: 200, max: 10000, unit: 'chars', help: 'Size limit for USER.md.' },
  ],
  compression: [
    { key: 'compression.summary_model', type: 'text', value: 'glm-5.3-flash', default: '', help: 'Model that writes the summaries. Empty uses the auxiliary compression slot.', modified: true },
  ],
  delegation: [
    { key: 'delegation.max_iterations', type: 'number', value: 50, default: 50, min: 1, max: 200, help: 'Turn budget for each subagent.' },
    { key: 'delegation.default_toolsets', type: 'list', value: ['terminal', 'file', 'web'], default: ['terminal', 'file', 'web'], help: 'Toolsets a subagent gets when the parent does not say.' },
    { key: 'delegation.model', type: 'text', value: '', default: '', help: 'Model for subagents. Empty inherits the main model.' },
  ],
  cron: [
    { key: 'cron.enabled', type: 'boolean', value: true, default: true, help: 'Run scheduled jobs for this profile.', restartRequired: true },
    { key: 'cron.tick_seconds', type: 'number', value: 60, default: 60, min: 15, max: 600, unit: 's', help: 'How often the scheduler checks for due jobs.', restartRequired: true },
    { key: 'cron.deliver_default', type: 'select', options: ['origin', 'telegram', 'discord', 'inbox'], value: 'telegram', default: 'origin', help: 'Where job output goes when a job does not set deliver.' },
  ],
  gateway: [
    { key: 'gateway.session_reset', type: 'select', options: ['never', 'daily', 'idle'], value: 'idle', default: 'idle', help: 'When a platform chat starts a fresh session.' },
  ],
  security: [
    { key: 'security.redact_secrets', type: 'boolean', value: true, default: true, help: 'Mask API keys and tokens in tool output and logs.' },
    { key: 'approvals.timeout', type: 'number', value: 300, default: 300, min: 30, max: 3600, unit: 's', help: 'Seconds an approval waits before it is denied.' },
    { key: 'security.allowed_commands', type: 'list', value: ['git status', 'pnpm test'], default: [], help: 'Commands that never need approval in manual mode.' },
    { key: 'security.tirith_enabled', type: 'boolean', value: true, default: true, help: 'Pre-execution scan of terminal commands for injection and exfiltration.', restartRequired: true },
  ],
  voice: [
    { key: 'tts.provider', type: 'select', options: ['edge', 'elevenlabs', 'openai'], value: 'edge', default: 'edge', help: 'Text-to-speech engine for voice replies.' },
    { key: 'stt.enabled', type: 'boolean', value: true, default: true, help: 'Transcribe voice messages from chat platforms.' },
    { key: 'voice.auto_tts', type: 'boolean', value: false, default: false, help: 'Always reply with audio to voice messages.' },
  ],
};
const LABELS = {
  'agent.max_turns': 'Max turns', 'agent.reasoning_effort': 'Reasoning effort', 'agent.personality': 'Personality', 'approvals.mode': 'Approval mode',
  'model.default': 'Main model', 'model.provider': 'Provider', 'fallback_model.model': 'Fallback model', 'terminal.backend': 'Backend', 'terminal.timeout': 'Command timeout',
  'memory.provider': 'Memory provider', 'memory.user_profile_enabled': 'Maintain USER.md', 'compression.threshold': 'Compression threshold', 'compression.enabled': 'Compress context',
  'gateway.multiplex': 'Multiplex profiles', 'gateway.port': 'Gateway port', 'display.tool_progress': 'Tool progress messages', timezone: 'Timezone', locale: 'Locale',
  'checkpoints.enabled': 'Checkpoints', 'checkpoints.max_snapshots': 'Snapshots to keep', 'agent.disabled_toolsets': 'Disabled toolsets', 'terminal.cwd': 'Working directory',
  'terminal.docker_image': 'Docker image', 'display.show_reasoning': 'Show reasoning', 'display.streaming': 'Streaming', 'display.skin': 'CLI skin',
  'memory.memory_char_limit': 'MEMORY.md limit', 'memory.user_char_limit': 'USER.md limit', 'compression.summary_model': 'Summary model',
  'delegation.max_iterations': 'Subagent turn budget', 'delegation.default_toolsets': 'Subagent toolsets', 'delegation.model': 'Subagent model',
  'cron.enabled': 'Scheduler', 'cron.tick_seconds': 'Tick interval', 'cron.deliver_default': 'Default delivery', 'gateway.session_reset': 'Session reset',
  'security.redact_secrets': 'Redact secrets', 'approvals.timeout': 'Approval timeout', 'security.allowed_commands': 'Always-allowed commands',
  'security.tirith_enabled': 'Command scanner (tirith)', 'tts.provider': 'TTS provider', 'stt.enabled': 'Speech to text', 'voice.auto_tts': 'Voice replies',
};
const UNITS = { 'terminal.timeout': 's', 'gateway.port': '', 'agent.max_turns': 'turns' };
const PROFILE_KEYS = new Set(['model.default', 'model.provider', 'agent.personality', 'terminal.cwd', 'display.tool_progress', 'agent.disabled_toolsets', 'cron.deliver_default']);
const FILTERS = [
  { id: 'modified', label: '@modified', hint: 'Differs from the Hermes default' },
  { id: 'profile', label: '@profile', hint: 'Set in this profile, not inherited' },
  { id: 'restart', label: '@restart-required', hint: 'Takes effect after a gateway restart' },
];

function buildSchema(d) {
  return ORDER.map(([id, title, ic]) => {
    const base = (d.config.find((c) => c.id === id)?.keys || []).map((k) => ({ ...k }));
    const keys = [...base, ...(EXTRA[id] || []).map((k) => ({ ...k }))].map((k) => ({
      ...k, cat: id, label: LABELS[k.key] || k.key.split('.').pop().replace(/_/g, ' '), unit: k.unit ?? UNITS[k.key] ?? '', profile: PROFILE_KEYS.has(k.key),
    }));
    return { id, title, icon: ic, keys };
  });
}
let schema = null;
const fields = () => schema.flatMap((c) => c.keys);
const field = (key) => fields().find((f) => f.key === key);

/* Per-profile saved values + pending edits (in memory). */
const store = {};
function S(ctx) {
  schema ??= buildSchema(ctx.data);
  const p = ctx.profile;
  if (!store[p.name]) {
    const saved = new Map(fields().map((f) => [f.key, clone(f.value)]));
    if (p.model) saved.set('model.default', p.model);
    if (field('model.provider').options.includes(p.provider)) saved.set('model.provider', p.provider);
    if (p.name === 'coder') { saved.set('terminal.backend', 'docker'); saved.set('agent.reasoning_effort', 'high'); }
    if (p.name === 'homeassistant') saved.set('agent.disabled_toolsets', ['terminal', 'browser']);
    store[p.name] = { saved, pending: new Map(), yamlDraft: null };
  }
  return store[p.name];
}
const clone = (v) => (Array.isArray(v) ? [...v] : v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cur = (st, key) => (st.pending.has(key) ? st.pending.get(key) : st.saved.get(key));
const isModified = (st, f) => !same(st.saved.get(f.key), f.default);
const fmtVal = (v) => (Array.isArray(v) ? (v.length ? v.join(', ') : '[]') : v === '' ? '""' : String(v));
const domId = (key) => `cf-${key.replace(/[^a-z0-9]/gi, '-')}`;
const cfgPath = (p) => (p.isDefault ? '~/.hermes/config.yaml' : `~/.hermes/profiles/${p.name}/config.yaml`);

/* ==========================================================================
   Search
   ========================================================================== */
function parseQuery(qs, chips) {
  const toks = String(qs || '').split(/\s+/).filter(Boolean);
  const f = new Set(chips);
  const words = [];
  for (const t of toks) {
    const m = t.toLowerCase().match(/^@(modified|profile|restart(-required)?)$/);
    if (m) f.add(m[1].startsWith('restart') ? 'restart' : m[1]); else words.push(t);
  }
  return { text: words.join(' '), filters: f };
}
function match(st, f, q) {
  if (q.filters.has('modified') && !isModified(st, f) && !st.pending.has(f.key)) return -1;
  if (q.filters.has('profile') && !f.profile) return -1;
  if (q.filters.has('restart') && !f.restartRequired) return -1;
  if (!q.text) return 1;
  return Math.max(fuzzy(q.text, f.label), fuzzy(q.text, f.key), fuzzy(q.text, f.help) - 400);
}
function mark(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

/* ==========================================================================
   Rendering
   ========================================================================== */
function control(st, f) {
  const v = cur(st, f.key);
  const id = `${domId(f.key)}-c`;
  const desc = `${domId(f.key)}-h`;
  switch (f.type) {
    case 'boolean':
      return html`<button type="button" id="${id}" class="switch" role="switch" aria-checked="${String(!!v)}" aria-describedby="${desc}" data-ctl="bool"><span class="sr-only">${v ? 'On' : 'Off'}</span></button>`;
    case 'select':
      return html`<select id="${id}" class="input" aria-describedby="${desc}" data-ctl="select">${f.options.map((o) => html`<option value="${o}" ${o === v ? raw('selected') : ''}>${o}</option>`)}</select>`;
    case 'number':
      return html`<span class="cf-num"><input id="${id}" class="input input--mono" type="number" inputmode="decimal" value="${v}" ${f.min != null ? raw(`min="${f.min}"`) : ''} ${f.max != null ? raw(`max="${f.max}"`) : ''} step="${Number.isInteger(f.default) ? 1 : 0.05}" aria-describedby="${desc}" data-ctl="number">${f.unit ? html`<span class="cf-num__unit">${f.unit}</span>` : ''}</span>`;
    case 'list':
      return html`<div class="cf-list" role="group" aria-labelledby="${domId(f.key)}-l">
        ${v.length ? v.map((x, i) => html`<span class="chip cf-list__chip"><span class="mono">${x}</span><button type="button" class="chip__x hit" aria-label="Remove ${x}" data-rm="${i}">${icon('x', 'i-sm')}</button></span>`) : html`<span class="subtle cf-list__empty">Empty list</span>`}
        <input id="${id}" class="input input--mono cf-list__add" placeholder="Add, then Enter" aria-label="Add to ${f.label}" aria-describedby="${desc}" data-ctl="list">
      </div>`;
    default:
      return html`<input id="${id}" class="input input--mono" value="${v}" spellcheck="false" autocomplete="off" aria-describedby="${desc}" data-ctl="text">`;
  }
}
function fieldHtml(ctx, st, f, q = '') {
  const pend = st.pending.has(f.key);
  const mod = isModified(st, f);
  const v = cur(st, f.key);
  const atDefault = same(v, f.default);
  const lid = `${domId(f.key)}-l`;
  return html`<div class="cf-field${pend ? ' is-pending' : ''}" id="${domId(f.key)}" data-key="${f.key}">
    <div class="cf-field__text">
      <div class="cf-field__label">
        ${f.type === 'list' ? html`<span id="${lid}" class="cf-field__name">${raw(mark(f.label, q))}</span>` : html`<label id="${lid}" class="cf-field__name" for="${domId(f.key)}-c">${raw(mark(f.label, q))}</label>`}
        ${mod ? html`<span class="cf-dot" title="Modified from default"><span class="sr-only">Modified</span></span>` : ''}
        ${pend ? html`<span class="tag" data-tone="accent">Unsaved</span>` : ''}
        ${f.restartRequired ? html`<span class="tag" data-tone="warning">${icon('refresh', 'i-sm')}Restart</span>` : ''}
        ${f.profile ? html`<span class="tag">${icon('user', 'i-sm')}Profile</span>` : ''}
      </div>
      <code class="cf-field__key">${raw(mark(f.key, q))}</code>
      <p class="cf-field__help" id="${domId(f.key)}-h">${f.help}${f.restartRequired ? ' Requires a gateway restart.' : ''}${!atDefault ? html` <span class="cf-field__def">Default: <span class="mono">${fmtVal(f.default)}</span></span>` : ''}</p>
    </div>
    <div class="cf-field__ctl">${control(st, f)}</div>
    <div class="cf-field__acts">
      ${!atDefault ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-reset aria-label="Reset ${f.label} to default (${fmtVal(f.default)})" title="Reset to default">${icon('history')}</button>` : ''}
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-link aria-label="Copy link to ${f.key}" title="Copy link">${icon('link')}</button>
    </div>
  </div>`;
}
function resultsHtml(ctx, st, cat, qs, chips) {
  const q = parseQuery(qs, chips);
  const searching = !!q.text || q.filters.size > 0;
  const cats = schema.filter((c) => searching || !cat || c.id === cat);
  let total = 0;
  const groups = cats.map((c) => {
    const ks = c.keys.map((f) => ({ f, s: match(st, f, q) })).filter((x) => x.s >= 0);
    if (q.text) ks.sort((a, b) => b.s - a.s);
    total += ks.length;
    return { c, ks };
  }).filter((g) => g.ks.length);
  const head = searching
    ? html`<p class="cf-count" role="status">${total} ${total === 1 ? 'setting' : 'settings'}${q.text ? html` ${total === 1 ? 'matches' : 'match'} “${q.text}”` : ''}${q.filters.size ? html` · ${[...q.filters].map((x) => FILTERS.find((y) => y.id === x).label).join(' ')}` : ''} · all categories</p>`
    : html`<p class="cf-count sr-only" role="status">${total} settings</p>`;
  if (!groups.length) {
    return html`${head}${emptyState({ icon: 'search', title: 'No settings match', body: q.filters.has('modified') && !q.text ? 'Nothing differs from the Hermes defaults.' : 'Try a key like agent.max_turns, a word from the description, or clear the filters.', action: html`<button type="button" class="btn btn--secondary" data-clear>Clear search</button>` })}`;
  }
  return html`${head}${groups.map((g) => html`<section class="cf-group" aria-labelledby="cf-g-${g.c.id}">
    <h2 class="cf-group__title" id="cf-g-${g.c.id}">${icon(g.c.icon, 'i-sm')}${g.c.title}<span class="subtle">${g.ks.length}</span></h2>
    <div class="cf-group__list panel">${g.ks.map(({ f }) => fieldHtml(ctx, st, f, q.text))}</div>
  </section>`)}`;
}
function saveBarHtml(st, offline) {
  const n = st.pending.size;
  const rs = [...st.pending.keys()].filter((k) => field(k).restartRequired).length;
  return html`<div class="cf-savebar__in">
    <span class="cf-savebar__msg"><strong>${n} unsaved ${n === 1 ? 'change' : 'changes'}</strong>${rs ? html`<span class="subtle"> · ${rs} need${rs === 1 ? 's' : ''} a restart</span>` : ''}${offline ? html`<span class="subtle"> · offline: saving is disabled</span>` : ''}</span>
    <button type="button" class="btn btn--ghost btn--sm" data-review>Review</button>
    <button type="button" class="btn btn--secondary btn--sm" data-discard>Discard</button>
    <button type="button" class="btn btn--primary btn--sm" data-save ${offline ? raw('disabled') : ''}>${icon('lock')}Save…</button>
  </div>`;
}

/* ---- Raw YAML ---- */
function toYaml(ctx, st, vals) {
  const tree = {};
  for (const f of fields()) {
    const parts = f.key.split('.');
    let node = tree;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    node[parts[parts.length - 1]] = vals(f.key);
  }
  const scalar = (v) => (typeof v === 'string' ? (v === '' || /[:#]/.test(v) ? JSON.stringify(v) : v) : String(v));
  const out = [`# ${cfgPath(ctx.profile)}`, `# Hermes ${ctx.data.version.hermes} · profile ${ctx.profile.name}`];
  const walk = (obj, ind) => {
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) { out.push(`${ind}${k}:${v.length ? '' : ' []'}`); v.forEach((x) => out.push(`${ind}  - ${scalar(x)}`)); }
      else if (v && typeof v === 'object') { out.push(`${ind}${k}:`); walk(v, ind + '  '); }
      else out.push(`${ind}${k}: ${scalar(v)}`);
    }
  };
  walk(tree, '');
  return out.join('\n');
}
function validateYaml(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (/\t/.test(l)) return { line: i + 1, msg: 'Tabs are not allowed for indentation. Use two spaces.' };
    const ind = l.match(/^ */)[0].length;
    if (ind % 2) return { line: i + 1, msg: `Indentation of ${ind} spaces. Use a multiple of two.` };
    const body = l.trim();
    if (body.startsWith('- ')) continue;
    if (!/^[A-Za-z_][\w.-]*:(\s.*)?$/.test(body)) {
      const word = body.split(/\s+/)[0];
      return { line: i + 1, msg: `Expected “key: value”. Is a colon missing after “${word}”?` };
    }
  }
  return null;
}
function parseYaml(text) {
  const vals = new Map();
  const stack = [];
  let listKey = null;
  for (const l of text.split('\n')) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const ind = l.match(/^ */)[0].length / 2;
    const body = l.trim();
    if (body.startsWith('- ') && listKey) { vals.get(listKey).push(body.slice(2).replace(/^"(.*)"$/, '$1')); continue; }
    const [, k, rest = ''] = body.match(/^([^:]+):\s?(.*)$/) || [];
    stack.length = ind;
    stack.push(k);
    const key = stack.join('.');
    listKey = null;
    if (rest === '' && field(key)?.type === 'list') { vals.set(key, []); listKey = key; continue; }
    if (rest === '[]') { vals.set(key, []); continue; }
    if (rest === '') continue;
    const f = field(key);
    if (!f) continue;
    const r = rest.replace(/^"(.*)"$/, '$1');
    vals.set(key, f.type === 'number' ? Number(r) : f.type === 'boolean' ? r === 'true' : r);
  }
  return vals;
}
function qrSvg(text) {
  // Mock QR: deterministic modules from the URL + three finder patterns (not scannable; prototype only).
  const n = 25;
  let h = 2166136261;
  const bits = [];
  for (let i = 0; i < n * n; i++) { h = Math.imul(h ^ text.charCodeAt(i % text.length) ^ i, 16777619) >>> 0; bits.push((h >>> 7) & 1); }
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" class="cf-qr__bg"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  const inF = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  let r = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inF(x, y) && bits[y * n + x]) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  return `<svg class="cf-qr" viewBox="-2 -2 ${n + 4} ${n + 4}" role="img" aria-label="QR code for the link below (mock)"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" class="cf-qr__bg"/>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}${r}</svg>`;
}
function yamlHtml(ctx, st) {
  const compact = ctx.size === 'compact';
  const text = st.yamlDraft ?? toYaml(ctx, st, (k) => st.saved.get(k));
  const err = st.yamlDraft != null ? validateYaml(text) : null;
  const dirty = st.yamlDraft != null && st.yamlDraft !== toYaml(ctx, st, (k) => st.saved.get(k));
  if (compact) {
    return html`<div class="stack">
      <div class="banner" data-tone="info">${icon('monitor')}<div class="banner__content"><div class="banner__title">Read-only on phones</div><div class="banner__body">Editing raw YAML needs a keyboard and a wide screen. Use the form for quick changes, or continue on a larger screen.</div>
        <div class="banner__actions"><button type="button" class="btn btn--primary btn--sm" data-handoff>${icon('external')}Edit on a larger screen</button></div></div><span></span></div>
      <div class="code"><div class="code__head"><span class="grow truncate">${cfgPath(ctx.profile)}</span><button type="button" class="btn btn--ghost btn--sm" data-copyyaml>${icon('copy')}Copy</button></div><pre class="cf-yaml-ro" tabindex="0" aria-label="config.yaml (read-only)">${yamlColor(text)}</pre></div>
    </div>`;
  }
  const lines = text.split('\n').length;
  return html`<div class="stack cf-yaml">
    <div class="cf-yaml__bar">
      <span class="mono subtle truncate">${cfgPath(ctx.profile)}</span>
      <button type="button" class="btn btn--ghost btn--sm" data-yamlbad title="Prototype: insert a line with a missing colon">${icon('alert')}Try an invalid edit</button>
      <button type="button" class="btn btn--secondary btn--sm" data-yamlreset ${dirty ? '' : raw('disabled')}>Revert</button>
      <button type="button" class="btn btn--primary btn--sm" data-yamlsave ${!dirty || err || ctx.data.connection === 'offline' ? raw('disabled') : ''}>${icon('lock')}Save YAML…</button>
    </div>
    <div data-yamlerr>${err ? yamlErr(err) : ''}</div>
    <div class="cf-yaml__ed${err ? ' is-invalid' : ''}">
      <pre class="cf-yaml__gutter" aria-hidden="true">${Array.from({ length: lines }, (_, i) => `${i + 1}`).join('\n')}</pre>
      <label class="sr-only" for="cf-yaml-ta">config.yaml source</label>
      <textarea id="cf-yaml-ta" class="cf-yaml__ta mono" spellcheck="false" wrap="off" ${err ? raw('aria-invalid="true" aria-describedby="cf-yaml-err"') : ''}>${text}</textarea>
    </div>
    <p class="subtle cf-note">Comments and key order are preserved by Hermes on save. Unknown keys are kept but flagged.</p>
  </div>`;
}
function yamlErr(err) {
  return html`<div class="banner" data-tone="danger" role="alert" id="cf-yaml-err">${icon('failed')}<div class="banner__content"><div class="banner__title">Line ${err.line}: invalid YAML</div><div class="banner__body">${err.msg} Saving is disabled until this is fixed.</div>
    <div class="banner__actions"><button type="button" class="btn btn--secondary btn--sm" data-goline="${err.line}">Go to line ${err.line}</button></div></div><span></span></div>`;
}
function yamlColor(text) {
  return raw(text.split('\n').map((l) => {
    if (/^\s*#/.test(l)) return `<span class="c">${esc(l)}</span>`;
    const m = l.match(/^(\s*)(- )?([^:]+:)?(.*)$/);
    if (!m) return esc(l);
    const v = m[4];
    const vv = /^\s*(true|false|\d[\d.]*)\s*$/.test(v) ? `<span class="n">${esc(v)}</span>` : v.trim() ? `<span class="s">${esc(v)}</span>` : esc(v);
    return `${m[1]}${m[2] ? '<span class="p">- </span>' : ''}${m[3] ? `<span class="k">${esc(m[3])}</span>` : ''}${vv}`;
  }).join('\n'));
}

/* ==========================================================================
   Module
   ========================================================================== */
let chipState = null; // filter chips (also mirrored in ?f=)
let searchText = null;

export default {
  routes: ['/system/config', '/system/config/:category'],
  title: (ctx) => (ctx.params.category ? `Config · ${ORDER.find((o) => o[0] === ctx.params.category)?.[1] || ctx.params.category}` : 'Config'),
  group: 'system',
  render(ctx) {
    const st = S(ctx);
    const p = ctx.profile;
    const cat = ctx.params.category;
    const known = !cat || schema.some((c) => c.id === cat);
    const view = ctx.query.view === 'yaml' ? 'yaml' : 'form';
    chipState = new Set((ctx.query.f || '').split(',').filter((x) => FILTERS.some((f) => f.id === x)));
    searchText = ctx.query.q || '';
    const all = fields();
    const modCount = all.filter((f) => isModified(st, f)).length;
    const large = ctx.size === 'large';
    const base = cat ? `/system/config/${cat}` : '/system/config';
    const viewHref = (v) => {
      const q = new URLSearchParams();
      if (v === 'yaml') q.set('view', 'yaml');
      if (ctx.query.profile) q.set('profile', ctx.query.profile);
      return ctx.href(`${base}${q.toString() ? '?' + q : ''}`);
    };
    if (!known) return html`${pageHeader({ title: 'Config' })}${emptyState({ icon: 'sliders', title: `No “${cat}” category`, body: 'Pick a category or search all settings.', action: html`<a class="btn btn--primary" href="${ctx.href('/system/config')}">All settings</a>` })}`;
    const sidebar = html`<nav class="cf-side" aria-label="Config categories"><ul>
      <li><a href="${ctx.href('/system/config' + (view === 'yaml' ? '?view=yaml' : ''))}" ${!cat ? raw('aria-current="page"') : ''}>${icon('sliders', 'i-sm')}<span>All settings</span><span class="cf-side__n">${all.length}</span></a></li>
      ${schema.map((c) => {
        const m = c.keys.filter((f) => isModified(st, f)).length;
        return html`<li><a href="${ctx.href(`/system/config/${c.id}`)}" ${cat === c.id ? raw('aria-current="page"') : ''}>${icon(c.icon, 'i-sm')}<span>${c.title}</span>${m ? html`<span class="cf-dot" title="${m} modified"><span class="sr-only">, ${m} modified</span></span>` : ''}<span class="cf-side__n">${c.keys.length}</span></a></li>`;
      })}</ul></nav>`;
    const jump = html`<div class="field cf-jump"><label class="field__label" for="cf-jump">Jump to</label>
      <select id="cf-jump" class="input" data-jump><option value="">All settings (${all.length})</option>${schema.map((c) => html`<option value="${c.id}" ${cat === c.id ? raw('selected') : ''}>${c.title} (${c.keys.length})</option>`)}</select></div>`;
    return html`<div class="cf">
      ${pageHeader({
        overline: html`System · profile ${p.name}`,
        title: 'Config',
        subtitle: html`<span class="mono">${cfgPath(p)}</span> · ${all.length} settings · ${modCount} modified`,
      })}
      <nav class="cf-views" aria-label="Config view"><a href="${viewHref('form')}" ${view === 'form' ? raw('aria-current="page"') : ''}>${icon('sliders', 'i-sm')}Settings</a><a href="${viewHref('yaml')}" ${view === 'yaml' ? raw('aria-current="page"') : ''}>${icon('code', 'i-sm')}Raw YAML</a></nav>
      ${view === 'yaml' ? yamlHtml(ctx, st) : html`
      <div class="cf-layout">
        ${large ? sidebar : ''}
        <div class="cf-main">
          <div class="cf-searchbar" role="search">
            <div class="input-wrap cf-search">${icon('search')}<input id="cf-q" class="input" type="search" value="${searchText}" placeholder="Search ${all.length} settings, or type @" aria-label="Search settings" aria-describedby="cf-q-h" autocomplete="off" spellcheck="false" data-q></div>
            <p id="cf-q-h" class="sr-only">Type @modified, @profile or @restart-required to filter.</p>
            <div class="cf-chips" role="group" aria-label="Filters">${FILTERS.map((f) => html`<button type="button" class="chip" aria-pressed="${String(chipState.has(f.id) || parseQuery(searchText, []).filters.has(f.id))}" data-chip="${f.id}" title="${f.hint}">${f.label}</button>`)}</div>
          </div>
          ${large ? '' : jump}
          <div class="cf-results" data-results>${resultsHtml(ctx, st, cat, searchText, chipState)}</div>
        </div>
      </div>`}
      <div class="cf-savebar" data-savebar role="region" aria-label="Unsaved changes" ${st.pending.size ? '' : raw('hidden')}>${saveBarHtml(st, ctx.data.connection === 'offline')}</div>
    </div>`;
  },

  mount(root, ctx) {
    const st = S(ctx);
    const cat = ctx.params.category;
    const p = ctx.profile;
    const results = root.querySelector('[data-results]');
    const qInput = root.querySelector('[data-q]');
    const savebar = root.querySelector('[data-savebar]');
    const offline = () => ctx.data.connection === 'offline';
    const syncUrl = () => {
      const q = new URLSearchParams(location.hash.split('?')[1] || '');
      searchText ? q.set('q', searchText) : q.delete('q');
      chipState.size ? q.set('f', [...chipState].join(',')) : q.delete('f');
      q.delete('key');
      history.replaceState(history.state, '', `#${ctx.path}${q.toString() ? '?' + q : ''}`);
    };
    const redrawResults = () => {
      if (!results) return;
      results.innerHTML = String(resultsHtml(ctx, st, cat, searchText, chipState));
      const typed = parseQuery(searchText, []).filters;
      root.querySelectorAll('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', String(chipState.has(c.dataset.chip) || typed.has(c.dataset.chip))));
    };
    const redrawBar = () => {
      savebar.hidden = !st.pending.size;
      savebar.innerHTML = String(saveBarHtml(st, offline()));
    };
    const redrawField = (key, focusSel) => {
      const el = root.querySelector(`#${domId(key)}`);
      if (el) {
        const q = parseQuery(searchText, []).text;
        el.outerHTML = String(fieldHtml(ctx, st, field(key), q));
        if (focusSel) root.querySelector(`#${domId(key)} ${focusSel}`)?.focus();
      }
      redrawBar();
    };
    const setVal = (key, v, focusSel) => {
      if (same(v, st.saved.get(key))) st.pending.delete(key); else st.pending.set(key, clone(v));
      redrawField(key, focusSel);
    };

    qInput?.addEventListener('input', () => { searchText = qInput.value; syncUrl(); redrawResults(); });
    qInput?.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qInput.value) { e.stopPropagation(); qInput.value = ''; searchText = ''; syncUrl(); redrawResults(); } });
    root.querySelector('[data-jump]')?.addEventListener('change', (e) => ctx.navigate(e.target.value ? `/system/config/${e.target.value}` : '/system/config'));

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const fEl = b.closest('.cf-field');
      const key = fEl?.dataset.key;
      if (b.dataset.chip) {
        const id = b.dataset.chip;
        const typed = parseQuery(searchText, []).filters;
        if (typed.has(id)) { // remove the typed token instead
          searchText = searchText.split(/\s+/).filter((t) => parseQuery(t, []).filters.size === 0 || !parseQuery(t, []).filters.has(id)).join(' ');
          qInput.value = searchText;
          chipState.delete(id);
        } else chipState.has(id) ? chipState.delete(id) : chipState.add(id);
        syncUrl(); redrawResults();
      } else if ('clear' in b.dataset) {
        searchText = ''; chipState.clear(); if (qInput) qInput.value = ''; syncUrl(); redrawResults(); qInput?.focus();
      } else if (b.dataset.ctl === 'bool') {
        setVal(key, !(cur(st, key)), '[data-ctl]');
      } else if (b.dataset.rm != null) {
        const list = [...cur(st, key)];
        const [gone] = list.splice(+b.dataset.rm, 1);
        setVal(key, list, '[data-ctl]');
        ctx.toast(`Removed “${gone}” (unsaved)`, { tone: 'info', timeout: 2500 });
      } else if ('reset' in b.dataset) {
        const f = field(key);
        const before = cur(st, key);
        setVal(key, clone(f.default), '[data-ctl]');
        ctx.toast(`${f.label} reset to default (unsaved)`, { detail: `${fmtVal(before)} → ${fmtVal(f.default)}`, undo: () => setVal(key, before) });
      } else if ('link' in b.dataset) {
        const f = field(key);
        const url = `${location.origin}${location.pathname}#/system/config/${f.cat}?key=${encodeURIComponent(key)}${ctx.query.profile ? `&profile=${ctx.query.profile}` : ''}`;
        try { await navigator.clipboard.writeText(url); } catch { /* clipboard may be blocked in the prototype */ }
        ctx.toast('Link copied', { detail: `#/system/config/${f.cat}?key=${key}`, tone: 'info' });
      } else if ('discard' in b.dataset) {
        const snap = new Map(st.pending);
        st.pending.clear();
        ctx.refresh();
        ctx.toast(`Discarded ${snap.size} unsaved ${snap.size === 1 ? 'change' : 'changes'}`, { undo: () => { snap.forEach((v, k) => st.pending.set(k, v)); ctx.refresh(); } });
      } else if ('review' in b.dataset) {
        openReview(ctx, st, () => ctx.refresh());
      } else if ('save' in b.dataset) {
        saveConfig(ctx, st, [...st.pending.entries()]);
      } else if ('handoff' in b.dataset) {
        const url = `${location.origin}${location.pathname}#/system/config?view=yaml&profile=${p.name}`;
        ctx.openSheet({
          title: 'Edit on a larger screen',
          body: `<p class="muted">Scan with your computer's camera, or open the link on any signed-in device. You will land on this file's Raw YAML editor for <strong>${esc(p.name)}</strong>.</p>
            <div class="cf-handoff">${qrSvg(url)}<span class="overline">Mock QR · prototype</span></div>
            <div class="field"><label class="field__label" for="cf-ho-url">Link</label><input id="cf-ho-url" class="input input--mono" readonly value="${esc(url)}"></div>`,
          footer: '<button type="button" class="btn btn--secondary" data-send>Send to my desktop</button><button type="button" class="btn btn--primary" data-copy>Copy link</button>',
          onMount(panel, layer) {
            panel.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); } catch { /* */ } layer.close(); ctx.toast('Link copied', { tone: 'info' }); });
            panel.querySelector('[data-send]').addEventListener('click', () => { layer.close(); ctx.toast('Sent to “Studio Mac · Chrome”', { detail: 'Web Push · opens Config › Raw YAML' }); });
          },
        });
      } else if ('copyyaml' in b.dataset) {
        try { await navigator.clipboard.writeText(toYaml(ctx, st, (k) => st.saved.get(k))); } catch { /* */ }
        ctx.toast('config.yaml copied', { tone: 'info' });
      } else if ('yamlbad' in b.dataset) {
        const ta = root.querySelector('#cf-yaml-ta');
        const lines = ta.value.split('\n');
        const i = lines.findIndex((l) => l.trim().startsWith('max_turns:'));
        lines[i] = lines[i].replace('max_turns:', 'max_turns');
        ta.value = lines.join('\n');
        ta.dispatchEvent(new Event('input'));
        root.querySelector('[data-goline]')?.click();
      } else if ('yamlreset' in b.dataset) {
        st.yamlDraft = null; ctx.refresh();
      } else if (b.dataset.goline) {
        const ta = root.querySelector('#cf-yaml-ta');
        const ln = +b.dataset.goline;
        const lines = ta.value.split('\n');
        const start = lines.slice(0, ln - 1).join('\n').length + (ln > 1 ? 1 : 0);
        ta.focus();
        ta.setSelectionRange(start, start + lines[ln - 1].length);
        ta.scrollTop = (ln - 4) * parseFloat(getComputedStyle(ta).lineHeight);
      } else if ('yamlsave' in b.dataset) {
        const vals = parseYaml(st.yamlDraft);
        const changes = [...vals.entries()].filter(([k, v]) => !same(v, st.saved.get(k)));
        saveConfig(ctx, st, changes, true);
      }
    });
    root.addEventListener('change', (e) => {
      const t = e.target;
      const key = t.closest('.cf-field')?.dataset.key;
      if (!key) return;
      if (t.dataset.ctl === 'select') setVal(key, t.value, '[data-ctl]');
      else if (t.dataset.ctl === 'number') { const n = Number(t.value); if (t.value !== '' && !Number.isNaN(n)) setVal(key, n, '[data-ctl]'); }
      else if (t.dataset.ctl === 'text') setVal(key, t.value, '[data-ctl]');
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.dataset?.ctl === 'list' && e.key === 'Enter' && t.value.trim()) {
        e.preventDefault();
        const key = t.closest('.cf-field').dataset.key;
        setVal(key, [...cur(st, key), t.value.trim()], '[data-ctl="list"]');
      }
      if ((t.dataset?.ctl === 'text' || t.dataset?.ctl === 'number') && e.key === 'Enter') t.blur();
    });
    // YAML editor
    const ta = root.querySelector('#cf-yaml-ta');
    if (ta) {
      const gutter = root.querySelector('.cf-yaml__gutter');
      ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
      ta.addEventListener('input', () => {
        st.yamlDraft = ta.value;
        const err = validateYaml(ta.value);
        const base = toYaml(ctx, st, (k) => st.saved.get(k));
        const dirty = ta.value !== base;
        root.querySelector('[data-yamlerr]').innerHTML = err ? String(yamlErr(err)) : '';
        root.querySelector('.cf-yaml__ed').classList.toggle('is-invalid', !!err);
        if (err) { ta.setAttribute('aria-invalid', 'true'); ta.setAttribute('aria-describedby', 'cf-yaml-err'); } else { ta.removeAttribute('aria-invalid'); ta.removeAttribute('aria-describedby'); }
        root.querySelector('[data-yamlsave]').disabled = !dirty || !!err || offline();
        root.querySelector('[data-yamlreset]').disabled = !dirty;
        const n = ta.value.split('\n').length;
        if (gutter.textContent.split('\n').length !== n) gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
      });
    }
    // Deep link: ?key=… scrolls to the field, highlights it and focuses its control
    const key = ctx.query.key;
    if (key && field(key)) {
      requestAnimationFrame(() => {
        const el = root.querySelector(`#${domId(key)}`);
        if (!el) return;
        el.classList.add('is-target');
        el.scrollIntoView({ block: 'center' });
        el.querySelector('[data-ctl]')?.focus({ preventScroll: true });
      });
    }
    // Leaving with unsaved changes: browser unload prompt (in-app routes keep pending edits in memory)
    const unload = (e) => { if (st.pending.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  },

  paletteActions(ctx) {
    return [
      { label: 'Search settings…', icon: 'search', sub: 'Focus the settings search', run: () => {
        const focus = () => { const q = document.getElementById('cf-q'); q?.focus(); q?.select(); };
        if (ctx.query.view === 'yaml') ctx.navigate('/system/config').then(() => setTimeout(focus, 60)); else setTimeout(focus, 60);
      } },
      { label: 'Show modified settings', icon: 'filter', sub: '@modified', run: () => ctx.navigate('/system/config?f=modified') },
      { label: 'Show restart-required settings', icon: 'refresh', sub: '@restart-required', run: () => ctx.navigate('/system/config?f=restart') },
      { label: 'Open Raw YAML', icon: 'code', run: () => ctx.navigate('/system/config?view=yaml') },
    ];
  },
};

/* ---- Review + save (T3) ---- */
function diffRows(st, entries) {
  return entries.map(([k, v]) => {
    const f = field(k);
    return `<li class="cf-diff__row"><div class="cf-diff__k"><span>${esc(f.label)}</span><code>${esc(k)}</code>${f.restartRequired ? '<span class="tag" data-tone="warning">Restart</span>' : ''}</div><div class="cf-diff__v mono"><del>${esc(fmtVal(st.saved.get(k)))}</del><span aria-hidden="true">→</span><span class="sr-only">changes to</span><ins>${esc(fmtVal(v))}</ins></div>${st.pending.has(k) ? `<button type="button" class="btn btn--ghost btn--sm" data-undo-k="${esc(k)}" aria-label="Undo change to ${esc(k)}">Undo</button>` : ''}</li>`;
  }).join('');
}
function openReview(ctx, st, done) {
  ctx.openSheet({
    title: `Review ${st.pending.size} unsaved ${st.pending.size === 1 ? 'change' : 'changes'}`,
    detents: ['half', 'full'],
    body: `<p class="muted">Writes <span class="mono">${esc(cfgPath(ctx.profile))}</span> for <strong>${esc(ctx.profile.name)}</strong>.</p><ul class="cf-diff" data-diff>${diffRows(st, [...st.pending.entries()])}</ul>`,
    footer: `<button type="button" class="btn btn--secondary" data-close>Keep editing</button><button type="button" class="btn btn--primary" data-go ${ctx.data.connection === 'offline' ? 'disabled' : ''}>${icon('lock')}Save…</button>`,
    onMount(panel, layer) {
      panel.addEventListener('click', (e) => {
        const u = e.target.closest('[data-undo-k]');
        if (!u) return;
        st.pending.delete(u.dataset.undoK);
        if (!st.pending.size) { layer.close(); return; }
        panel.querySelector('[data-diff]').innerHTML = diffRows(st, [...st.pending.entries()]);
        panel.querySelector('[data-diff] button')?.focus();
      });
      panel.querySelector('[data-go]').addEventListener('click', async () => {
        layer.close();
        await overlaysSettled();
        saveConfig(ctx, st, [...st.pending.entries()]);
      });
    },
    onClose: done,
  });
}
function saveConfig(ctx, st, entries, fromYaml = false) {
  const p = ctx.profile;
  if (!entries.length) { ctx.toast('Nothing to save', { tone: 'info' }); return; }
  const restart = entries.filter(([k]) => field(k)?.restartRequired);
  const list = entries.slice(0, 6).map(([k, v]) => `<span class="mono">${esc(k)}: ${esc(fmtVal(st.saved.get(k)))} → ${esc(fmtVal(v))}</span>`).join('<br>');
  ctx.openDialog({
    tier: 3,
    title: `Save ${entries.length} ${entries.length === 1 ? 'setting' : 'settings'} to ${p.name}?`,
    object: p.name,
    profile: p.name,
    body: `${fromYaml ? 'Replaces' : 'Writes'} <span class="mono">${esc(cfgPath(p))}</span>:<br>${list}${entries.length > 6 ? `<br>…and ${entries.length - 6} more` : ''}${restart.length ? `<br><br><strong>${restart.length} ${restart.length === 1 ? 'change needs' : 'changes need'} a gateway restart.</strong>` : ''}`,
    recoverability: 'Restorable: the previous file is kept as config.yaml.bak and in tonight\'s backup.',
    confirmLabel: 'Save config',
  }).then((ok) => {
    if (!ok) return;
    entries.forEach(([k, v]) => { st.saved.set(k, clone(v)); st.pending.delete(k); });
    st.yamlDraft = null;
    ctx.refresh();
    ctx.toast(`Saved ${entries.length} ${entries.length === 1 ? 'setting' : 'settings'}`, { detail: `${p.name} · ${cfgPath(p)}` });
    if (restart.length) {
      ctx.toast('Restart the gateway to apply', {
        tone: 'warning', detail: restart.map(([k]) => k).join(', '), timeout: 12000,
        action: { label: 'Restart…', onClick: () => ctx.openDialog({ tier: 2, title: `Restart the gateway for ${p.name}?`, body: 'Live sessions reconnect automatically; in-flight tool calls finish first.', profile: p.name, confirmLabel: 'Restart' }).then((y) => { if (y) ctx.toast('Gateway restarted', { detail: `${p.name} · new settings active` }); }) },
      });
    }
  });
}
