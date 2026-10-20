// Caduceus Dashboard prototype: shared helpers, icons, overlays, toasts, module
// registry and mock data. Throwaway code: no backend, no persistence beyond
// localStorage for device preferences. See README.md for the contract.

/* ==========================================================================
   1. HTML helpers
   ========================================================================== */
class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
/** Mark a string as trusted HTML (skips escaping inside html``). */
export const raw = (s) => new Safe(String(s ?? ''));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function val(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}
/** Tagged template: interpolations are escaped unless they are raw()/html``/icon() results; arrays are joined. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const h = html;

let uidN = 0;
export const uid = (p = 'hc') => `${p}-${++uidN}`;

/* ==========================================================================
   2. Formatting
   ========================================================================== */
export const NOW = Date.now();
const MIN = 60_000;
/** Timestamp `m` minutes before page load. */
export const ago = (m) => NOW - m * MIN;
/** Timestamp `m` minutes after page load. */
export const inMin = (m) => NOW + m * MIN;
/** Next local occurrence of hh:mm (optionally on weekday `dow`, 0 = Sunday) after page load. */
export function nextAt(hour, minute = 0, dow = null) {
  const d = new Date(NOW);
  d.setSeconds(0, 0);
  d.setHours(hour, minute);
  while (d.getTime() <= NOW || (dow != null && d.getDay() !== dow)) d.setDate(d.getDate() + 1);
  return d.getTime();
}
const nextHalfHour = () => { const d = new Date(NOW); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() < 30 ? 30 : 60); return d.getTime(); };

export function fmtAgo(ts, { suffix = false } = {}) {
  const d = Date.now() - ts;
  const future = d < 0;
  const m = Math.round(Math.abs(d) / MIN);
  let s;
  if (m < 1) return future ? 'now' : 'just now';
  else if (m < 60) s = `${m}m`;
  else if (m < 60 * 24) s = `${Math.round(m / 60)}h`;
  else if (m < 60 * 24 * 14) s = `${Math.round(m / 1440)}d`;
  else s = `${Math.round(m / 10080)}w`;
  if (future) return `in ${s}`;
  return suffix ? `${s} ago` : s;
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const hh = Math.floor(m / 60);
  return `${hh}h ${String(m % 60).padStart(2, '0')}m`;
}
export const fmtMoney = (n) => `$${n.toFixed(2)}`;
export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function fmtWhen(ts) {
  const d = new Date(ts), today = new Date(NOW);
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(NOW + 86_400_000).toDateString() === d.toDateString();
  const t = fmtTime(ts);
  if (sameDay) return `Today ${t}`;
  if (tomorrow) return `Tomorrow ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`;
}

/* ==========================================================================
   3. Icons (Tabler-style outline, 24px grid, stroke from --cd-icon-stroke)
   ========================================================================== */
const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M17 7L7 17M7 7l10 10"/>',
  succeeded: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/>',
  failed: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  running: '<path d="M12 3a9 9 0 1 1-9 9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  queued: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="2.6"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01" stroke-width="2.4"/>',
  cancelled: '<circle cx="12" cy="12" r="9"/><path d="M5.8 18.2L18.2 5.8"/>',
  paused: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  stale: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  offline: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3.1"/>',
  blocked: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  draft: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V20H14.5v-5.5h-5V20H4z"/>',
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  inbox: '<path d="M4 13.5L6.2 5h11.6l2.2 8.5V19H4z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
  work: '<rect x="4" y="4" width="4.5" height="16" rx="1"/><rect x="10" y="4" width="4.5" height="10" rx="1"/><rect x="16" y="4" width="4" height="13" rx="1"/>',
  agents: '<rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 4.5V8M9.5 13v.01M14.5 13v.01M9.5 16h5" stroke-width="2"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'chev-r': '<path d="M9.5 6l6 6-6 6"/>',
  'chev-l': '<path d="M14.5 6l-6 6 6 6"/>',
  'chev-d': '<path d="M6 9.5l6 6 6-6"/>',
  'chev-u': '<path d="M6 14.5l6-6 6 6"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  terminal: '<path d="M5 7l5 5-5 5M12.5 17.5H19"/>',
  file: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  send: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
  clip: '<path d="M15.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7.2-7.2a4 4 0 0 0-5.7-5.7l-7.3 7.3a6 6 0 0 0 8.5 8.5l6-6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01" stroke-width="2.2"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 17v.01" stroke-width="2.2"/>',
  'wifi-off': '<path d="M3.5 3.5l17 17M8.6 15.4a5 5 0 0 1 6.2-.4M5.2 12a9.6 9.6 0 0 1 4-2.2M12 19.5v.01M14.3 9.6A9.8 9.8 0 0 1 19 12" stroke-width="1.9"/>',
  grip: '<path d="M9 6v.01M15 6v.01M9 12v.01M15 12v.01M9 18v.01M15 18v.01" stroke-width="2.6"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 13h10l1-13M9.5 7V4h5v3"/>',
  'dots-v': '<path d="M12 5.5v.01M12 12v.01M12 18.5v.01" stroke-width="2.8"/>',
  git: '<circle cx="6.5" cy="6" r="2"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="9" r="2"/><path d="M6.5 8v8M17.5 11c0 3-4 3-9.5 6"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  log: '<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>',
  'arrow-up': '<path d="M7 14l5-5 5 5"/>',
  'arrow-r': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  cmd: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'sidebar-collapse': '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M15.5 10l-2 2 2 2"/>',
  'sidebar-expand': '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M13.5 10l2 2-2 2"/>',
  tasks: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17"/>',
  playbook: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h8M18 8v8M6 8v4a6 6 0 0 0 6 6h4"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M16 3v4M8 3v4M4 10h16"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  folder: '<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-3.5-5.5"/>',
  'user-plus': '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6"/>',
  stack: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  plug: '<path d="M9 3v4M15 3v4M7 7h10v3a5 5 0 0 1-10 0zM12 15v6"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01" stroke-width="2.4"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  webhook: '<path d="M9 8.5a3.5 3.5 0 1 1 5.5 2.9L17 16"/><path d="M15 17H8a3.5 3.5 0 1 1-1-6.8"/><path d="M11.5 8.5L9 13a3.5 3.5 0 1 0 6.5 3"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  package: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  heartbeat: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
  puzzle: '<path d="M5 8h3a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H5v-3a2 2 0 1 0 0-4z"/>',
  tool: '<path d="M7 10h3V7L6.5 3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1-3 3l-6-6a6 6 0 0 1-8-8L7 10"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" stroke-width="1.9"/>',
  telegram: '<path d="M20 4L3 11l6 2.5L11.5 20l3-5 5.5-11zM9 13.5L20 4"/>',
  discord: '<path d="M4 19l1.3-3.9A8 8 0 1 1 8.4 18z"/><path d="M9 12h.01M15 12h.01" stroke-width="2.4"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  steer: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.4-.9-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6v1.7M12 16.3V18"/>',
  pin: '<path d="M15 4.5l-4 4-4 1.5-1.5 1.5 7 7 1.5-1.5 1.5-4 4-4M9 15l-4.5 4.5M14.5 4l5.5 5.5"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1v-7.5z"/>',
  fingerprint: '<path d="M6.5 9a6 6 0 0 1 11 3.5V14M12 11.5v3a7 7 0 0 0 2 5M8.5 12.5v2a10 10 0 0 0 1.5 5.5M15.5 16.5a14 14 0 0 1 .4 3M5.2 15.5V13"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" stroke-width="2"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 17v.01"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  palette: '<path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-2a2 2 0 0 0-1.5 3.3A1.5 1.5 0 0 1 12 21z"/><path d="M7.5 11.5h.01M10 7.5h.01M15 7.5h.01" stroke-width="2.4"/>',
  type: '<path d="M4 7V5h10v2M9 5v14M7 19h4M14 13v-1h6v1M17 12v7M15.5 19h3"/>',
  rows: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5" fill="currentColor"/>',
  subagent: '<rect x="3.5" y="4" width="8" height="7" rx="1.5"/><rect x="12.5" y="13" width="8" height="7" rx="1.5"/><path d="M7.5 11v4.5h5"/>',
  wordmark: '<path d="M7 4v16M17 4v16M7 12h10"/>',
};
export const iconNames = Object.keys(P);
/** Inline SVG icon (decorative: aria-hidden). Name the control, not the icon. */
export function icon(name, cls = '') {
  return raw(`<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || P.info}</svg>`);
}

/* ==========================================================================
   4. Status ladder (design-system.md §4.2): glyph + label + tone, always
   ========================================================================== */
export const LADDER = {
  waiting: { tone: 'warning', glyph: 'waiting', label: 'Waiting for you', attn: true },
  running: { tone: 'running', glyph: 'running', label: 'Running', spin: true },
  queued: { tone: 'neutral', glyph: 'queued', label: 'Queued' },
  scheduled: { tone: 'neutral', glyph: 'queued', label: 'Scheduled' },
  paused: { tone: 'paused', glyph: 'paused', label: 'Paused' },
  blocked: { tone: 'blocked', glyph: 'blocked', label: 'Blocked' },
  failed: { tone: 'danger', glyph: 'failed', label: 'Failed' },
  stale: { tone: 'stale', glyph: 'stale', label: 'Stale' },
  succeeded: { tone: 'success', glyph: 'succeeded', label: 'Succeeded' },
  done: { tone: 'success', glyph: 'succeeded', label: 'Done' },
  cancelled: { tone: 'neutral', glyph: 'cancelled', label: 'Cancelled' },
  offline: { tone: 'neutral', glyph: 'offline', label: 'Offline' },
  draft: { tone: 'neutral', glyph: 'draft', label: 'Draft' },
  online: { tone: 'success', dot: true, label: 'Online' },
  degraded: { tone: 'warning', dot: true, label: 'Degraded' },
  reconnecting: { tone: 'warning', dot: true, label: 'Reconnecting' },
};
/**
 * statusBadge('running', { label?, detail?: '6m 12s', variant?: 'plain'|'solid'|'attn' })
 * `waiting` gets the attention treatment by default. Running is the only spinner.
 */
export function statusBadge(state, { label, detail, variant } = {}) {
  const s = LADDER[state] || LADDER.queued;
  const v = variant || (s.attn ? 'attn' : '');
  const glyph = s.dot
    ? `<span class="dot${state === 'offline' ? ' dot--dashed' : ''}" aria-hidden="true"></span>`
    : String(icon(s.glyph, s.spin ? 'spin' : ''));
  return raw(`<span class="status${v ? ' status--' + v : ''}" data-tone="${s.tone}" data-state="${state}">${glyph}<span>${esc(label || s.label)}</span>${detail ? `<span class="mono status__detail">${esc(detail)}</span>` : ''}</span>`);
}
/** Map a Hermes Kanban task onto the ladder: { state, label }. */
export function taskState(t) {
  switch (t.status) {
    case 'triage': return { state: 'draft', label: 'Draft' };
    case 'todo': return { state: 'queued', label: 'Queued' };
    case 'ready': return { state: 'queued', label: 'Ready' };
    case 'scheduled': return { state: 'scheduled', label: `Scheduled · ${fmtWhen(t.scheduledFor)}` };
    case 'running': return t.stale ? { state: 'stale', label: `Stale · ${fmtAgo(t.heartbeat)}` } : { state: 'running', label: 'Running' };
    case 'blocked':
      if (t.gave_up) return { state: 'failed', label: 'Failed · gave up' };
      if (t.block_kind === 'needs_input') return { state: 'waiting', label: 'Needs you' };
      return { state: 'blocked', label: `Blocked · ${t.block_kind}` };
    case 'review': return { state: 'waiting', label: 'Waiting for you' };
    case 'done': return { state: 'done', label: 'Done' };
    case 'archived': return { state: 'cancelled', label: 'Archived' };
    default: return { state: 'queued', label: t.status };
  }
}

