// Work › Schedules (work-model §2.4, mobile §4): Hermes cron only. Four job types in one list, run history with
// expandable output, a schedule builder with the next three fire times, and the Blueprints gallery.
// The "When" builder is exported for the New task → Schedule dispatch mode (tasks.js).
import {
  html, raw, esc, icon, statusBadge, profileTag, emptyState, fmtAgo, fmtDur, fmtMoney, fmtTokens, fmtTime,
  getJob, getPlaybook, inScope, overlaysSettled, uid,
} from '../shared.js';
import { ensureCss, liveQuery, setQuery, tabsHtml, tabPanelAttrs, bindTabs } from './board.js';

ensureCss('schedules');

/* ---------- Vocabulary ---------- */
export const JOB_TYPES = {
  agent: { label: 'Agent prompt', icon: 'chat', tone: 'accent', hint: 'A prompt run by the profile on a schedule' },
  script: { label: 'Script', icon: 'terminal', tone: 'neutral', hint: 'Runs a script from the profile’s scripts/ folder' },
  task: { label: 'Create task', icon: 'tasks', tone: 'info', hint: 'Creates a Kanban task or runs a playbook' },
  blueprint: { label: 'Blueprint', icon: 'package', tone: 'success', hint: 'An instance of a Hermes Automation Blueprint' },
};
export const typeLabel = (j) => (j.type === 'task' && j.creates?.playbook ? 'Run playbook' : JOB_TYPES[j.type]?.label || j.type);
export const typeBadge = (j) => html`<span class="tag jtype" data-tone="${JOB_TYPES[j.type]?.tone || 'neutral'}">${icon(JOB_TYPES[j.type]?.icon || 'clock', 'i-sm')}${typeLabel(j)}</span>`;
const DELIVER = { telegram: 'Telegram', discord: 'Discord', inbox: 'Inbox', session: 'Attach to a session', local: 'Keep output only' };
const deliverIcon = (k) => ({ telegram: 'telegram', discord: 'discord', inbox: 'inbox', session: 'chat' }[k] || 'archive');
const SCRIPTS = { default: ['verify_backup.sh', 'gpu_watch.py', 'calendar_digest.py'], coder: ['ci_flake_report.py', 'dep_audit.sh'], homeassistant: ['energy_week.py'], property: ['rent_due.py'], librarian: ['rss_pull.py'], general: ['groceries.py'] };

/** Hermes Automation Blueprints (screen-local mock; Hermes ships 16). */
const BLUEPRINTS = [
  { id: 'morning-briefing', name: 'Morning briefing', category: 'Personal', icon: 'sun', schedule: '0 7 * * *', desc: 'Calendar, weather and deliveries summarised before you wake up.', needs: ['google-workspace'], deliver: 'telegram' },
  { id: 'weekly-energy-digest', name: 'Weekly energy digest', category: 'Home', icon: 'bolt', schedule: '0 18 * * 0', desc: 'Home Assistant energy totals, top consumers and week-on-week change.', needs: ['home-assistant-control'], deliver: 'discord', inUse: 1 },
  { id: 'price-watch', name: 'Price watch', category: 'Monitoring', icon: 'eye', schedule: '*/30 * * * *', desc: 'A cheap monitor script checks a page; the agent only runs when it changes.', needs: [], deliver: 'telegram' },
  { id: 'site-uptime', name: 'Site uptime', category: 'Monitoring', icon: 'heartbeat', schedule: '*/5 * * * *', desc: 'monitor_url pings a URL; failures go to the Inbox.', needs: [], deliver: 'inbox' },
  { id: 'backup-verify', name: 'Backup verify', category: 'System', icon: 'database', schedule: '30 2 * * *', desc: 'Checksums last night’s backup and reports drift verbatim.', needs: [], deliver: 'telegram' },
  { id: 'pr-digest', name: 'Pull request digest', category: 'Engineering', icon: 'git', schedule: '0 9 * * 1-5', desc: 'Open PRs, stale reviews and red CI across your repos, every weekday.', needs: ['github-pr-workflow'], deliver: 'discord' },
  { id: 'dependency-audit', name: 'Dependency audit', category: 'Engineering', icon: 'shield', schedule: '0 3 * * 1', desc: 'Creates a Kanban task to audit outdated and vulnerable dependencies.', needs: ['dependency-audit'], deliver: 'inbox' },
  { id: 'reading-digest', name: 'Reading list digest', category: 'Research', icon: 'book', schedule: '0 8 * * 6', desc: 'New items on your reading list with two-line summaries and links.', needs: ['web-research'], deliver: 'telegram' },
  { id: 'rent-reminder', name: 'Rent reminders', category: 'Property', icon: 'coin', schedule: '0 9 1 * *', desc: 'Checks the rent ledger and drafts reminders for late payments.', needs: ['google-workspace'], deliver: 'inbox' },
  { id: 'inbox-digest', name: 'Evening inbox digest', category: 'Personal', icon: 'inbox', schedule: '0 20 * * *', desc: 'FYI items from the day in one message instead of many.', needs: [], deliver: 'telegram', inUse: 1 },
];