/* ==========================================================================
   5. Small UI fragments shared by screens
   ========================================================================== */
/** Stable profile-name hash → avatar palette slot 1..8 (seed chosen so the six mock profiles differ). */
export function avatarIdx(name) {
  let a = (2166136261 ^ 9) >>> 0;
  for (const c of String(name)) a = Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0;
  a = (a ^ (a >>> 13)) >>> 0;
  a = Math.imul(a, 0x5bd1e995) >>> 0;
  a = (a ^ (a >>> 15)) >>> 0;
  return (a % 8) + 1;
}
export function avatar(name, { size = '' } = {}) {
  if (!name || name === 'all') return raw(`<span class="avatar avatar--all${size === 'sm' ? ' avatar--sm' : ''}" aria-hidden="true">${icon('users')}</span>`);
  return raw(`<span class="avatar${size === 'sm' ? ' avatar--sm' : ''}" data-av="${avatarIdx(name)}" aria-hidden="true">${esc(name[0].toUpperCase())}</span>`);
}
/** Non-interactive profile label: avatar + name (never colour alone). */
export function profileTag(name) {
  return html`<span class="ptag">${avatar(name, { size: 'sm' })}<span class="ptag__name">${name === 'all' ? 'All profiles' : name}</span></span>`;
}
export const SOURCES = {
  caduceus: { label: 'Caduceus', icon: 'browser' },
  cli: { label: 'CLI', icon: 'terminal' },
  telegram: { label: 'Telegram', icon: 'telegram' },
  discord: { label: 'Discord', icon: 'discord' },
  cron: { label: 'Cron', icon: 'clock' },
  kanban: { label: 'Kanban worker', icon: 'work' },
  'claude-code': { label: 'Claude Code', icon: 'code' },
};
export function sourceTag(src) {
  const s = SOURCES[src] || { label: src, icon: 'chat' };
  return html`<span class="srctag">${icon(s.icon, 'i-sm')}<span>${s.label}</span></span>`;
}
/** Page header: h1 (focus target on navigation) + subtitle + actions. */
export function pageHeader({ title, subtitle, actions = '', overline = '' }) {
  return html`<header class="page-header">
    <div class="page-header__text">
      ${overline ? html`<p class="overline">${overline}</p>` : ''}
      <h1 tabindex="-1">${title}</h1>
      ${subtitle ? html`<p class="page-header__sub">${subtitle}</p>` : ''}
    </div>
    ${actions ? html`<div class="page-header__actions">${actions}</div>` : ''}
  </header>`;
}
export function emptyState({ icon: ic = 'inbox', title, body, action = '' }) {
  return html`<div class="empty"><div class="empty__icon">${icon(ic)}</div><h3>${title}</h3><p>${body}</p>${action}</div>`;
}
export function kbd(...keys) {
  return raw(`<span class="kbds">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>`);
}
/** Simple fuzzy score (higher is better, -1 = no match). Substring beats subsequence. */
export function fuzzy(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = String(text).toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx * 2 - (t.length - q.length) * 0.1 + (idx === 0 || /\W/.test(t[idx - 1]) ? 50 : 0);
  let ti = 0, score = 0, prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const f = t.indexOf(ch, ti);
    if (f < 0) return -1;
    score += f === prev + 1 ? 10 : f === 0 || /\W/.test(t[f - 1]) ? 8 : 1;
    prev = f; ti = f + 1;
  }
  return score >= q.replace(/\s/g, '').length * 4 ? score : -1; // reject scattered matches
}

/* ==========================================================================
   6. Window size class (IA §2: compact < 600 ≤ medium < 1200 ≤ large)
   ========================================================================== */
export function sizeClass(w = window.innerWidth) {
  return w < 600 ? 'compact' : w < 1200 ? 'medium' : 'large';
}

/* ==========================================================================
   7. Overlays: sheets, dialogs, drawers, palette layers
   Every layer traps focus, makes the rest of the page `inert`, closes on
   Escape and browser back (one history entry per layer), returns focus to
   the invoker, and stacks (sheet over sheet).
   ========================================================================== */
const stack = [];
let expectedPops = 0;
let popWaiters = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

function overlayRoot() { return document.getElementById('overlays'); }
function syncInert() {
  const has = stack.length > 0;
  for (const id of ['app', 'proto', 'skip']) {
    const el = document.getElementById(id);
    if (el) el.inert = has;
  }
  stack.forEach((l, i) => { l.el.inert = i < stack.length - 1; });
  document.documentElement.classList.toggle('has-overlay', has);
}
function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
}
function trapTab(e, panel) {
  if (e.key !== 'Tab') return;
  const f = focusables(panel);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function flushPops() { const w = popWaiters; popWaiters = []; w.forEach((r) => r()); }

window.addEventListener('popstate', (e) => {
  if (expectedPops > 0) { expectedPops--; if (!expectedPops) flushPops(); return; }
  const target = e.state?.hcLayers || 0;
  while (stack.length > target) closeInternal(stack[stack.length - 1]);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack[stack.length - 1];
  if (top.escapable === false) return;
  e.preventDefault();
  e.stopPropagation();
  top.close();
}, true);

function closeInternal(layer, result) {
  if (layer.closed) return 0;
  const idx = stack.indexOf(layer);
  let pushed = 0;
  while (stack.length - 1 > idx) pushed += closeInternal(stack[stack.length - 1]);
  stack.splice(idx, 1);
  layer.closed = true;
  try { layer.cleanup?.(); } catch (err) { console.error(err); }
  layer.el.classList.add('is-closing');
  setTimeout(() => layer.el.remove(), 170);
  syncInert();
  try { layer.onClose?.(result); } catch (err) { console.error(err); }
  const inv = layer.invoker;
  if (inv && inv.isConnected && !stack.length) inv.focus({ preventScroll: true });
  else if (stack.length) stack[stack.length - 1].panel.focus({ preventScroll: true });
  return pushed + (layer.pushed ? 1 : 0);
}
function closeFromUI(layer, result) {
  const n = closeInternal(layer, result);
  if (n > 0) { expectedPops++; history.go(-n); }
}
/** Resolves once history entries consumed by closed overlays are popped (call before changing the hash). */
export function overlaysSettled() {
  return expectedPops === 0 ? Promise.resolve() : new Promise((r) => popWaiters.push(r));
}
/** Close every overlay. `fromHistory`: the URL already moved (hashchange); do not touch history. */
export function closeAllLayers({ fromHistory = false } = {}) {
  if (!stack.length) return overlaysSettled();
  if (fromHistory) { while (stack.length) closeInternal(stack[stack.length - 1]); return Promise.resolve(); }
  closeFromUI(stack[0]);
  return overlaysSettled();
}
export const layerCount = () => stack.length;

/**
 * Low-level layer. `content` must contain one element with [data-panel].
 * Elements with [data-close] close the layer; the scrim closes it when scrimDismiss.
 */
export function openLayer({ kind = 'dialog', content, labelledby, label, role = 'dialog', scrimDismiss = true, escapable = true, onMount, onClose, initialFocus, className = '' }) {
  const invoker = document.activeElement;
  const el = document.createElement('div');
  el.className = `layer layer--${kind}${className ? ' ' + className : ''}`;
  el.dataset.size = sizeClass();
  el.innerHTML = `<div class="layer__scrim" data-scrim></div>${content}`;
  overlayRoot().append(el);
  const panel = el.querySelector('[data-panel]');
  panel.setAttribute('role', role);
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  if (labelledby) panel.setAttribute('aria-labelledby', labelledby);
  else if (label) panel.setAttribute('aria-label', label);
  const layer = { el, panel, invoker, onClose, escapable, closed: false, pushed: false };
  layer.close = (result) => closeFromUI(layer, result);
  stack.push(layer);
  const push = () => {
    if (layer.closed) return;
    history.pushState({ ...(history.state || {}), hcLayers: stack.indexOf(layer) + 1 }, '');
    layer.pushed = true;
  };
  // A pending history.go() from a just-closed layer would swallow a new entry: wait for it.
  if (expectedPops > 0) overlaysSettled().then(push); else push();
  syncInert();
  el.addEventListener('click', (e) => {
    if (e.target.matches('[data-scrim]')) { if (scrimDismiss) layer.close(); return; }
    if (e.target.closest('[data-close]')) layer.close();
  });
  el.addEventListener('keydown', (e) => trapTab(e, panel));
  layer.cleanup = onMount?.(panel, layer);
  const target = (initialFocus && panel.querySelector(initialFocus)) || panel.querySelector('[data-body] ' + FOCUSABLE.split(',').join(',[data-body] ')) || panel.querySelector('[data-close]') || panel;
  requestAnimationFrame(() => target.focus({ preventScroll: true }));
  return layer;
}

function bindSheetDrag(panel, layer, detents) {
  const grab = panel.querySelector('.sheet__grab-zone');
  if (!grab) return;
  let y0 = null, dy = 0, moved = false;
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; moved = false; grab.setPointerCapture(e.pointerId); panel.classList.add('is-dragging'); });
  grab.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = e.clientY - y0;
    if (Math.abs(dy) > 4) moved = true;
    panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.classList.remove('is-dragging');
    panel.style.transform = '';
    if (dy > 90) { layer.close(); return; }
    if (dy < -40 && detents.includes('full')) panel.dataset.detent = 'full';
    else if (!moved && detents.length > 1) {
      const i = detents.indexOf(panel.dataset.detent);
      panel.dataset.detent = detents[(i + 1) % detents.length];
    }
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

/**
 * openSheet({ title, body, footer?, detents?: ['auto'|'half'|'full', …], onClose?, onMount?(panel, layer), wide?, initialFocus? })
 * Bottom sheet on compact; centred dialog on medium/large. Returns the layer ({ el, panel, close }).
 */
export function openSheet({ title, body = '', footer = '', detents = ['auto'], onClose, onMount, wide = false, initialFocus, className = '' }) {
  const id = uid('sheet');
  const compact = sizeClass() === 'compact';
  const head = `<header class="overlay__head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Close">${icon('x')}</button></header>`;
  const inner = `${head}<div class="overlay__body" data-body>${body}</div>${footer ? `<footer class="overlay__foot">${footer}</footer>` : ''}`;
  const content = compact
    ? `<section class="sheet ${className}" data-panel data-detent="${detents[0]}"><div class="sheet__grab-zone" aria-hidden="true"><span class="sheet__grab"></span></div>${inner}</section>`
    : `<section class="dialog${wide ? ' dialog--wide' : ''} ${className}" data-panel>${inner}</section>`;
  return openLayer({
    kind: compact ? 'sheet' : 'dialog', content, labelledby: id, onClose, initialFocus,
    onMount: (panel, layer) => {
      if (compact) bindSheetDrag(panel, layer, detents);
      return onMount?.(panel, layer);
    },
  });
}
export function closeSheet() {
  const top = stack[stack.length - 1];
  if (top) top.close();
}
/** Side drawer from the inline-start edge (medium nav) or inline-end (inspectors). */
export function openDrawer({ label, body, side = 'start', onMount, onClose, title, initialFocus }) {
  const id = uid('drawer');
  const head = title ? `<header class="overlay__head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Close">${icon('x')}</button></header>` : '';
  return openLayer({
    kind: 'drawer', className: `layer--drawer-${side}`,
    content: `<section class="drawer drawer--${side}" data-panel>${head}<div class="overlay__body drawer__body" data-body>${body}</div></section>`,
    labelledby: title ? id : undefined, label: title ? undefined : label, onMount, onClose, initialFocus,
  });
}