/* ---------- Cron maths: next fire times ---------- */
function parseField(f, min, max, name) {
  if (f === '*') return null;
  const out = new Set();
  for (const part of f.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`Can’t read the ${name} field “${f}”`);
    let lo, hi;
    if (m[1] === '*') [lo, hi] = [min, max];
    else { [lo, hi] = m[1].split('-').map(Number); if (hi == null) hi = m[2] ? max : lo; }
    const step = m[2] ? +m[2] : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`The ${name} field must be between ${min} and ${max}`);
    for (let v = lo; v <= hi; v += step) out.add(name === 'weekday' && v === 7 ? 0 : v);
  }
  return out;
}
export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5 || !f[0]) throw new Error('Use five fields: minute hour day-of-month month weekday');
  return { min: parseField(f[0], 0, 59, 'minute'), hour: parseField(f[1], 0, 23, 'hour'), dom: parseField(f[2], 1, 31, 'day'), mon: parseField(f[3], 1, 12, 'month'), dow: parseField(f[4], 0, 7, 'weekday') };
}
export function nextFires(expr, n = 3, from = Date.now()) {
  const c = parseCron(expr);
  const has = (s, v) => !s || s.has(v);
  const d = new Date(from);
  d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  const out = [];
  for (let guard = 0; out.length < n && guard < 100000; guard++) {
    if (!has(c.mon, d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    const domOk = has(c.dom, d.getDate()), dowOk = has(c.dow, d.getDay());
    if (!(c.dom && c.dow ? domOk || dowOk : domOk && dowOk)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!has(c.hour, d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!has(c.min, d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    out.push(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  if (!out.length) throw new Error('This expression never fires');
  return out;
}

/* ---------- Builder model ---------- */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODES = [['interval', 'Interval'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['once', 'Once'], ['custom', 'Custom cron']];
const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => (t || '00:00').split(':').map(Number);
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function localIso(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/** Best-effort cron → builder spec, so Edit opens on the friendliest mode. */
export function specFromCron(cron = '0 7 * * *') {
  const base = { mode: 'custom', every: 30, unit: 'm', time: '07:00', days: [1], dom: 1, once: localIso(Date.now() + 3600_000), cron };
  let m;
  if ((m = cron.match(/^\*\/(\d+) \* \* \* \*$/))) return { ...base, mode: 'interval', every: +m[1], unit: 'm' };
  if ((m = cron.match(/^0 \*\/(\d+) \* \* \*$/))) return { ...base, mode: 'interval', every: +m[1], unit: 'h' };
  if ((m = cron.match(/^(\d+) (\d+) \* \* \*$/))) return { ...base, mode: 'daily', time: `${pad(m[2])}:${pad(m[1])}` };
  if ((m = cron.match(/^(\d+) (\d+) \* \* ([\d,-]+)$/))) return { ...base, mode: 'weekly', time: `${pad(m[2])}:${pad(m[1])}`, days: [...parseField(m[3], 0, 7, 'weekday')] };
  if ((m = cron.match(/^(\d+) (\d+) (\d+) \* \*$/))) return { ...base, mode: 'monthly', time: `${pad(m[2])}:${pad(m[1])}`, dom: +m[3] };
  return base;
}
/** spec → { cron, human, fires[] } or { error }. */
export function computeSchedule(s) {
  try {
    const [H, M] = hm(s.time);
    if (s.mode === 'interval') {
      const n = Math.floor(+s.every);
      if (!n || n < 1) throw new Error('Enter how often, 1 or more');
      const mins = s.unit === 'h' ? n * 60 : n;
      if (s.unit === 'm' && n < 5) throw new Error('The scheduler ticks every minute; use 5 minutes or more');
      const human = `Every ${n === 1 ? '' : n + ' '}${s.unit === 'h' ? 'hour' : 'minute'}${n === 1 ? '' : 's'}`;
      if (s.unit === 'm' && 60 % n === 0) return { cron: `*/${n} * * * *`, human, fires: nextFires(`*/${n} * * * *`) };
      if (s.unit === 'h' && 24 % n === 0) return { cron: n === 1 ? '0 * * * *' : `0 */${n} * * *`, human, fires: nextFires(n === 1 ? '0 * * * *' : `0 */${n} * * *`) };
      const now = Date.now();
      return { cron: `every ${mins}m`, human: `${human} (from now)`, fires: [1, 2, 3].map((k) => now + k * mins * 60_000) };
    }
    if (s.mode === 'daily') return { cron: `${M} ${H} * * *`, human: `Every day at ${pad(H)}:${pad(M)}`, fires: nextFires(`${M} ${H} * * *`) };
    if (s.mode === 'weekly') {
      if (!s.days.length) throw new Error('Pick at least one day');
      const days = [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const label = days.join(',') === '1,2,3,4,5' ? 'Weekdays' : days.length === 7 ? 'Every day' : days.map((d) => DOW[d]).join(', ');
      return { cron: `${M} ${H} * * ${days.join(',')}`, human: `${label} at ${pad(H)}:${pad(M)}`, fires: nextFires(`${M} ${H} * * ${days.join(',')}`) };
    }
    if (s.mode === 'monthly') return { cron: `${M} ${H} ${s.dom} * *`, human: `The ${ordinal(+s.dom)} of each month at ${pad(H)}:${pad(M)}`, fires: nextFires(`${M} ${H} ${s.dom} * *`) };
    if (s.mode === 'once') {
      const t = new Date(s.once).getTime();
      if (!t || Number.isNaN(t)) throw new Error('Pick a date and time');
      if (t <= Date.now()) throw new Error('Pick a time in the future');
      return { cron: `at ${s.once.replace('T', ' ')}`, human: `Once, ${fmtFire(t)}`, fires: [t], once: true };
    }
    const fires = nextFires(s.cron);
    return { cron: s.cron.trim().replace(/\s+/g, ' '), human: 'Custom cron expression', fires };
  } catch (e) {
    return { error: e.message };
  }
}
export function fmtFire(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(ts)}`;
}

function whenFields(s, p) {
  if (s.mode === 'interval') return html`<div class="sb__row">
    <div class="field sb__num"><label class="field__label" for="${p}-every">Every</label><input class="input" id="${p}-every" type="number" inputmode="numeric" min="1" value="${s.every}" data-sb="every"></div>
    <div class="field"><label class="field__label" for="${p}-unit">Unit</label><select class="input" id="${p}-unit" data-sb="unit"><option value="m" ${s.unit === 'm' ? raw('selected') : ''}>minutes</option><option value="h" ${s.unit === 'h' ? raw('selected') : ''}>hours</option></select></div>
  </div>`;
  const time = html`<div class="field sb__time"><label class="field__label" for="${p}-time">Time</label><input class="input" id="${p}-time" type="time" value="${s.time}" data-sb="time"></div>`;
  if (s.mode === 'daily') return time;
  if (s.mode === 'weekly') return html`<div class="field"><span class="field__label" id="${p}-days">Days</span>
      <div class="sb__days" role="group" aria-labelledby="${p}-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => html`<button type="button" class="chip" aria-pressed="${String(s.days.includes(d))}" data-day="${d}">${DOW[d]}</button>`)}</div></div>${time}`;
  if (s.mode === 'monthly') return html`<div class="sb__row"><div class="field"><label class="field__label" for="${p}-dom">Day of month</label><select class="input" id="${p}-dom" data-sb="dom">${Array.from({ length: 28 }, (_, i) => html`<option value="${i + 1}" ${+s.dom === i + 1 ? raw('selected') : ''}>${ordinal(i + 1)}</option>`)}</select></div>${time}</div>`;
  if (s.mode === 'once') return html`<div class="field"><label class="field__label" for="${p}-once">Date and time</label><input class="input" id="${p}-once" type="datetime-local" value="${s.once}" data-sb="once"></div>`;
  return html`<div class="field"><label class="field__label" for="${p}-cron">Cron expression</label><input class="input input--mono" id="${p}-cron" value="${s.cron}" data-sb="cron" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="${p}-cron-h">
    <p class="field__help" id="${p}-cron-h">minute · hour · day of month · month · weekday (local time)</p>
    <div class="sb__eg">${['0 9 * * 1-5', '*/15 8-18 * * *', '0 0 1 */3 *'].map((x) => html`<button type="button" class="chip mono" data-eg="${x}">${x}</button>`)}</div></div>`;
}
function whenPreview(s) {
  const r = computeSchedule(s);
  if (r.error) return html`<p class="field__error">${icon('alert', 'i-sm')}${r.error}</p>`;
  return html`<div class="sb__expr"><span class="mono">${r.cron}</span><span class="muted">${r.human}</span></div>
    <p class="overline">${r.once ? 'Fires once' : 'Next 3 fire times'}</p>
    <ol class="sb__fires">${r.fires.map((t, i) => html`<li><span class="sb__fi mono">${i + 1}</span><span>${fmtFire(t)}</span><span class="mono subtle">${fmtAgo(t)}</span></li>`)}</ol>`;
}
/** The "When" fieldset. Bind with bindWhen(container, spec). */
export function whenHtml(s, p = uid('sb')) {
  return html`<fieldset class="sb" data-when>
    <legend class="sb__legend">When</legend>
    <div class="seg sb__modes" role="radiogroup" aria-label="Schedule type">${MODES.map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(s.mode === k)}" data-mode="${k}">${l}</button>`)}</div>
    <div class="sb__fields" data-sb-fields data-p="${p}">${whenFields(s, p)}</div>
    <div class="sb__preview" data-sb-preview aria-live="polite">${whenPreview(s)}</div>
  </fieldset>`;
}
export function bindWhen(box, s, onChange) {
  const root = box.querySelector('[data-when]');
  const fields = root.querySelector('[data-sb-fields]');
  const prev = root.querySelector('[data-sb-preview]');
  const upd = () => { prev.innerHTML = String(whenPreview(s)); onChange?.(s); };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) {
      s.mode = b.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      fields.innerHTML = String(whenFields(s, fields.dataset.p));
      upd();
    } else if (b.dataset.day) {
      const d = +b.dataset.day;
      s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d];
      b.setAttribute('aria-pressed', String(s.days.includes(d)));
      upd();
    } else if (b.dataset.eg) {
      s.cron = b.dataset.eg;
      fields.querySelector('[data-sb="cron"]').value = s.cron;
      upd();
    }
  });
  root.addEventListener('input', (e) => { const k = e.target.dataset.sb; if (k) { s[k] = e.target.value; upd(); } });
  return () => computeSchedule(s);
}

/* ---------- Builder sheet ---------- */
function formFor(j) {
  return {
    name: j?.name || '', type: j?.type || 'agent', profile: j?.profile || 'default', prompt: j?.prompt || '',
    script: j?.script || '', no_agent: j?.no_agent ?? true, taskKind: j?.creates?.playbook ? 'playbook' : 'task',
    board: j?.creates?.board || 'caduceus', title: j?.creates?.title || '', assignee: j?.creates?.assignee || 'coder', playbook: j?.creates?.playbook || 'research-brief',
    blueprint: j?.blueprint || 'morning-briefing', monitor: j?.monitor_script ? 'script' : j?.monitor_url ? 'url' : 'none',
    monitor_script: j?.monitor_script || '', monitor_url: j?.monitor_url || '', context_from: j?.context_from || '',
    deliver: j?.deliver || 'telegram', failure_deliver: j?.failure_deliver || 'inbox', workdir: j?.workdir || '',
  };
}
const opt = (v, label, cur) => html`<option value="${v}" ${v === cur ? raw('selected') : ''}>${label}</option>`;
function whatFields(ctx, f) {
  if (f.type === 'agent') return html`<div class="field"><label class="field__label" for="jb-prompt">Prompt</label><textarea class="input" id="jb-prompt" rows="3" data-f="prompt" placeholder="Summarise my calendar, weather and deliveries for today.">${f.prompt}</textarea><p class="field__help">Runs as a fresh session for the profile below. Use “Context from” to chain another job’s output.</p></div>`;
  if (f.type === 'script') return html`<div class="field"><label class="field__label" for="jb-script">Script</label><select class="input input--mono" id="jb-script" data-f="script">${opt('', 'Choose a script…', f.script)}${(SCRIPTS[f.profile] || []).map((s) => opt(s, s, f.script))}</select><p class="field__help">Scripts live in <span class="mono">~/.hermes/profiles/${f.profile}/scripts/</span>; paths outside it are refused.</p></div>
    <div class="switch-row"><span><span id="jb-na">Deliver script output only</span><span class="field__help" style="display:block">no_agent: stdout is sent verbatim. Off: stdout becomes context for an agent prompt.</span></span><button type="button" class="switch" role="switch" aria-checked="${String(f.no_agent)}" aria-labelledby="jb-na" data-sw="no_agent"></button></div>`;
  if (f.type === 'task') return html`<div class="seg" role="radiogroup" aria-label="Create">${[['task', 'Create task'], ['playbook', 'Run playbook']].map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(f.taskKind === k)}" data-tk="${k}">${l}</button>`)}</div>
    ${f.taskKind === 'task' ? html`<div class="field"><label class="field__label" for="jb-title">Task title</label><input class="input" id="jb-title" data-f="title" value="${f.title}" placeholder="Weekly dependency audit"></div>
      <div class="jb__row"><div class="field"><label class="field__label" for="jb-board">Board</label><select class="input" id="jb-board" data-f="board">${ctx.data.boards.map((b) => opt(b.id, b.name, f.board))}</select></div>
      <div class="field"><label class="field__label" for="jb-asg">Assignee</label><select class="input" id="jb-asg" data-f="assignee">${ctx.data.profiles.map((p) => opt(p.name, p.name, f.assignee))}</select></div></div>
      <p class="field__help">Runs <span class="mono">hermes kanban create --board ${f.board} --assignee ${f.assignee} …</span> at each fire; the task lands in Scheduled → Ready.</p>`
      : html`<div class="field"><label class="field__label" for="jb-pb">Playbook</label><select class="input" id="jb-pb" data-f="playbook">${ctx.data.playbooks.map((p) => opt(p.id, `${p.name} · v${p.version}`, f.playbook))}</select><p class="field__help">Inputs use the playbook defaults; edit them on the playbook.</p></div>`}`;
  const bp = BLUEPRINTS.find((b) => b.id === f.blueprint);
  return html`<div class="field"><label class="field__label" for="jb-bp">Blueprint</label><select class="input" id="jb-bp" data-f="blueprint">${BLUEPRINTS.map((b) => opt(b.id, b.name, f.blueprint))}</select>${bp ? html`<p class="field__help">${bp.desc}</p>` : ''}</div>`;
}
function monitorField(f) {
  if (f.monitor === 'script') return html`<div class="field"><label class="field__label" for="jb-ms">Monitor script</label><input class="input input--mono" id="jb-ms" data-f="monitor_script" value="${f.monitor_script}" placeholder="gpu_watch.py --hash"></div>`;
  if (f.monitor === 'url') return html`<div class="field"><label class="field__label" for="jb-mu">Monitor URL</label><input class="input input--mono" id="jb-mu" type="url" data-f="monitor_url" value="${f.monitor_url}" placeholder="https://example.com/status"></div>`;
  return '';
}

/** Create or edit a cron job. preset: partial job (e.g. from a blueprint). */
export function openScheduleBuilder(ctx, { job = null, preset = null } = {}) {
  const f = formFor(job || preset);
  const spec = specFromCron(job?.schedule || preset?.schedule || '0 7 * * *');
  const others = ctx.data.cron.filter((j) => j.id !== job?.id);
  const body = html`<form class="jb" novalidate data-jb>
    <section class="jb__sec" aria-labelledby="jb-s1"><h3 class="jb__h" id="jb-s1"><span class="jb__n" aria-hidden="true">1</span>What runs</h3>
      <div class="field"><label class="field__label" for="jb-name">Name</label><input class="input" id="jb-name" data-f="name" value="${f.name}" placeholder="Morning briefing" required aria-describedby="jb-name-e"><p class="field__error" id="jb-name-e" hidden>${icon('alert', 'i-sm')}Give the job a name</p></div>
      <div class="field"><span class="field__label" id="jb-type-l">Type</span>
        <div class="jb__types" role="radiogroup" aria-labelledby="jb-type-l">${Object.entries(JOB_TYPES).map(([k, t]) => html`<button type="button" class="jb__type" role="radio" aria-checked="${String(f.type === k)}" data-type="${k}" data-tone="${t.tone}">${icon(t.icon)}<span><strong>${t.label}</strong><small>${t.hint}</small></span></button>`)}</div></div>
      <div class="field"><label class="field__label" for="jb-prof">Profile</label><select class="input" id="jb-prof" data-f="profile">${ctx.data.profiles.map((p) => opt(p.name, p.name, f.profile))}</select></div>
      <div class="jb__what" data-what>${whatFields(ctx, f)}</div>
    </section>
    <section class="jb__sec" aria-labelledby="jb-s2"><h3 class="jb__h" id="jb-s2"><span class="jb__n" aria-hidden="true">2</span>When</h3>${whenHtml(spec, 'jbw')}</section>
    <section class="jb__sec" aria-labelledby="jb-s3"><h3 class="jb__h" id="jb-s3"><span class="jb__n" aria-hidden="true">3</span>Options</h3>
      <div class="field"><span class="field__label" id="jb-mon-l">Monitor first</span>
        <div class="seg" role="radiogroup" aria-labelledby="jb-mon-l">${[['none', 'None'], ['script', 'monitor_script'], ['url', 'monitor_url']].map(([k, l]) => html`<button type="button" role="radio" aria-checked="${String(f.monitor === k)}" data-mon="${k}">${l}</button>`)}</div>
        <p class="field__help">A cheap check runs each tick; unchanged output skips the agent run.</p></div>
      <div data-monf>${monitorField(f)}</div>
      <div class="jb__row">
        <div class="field"><label class="field__label" for="jb-ctx">Context from</label><select class="input" id="jb-ctx" data-f="context_from">${opt('', 'None', f.context_from)}${others.map((j) => opt(j.id, j.name, f.context_from))}</select><p class="field__help">context_from: the last output of another job is added to the prompt.</p></div>
        <div class="field"><label class="field__label" for="jb-dl">Deliver to</label><select class="input" id="jb-dl" data-f="deliver">${Object.entries(DELIVER).map(([k, l]) => opt(k, l, f.deliver))}</select></div>
      </div>
      <div class="jb__row">
        <div class="field"><label class="field__label" for="jb-fd">On failure</label><select class="input" id="jb-fd" data-f="failure_deliver">${Object.entries(DELIVER).map(([k, l]) => opt(k, l, f.failure_deliver))}</select></div>
        <div class="field"><label class="field__label" for="jb-wd">Working directory</label><input class="input input--mono" id="jb-wd" data-f="workdir" value="${f.workdir}" placeholder="~/ (profile home)"></div>
      </div>
    </section>
  </form>`;
  ctx.openSheet({
    title: job ? `Edit ${job.name}` : 'New schedule',
    wide: true,
    detents: ['full'],
    className: 'jb-sheet',
    body: String(body),
    footer: `<p class="jb__foot-note" data-foot-note></p><button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-save>${icon('check')}${job ? 'Save changes' : 'Create schedule'}</button>`,
    initialFocus: '#jb-name',
    onMount(panel, layer) {
      const form = panel.querySelector('[data-jb]');
      const what = form.querySelector('[data-what]');
      const note = panel.querySelector('[data-foot-note]');
      const syncNote = () => { note.textContent = f.type === 'script' ? 'Script jobs need a passkey and typed confirmation (T3).' : ''; };
      syncNote();
      bindWhen(form, spec);
      form.addEventListener('input', (e) => {
        const k = e.target.dataset.f;
        if (!k) return;
        f[k] = e.target.value;
        if (k === 'name') { e.target.removeAttribute('aria-invalid'); form.querySelector('#jb-name-e').hidden = true; }
        if (k === 'profile' || (f.type === 'task' && (k === 'board' || k === 'assignee'))) what.innerHTML = String(whatFields(ctx, f));
        if (k === 'blueprint') what.innerHTML = String(whatFields(ctx, f));
      });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.type) { f.type = b.dataset.type; form.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); what.innerHTML = String(whatFields(ctx, f)); syncNote(); }
        else if (b.dataset.tk) { f.taskKind = b.dataset.tk; what.innerHTML = String(whatFields(ctx, f)); what.querySelector(`[data-tk="${f.taskKind}"]`)?.focus(); }
        else if (b.dataset.sw) { f[b.dataset.sw] = !f[b.dataset.sw]; b.setAttribute('aria-checked', String(f[b.dataset.sw])); }
        else if (b.dataset.mon) { f.monitor = b.dataset.mon; form.querySelectorAll('[data-mon]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); form.querySelector('[data-monf]').innerHTML = String(monitorField(f)); }
      });
      panel.querySelector('[data-save]').addEventListener('click', async () => {
        const r = computeSchedule(spec);
        const nameEl = form.querySelector('#jb-name');
        if (!f.name.trim()) { nameEl.setAttribute('aria-invalid', 'true'); form.querySelector('#jb-name-e').hidden = false; nameEl.focus(); return; }
        if (r.error) { form.querySelector('[data-sb-preview]').scrollIntoView({ block: 'center' }); form.querySelector('[data-sb-fields] input, [data-sb-fields] select')?.focus(); return; }
        if (f.type === 'script') {
          const ok = await ctx.openDialog({ tier: 3, title: `${job ? 'Save' : 'Create'} script job “${f.name}”?`, object: f.name, profile: f.profile, danger: false, body: `Runs <span class="mono">${esc(f.script || 'a script')}</span> on this host ${esc(r.human.toLowerCase())}.`, recoverability: 'Reversible: pause or delete the job; past runs and outputs are kept.', confirmLabel: job ? 'Save script job' : 'Create script job' });
          if (!ok) return;
        }
        const rec = job || { id: `c_${uid('job').replace(/\W/g, '')}`, runs: [], lastStatus: null, state: 'active' };
        Object.assign(rec, {
          name: f.name.trim(), type: f.type, profile: f.profile, schedule: r.cron, human: r.human, next: r.fires[0], deliver: f.deliver, failure_deliver: f.failure_deliver,
          prompt: f.type === 'agent' ? f.prompt : undefined, script: f.type === 'script' ? f.script : undefined, no_agent: f.type === 'script' ? f.no_agent : undefined,
          creates: f.type === 'task' ? (f.taskKind === 'playbook' ? { playbook: f.playbook } : { board: f.board, title: f.title || f.name, assignee: f.assignee }) : undefined,
          blueprint: f.type === 'blueprint' ? f.blueprint : undefined,
          monitor_script: f.monitor === 'script' ? f.monitor_script : undefined, monitor_url: f.monitor === 'url' ? f.monitor_url : undefined,
          context_from: f.context_from || undefined, workdir: f.workdir || undefined,
        });
        if (!job) ctx.data.cron.unshift(rec);
        layer.close();
        await overlaysSettled();
        ctx.toast(job ? `Saved ${rec.name}` : `Scheduled ${rec.name}`, { detail: `${r.human} · next ${fmtFire(r.fires[0])}` });
        if (job) ctx.refresh(); else ctx.navigate('/work/schedules/' + rec.id);
      });
    },
  });
}

/* ---------- Job actions ---------- */
const timers = new Set();
export function runJobNow(ctx, j) {
  return ctx.openDialog({ tier: 1, title: `Run “${j.name}” now?`, body: `Runs once outside its schedule (${esc(j.human)}). The next scheduled run is unchanged.`, profile: j.profile, confirmLabel: 'Run now' })
    .then((ok) => {
      if (!ok) return;
      const run = { id: `cr_${9100 + j.runs.length}`, at: Date.now(), status: 'running', duration: null, output: 'Started manually from Caduceus…' };
      j.runs.unshift(run); j.state = 'running'; j.lastStatus = 'running';
      ctx.refresh();
      ctx.toast(`Running ${j.name}`, { tone: 'info', detail: run.id });
      const t = setTimeout(() => {
        timers.delete(t);
        Object.assign(run, { status: 'succeeded', duration: 6, output: j.type === 'script' ? 'OK (manual run)\nexit 0' : 'Done. Delivered to ' + (DELIVER[j.deliver] || 'output') + '.', exit: j.type === 'script' ? 0 : undefined, tokens: j.type === 'script' ? undefined : 8_400, cost: j.type === 'script' ? undefined : 0.01 });
        j.state = 'active'; j.lastStatus = 'succeeded';
        if (location.hash.startsWith('#/work/schedules')) ctx.refresh();
      }, 4000);
      timers.add(t);
    });
}
export function togglePause(ctx, j) {
  const prev = { state: j.state, next: j.next };
  if (j.state === 'paused') { j.state = 'active'; try { j.next = nextFires(j.schedule, 1)[0]; } catch { j.next = null; } } else { j.state = 'paused'; j.next = null; }
  ctx.refresh();
  ctx.toast(j.state === 'paused' ? `Paused ${j.name}` : `Resumed ${j.name}`, { detail: j.state === 'paused' ? 'No runs until resumed' : `Next ${fmtFire(j.next)}`, undo: () => { Object.assign(j, prev); ctx.refresh(); } });
}
function jobMenu(ctx, j) {
  ctx.openSheet({
    title: j.name,
    body: String(html`<ul class="tmenu" role="list">
      <li><button type="button" class="tmenu__item" data-m="open">${icon('arrow-r')}<span class="tmenu__label">Open job</span>${icon('chev-r', 'i-sm')}</button></li>
      <li><button type="button" class="tmenu__item" data-m="run">${icon('play')}<span class="tmenu__label">Run now</span></button></li>
      <li><button type="button" class="tmenu__item" data-m="pause">${icon(j.state === 'paused' ? 'play' : 'paused')}<span class="tmenu__label">${j.state === 'paused' ? 'Resume' : 'Pause'}</span></button></li>
      <li><button type="button" class="tmenu__item" data-m="edit">${icon('draft')}<span class="tmenu__label">Edit…</span></button></li>
      <li><button type="button" class="tmenu__item" data-m="dup">${icon('copy')}<span class="tmenu__label">Duplicate</span></button></li>
      <li><button type="button" class="tmenu__item tmenu__item--danger" data-m="del">${icon('trash')}<span class="tmenu__label">Delete…</span></button></li>
    </ul>`),
    onMount(panel, layer) {
      panel.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => {
        const m = b.dataset.m;
        if (m === 'open') { ctx.navigate('/work/schedules/' + j.id); return; }
        layer.close(); await overlaysSettled();
        if (m === 'run') runJobNow(ctx, j);
        else if (m === 'pause') togglePause(ctx, j);
        else if (m === 'edit') openScheduleBuilder(ctx, { job: j });
        else if (m === 'dup') openScheduleBuilder(ctx, { preset: { ...j, name: `${j.name} (copy)` } });
        else if (m === 'del') deleteJob(ctx, j);
      }));
    },
  });
}
function deleteJob(ctx, j) {
  ctx.openDialog({ tier: 1, title: `Delete “${j.name}”?`, body: `Removes the cron job and stops future runs. ${j.runs.length} past run${j.runs.length === 1 ? '' : 's'} stay in Logs.`, profile: j.profile, danger: true, confirmLabel: 'Delete job' })
    .then((ok) => {
      if (!ok) return;
      const i = ctx.data.cron.indexOf(j);
      ctx.data.cron.splice(i, 1);
      if (location.hash.includes(j.id)) ctx.navigate('/work/schedules'); else ctx.refresh();
      ctx.toast(`Deleted ${j.name}`, { undo: () => { ctx.data.cron.splice(i, 0, j); ctx.refresh(); } });
    });
}

/* ---------- Rendering helpers ---------- */
function lastBadge(j) {
  if (j.state === 'running' || j.lastStatus === 'running') return statusBadge('running', { label: 'Running', detail: j.runs[0] ? fmtDur((Date.now() - j.runs[0].at) / 1000) : '' });
  if (!j.lastStatus) return html`<span class="subtle">Never run</span>`;
  const r = j.runs[0];
  return statusBadge(j.lastStatus === 'failed' ? 'failed' : 'succeeded', { label: j.lastStatus === 'failed' ? 'Failed' : 'Succeeded', detail: r ? fmtAgo(r.at) : '' });
}
function nextCell(j) {
  if (j.state === 'paused') return statusBadge('paused', { variant: 'plain' });
  if (!j.next) return html`<span class="subtle">—</span>`;
  return html`<span class="jnext"><span>${fmtFire(j.next)}</span><span class="mono subtle">${fmtAgo(j.next)}</span></span>`;
}
function jobCard(ctx, j) {
  return html`<li class="jcard panel${j.lastStatus === 'failed' ? ' is-failed' : ''}" data-job="${j.id}">
    <div class="jcard__top">${typeBadge(j)}${j.state === 'paused' ? statusBadge('paused', { variant: 'plain' }) : ''}
      <button type="button" class="btn btn--ghost btn--icon jcard__menu" data-jmenu="${j.id}" aria-haspopup="dialog" aria-label="Actions for ${j.name}">${icon('dots-v')}</button></div>
    <h3 class="jcard__title"><a href="${ctx.href('/work/schedules/' + j.id)}">${j.name}</a></h3>
    <p class="jcard__when"><span>${j.human}</span><span class="mono subtle">${j.schedule}</span></p>
    <dl class="jcard__kv">
      <div><dt>Next</dt><dd>${nextCell(j)}</dd></div>
      <div><dt>Last</dt><dd>${lastBadge(j)}</dd></div>
    </dl>
    <div class="jcard__foot">${profileTag(j.profile)}${j.deliver ? html`<span class="jcard__dl">${icon(deliverIcon(j.deliver), 'i-sm')}${DELIVER[j.deliver]}</span>` : ''}
      <span class="jcard__acts">
        <button type="button" class="btn btn--secondary btn--sm" data-jpause="${j.id}">${icon(j.state === 'paused' ? 'play' : 'paused')}${j.state === 'paused' ? 'Resume' : 'Pause'}</button>
        <button type="button" class="btn btn--secondary btn--sm" data-jrun="${j.id}" ${j.state === 'running' ? raw('disabled') : ''}>${icon('play')}Run now</button>
      </span></div>
  </li>`;
}
function jobRow(ctx, j) {
  return html`<tr data-job="${j.id}">
    <td class="cell-main"><a class="jrow__name" href="${ctx.href('/work/schedules/' + j.id)}">${j.name}</a><div class="jrow__sub">${typeBadge(j)}${j.deliver ? html`<span class="jcard__dl">${icon(deliverIcon(j.deliver), 'i-sm')}${DELIVER[j.deliver]}</span>` : ''}</div></td>
    <td data-label="Schedule"><div class="jrow__when"><span>${j.human}</span><span class="mono subtle">${j.schedule}</span></div></td>
    <td data-label="Next">${nextCell(j)}</td>
    <td class="cell-status" data-label="Last result">${lastBadge(j)}</td>
    <td data-label="Profile">${profileTag(j.profile)}</td>
    <td class="cell-actions"><div class="jrow__acts">
      <button type="button" class="btn btn--ghost btn--icon" data-jrun="${j.id}" aria-label="Run ${j.name} now" ${j.state === 'running' ? raw('disabled') : ''}>${icon('play')}</button>
      <button type="button" class="btn btn--ghost btn--icon" data-jpause="${j.id}" aria-label="${j.state === 'paused' ? 'Resume' : 'Pause'} ${j.name}">${icon(j.state === 'paused' ? 'play' : 'paused')}</button>
      <button type="button" class="btn btn--ghost btn--icon" data-jmenu="${j.id}" aria-haspopup="dialog" aria-label="More actions for ${j.name}">${icon('dots-v')}</button>
    </div></td>
  </tr>`;
}

const TYPE_FILTERS = [['', 'All types'], ['agent', 'Agent prompt'], ['script', 'Script'], ['task', 'Create task / playbook'], ['blueprint', 'Blueprint']];
const STATE_FILTERS = [['', 'Any state'], ['active', 'Active'], ['paused', 'Paused'], ['failing', 'Failing']];

function renderList(ctx) {
  const q = liveQuery();
  const tab = q.tab === 'blueprints' ? 'blueprints' : 'jobs';
  const all = ctx.data.cron.filter((j) => inScope(j.profile, ctx.scope));
  const jobs = all.filter((j) => (!q.type || j.type === q.type)
    && (!q.state || (q.state === 'failing' ? j.lastStatus === 'failed' : q.state === 'active' ? j.state !== 'paused' : j.state === q.state)));
  const failing = all.filter((j) => j.lastStatus === 'failed').length;
  const paused = all.filter((j) => j.state === 'paused').length;
  const running = all.filter((j) => j.state === 'running').length;
  const sched = ctx.data.health.find((h) => h.id === 'scheduler');
  const chips = (key, list) => html`<div class="chips-scroll" role="group" aria-label="${key === 'type' ? 'Job type' : 'State'}" data-keep-scroll="chips-${key}">${list.map(([v, l]) => html`<button type="button" class="chip" aria-pressed="${String((q[key] || '') === v)}" data-fchip="${key}" data-v="${v}" data-fk="fc-${key}-${v}">${l}${v ? html`<span class="mono subtle">${all.filter((j) => (key === 'type' ? j.type === v : v === 'failing' ? j.lastStatus === 'failed' : v === 'active' ? j.state !== 'paused' : j.state === v)).length}</span>` : ''}</button>`)}</div>`;

  let panel;
  if (tab === 'blueprints') {
    panel = html`<p class="muted sched__lede">Hermes Automation Blueprints are ready-made jobs. Using one opens the builder with its schedule and delivery filled in.</p>
      <ul class="bps" role="list">${BLUEPRINTS.map((b) => html`<li class="bp panel">
        <div class="bp__top"><span class="bp__icon" aria-hidden="true">${icon(b.icon)}</span><span class="tag">${b.category}</span>${b.inUse ? html`<span class="tag" data-tone="success">${icon('check', 'i-sm')}In use</span>` : ''}</div>
        <h3 class="bp__title">${b.name}</h3>
        <p class="bp__desc">${b.desc}</p>
        <p class="bp__meta"><span>${specLabel(b.schedule)}</span>${b.needs.length ? html`<span class="mono subtle">needs ${b.needs.join(', ')}</span>` : ''}</p>
        <button type="button" class="btn btn--secondary btn--sm bp__use" data-bp="${b.id}">${icon('plus')}Use blueprint</button>
      </li>`)}</ul>`;
  } else {
    panel = html`<div class="sched__filters">${chips('type', TYPE_FILTERS)}${chips('state', STATE_FILTERS)}</div>
      ${!jobs.length ? emptyState({ icon: 'calendar', title: 'No jobs match', body: 'Clear a filter, or create a schedule.', action: html`<button type="button" class="btn btn--secondary" data-clearf>Clear filters</button>` })
        : ctx.size === 'large'
          ? html`<div class="dl-wrap panel jtable"><table class="dl"><caption class="sr-only">Cron jobs</caption><thead><tr><th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">Next fire</th><th scope="col">Last result</th><th scope="col">Profile</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${jobs.map((j) => jobRow(ctx, j))}</tbody></table></div>`
          : html`<ul class="jcards" role="list">${jobs.map((j) => jobCard(ctx, j))}</ul>`}`;
  }
  return html`<div class="sched">
    <header class="page-header"><div class="page-header__text"><p class="overline">Work</p><h1 tabindex="-1">Schedules</h1>
      <p class="page-header__sub">${all.length} jobs · ${running} running · ${paused} paused${failing ? html` · <span class="sched__fail">${failing} failing</span>` : ''} · scheduler ${sched ? sched.metric.replace('tick ', 'ticked ') + ' ago' : 'online'}</p></div>
      ${ctx.size === 'compact' ? '' : html`<div class="page-header__actions"><button type="button" class="btn btn--primary" data-new>${icon('plus')}New schedule</button></div>`}
    </header>
    ${tabsHtml([{ key: 'jobs', label: 'Jobs', count: all.length }, { key: 'blueprints', label: 'Blueprints', count: BLUEPRINTS.length }], tab, 'Schedules')}
    <div class="sched__panel" ${tabPanelAttrs(tab)}>${panel}</div>
  </div>`;
}
function specLabel(cron) { const r = computeSchedule(specFromCron(cron)); return r.error ? cron : r.human; }

function renderJob(ctx, j) {
  if (!j) return html`<div class="empty"><div class="empty__icon">${icon('calendar')}</div><h1 tabindex="-1">Job not found</h1><p>It may have been deleted.</p><a class="btn btn--secondary" href="${ctx.href('/work/schedules')}">All schedules</a></div>`;
  let fires = [];
  try { if (j.state !== 'paused' && !String(j.schedule).startsWith('at ') && !String(j.schedule).startsWith('every')) fires = nextFires(j.schedule, 3); } catch { /* custom/once */ }
  const bp = j.blueprint && BLUEPRINTS.find((b) => b.id === j.blueprint);
  const ctxFrom = j.context_from && getJob(j.context_from);
  const kv = (k, v) => (v ? html`<dt>${k}</dt><dd>${v}</dd>` : '');
  const what = j.type === 'agent' ? html`<blockquote class="jd__prompt">${j.prompt || '—'}</blockquote>`
    : j.type === 'script' ? html`<p><span class="mono">${j.script}</span> · ${j.no_agent ? 'output delivered verbatim (no_agent)' : 'output becomes context for an agent run'}</p>`
    : j.type === 'task' ? html`<p>${j.creates?.playbook ? html`Runs playbook <a href="${ctx.href('/work/playbooks/' + j.creates.playbook)}">${getPlaybook(j.creates.playbook)?.name}</a>` : html`Creates <strong>${j.creates?.title}</strong> on board <a href="${ctx.href('/work/board/' + j.creates?.board)}">${j.creates?.board}</a>, assigned to ${j.creates?.assignee}`}</p>`
    : html`<p>Instance of <strong>${bp?.name || j.blueprint}</strong>. ${bp?.desc || ''}</p>`;
  const runs = j.runs;
  return html`<div class="jd">
    <header class="page-header"><div class="page-header__text"><p class="overline">Schedule · ${typeLabel(j)}</p><h1 tabindex="-1">${j.name}</h1>
      <p class="page-header__sub jd__sub">${typeBadge(j)}${j.state === 'paused' ? statusBadge('paused') : j.state === 'running' ? statusBadge('running') : statusBadge('scheduled', { label: 'Active' })}${profileTag(j.profile)}</p></div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--primary" data-jrun="${j.id}" ${j.state === 'running' ? raw('disabled') : ''}>${icon('play')}Run now</button>
        <button type="button" class="btn btn--secondary" data-jpause="${j.id}">${icon(j.state === 'paused' ? 'play' : 'paused')}${j.state === 'paused' ? 'Resume' : 'Pause'}</button>
        ${ctx.size === 'compact' ? '' : html`<button type="button" class="btn btn--secondary" data-jedit="${j.id}">${icon('draft')}Edit</button>`}
        <button type="button" class="btn btn--ghost btn--icon" data-jmenu="${j.id}" aria-haspopup="dialog" aria-label="More actions">${icon('dots-v')}</button>
      </div>
    </header>
    <div class="jd__grid">
      <section class="jd__def" aria-labelledby="jd-def">
        <h2 class="section__title" id="jd-def">Definition</h2>
        <div class="panel panel--pad stack">
          ${what}
          <dl class="kv">
            ${kv('schedule', html`${j.human} <span class="mono subtle">${j.schedule}</span>`)}
            ${kv('deliver', DELIVER[j.deliver] || j.deliver)}
            ${kv('failure_deliver', DELIVER[j.failure_deliver])}
            ${kv('monitor_script', j.monitor_script && html`<span class="mono">${j.monitor_script}</span>`)}
            ${kv('monitor_url', j.monitor_url && html`<span class="mono jd__url">${j.monitor_url}</span>`)}
            ${kv('context_from', ctxFrom && html`<a href="${ctx.href('/work/schedules/' + ctxFrom.id)}">${ctxFrom.name}</a>`)}
            ${kv('workdir', j.workdir && html`<span class="mono">${j.workdir}</span>`)}
            ${kv('job id', html`<span class="mono">${j.id}</span>`)}
          </dl>
        </div>
        <h2 class="section__title" id="jd-next">Next fire times</h2>
        <div class="panel panel--pad" aria-labelledby="jd-next">${j.state === 'paused' ? html`<p class="muted">Paused. Resume to schedule the next run.</p>`
          : fires.length ? html`<ol class="sb__fires">${fires.map((t, i) => html`<li><span class="sb__fi mono">${i + 1}</span><span>${fmtFire(t)}</span><span class="mono subtle">${fmtAgo(t)}</span></li>`)}</ol>`
          : html`<p class="muted">${j.next ? fmtFire(j.next) : '—'}</p>`}</div>
      </section>
      <section class="jd__runs" aria-labelledby="jd-runs">
        <div class="section__head"><h2 class="section__title" id="jd-runs">Run history <span class="mono subtle">${runs.length}</span></h2></div>
        ${runs.length ? html`<ul class="jruns" role="list">${runs.map((r, i) => html`<li><details class="tool jrun${r.status === 'failed' ? ' tool--failed' : ''}" ${(i === 0 && r.status !== 'succeeded') ? raw('open') : ''}>
          <summary>${icon('chev-r', 'chev')}${statusBadge(r.status === 'running' ? 'running' : r.status === 'failed' ? 'failed' : 'succeeded', { variant: 'plain' })}
            <span class="jrun__at">${fmtFire(r.at)}</span>
            <span class="jrun__meta mono">${r.status === 'running' ? html`<span data-elapsed="${r.at}">${fmtDur((Date.now() - r.at) / 1000)}</span>` : fmtDur(r.duration || 0)}${r.exit != null ? ` · exit ${r.exit}` : ''}${r.tokens ? ` · ${fmtTokens(r.tokens)} tok` : ''}${r.cost != null ? ` · ${fmtMoney(r.cost)}` : ''}</span>
          </summary>
          <div class="tool__body">
            <pre class="log" role="log" aria-label="Output of ${r.id}">${r.output}</pre>
            <div class="jrun__acts"><span class="mono subtle">${r.id}</span>${r.sessionId ? html`<a class="btn btn--ghost btn--sm" href="${ctx.href('/chat/' + r.sessionId)}">${icon('chat')}Open session</a>` : ''}<button type="button" class="btn btn--ghost btn--sm" data-copy="${r.id}">${icon('copy')}Copy output</button></div>
          </div>
        </details></li>`)}</ul>` : html`<div class="panel panel--pad muted">No runs yet.</div>`}
      </section>
    </div>
  </div>`;
}

export default {
  routes: ['/work/schedules', '/work/schedules/:jobId'],
  title: (ctx) => (ctx.params.jobId ? getJob(ctx.params.jobId)?.name || 'Schedule' : 'Schedules'),
  group: 'work',
  render(ctx) {
    return ctx.params.jobId ? renderJob(ctx, getJob(ctx.params.jobId)) : renderList(ctx);
  },
  mount(root, ctx) {
    if (!ctx.params.jobId && ctx.size === 'compact') ctx.setAppBar({ actions: [{ icon: 'plus', label: 'New schedule', onClick: () => openScheduleBuilder(ctx) }] });
    bindTabs(root, (k) => setQuery(ctx, { tab: k === 'jobs' ? null : k }, `tab-${k}`));
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const job = (id) => getJob(id);
      if (b.dataset.fchip) setQuery(ctx, { [b.dataset.fchip]: b.dataset.v || null }, `fc-${b.dataset.fchip}-${b.dataset.v}`);
      else if (b.hasAttribute('data-clearf')) setQuery(ctx, { type: null, state: null });
      else if (b.hasAttribute('data-new')) openScheduleBuilder(ctx);
      else if (b.dataset.jrun) runJobNow(ctx, job(b.dataset.jrun));
      else if (b.dataset.jpause) togglePause(ctx, job(b.dataset.jpause));
      else if (b.dataset.jedit) openScheduleBuilder(ctx, { job: job(b.dataset.jedit) });
      else if (b.dataset.jmenu) jobMenu(ctx, job(b.dataset.jmenu));
      else if (b.dataset.bp) {
        const bp = BLUEPRINTS.find((x) => x.id === b.dataset.bp);
        openScheduleBuilder(ctx, { preset: { name: bp.name, type: 'blueprint', blueprint: bp.id, schedule: bp.schedule, deliver: bp.deliver, profile: ctx.scope !== 'all' ? ctx.scope : 'default' } });
      } else if (b.dataset.copy) {
        const r = getJob(ctx.params.jobId)?.runs.find((x) => x.id === b.dataset.copy);
        navigator.clipboard?.writeText(r?.output || '').catch(() => {});
        ctx.toast('Output copied', { tone: 'info' });
      }
    });
    const tick = setInterval(() => root.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); }), 1000);
    return () => clearInterval(tick);
  },
  paletteActions(ctx) {
    const acts = [{ label: 'New schedule', icon: 'calendar', sub: 'Schedule builder', run: () => openScheduleBuilder(ctx) }];
    const j = ctx.params.jobId && getJob(ctx.params.jobId);
    if (j) acts.unshift({ label: `Run “${j.name}” now`, icon: 'play', run: () => runJobNow(ctx, j) });
    acts.push({ label: 'New task', icon: 'plus', run: () => ctx.navigate('/work/tasks/new') });
    return acts;
  },
};