/**
 * Tiered confirmation (mobile-and-interaction.md §5, architecture §5).
 * openDialog({ tier: 1|2|3, title, body, object?, profile?, confirmLabel, danger?, recoverability?, onConfirm? })
 *   T1 names the object and the profile chip. T2 adds a mock passkey step-up.
 *   T3 adds type-the-name + a recoverability statement. Scrim taps do nothing on T2/T3.
 * Returns Promise<boolean> (true = confirmed).
 */
export function openDialog({ tier = 1, title, body = '', object, profile, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, recoverability, onConfirm }) {
  return new Promise((resolve) => {
    const id = uid('dlg');
    const compact = sizeClass() === 'compact';
    const tierLabel = tier === 1 ? 'Tier 1 · confirm' : tier === 2 ? 'Tier 2 · passkey step-up' : 'Tier 3 · step-up + type to confirm';
    const inputId = uid('t3');
    const bodyHtml = html`
      <p class="overline confirm__tier">${tierLabel}</p>
      ${body ? html`<p class="confirm__text">${raw(body)}</p>` : ''}
      ${profile ? html`<div class="confirm__scope"><span class="subtle">Profile</span>${profileTag(profile)}</div>` : ''}
      ${tier >= 3 && recoverability ? html`<div class="banner" data-tone="danger">${icon('alert')}<div><div class="banner__title">${recoverability}</div></div><span></span></div>` : ''}
      ${tier >= 3 ? html`<div class="field"><label class="field__label" for="${inputId}">Type <span class="mono">${object}</span> to confirm</label><input id="${inputId}" class="input input--mono" autocomplete="off" spellcheck="false" data-t3></div>` : ''}
      ${tier >= 2 ? html`<div class="stepup" data-stepup>${icon('fingerprint')}<div class="stepup__text"><strong data-stepup-title>Passkey required</strong><small data-stepup-sub>Confirming asks this device's passkey (mocked in the prototype).</small></div></div>` : ''}`;
    const confirmText = tier >= 2 ? `${confirmLabel}` : confirmLabel;
    const foot = `<button type="button" class="btn btn--secondary" data-cancel>${esc(cancelLabel)}</button><button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm${tier >= 3 ? ' disabled' : ''}>${tier >= 2 ? icon('fingerprint') : ''}<span>${esc(confirmText)}</span></button>`;
    const inner = `<header class="overlay__head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Cancel">${icon('x')}</button></header><div class="overlay__body" data-body>${bodyHtml}</div><footer class="overlay__foot">${foot}</footer>`;
    let confirmed = false;
    openLayer({
      kind: compact ? 'sheet' : 'dialog',
      role: 'alertdialog',
      content: compact ? `<section class="sheet confirm" data-panel data-detent="auto"><div class="sheet__grab-zone" aria-hidden="true"><span class="sheet__grab"></span></div>${inner}</section>` : `<section class="dialog confirm" data-panel>${inner}</section>`,
      labelledby: id,
      scrimDismiss: tier === 1,
      initialFocus: tier >= 3 ? '[data-t3]' : '[data-cancel]',
      onClose: () => resolve(confirmed),
      onMount: (panel, layer) => {
        const btn = panel.querySelector('[data-confirm]');
        panel.querySelector('[data-cancel]').addEventListener('click', () => layer.close());
        const t3 = panel.querySelector('[data-t3]');
        t3?.addEventListener('input', () => { btn.disabled = t3.value.trim() !== object; });
        t3?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
        btn.addEventListener('click', async () => {
          if (btn.getAttribute('aria-busy') === 'true') return;
          btn.setAttribute('aria-busy', 'true');
          btn.querySelector('svg')?.remove();
          btn.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>');
          panel.querySelector('[data-cancel]').disabled = true;
          if (tier >= 2) {
            const su = panel.querySelector('[data-stepup]');
            su.dataset.state = 'waiting';
            su.querySelector('[data-stepup-title]').textContent = 'Waiting for passkey…';
            su.querySelector('[data-stepup-sub]').textContent = 'Touch your security key or use Face ID / Touch ID.';
            await new Promise((r) => setTimeout(r, 1100));
            su.dataset.state = 'ok';
            su.querySelector('svg').outerHTML = String(icon('succeeded'));
            su.querySelector('[data-stepup-title]').textContent = 'Verified';
            su.querySelector('[data-stepup-sub]').textContent = 'Step-up valid for 5 minutes on this device.';
            await new Promise((r) => setTimeout(r, 450));
          } else {
            await new Promise((r) => setTimeout(r, 250));
          }
          try { await onConfirm?.(); } catch (err) { console.error(err); }
          confirmed = true;
          layer.close(true);
        });
      },
    });
  });
}

/* ==========================================================================
   8. Toasts (one polite live region above the tab bar / composer)
   ========================================================================== */
const TOAST_GLYPH = { success: 'succeeded', danger: 'failed', info: 'info', warning: 'alert', accent: 'refresh', neutral: 'info' };
/** toast('Archived', { tone?, detail?, undo?: fn, action?: { label, onClick }, timeout? }) */
export function toast(msg, { tone = 'success', detail, undo, action, timeout } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const t = undo ? 'accent' : tone;
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = t;
  if (tone === 'danger') el.setAttribute('role', 'alert');
  el.innerHTML = `${icon(TOAST_GLYPH[t] || 'info')}<div class="toast__text"><span>${esc(msg)}</span>${detail ? `<small class="mono">${esc(detail)}</small>` : ''}</div><div class="toast__actions">${undo ? '<button type="button" class="btn btn--sm btn--ghost" data-undo>Undo</button>' : ''}${action ? `<button type="button" class="btn btn--sm btn--ghost" data-act>${esc(action.label)}</button>` : ''}<button type="button" class="btn btn--ghost btn--icon btn--sm" data-x aria-label="Dismiss notification">${icon('x', 'i-sm')}</button></div>`;
  region.append(el);
  while (region.children.length > 3) region.firstElementChild.remove();
  const ms = timeout ?? (tone === 'danger' ? 0 : undo ? 6000 : 5000);
  let timer = null;
  const dismiss = () => { clearTimeout(timer); el.classList.add('is-closing'); setTimeout(() => el.remove(), 170); };
  const arm = () => { if (ms) timer = setTimeout(dismiss, ms); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', arm);
  el.querySelector('[data-x]').addEventListener('click', dismiss);
  el.querySelector('[data-undo]')?.addEventListener('click', () => { dismiss(); undo(); });
  el.querySelector('[data-act]')?.addEventListener('click', () => { dismiss(); action.onClick?.(); });
  arm();
  return { dismiss };
}

/* ==========================================================================
   9. Module registry (IA §1) — nav, palette, More list and module.js read it
   ========================================================================== */
export const navGroups = [
  { id: 'top', title: null },
  { id: 'work', title: 'Work', icon: 'work' },
  { id: 'agents', title: 'Agents', icon: 'agents' },
  { id: 'connect', title: 'Connect', icon: 'broadcast' },
  { id: 'workspace', title: 'Workspace', icon: 'folder' },
  { id: 'observe', title: 'Observe', icon: 'chart' },
  { id: 'system', title: 'System', icon: 'shield' },
  { id: 'settings', title: null },
];
// key = `g` + letter shortcut. crossProfile: shows "All profiles" scope (IA §6).
// profileScoped: the page header shows the scoped profile.
export const modules = [
  { id: 'home', title: 'Home', group: 'top', icon: 'home', path: '/home', key: 'h', crossProfile: true,
    summary: 'What needs you, what is running, health and spend',
    contents: ['Waiting-for-you summary', 'Running now: live chats, kanban runs, cron jobs due', 'Health strip: gateway, scheduler, dispatcher, providers, resources', 'Spend versus budget', 'Recent sessions', 'Quick launch: new chat, new task, run a playbook'] },
  { id: 'chat', title: 'Chat', group: 'top', icon: 'chat', path: '/chat', key: 'c', crossProfile: true,
    summary: 'Sessions, transcript, composer and context panel',
    contents: ['Sessions pane: source filter, projects, pins, archive, FTS search, cross-profile toggle', 'Transcript: tool, reasoning and subagent cards; activity modes Worklog / Stream / Final only', 'Composer: profile, model, reasoning, workspace, context ring, attach, voice, saved prompts, toolsets', 'Busy modes Queue / Interrupt / Steer', 'Approval and clarify cards inline above the composer', 'Context panel: Files · Artifacts · Todo · Run · Preview', 'Terminal mode (desktop only)'] },
  { id: 'inbox', title: 'Inbox', group: 'top', icon: 'inbox', path: '/inbox', key: 'i', crossProfile: true,
    summary: 'Approvals, questions, reviews, failures and alerts',
    contents: ['Approvals', 'Clarify questions', 'Review gates', '`needs_input` blocks', 'Failures', 'Pairing requests', 'System and budget alerts', 'Activity feed'] },
  { id: 'board', title: 'Board', group: 'work', icon: 'work', path: '/work/board', key: 'w', crossProfile: true,
    summary: 'Kanban boards, lanes, dispatcher controls',
    contents: ['Kanban boards', 'Lanes by status or profile', 'Filters', 'Dispatcher controls', 'Orchestration settings'] },
  { id: 'tasks', title: 'Tasks', group: 'work', icon: 'tasks', path: '/work/tasks', key: 't', crossProfile: true,
    summary: 'Saved-filter task list and task detail',
    contents: ['Saved-filter list of tasks (mine, waiting, failed, by playbook, by project)', 'Task detail: Brief · Runs · Activity · Links · Attachments · Settings', 'Run view with worker log and session transcript'] },
  { id: 'playbooks', title: 'Playbooks', group: 'work', icon: 'playbook', path: '/work/playbooks', key: 'p',
    summary: 'Library, stage lists, run form, runs',
    contents: ['Library', 'Graph (≥ 1024 px) or stage-list view', 'Run form generated from the inputs schema', 'Runs grouped by playbook'] },
  { id: 'schedules', title: 'Schedules', group: 'work', icon: 'calendar', path: '/work/schedules', key: 's', crossProfile: true,
    summary: 'Hermes cron: 4 job types, run history, blueprints',
    contents: ['Hermes cron jobs: agent prompt, script, create task / run playbook, blueprint instance', 'Run history and output', 'Blueprints gallery', 'Schedule builder with next three fire times'] },
  { id: 'projects', title: 'Projects', group: 'work', icon: 'briefcase', path: '/work/projects', key: 'j', crossProfile: true,
    summary: 'projects.db, Project OS overview, linked boards',
    contents: ['`projects.db` projects', 'Repo and docs overview ("Project OS")', 'Boards linked to each project'] },
  { id: 'profiles', title: 'Profiles', group: 'agents', icon: 'users', path: '/agents/profiles', key: 'a',
    summary: 'Profile cards, builder, per-profile tabs',
    contents: ['Profile cards', 'Profile Builder wizard', 'Tabs: Overview · Identity (SOUL.md) · Instructions · Memory · Skills · Tools & MCP · Model · Gateway & channels · Files · Danger zone', 'Make default (writes Hermes active_profile)'] },
  { id: 'skills', title: 'Skills', group: 'agents', icon: 'stack', path: '/agents/skills', key: 'k', profileScoped: true,
    summary: 'Installed skills, Hub, Learn-a-skill, curator',
    contents: ['Installed: toggle, edit, delete, usage stats', 'Hub: 9 sources, security scan, install, update all', 'Learn-a-skill', 'Curator'] },
  { id: 'memory', title: 'Memory', group: 'agents', icon: 'database', path: '/agents/memory', key: 'm', profileScoped: true,
    summary: 'MEMORY.md / USER.md, providers, Hindsight',
    contents: ['MEMORY.md / USER.md editors', 'Memory provider and context engine settings', 'Hindsight browser', 'External notes', 'LLM Wiki', 'Learning graph'] },
  { id: 'models', title: 'Models', group: 'agents', icon: 'cpu', path: '/agents/models', key: 'o', profileScoped: true,
    summary: 'Main model, auxiliary slots, MoA, fallbacks',
    contents: ['Main model', 'Every `auxiliary.*` slot (15)', 'Mixture-of-Agents presets', 'Fallback chain', 'Live catalogue', 'Per-model usage cards with "Use as…"'] },
  { id: 'tools', title: 'Tools & MCP', group: 'agents', icon: 'plug', path: '/agents/tools', key: 'u', profileScoped: true,
    summary: 'Toolsets, MCP servers, catalogue, hooks',
    contents: ['Toolsets: provider, keys, setup', 'MCP servers: add, edit, OAuth, test, toggle, tool inventory', 'MCP catalogue', 'Shell hooks', 'Tool gateway routing'] },
  { id: 'gateway', title: 'Gateway', group: 'connect', icon: 'server', path: '/connect/gateway', key: 'y',
    summary: 'Start, stop, restart; per-profile status',
    contents: ['Start / stop / restart', 'Per-profile status', 'Multiplex migration', 'Health'] },
  { id: 'channels', title: 'Channels', group: 'connect', icon: 'broadcast', path: '/connect/channels',
    summary: '23+ platforms, QR onboarding, allowed users',
    contents: ['23+ platforms: configure, test', 'QR onboarding (Telegram, WhatsApp)', 'Allowed users'] },
  { id: 'pairing', title: 'Pairing', group: 'connect', icon: 'user-plus', path: '/connect/pairing',
    summary: 'Pending and approved DM users',
    contents: ['Pending DM users', 'Approved DM users'] },
  { id: 'webhooks', title: 'Webhooks', group: 'connect', icon: 'webhook', path: '/connect/webhooks',
    summary: 'Receiver, subscriptions, one-time secrets',
    contents: ['Receiver', 'Subscriptions', 'One-time secrets'] },
  { id: 'files', title: 'Files', group: 'workspace', icon: 'folder', path: '/workspace/files', key: 'f',
    summary: 'Tree, preview and editor, upload',
    contents: ['Tree', 'Preview and editor: code, markdown, office, PDF, media', 'Upload, move, rename'] },
  { id: 'git', title: 'Git', group: 'workspace', icon: 'git', path: '/workspace/git', key: 'v',
    summary: 'Status, diff, commit, branches, worktrees',
    contents: ['Status, diff, stage', 'AI commit message, commit', 'Pull / push', 'Branches, worktrees'] },
  { id: 'checkpoints', title: 'Checkpoints', group: 'workspace', icon: 'history', path: '/workspace/checkpoints',
    summary: 'Shadow-git checkpoints: diff, restore, prune',
    contents: ['Shadow-git checkpoints', 'Diff', 'Restore', 'Prune'] },
  { id: 'terminal', title: 'Terminal', group: 'workspace', icon: 'terminal', path: '/workspace/terminal',
    summary: 'Real PTY shell, optional TUI mode',
    contents: ['Real PTY shell', 'Optional TUI mode for chat'] },
  { id: 'artifacts', title: 'Artifacts', group: 'workspace', icon: 'package', path: '/workspace/artifacts',
    summary: 'Reports and deliverables from runs',
    contents: ['Files produced by sessions, runs and playbooks (reports, deliverables)'] },
  { id: 'insights', title: 'Insights', group: 'observe', icon: 'chart', path: '/observe/insights', key: 'n', crossProfile: true,
    summary: 'Tokens, cost, cache, quotas, budgets',
    contents: ['Token, cost and cache analytics per model, source and playbook', 'Activity heatmap', 'Provider quota', 'Budgets'] },
  { id: 'logs', title: 'Logs', group: 'observe', icon: 'log', path: '/observe/logs', key: 'l',
    summary: 'Streaming tail, search, filters, download',
    contents: ['Streaming tail', 'Server-side search', 'Filters', 'Download'] },
  { id: 'health', title: 'Health', group: 'observe', icon: 'heartbeat', path: '/observe/health', key: 'e',
    summary: 'Subsystems, host stats, diagnostics',
    contents: ['Subsystems, each with an actionable reason', 'Host stats', 'Resource pressure', 'Diagnostics'] },
  { id: 'config', title: 'Config', group: 'system', icon: 'sliders', path: '/system/config', key: 'x', profileScoped: true,
    summary: 'Schema-driven form, raw YAML',
    contents: ['Schema-driven form with search', 'Raw YAML with validation', 'Import / export / reset'] },
  { id: 'keys', title: 'Keys & Auth', group: 'system', icon: 'key', path: '/system/keys', key: 'q', profileScoped: true,
    summary: 'Provider keys, OAuth, credential pool',
    contents: ['Provider keys (audited reveal)', 'OAuth logins', 'Credential pool', 'Custom endpoints'] },
  { id: 'plugins', title: 'Plugins', group: 'system', icon: 'puzzle', path: '/system/plugins',
    summary: 'Install, update, enable; catalogue',
    contents: ['Hermes plugin install / update / enable', 'Curated catalogue'] },
  { id: 'maintenance', title: 'Maintenance', group: 'system', icon: 'tool', path: '/system/maintenance',
    summary: 'Update, backup, doctor, support dump',
    contents: ['Update Hermes (and Caduceus)', 'Backup / restore', 'Doctor', 'Security audit', 'Debug share, support dump', '`hermes>` console'] },
  { id: 'security', title: 'Security', group: 'system', icon: 'shield', path: '/system/security',
    summary: 'Auth, devices, push subscriptions, read-only',
    contents: ['Dashboard auth: password, passkeys, OIDC', 'Signed-in devices and sessions with revoke', 'Web Push subscriptions', 'Read-only mode'] },
  { id: 'settings', title: 'Settings', group: 'settings', icon: 'settings', path: '/settings', key: ',',
    summary: 'Appearance, notifications, keyboard, accessibility',
    contents: ['Appearance: theme, skin, density, font size', 'Notifications', 'Composer chips', 'Nav order', 'Language', 'Keyboard', 'Accessibility'] },
];
export const moduleById = Object.fromEntries(modules.map((m) => [m.id, m]));

/* ==========================================================================
   10. Mock data — one consistent fictional Hermes install
   ========================================================================== */
const profiles = [
  { name: 'default', model: 'deepseek-v4.1-flash', provider: 'deepseek', isDefault: true, gateway: 'running', description: 'Everyday assistant. Morning briefing, quick questions, Telegram DMs.', channels: ['telegram', 'discord'], sessions: 212, skills: 14, successRate: 0.96, runs7d: 41 },
  { name: 'coder', model: 'glm-5.3', provider: 'z.ai', isDefault: false, gateway: 'running', description: 'Software work on caduceus-dashboard and home-lab repos. Worktrees, PRs, CI.', channels: ['discord'], sessions: 388, skills: 22, successRate: 0.91, runs7d: 77 },
  { name: 'librarian', model: 'deepseek-v4.1', provider: 'deepseek', isDefault: false, gateway: 'running', description: 'Research briefs, citations and the reading list.', channels: [], sessions: 96, skills: 9, successRate: 0.94, runs7d: 18 },
  { name: 'property', model: 'glm-5.3-flash', provider: 'z.ai', isDefault: false, gateway: 'running', description: 'Rental portfolio: tenants, leases, council documents, rent ledger.', channels: ['telegram'], sessions: 74, skills: 7, successRate: 0.82, runs7d: 12 },
  { name: 'general', model: 'deepseek-v4.1-flash', provider: 'deepseek', isDefault: false, gateway: 'stopped', description: 'Household admin, shopping and meal plans.', channels: ['telegram'], sessions: 51, skills: 6, successRate: 0.97, runs7d: 6 },
  { name: 'homeassistant', model: 'glm-5.3-flash', provider: 'z.ai', isDefault: false, gateway: 'stopped', description: 'Home Assistant control, energy reports, the homelab Discord.', channels: ['discord'], sessions: 63, skills: 5, successRate: 0.93, runs7d: 9 },
].map((p) => ({ ...p, av: avatarIdx(p.name) }));

const projects = [
  { id: 'caduceus-dashboard', name: 'caduceus-dashboard', repo: '~/code/caduceus-dashboard', profile: 'coder', boards: ['caduceus'], openTasks: 9 },
  { id: 'home-lab', name: 'home-lab', repo: '~/code/home-lab', profile: 'homeassistant', boards: ['home'], openTasks: 1 },
  { id: 'property-portfolio', name: 'Property portfolio', repo: '~/Documents/property', profile: 'property', boards: ['main'], openTasks: 3 },
  { id: 'reading-list', name: 'Reading list', repo: '~/notes/reading', profile: 'librarian', boards: ['main'], openTasks: 1 },
];

const sessions = [
  { id: 's_8f2c1a', title: 'Webhook retry backoff (feat/x)', preview: 'Ready to push: git push origin feat/x — waiting for approval', source: 'caduceus', profile: 'coder', model: 'glm-5.3', live: true, liveState: 'waiting', pinned: true, project: 'caduceus-dashboard', updated: ago(2), started: ago(26), messages: 14, tokens: 182_400, cost: 0.61, context: 0.38 },
  { id: 's_3b91d0', title: 'RAG evaluation survey: related work', preview: 'Which citation style should the brief use?', source: 'caduceus', profile: 'librarian', model: 'deepseek-v4.1', live: true, liveState: 'waiting', pinned: false, project: 'reading-list', updated: ago(5), started: ago(41), messages: 9, tokens: 96_100, cost: 0.22, context: 0.21 },
  { id: 's_c47e22', title: 'Summarise council planning docs for 14 Elm St', preview: 'Reading application DA-2026/0412 (3 of 7 PDFs)…', source: 'telegram', profile: 'property', model: 'glm-5.3-flash', live: true, liveState: 'running', pinned: false, project: 'property-portfolio', updated: ago(0.5), started: ago(4), messages: 3, tokens: 41_800, cost: 0.05, context: 0.12 },
  { id: 's_kw_1049', title: 'kanban · t_1049 Add rate-limit headers to /api/sessions', preview: 'Running tests: pnpm vitest run src/api', source: 'kanban', profile: 'coder', model: 'glm-5.3-flash', live: true, liveState: 'running', pinned: false, project: 'caduceus-dashboard', updated: ago(0.3), started: ago(6), messages: 11, tokens: 64_300, cost: 0.09, context: 0.29, taskId: 't_1049' },
  { id: 's_kw_1051', title: 'kanban · t_1051 Search & read: passkey step-up UX', preview: 'Read 9 of ~15 sources; drafting notes', source: 'kanban', profile: 'librarian', model: 'deepseek-v4.1', live: true, liveState: 'running', pinned: false, project: 'reading-list', updated: ago(1), started: ago(18), messages: 22, tokens: 128_900, cost: 0.31, context: 0.44, taskId: 't_1051' },
  { id: 's_cc_77a1', title: 'Refactor gateway client resume logic', preview: 'Opened PR #212: coalesce reconnects on visibilitychange', source: 'claude-code', profile: 'coder', model: 'glm-5.3', live: false, pinned: true, project: 'caduceus-dashboard', updated: ago(95), started: ago(180), messages: 37, tokens: 512_000, cost: 1.84 },
  { id: 's_cli_51e0', title: 'Debug zsh completion for hermes CLI', preview: 'Fixed: compinit ran before fpath was extended', source: 'cli', profile: 'default', model: 'deepseek-v4.1-flash', live: false, pinned: false, project: null, updated: ago(160), started: ago(175), messages: 8, tokens: 22_000, cost: 0.02 },
  { id: 's_tg_9d03', title: 'Grocery list + meal plan for the week', preview: 'Added: oats, miso, 2× tofu. Plan sent to Telegram.', source: 'telegram', profile: 'general', model: 'deepseek-v4.1-flash', live: false, pinned: false, project: null, updated: ago(300), started: ago(320), messages: 12, tokens: 15_400, cost: 0.01 },
  { id: 's_dc_2f6b', title: '#homelab · NAS fan noise after update', preview: 'Fan curve reset by firmware 7.2.1; restored profile "quiet".', source: 'discord', profile: 'homeassistant', model: 'glm-5.3-flash', live: false, pinned: false, project: 'home-lab', updated: ago(420), started: ago(470), messages: 15, tokens: 33_100, cost: 0.03 },
  { id: 's_cron_brief', title: 'Morning briefing · Tue 6 Oct', preview: '3 meetings, rain after 15:00, 2 packages arriving.', source: 'cron', profile: 'default', model: 'deepseek-v4.1-flash', live: false, pinned: false, project: null, updated: ago(690), started: ago(692), messages: 2, tokens: 9_800, cost: 0.01, jobId: 'c_morning' },
  { id: 's_cron_energy', title: 'Energy report · week 40', preview: 'Usage down 12% week on week; heat pump is 41% of load.', source: 'cron', profile: 'homeassistant', model: 'glm-5.3-flash', live: false, pinned: false, project: 'home-lab', updated: ago(1860), started: ago(1862), messages: 2, tokens: 12_200, cost: 0.01, jobId: 'c_energy' },
  { id: 's_kw_1044', title: 'kanban · t_1044 Research brief: local vector DBs', preview: 'Report attached: vector-dbs-2026.md (11 sources).', source: 'kanban', profile: 'librarian', model: 'deepseek-v4.1', live: false, pinned: false, project: 'reading-list', updated: ago(1440), started: ago(1520), messages: 31, tokens: 244_000, cost: 0.58, taskId: 't_1044' },
  { id: 's_con_a8', title: 'Lease renewal letter for Unit 2A', preview: 'Draft v2 with CPI-linked increase (3.1%).', source: 'caduceus', profile: 'property', model: 'glm-5.3-flash', live: false, pinned: true, project: 'property-portfolio', updated: ago(2900), started: ago(2950), messages: 10, tokens: 28_700, cost: 0.03 },
  { id: 's_con_b2', title: 'Explain the MCP OAuth device flow', preview: 'The device code is shown once; polling interval is 5 s…', source: 'caduceus', profile: 'general', model: 'deepseek-v4.1-flash', live: false, pinned: false, project: null, updated: ago(4300), started: ago(4320), messages: 6, tokens: 11_900, cost: 0.01 },
  { id: 's_cli_c9', title: 'Profile builder: draft SOUL for homeassistant', preview: 'Saved SOUL.md (412 words).', source: 'cli', profile: 'default', model: 'deepseek-v4.1-flash', live: false, pinned: false, archived: true, project: null, updated: ago(8700), started: ago(8760), messages: 18, tokens: 40_500, cost: 0.04 },
];

// Rich transcript for s_8f2c1a. Block types: user · reasoning · tool · subagent · assistant · approval.
const transcripts = {
  s_8f2c1a: [
    { type: 'user', at: ago(26), text: 'Add exponential backoff with jitter to the webhook dispatcher. Max 5 attempts, cap 60 s. Keep the existing tests green and push to feat/x when done.' },
    { type: 'reasoning', at: ago(25.8), seconds: 12, text: 'The dispatcher retries immediately in a tight loop (dispatch.ts:88). Plan: add a `backoff(attempt)` helper with full jitter, thread the attempt count through `deliver()`, and read the cap from `webhooks.retry_cap_s`. dispatch.test.ts uses fake timers, so the new delays must be advanced explicitly.' },
    { type: 'tool', at: ago(25.5), name: 'read_file', args: 'src/webhooks/dispatch.ts', status: 'succeeded', duration: 0.1, output: '84  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {\n85    const res = await deliver(hook, payload);\n86    if (res.ok) return res;\n87    log.warn({ hook: hook.id, attempt }, "webhook delivery failed");\n88  }\n89  throw new DeliveryError(hook.id, MAX_ATTEMPTS);' },
    { type: 'tool', at: ago(25.2), name: 'search_files', args: '"retry" src/webhooks', status: 'succeeded', duration: 0.3, output: 'src/webhooks/dispatch.ts:12   const MAX_ATTEMPTS = 5;\nsrc/webhooks/dispatch.test.ts:41   it("retries with backoff", async () => {\nsrc/config/schema.ts:233   retry_cap_s: z.number().default(60),' },
    { type: 'tool', at: ago(24), name: 'patch', args: 'src/webhooks/dispatch.ts', status: 'succeeded', duration: 0.2, diff: { file: 'src/webhooks/dispatch.ts', add: 6, remove: 2, lines: [
      { t: 'ctx', ln: 84, text: '  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {' },
      { t: 'ctx', ln: 85, text: '    const res = await deliver(hook, payload);' },
      { t: 'ctx', ln: 86, text: '    if (res.ok) return res;' },
      { t: 'rem', ln: 87, text: '    log.warn({ hook: hook.id, attempt }, "webhook delivery failed");' },
      { t: 'add', ln: 87, text: '    const wait = backoff(attempt, cfg.webhooks.retry_cap_s);' },
      { t: 'add', ln: 88, text: '    log.warn({ hook: hook.id, attempt, wait }, "webhook delivery failed; retrying");' },
      { t: 'add', ln: 89, text: '    if (attempt < MAX_ATTEMPTS) await sleep(wait);' },
      { t: 'ctx', ln: 90, text: '  }' },
      { t: 'rem', ln: 89, text: '  throw new DeliveryError(hook.id, MAX_ATTEMPTS);' },
      { t: 'add', ln: 91, text: '  throw new DeliveryError(hook.id, MAX_ATTEMPTS, { lastWait: wait });' },
      { t: 'add', ln: 92, text: '' },
      { t: 'add', ln: 93, text: 'export { backoff } from "./backoff";' },
    ] } },
    { type: 'tool', at: ago(22), name: 'terminal', args: 'pnpm vitest run src/webhooks', status: 'failed', duration: 3.4, reason: 'exit 1 · 1 failed', output: ' ✓ src/webhooks/sign.test.ts (6)\n ❯ src/webhooks/dispatch.test.ts (9)\n   ✓ delivers on first attempt\n   ✓ gives up after max attempts\n   × retries with backoff\n     → expected "deliver" to be called 2 times, but got 1 times\n       at src/webhooks/dispatch.test.ts:57:31\n\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 14 passed (15)' },
    { type: 'reasoning', at: ago(21.8), seconds: 4, text: 'The test advances fake timers by 1000 ms, but the first jittered delay can be up to 2000 ms. Make `random` injectable and seed it in the test instead of widening the timer advance.' },
    { type: 'subagent', at: ago(21.5), id: 'sa_31', title: 'Make dispatch backoff test deterministic', profile: 'coder', model: 'glm-5.3-flash', status: 'succeeded', duration: 48, tools: 4, tokens: 18_200, summary: 'Injected `random` into `backoff()` (default `Math.random`) and seeded it with `() => 0.5` in dispatch.test.ts. 15/15 webhook tests pass.' },
    { type: 'tool', at: ago(20.6), name: 'terminal', args: 'pnpm vitest run src/webhooks', status: 'succeeded', duration: 2.1, output: ' ✓ src/webhooks/sign.test.ts (6)\n ✓ src/webhooks/dispatch.test.ts (9)\n\n Test Files  2 passed (2)\n      Tests  15 passed (15)' },
    { type: 'tool', at: ago(20), name: 'terminal', args: 'git commit -am "feat(webhooks): exponential backoff with jitter"', status: 'succeeded', duration: 0.4, output: '[feat/x 3e9a1c7] feat(webhooks): exponential backoff with jitter\n 3 files changed, 38 insertions(+), 4 deletions(-)\n create mode 100644 src/webhooks/backoff.ts' },
    { type: 'assistant', at: ago(19.5), profile: 'coder', model: 'glm-5.3', blocks: [
      { p: 'Backoff is in. Each retry now waits `min(cap, 2^attempt)` seconds with full jitter, and the cap reads from `webhooks.retry_cap_s` (default 60).' },
      { table: { head: ['Attempt', 'Max wait', 'Before'], rows: [['1', '2 s', '0 s'], ['2', '4 s', '0 s'], ['3', '8 s', '0 s'], ['4', '16 s', '0 s'], ['5', '— (gives up)', '0 s']] } },
      { code: { file: 'src/webhooks/backoff.ts', lang: 'ts', text: 'export function backoff(attempt: number, capS = 60, random = Math.random): number {\n  const ceiling = Math.min(capS, 2 ** attempt) * 1000;\n  return Math.floor(random() * ceiling);\n}' } },
      { p: 'All 15 webhook tests pass. I committed `feat(webhooks): exponential backoff with jitter` (3e9a1c7) and the next step is pushing the branch.' },
    ] },
    { type: 'approval', at: ago(2), id: 'apr_8f2c', inboxId: 'in_approval', tool: 'terminal', command: 'git push origin feat/x', cwd: '~/code/caduceus-dashboard', reason: 'Matches approval pattern `git push*` (approvals.mode: manual)', consequence: 'Publishes 2 commits to origin (github.com/hermes-lab/caduceus-dashboard). CI runs on push and the branch becomes visible to collaborators.', flags: ['network', 'remote write'] },
  ],
};

const inbox = [
  { id: 'in_approval', kind: 'approval', urgency: 'decision', needsAction: true, title: 'Approve `git push origin feat/x`?', preview: 'terminal · ~/code/caduceus-dashboard · 2 commits to origin', profile: 'coder', source: { type: 'session', id: 's_8f2c1a' }, created: ago(2), actions: ['Allow once', 'This session', 'Always…', 'Deny'] },
  { id: 'in_clarify', kind: 'clarify', urgency: 'decision', needsAction: true, title: 'Which citation style should the brief use?', preview: 'RAG evaluation survey: related work', profile: 'librarian', source: { type: 'session', id: 's_3b91d0' }, created: ago(5), choices: ['APA 7', 'Chicago author-date', 'IEEE', 'Plain links'], countdown: 600 },
  { id: 'in_review', kind: 'review', urgency: 'decision', needsAction: true, title: 'Design review · Board bulk-move sheet', preview: 'Software Delivery · stage 5 of 16 · Architecture notes + 2 mockups attached', profile: 'coder', source: { type: 'task', id: 't_1061' }, playbookRun: 'pr_1060', created: ago(38), actions: ['Approve', 'Reject + note', 'Open result'] },
  { id: 'in_needs_input', kind: 'needs_input', urgency: 'decision', needsAction: true, title: 'Confirm tenant move-out date for Unit 4B', preview: 'Lease says 31 Oct; tenant email says 7 Nov. Which should the bond claim use?', profile: 'property', source: { type: 'task', id: 't_1043' }, created: ago(130), actions: ['Answer'] },
  { id: 'in_pairing', kind: 'pairing', urgency: 'decision', needsAction: true, title: 'Pairing request from @mara_k on Telegram', preview: 'Wants to DM the default profile · code 4F7-K2Q', profile: 'default', source: { type: 'pairing', id: 'pair_mara' }, created: ago(14), actions: ['Approve', 'Deny'] },
  { id: 'in_cron_failed', kind: 'cron_failed', urgency: 'failed', needsAction: false, title: 'Nightly backup verify failed', preview: 'verify_backup.sh exited 2: checksum mismatch in 2026-10-05.tar.zst', profile: 'default', source: { type: 'cron', id: 'c_backup' }, created: ago(1050), actions: ['Run now', 'Open output', 'Pause'] },
  { id: 'in_gave_up', kind: 'gave_up', urgency: 'failed', needsAction: false, title: 'Gave up: Scrape council planning portal', preview: '3 of 3 attempts failed · HTTP 403 from eplanning.council.example', profile: 'property', source: { type: 'task', id: 't_1041' }, created: ago(240), actions: ['Retry', 'Reassign', 'Open log'] },
  { id: 'in_budget', kind: 'budget', urgency: 'fyi', needsAction: false, title: 'Weekly spend passed 80% of budget', preview: '$41.20 of $50.00 · unattended work pauses at 100%', profile: null, source: { type: 'budget', id: 'week' }, created: ago(55), actions: ['Open spend', 'Raise budget'] },
  { id: 'in_update', kind: 'update', urgency: 'fyi', needsAction: false, title: 'Hermes v0.14.2 is available', preview: 'You run v0.14.0 · updating restarts the gateway (≈ 20 s)', profile: null, source: { type: 'system', id: 'update' }, created: ago(600), actions: ['Update…', 'Release notes'] },
];

const boards = [
  { id: 'caduceus', name: 'Caduceus Dashboard', project: 'caduceus-dashboard', dispatcher: 'running', concurrency: 3 },
  { id: 'main', name: 'General', project: null, dispatcher: 'running', concurrency: 2 },
  { id: 'home', name: 'Household', project: 'home-lab', dispatcher: 'paused', concurrency: 1 },
];
export const TASK_STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'];

const tasks = [
  { id: 't_1032', board: 'caduceus', title: 'Investigate flaky resume test on Safari', status: 'triage', assignee: null, priority: 'P2', skills: [], project: 'caduceus-dashboard', created: ago(2880), updated: ago(2880), body: '## Goal\nFind why `resume.spec.ts` fails ~1 in 8 on WebKit.\n\n## Context\nOnly on CI; never locally.', runs: [], comments: 1 },
  { id: 't_1036', board: 'caduceus', title: 'Write onboarding copy for passkey setup', status: 'todo', assignee: 'general', priority: 'P3', skills: ['writing/plain-language'], project: 'caduceus-dashboard', created: ago(2600), updated: ago(1400), body: '## Goal\nThree short screens explaining passkeys and step-up.', runs: [], comments: 0 },
  { id: 't_1037', board: 'caduceus', title: 'Weekly dependency audit', status: 'scheduled', assignee: 'coder', priority: 'P2', skills: ['software/dependency-audit'], project: 'caduceus-dashboard', scheduledFor: nextAt(3, 0, 1), createdBy: 'cron:c_depaudit', created: ago(10080), updated: ago(10080), body: '## Goal\nRun `pnpm outdated` + `osv-scanner`; open one PR per major bump.', runs: [], comments: 0 },
  { id: 't_1040', board: 'caduceus', title: 'Add skeletons to Inbox list', status: 'ready', assignee: 'coder', priority: 'P2', skills: ['software/frontend-design'], model_override: 'glm-5.3-flash', project: 'caduceus-dashboard', created: ago(900), updated: ago(60), body: '## Goal\nSkeleton rows that match the final layout (no CLS).', runs: [], comments: 2 },
  { id: 't_1049', board: 'caduceus', title: 'Add rate-limit headers to /api/sessions', status: 'running', assignee: 'coder', priority: 'P1', skills: ['software/test-driven-dev', 'software/github-pr-workflow'], model_override: 'glm-5.3-flash', goal_mode: true, goal_max_turns: 12, completion_contract: 'hermes-lab/caduceus-dashboard', project: 'caduceus-dashboard', workspace: { kind: 'worktree', branch: 'kanban/t_1049' }, created: ago(300), updated: ago(0.3), body: '## Goal\nReturn `RateLimit-*` headers (RFC 9331 draft) on every /api/sessions response.\n\n## Done when\nPR open, CI green.', runs: [
    { id: 'r_2210', profile: 'coder', status: 'running', started: ago(6), duration: 372, step: 'implement', summary: 'Running tests: pnpm vitest run src/api', tokens: 64_300, cost: 0.09, sessionId: 's_kw_1049', turn: 4 },
  ], comments: 0, parentOf: ['t_1045'] },
  { id: 't_1051', board: 'main', title: 'Search & read: passkey step-up UX patterns', status: 'running', assignee: 'librarian', priority: 'P2', skills: ['research/web-research', 'research/citation-formatter'], project: 'reading-list', playbook: 'research-brief', step_key: 'search-read', playbookRun: 'pr_1051', created: ago(30), updated: ago(1), body: '## Goal\nCollect 12–15 primary sources on step-up authentication UX.', runs: [
    { id: 'r_2214', profile: 'librarian', status: 'running', started: ago(18), duration: 1080, step: 'search-read', summary: 'Read 9 of ~15 sources; drafting notes', tokens: 128_900, cost: 0.31, sessionId: 's_kw_1051', turn: 7 },
  ], comments: 0 },
  { id: 't_1038', board: 'main', title: 'Sync rent ledger to the portfolio sheet', status: 'running', stale: true, heartbeat: ago(14), assignee: 'property', priority: 'P2', skills: ['productivity/google-workspace'], project: 'property-portfolio', created: ago(200), updated: ago(14), body: '## Goal\nAppend September receipts to the Ledger tab.', runs: [
    { id: 'r_2205', profile: 'property', status: 'stale', started: ago(47), duration: 2820, step: null, summary: 'No heartbeat for 14 minutes', tokens: 21_000, cost: 0.02 },
  ], comments: 0 },
  { id: 't_1043', board: 'main', title: 'Confirm tenant move-out date for Unit 4B', status: 'blocked', block_kind: 'needs_input', assignee: 'property', priority: 'P1', skills: ['property/lease-drafter'], project: 'property-portfolio', created: ago(400), updated: ago(130), body: '## Goal\nPrepare the bond claim for Unit 4B.', runs: [
    { id: 'r_2198', profile: 'property', status: 'blocked', started: ago(150), duration: 1210, summary: 'Asked: which move-out date applies (31 Oct vs 7 Nov)?', tokens: 18_400, cost: 0.02 },
  ], comments: 1 },
  { id: 't_1045', board: 'caduceus', title: 'Ship Inbox push notifications', status: 'blocked', block_kind: 'dependency', assignee: 'coder', priority: 'P1', skills: ['software/github-pr-workflow'], project: 'caduceus-dashboard', parents: ['t_1049'], created: ago(1800), updated: ago(300), body: '## Goal\nVAPID push for approvals and failures; presence-aware.', runs: [], comments: 3 },
  { id: 't_1041', board: 'main', title: 'Scrape council planning portal', status: 'blocked', gave_up: true, block_kind: 'transient', assignee: 'property', priority: 'P2', skills: ['research/web-research'], project: 'property-portfolio', created: ago(1300), updated: ago(240), body: '## Goal\nDownload all DA documents for 14 Elm St.', runs: [
    { id: 'r_2181', profile: 'property', status: 'failed', started: ago(720), duration: 95, summary: 'HTTP 403 from eplanning.council.example', error: 'HTTPError 403', tokens: 4_100, cost: 0.01 },
    { id: 'r_2189', profile: 'property', status: 'failed', started: ago(480), duration: 88, summary: 'HTTP 403 after user-agent change', error: 'HTTPError 403', tokens: 3_900, cost: 0.01 },
    { id: 'r_2196', profile: 'property', status: 'failed', started: ago(250), duration: 102, summary: 'HTTP 403; circuit breaker tripped (3 consecutive failures)', error: 'HTTPError 403', tokens: 4_300, cost: 0.01 },
  ], comments: 0 },
  { id: 't_1061', board: 'caduceus', title: 'Design review · Board bulk-move sheet', status: 'review', assignee: 'you', priority: 'P1', skills: [], project: 'caduceus-dashboard', playbook: 'software-delivery', step_key: 'design-review', playbookRun: 'pr_1060', created: ago(38), updated: ago(38), body: '## Review\nApprove the architecture notes and mockups for the bulk-move sheet.', runs: [], comments: 0 },
  { id: 't_1046', board: 'caduceus', title: 'Review PR #212: gateway client resume refactor', status: 'review', assignee: 'you', priority: 'P2', skills: [], completion_contract: 'https://github.com/hermes-lab/caduceus-dashboard/pull/212', project: 'caduceus-dashboard', created: ago(95), updated: ago(95), body: '## Review\nCI green. 14 files, +420 −388.', runs: [
    { id: 'r_2201', profile: 'coder', status: 'succeeded', started: ago(180), duration: 4900, summary: 'Opened PR #212; CI green', tokens: 512_000, cost: 1.84, sessionId: 's_cc_77a1' },
  ], comments: 2 },
  { id: 't_1044', board: 'main', title: 'Research brief: local vector DBs', status: 'done', assignee: 'librarian', priority: 'P3', skills: ['research/web-research'], project: 'reading-list', playbook: 'research-brief', created: ago(1600), updated: ago(1440), body: '', runs: [
    { id: 'r_2170', profile: 'librarian', status: 'succeeded', started: ago(1520), duration: 4700, summary: 'Report attached: vector-dbs-2026.md (11 sources)', tokens: 244_000, cost: 0.58, sessionId: 's_kw_1044' },
  ], comments: 0 },
  { id: 't_1060', board: 'caduceus', title: 'Intake · Board bulk-move sheet', status: 'done', assignee: 'coder', priority: 'P1', skills: [], project: 'caduceus-dashboard', playbook: 'software-delivery', step_key: 'intake', playbookRun: 'pr_1060', created: ago(150), updated: ago(146), body: '## Goal\nLet people move many Board cards at once from a sheet (no drag needed).', runs: [
    { id: 'r_2190', profile: 'coder', status: 'succeeded', started: ago(150), duration: 240, step: 'intake', summary: 'Brief normalised; 3 acceptance criteria', tokens: 8_200, cost: 0.02 },
  ], comments: 0 },
  { id: 't_1050', board: 'main', title: 'Plan · Passkey step-up UX patterns', status: 'done', assignee: 'librarian', priority: 'P2', skills: ['research/web-research'], project: 'reading-list', playbook: 'research-brief', step_key: 'plan', playbookRun: 'pr_1051', created: ago(30), updated: ago(19), body: '## Question\nHow do products present step-up authentication without hurting task flow?', runs: [
    { id: 'r_2212', profile: 'librarian', status: 'succeeded', started: ago(30), duration: 610, step: 'plan', summary: 'Search plan: 6 queries, 15 target sources', tokens: 11_300, cost: 0.03 },
  ], comments: 0 },
  { id: 't_1039', board: 'main', title: 'Rotate z.ai API key', status: 'done', assignee: 'default', priority: 'P1', skills: [], project: null, created: ago(3000), updated: ago(2900), body: '', runs: [
    { id: 'r_2160', profile: 'default', status: 'succeeded', started: ago(2910), duration: 40, summary: 'Key rotated; old key revoked', tokens: 2_000, cost: 0.0 },
  ], comments: 0 },
  { id: 't_1055', board: 'home', title: 'Replace hallway motion sensor battery', status: 'todo', assignee: 'homeassistant', priority: 'P3', skills: ['home/home-assistant-control'], project: 'home-lab', created: ago(700), updated: ago(700), body: 'Battery at 8% (sensor.hallway_motion_battery).', runs: [], comments: 0 },
  { id: 't_1056', board: 'home', title: 'Tidy the energy dashboard', status: 'done', assignee: 'homeassistant', priority: 'P3', skills: ['home/home-assistant-control'], project: 'home-lab', created: ago(5000), updated: ago(4000), body: '', runs: [
    { id: 'r_2120', profile: 'homeassistant', status: 'succeeded', started: ago(4100), duration: 320, summary: 'Merged 3 cards; added solar export', tokens: 9_000, cost: 0.01 },
  ], comments: 0 },
];

const SD_STAGES = [
  ['intake', 'Intake'], ['requirements', 'Requirements'], ['spec', 'Spec'], ['architecture', 'Architecture'],
  ['design-review', 'Design review', 'gate'], ['plan', 'Plan'], ['implement', 'Implement'], ['unit-tests', 'Unit tests'],
  ['integration-tests', 'Integration tests'], ['code-review', 'Code review'], ['security-review', 'Security review'], ['qa', 'QA'],
  ['docs', 'Docs'], ['release-review', 'Release review', 'gate'], ['deploy', 'Deploy'], ['verify', 'Verify'],
];
const playbooks = [
  { id: 'software-delivery', name: 'Software Delivery', version: 3, category: 'Engineering', description: 'Sixteen-stage pipeline from intake to verified deploy, with two human gates.', stages: SD_STAGES.map(([key, title, gate]) => ({ key, title, gate: gate || null, assignee: gate ? 'you' : key === 'security-review' ? 'coder' : 'coder' })), inputs: [{ key: 'goal', label: 'Goal', type: 'text', required: true }, { key: 'repo', label: 'Project', type: 'project', required: true }, { key: 'branch', label: 'Branch', type: 'text' }], runs: 7, lastRun: ago(150) },
  { id: 'research-brief', name: 'Research brief', version: 2, category: 'Research', description: 'Plan → search and read → synthesise a cited report → review.', stages: [{ key: 'plan', title: 'Plan', assignee: 'librarian' }, { key: 'search-read', title: 'Search & read', assignee: 'librarian' }, { key: 'synthesise', title: 'Synthesise', assignee: 'librarian' }, { key: 'review', title: 'Review', gate: 'gate', assignee: 'you' }], inputs: [{ key: 'question', label: 'Question', type: 'text', required: true }, { key: 'depth', label: 'Depth', type: 'select', options: ['quick', 'standard', 'deep'] }, { key: 'breadth', label: 'Sources', type: 'number' }], runs: 12, lastRun: ago(30) },
  { id: 'bug-hunt', name: 'Bug hunt', version: 1, category: 'Engineering', description: 'Reproduce, isolate, fix and verify a defect; loops back on a failed verify.', stages: [{ key: 'reproduce', title: 'Reproduce', assignee: 'coder' }, { key: 'isolate', title: 'Isolate', assignee: 'coder' }, { key: 'fix', title: 'Fix', assignee: 'coder' }, { key: 'verify', title: 'Verify', assignee: 'coder' }], inputs: [{ key: 'report', label: 'Bug report', type: 'text', required: true }, { key: 'repo', label: 'Project', type: 'project' }], runs: 4, lastRun: ago(4000) },
  { id: 'code-review', name: 'Code review', version: 1, category: 'Engineering', description: 'One-stage template: review a PR against the project checklist and post comments.', stages: [{ key: 'review', title: 'Review PR', assignee: 'coder' }], inputs: [{ key: 'pr', label: 'PR URL', type: 'url', required: true }], runs: 19, lastRun: ago(95) },
];
const playbookRuns = [
  { id: 'pr_1060', rootTaskId: 't_1060', playbook: 'software-delivery', version: 3, title: 'Board bulk-move sheet', profile: 'coder', started: ago(150), state: 'waiting', cost: 1.12,
    stages: SD_STAGES.map(([key], i) => ({ key, state: i < 4 ? 'succeeded' : i === 4 ? 'waiting' : 'queued', taskId: i === 4 ? 't_1061' : i === 0 ? 't_1060' : null, attempt: i <= 4 ? 1 : 0, duration: i < 4 ? [240, 610, 1380, 1720][i] : null })) },
  { id: 'pr_1051', rootTaskId: 't_1050', playbook: 'research-brief', version: 2, title: 'Passkey step-up UX patterns', profile: 'librarian', started: ago(30), state: 'running', cost: 0.36,
    stages: [{ key: 'plan', state: 'succeeded', taskId: 't_1050', duration: 610, attempt: 1 }, { key: 'search-read', state: 'running', taskId: 't_1051', duration: 1080, attempt: 1 }, { key: 'synthesise', state: 'queued', attempt: 0 }, { key: 'review', state: 'queued', attempt: 0 }] },
];

const cron = [
  { id: 'c_morning', name: 'Morning briefing', type: 'agent', profile: 'default', schedule: '0 7 * * *', human: 'Every day at 07:00', state: 'active', deliver: 'telegram', prompt: 'Summarise my calendar, weather and deliveries for today.', next: nextAt(7, 0), lastStatus: 'succeeded', runs: [
    { id: 'cr_9012', at: ago(690), status: 'succeeded', duration: 21, tokens: 9_800, cost: 0.01, output: '3 meetings, rain after 15:00, 2 packages arriving.', sessionId: 's_cron_brief' },
    { id: 'cr_8971', at: ago(690 + 1440), status: 'succeeded', duration: 19, tokens: 9_100, cost: 0.01, output: '1 meeting, sunny, no deliveries.' },
    { id: 'cr_8930', at: ago(690 + 2880), status: 'succeeded', duration: 24, tokens: 10_300, cost: 0.01, output: '4 meetings, strong wind warning.' } ] },
  { id: 'c_backup', name: 'Nightly backup verify', type: 'script', profile: 'default', schedule: '30 2 * * *', human: 'Every day at 02:30', state: 'active', script: 'verify_backup.sh', no_agent: true, deliver: 'telegram', failure_deliver: 'inbox', next: nextAt(2, 30), lastStatus: 'failed', runs: [
    { id: 'cr_9008', at: ago(1050), status: 'failed', duration: 41, exit: 2, output: 'sha256 mismatch: 2026-10-05.tar.zst\nexpected 9f1c…be20\nactual   41aa…07d3\nexit 2' },
    { id: 'cr_8968', at: ago(1050 + 1440), status: 'succeeded', duration: 38, exit: 0, output: 'OK 2026-10-04.tar.zst (14.2 GB)' },
    { id: 'cr_8927', at: ago(1050 + 2880), status: 'succeeded', duration: 37, exit: 0, output: 'OK 2026-10-03.tar.zst (14.1 GB)' } ] },
  { id: 'c_depaudit', name: 'Weekly dependency audit', type: 'task', profile: 'coder', schedule: '0 3 * * 1', human: 'Mondays at 03:00', state: 'active', creates: { board: 'caduceus', title: 'Weekly dependency audit', assignee: 'coder' }, next: nextAt(3, 0, 1), lastStatus: 'succeeded', runs: [
    { id: 'cr_8800', at: ago(10080 - 30), status: 'succeeded', duration: 2, output: 'Created t_1037 on board caduceus' } ] },
  { id: 'c_energy', name: 'Energy report', type: 'blueprint', blueprint: 'weekly-energy-digest', profile: 'homeassistant', schedule: '0 18 * * 0', human: 'Sundays at 18:00', state: 'active', monitor_url: 'http://homeassistant.local:8123/api/states/sensor.energy_week', deliver: 'discord', next: nextAt(18, 0, 0), lastStatus: 'succeeded', runs: [
    { id: 'cr_8990', at: ago(1860), status: 'succeeded', duration: 33, tokens: 12_200, cost: 0.01, output: 'Usage down 12% week on week; heat pump is 41% of load.', sessionId: 's_cron_energy' } ] },
  { id: 'c_gpu', name: 'Price watch: GPU listings', type: 'script', profile: 'default', schedule: '*/30 * * * *', human: 'Every 30 minutes', state: 'running', script: 'gpu_watch.py', no_agent: false, monitor_script: 'gpu_watch.py --hash', deliver: 'telegram', next: nextHalfHour(), lastStatus: 'running', runningSince: ago(0.7), runs: [
    { id: 'cr_9020', at: ago(0.7), status: 'running', duration: null, output: 'Monitor output changed; running agent…' },
    { id: 'cr_9019', at: ago(30.7), status: 'succeeded', duration: 3, output: 'Skipped: monitor output unchanged' } ] },
  { id: 'c_digest', name: 'Evening inbox digest', type: 'agent', profile: 'general', schedule: '0 20 * * *', human: 'Every day at 20:00', state: 'paused', deliver: 'telegram', next: null, lastStatus: 'succeeded', runs: [
    { id: 'cr_8700', at: ago(60 * 24 * 6), status: 'succeeded', duration: 18, output: '4 FYI items, nothing urgent.' } ] },
];

const health = [
  { id: 'gateway', name: 'Gateway', state: 'online', detail: '4 of 6 profiles running · restarted 3m ago', metric: 'uptime 3m' },
  { id: 'scheduler', name: 'Scheduler', state: 'online', detail: 'Last tick 14s ago · 6 jobs, 1 paused', metric: 'tick 14s' },
  { id: 'dispatcher', name: 'Dispatcher', state: 'degraded', detail: 'Worker for t_1038 has missed heartbeats for 14 minutes', metric: '1 stale', reason: 'The property worker for "Sync rent ledger" stopped reporting. The task stays claimed until it is reclaimed, so nothing else on board General can use its slot.', fix: { label: 'Reclaim t_1038', tier: 1, taskId: 't_1038' } },
  { id: 'providers', name: 'Providers', state: 'online', detail: 'deepseek, z.ai, openrouter · p95 1.8s', metric: 'p95 1.8s' },
  { id: 'resources', name: 'Resources', state: 'online', detail: 'CPU 34% · RAM 61% · Disk 72%', metric: 'disk 72%', host: { cpu: 0.34, mem: 0.61, disk: 0.72 } },
];

const spend = {
  today: 3.84, week: 41.2, month: 126.4,
  budget: { day: 10, week: 50, month: 200, warnAt: 0.8 },
  bySource: [
    { source: 'caduceus', amount: 14.1 }, { source: 'kanban', amount: 9.8 }, { source: 'claude-code', amount: 6.2 },
    { source: 'cron', amount: 4.3 }, { source: 'telegram', amount: 3.6 }, { source: 'cli', amount: 2.2 }, { source: 'discord', amount: 1.0 },
  ],
  byModel: [
    { model: 'glm-5.3', amount: 17.4 }, { model: 'deepseek-v4.1', amount: 9.9 }, { model: 'glm-5.3-flash', amount: 7.5 }, { model: 'deepseek-v4.1-flash', amount: 6.4 },
  ],
  daily: [4.1, 5.6, 3.2, 6.8, 7.4, 2.9, 5.3, 6.2, 4.9, 8.1, 5.7, 7.6, 9.2, 3.84],
};

const skills = [
  { path: 'software/github-pr-workflow', name: 'github-pr-workflow', category: 'software', description: 'Branch, commit, open PRs and watch CI.', source: 'builtin', version: '1.4.0', enabled: true, profiles: ['coder'], uses7d: 31, lastUsed: ago(6) },
  { path: 'software/test-driven-dev', name: 'test-driven-dev', category: 'software', description: 'Red-green-refactor loop with the project test runner.', source: 'hub', version: '0.9.2', enabled: true, profiles: ['coder'], uses7d: 22, lastUsed: ago(6) },
  { path: 'software/frontend-design', name: 'frontend-design', category: 'software', description: 'Accessible component and layout patterns.', source: 'hub', version: '2.1.0', enabled: true, profiles: ['coder'], uses7d: 9, lastUsed: ago(300), updateAvailable: '2.2.0' },
  { path: 'software/dependency-audit', name: 'dependency-audit', category: 'software', description: 'Outdated and vulnerable dependencies, one PR per bump.', source: 'local', version: '0.3.0', enabled: true, profiles: ['coder'], uses7d: 1, lastUsed: ago(10080) },
  { path: 'research/web-research', name: 'web-research', category: 'research', description: 'Search, read and extract with source tracking.', source: 'builtin', version: '1.8.1', enabled: true, profiles: ['librarian', 'property'], uses7d: 18, lastUsed: ago(1) },
  { path: 'research/citation-formatter', name: 'citation-formatter', category: 'research', description: 'APA, Chicago, IEEE and plain-link citations.', source: 'hub', version: '1.0.3', enabled: true, profiles: ['librarian'], uses7d: 6, lastUsed: ago(5) },
  { path: 'productivity/google-workspace', name: 'google-workspace', category: 'productivity', description: 'Sheets, Docs and Calendar via OAuth.', source: 'builtin', version: '1.2.0', enabled: true, profiles: ['default', 'property'], uses7d: 12, lastUsed: ago(47) },
  { path: 'home/home-assistant-control', name: 'home-assistant-control', category: 'home', description: 'Read states, call services, build energy digests.', source: 'hub', version: '0.7.4', enabled: true, profiles: ['homeassistant'], uses7d: 8, lastUsed: ago(420) },
  { path: 'property/lease-drafter', name: 'lease-drafter', category: 'property', description: 'Lease letters and bond claims from templates.', source: 'local', version: '0.2.1', enabled: true, profiles: ['property'], uses7d: 3, lastUsed: ago(150) },
  { path: 'media/youtube-transcript', name: 'youtube-transcript', category: 'media', description: 'Fetch and summarise video transcripts.', source: 'hub', version: '1.1.0', enabled: false, profiles: ['default'], uses7d: 0, lastUsed: ago(20000) },
  { path: 'writing/plain-language', name: 'plain-language', category: 'writing', description: 'Rewrite for clarity at a target reading level.', source: 'builtin', version: '1.0.0', enabled: true, profiles: ['general', 'default'], uses7d: 4, lastUsed: ago(1400) },
];

const mcpServers = [
  { name: 'github', transport: 'stdio', command: 'github-mcp-server', status: 'online', tools: 34, auth: 'token', enabled: true, profiles: ['coder'] },
  { name: 'home-assistant', transport: 'http', url: 'http://homeassistant.local:8123/mcp', status: 'online', tools: 18, auth: 'token', enabled: true, profiles: ['homeassistant'] },
  { name: 'linear', transport: 'http', url: 'https://mcp.linear.app/sse', status: 'needs_auth', tools: 0, auth: 'oauth', enabled: true, profiles: ['coder'] },
  { name: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem ~/Documents', status: 'online', tools: 11, auth: 'none', enabled: true, profiles: ['property', 'librarian'] },
  { name: 'playwright', transport: 'stdio', command: 'npx @playwright/mcp', status: 'offline', tools: 21, auth: 'none', enabled: false, profiles: ['coder'] },
];

const config = [
  { id: 'agent', title: 'Agent', keys: [
    { key: 'agent.max_turns', type: 'number', value: 90, default: 60, help: 'Maximum tool-calling turns per message.', modified: true },
    { key: 'agent.reasoning_effort', type: 'select', options: ['low', 'medium', 'high'], value: 'medium', default: 'medium', help: 'Default reasoning effort for supported models.' },
    { key: 'agent.personality', type: 'text', value: 'concise', default: 'helpful', help: 'Built-in personality preset.', modified: true },
    { key: 'approvals.mode', type: 'select', options: ['manual', 'smart', 'off'], value: 'manual', default: 'manual', help: 'How dangerous commands are approved.' },
  ] },
  { id: 'model', title: 'Model', keys: [
    { key: 'model.default', type: 'text', value: 'deepseek-v4.1-flash', default: 'deepseek-v4.1-flash', help: 'Main model for this profile.' },
    { key: 'model.provider', type: 'select', options: ['deepseek', 'z.ai', 'openrouter', 'nous'], value: 'deepseek', default: 'openrouter', help: 'Provider for the main model.', modified: true },
    { key: 'fallback_model.model', type: 'text', value: 'glm-5.3-flash', default: '', help: 'Used when the main provider fails.', modified: true },
  ] },
  { id: 'terminal', title: 'Terminal', keys: [
    { key: 'terminal.backend', type: 'select', options: ['local', 'docker', 'ssh', 'modal'], value: 'local', default: 'local', help: 'Where shell commands run.', restartRequired: true },
    { key: 'terminal.timeout', type: 'number', value: 180, default: 180, help: 'Seconds before a command is killed.' },
  ] },
  { id: 'memory', title: 'Memory', keys: [
    { key: 'memory.provider', type: 'select', options: ['builtin', 'hindsight', 'honcho'], value: 'hindsight', default: 'builtin', help: 'Long-term memory provider.', modified: true, restartRequired: true },
    { key: 'memory.user_profile_enabled', type: 'boolean', value: true, default: true, help: 'Maintain USER.md automatically.' },
  ] },
  { id: 'compression', title: 'Context compression', keys: [
    { key: 'compression.threshold', type: 'number', value: 0.7, default: 0.5, help: 'Fraction of the context window that triggers compression.', modified: true },
    { key: 'compression.enabled', type: 'boolean', value: true, default: true, help: 'Summarise old turns when the context fills up.' },
  ] },
  { id: 'gateway', title: 'Gateway', keys: [
    { key: 'gateway.multiplex', type: 'boolean', value: false, default: false, help: 'Serve every profile from one gateway process.', restartRequired: true },
    { key: 'gateway.port', type: 'number', value: 9119, default: 9119, help: 'Loopback port for hermes serve.', restartRequired: true },
  ] },
  { id: 'display', title: 'Display', keys: [
    { key: 'display.tool_progress', type: 'select', options: ['all', 'new', 'off'], value: 'new', default: 'all', help: 'Tool progress messages on chat platforms.', modified: true },
  ] },
];

const keys = [
  { id: 'k_deepseek', provider: 'DeepSeek', env: 'DEEPSEEK_API_KEY', masked: 'sk-…a91c', status: 'valid', lastUsed: ago(1), profiles: ['default', 'librarian', 'general'] },
  { id: 'k_zai', provider: 'Z.ai', env: 'ZAI_API_KEY', masked: 'zai-…4be0', status: 'valid', lastUsed: ago(0.3), profiles: ['coder', 'property', 'homeassistant'], rotated: ago(2900) },
  { id: 'k_openrouter', provider: 'OpenRouter', env: 'OPENROUTER_API_KEY', masked: 'sk-or-…7d21', status: 'valid', lastUsed: ago(3000), profiles: ['default'] },
  { id: 'k_telegram', provider: 'Telegram bot', env: 'TELEGRAM_BOT_TOKEN', masked: '7731…:AAH…q9', status: 'valid', lastUsed: ago(14), profiles: ['default', 'property', 'general'] },
  { id: 'k_discord', provider: 'Discord bot', env: 'DISCORD_BOT_TOKEN', masked: 'MTE…x4', status: 'valid', lastUsed: ago(420), profiles: ['coder', 'homeassistant'] },
  { id: 'k_firecrawl', provider: 'Firecrawl', env: 'FIRECRAWL_API_KEY', masked: null, status: 'missing', lastUsed: null, profiles: ['librarian'] },
];
const oauth = [
  { id: 'o_nous', provider: 'Nous Portal', account: 'hermes-lab', status: 'signed_in', expires: inMin(60 * 24 * 20) },
  { id: 'o_google', provider: 'Google Workspace', account: 'household@example.com', status: 'signed_in', expires: inMin(60 * 5) },
  { id: 'o_linear', provider: 'Linear (MCP)', account: null, status: 'signed_out', expires: null },
];

const channels = [
  { platform: 'telegram', name: 'Telegram', status: 'online', profiles: ['default', 'property', 'general'], allowedUsers: 3 },
  { platform: 'discord', name: 'Discord', status: 'online', profiles: ['coder', 'homeassistant'], allowedUsers: 5 },
  { platform: 'whatsapp', name: 'WhatsApp', status: 'offline', profiles: [], allowedUsers: 0 },
  { platform: 'slack', name: 'Slack', status: 'offline', profiles: [], allowedUsers: 0 },
];
const pairing = [
  { id: 'pair_mara', platform: 'telegram', user: '@mara_k', name: 'Mara K.', profile: 'default', code: '4F7-K2Q', state: 'pending', requested: ago(14) },
  { id: 'pair_jo', platform: 'discord', user: 'jo#2231', name: 'Jo', profile: 'homeassistant', code: null, state: 'approved', requested: ago(20000) },
];

const models = [
  { id: 'deepseek-v4.1-flash', provider: 'deepseek', context: 128_000, priceIn: 0.07, priceOut: 0.28 },
  { id: 'deepseek-v4.1', provider: 'deepseek', context: 128_000, priceIn: 0.27, priceOut: 1.1 },
  { id: 'glm-5.3', provider: 'z.ai', context: 200_000, priceIn: 0.6, priceOut: 2.2 },
  { id: 'glm-5.3-flash', provider: 'z.ai', context: 128_000, priceIn: 0.05, priceOut: 0.2 },
  { id: 'qwen3.6-plus', provider: 'openrouter', context: 256_000, priceIn: 0.4, priceOut: 1.2 },
];

export const data = {
  version: { hermes: '0.14.0', latest: '0.14.2', caduceus: '0.1.0-proto' },
  connection: 'online', // 'online' | 'reconnecting' | 'offline' (prototype bar toggles it)
  profiles, projects, sessions, transcripts, inbox, boards, tasks, playbooks, playbookRuns,
  cron, health, spend, skills, mcpServers, config, keys, oauth, channels, pairing, models,
};

/* ---- Lookups (keep screens free of ad-hoc finds) ---- */
export const getProfile = (name) => data.profiles.find((p) => p.name === name);
export const defaultProfile = () => data.profiles.find((p) => p.isDefault) || data.profiles[0];
export const getSession = (id) => data.sessions.find((s) => s.id === id);
export const getTask = (id) => data.tasks.find((t) => t.id === id);
export const getInboxItem = (id) => data.inbox.find((i) => i.id === id);
export const getPlaybook = (id) => data.playbooks.find((p) => p.id === id);
export const getJob = (id) => data.cron.find((j) => j.id === id);
/** Items that need a decision: the only thing the Inbox badge counts. */
export const actionableCount = (scope = 'all') => data.inbox.filter((i) => i.needsAction && !i.resolved && !(i.snoozedUntil > Date.now()) && (scope === 'all' || i.profile === scope)).length;
/** Sticky bottom bars mark themselves with `data-dock`; toasts and the PROTOTYPE pill sit above the tallest visible one. */
export function measureDock() {
  const vh = window.innerHeight;
  let floor = 0;
  for (const el of document.querySelectorAll('#main [data-dock]')) {
    const r = el.getBoundingClientRect();
    if (!r.height || r.top >= vh || r.bottom <= 0) continue;
    floor = Math.max(floor, vh - r.top);
  }
  document.documentElement.style.setProperty('--toast-floor', floor ? `${Math.round(floor + 12)}px` : '0px');
}
/** Filter helper for cross-profile lists: inScope(item.profile, ctx.scope). */
export const inScope = (profile, scope) => scope === 'all' || !profile || profile === scope;
