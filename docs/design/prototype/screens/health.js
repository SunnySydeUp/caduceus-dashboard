// Health / "Repairs" (architecture §11 Health, industry §12 #16): subsystems with an actionable reason,
// detected issues with severity, cause, one-tap tiered Fix or Ignore, recurring-failure flags, host stats.
// PROTOTYPE: subsystem checks and issues are screen-local; the dispatcher issue drives shared `data.health`.
import { html, raw, icon, statusBadge, profileTag, pageHeader, fmtAgo as fmtAgoRaw, getTask, getProfile, data, overlaysSettled } from '../shared.js';
/** fmtAgo that reads well before " ago" ("a moment ago", never "just now ago"). */
const fmtAgo = (ts, o) => { const s = fmtAgoRaw(ts, o); return s === 'just now' ? 'a moment' : s; };

const CSS_HREF = new URL('./health.css', import.meta.url).href;
if (!document.querySelector(`link[href="${CSS_HREF}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS_HREF }));

const SEV = { critical: { label: 'Critical', tone: 'danger', icon: 'failed' }, warning: { label: 'Warning', tone: 'warning', icon: 'alert' }, info: { label: 'Info', tone: 'info', icon: 'info' } };
const TIER = { 0: 'Undoable', 1: 'Tier 1 · confirm', 2: 'Tier 2 · passkey', 3: 'Tier 3 · type to confirm' };

const now = () => Date.now();
const H = {
  lastRun: now() - 14_000,
  running: false,
  fixed: [],
  ignored: new Set(),
  subs: [
    { id: 'caduceus', name: 'Caduceus server', icon: 'browser', state: 'online', reason: 'pid 812 · 3 workers · /_caduceus/healthz 200', metric: 'p95 42 ms', checked: now() - 14_000,
      checks: [['HTTP /_caduceus/healthz', '200 in 4 ms'], ['Worker pool', '3 of 3 alive'], ['WebSocket clients', '2 connected'], ['Version', '0.1.0-proto']] },
    { id: 'backend', name: 'Hermes backend child', icon: 'server', state: 'online', reason: 'hermes serve on 127.0.0.1:9119 · 0 restarts today', metric: 'up 12d', checked: now() - 14_000,
      checks: [['Process', 'pid 813 · supervised by Caduceus'], ['REST /api/health', '200 in 11 ms'], ['OpenRPC contract', 'v1 · 219 methods · matches pinned'], ['Hermes version', '0.14.0 (0.14.2 available)']] },
    { id: 'gateway', name: 'Gateway', icon: 'broadcast', shared: true, checked: now() - 14_000,
      checks: [['Profiles running', '4 of 6'], ['Telegram', 'polling · last update 9s ago'], ['Discord', 'websocket · heartbeat 41 ms'], ['Last restart', '3m ago (config change)']] },
    { id: 'scheduler', name: 'Scheduler tick', icon: 'clock', shared: true, checked: now() - 14_000,
      checks: [['Last tick', '14s ago (every 60s)'], ['Jobs', '6 · 1 paused · 1 running'], ['Missed ticks (24h)', '0'], ['Next due', 'Price watch in 12m']] },
    { id: 'dispatcher', name: 'Kanban dispatcher', icon: 'work', shared: true, checked: now() - 14_000, recurring: '3rd stale worker this week',
      checks: [['Heartbeat timeout', '10 min'], ['Workers', '2 healthy · 1 stale (t_1038)'], ['Board slots', 'General 1/1 used · Caduceus 1/2'], ['Ready queue', '3 tasks']] },
    { id: 'providers', name: 'Providers', icon: 'cpu', shared: true, checked: now() - 14_000,
      checks: [['deepseek', 'p95 1.6s · 0.2% errors'], ['z.ai', 'p95 1.9s · 1 key cooling down (429)'], ['openrouter', 'p95 2.4s · idle'], ['local-vllm', 'p95 0.2s']] },
    { id: 'resources', name: 'Resources', icon: 'database', shared: true, checked: now() - 14_000,
      checks: [['CPU', '34% · load 1.21 0.94 0.80'], ['Memory', '9.8 of 16 GB'], ['Disk /', '344 of 478 GB'], ['Open files', '1,204 of 65,536']] },
  ],
  issues: [
    { id: 'i_dispatch', sev: 'warning', sub: 'dispatcher', title: 'Worker for t_1038 stopped reporting', recurring: 'Recurring · 3rd time this week for the property worker', detected: now() - 14 * 60_000,
      cause: 'The property worker for “Sync rent ledger to the portfolio sheet” has missed heartbeats for 14 minutes. The task stays claimed until it is reclaimed, so nothing else on board General can use its slot.',
      fix: { label: 'Reclaim t_1038', tier: 1 }, link: { label: 'Open task', to: '/work/tasks/t_1038' }, profile: 'property' },
    { id: 'i_backup', sev: 'critical', sub: 'scheduler', title: 'Nightly backup verify failed', detected: now() - 1050 * 60_000,
      cause: 'verify_backup.sh exited 2: sha256 mismatch on 2026-10-05.tar.zst. The newest backup may be corrupt; the two before it verified OK.',
      fix: { label: 'Re-run verify now', tier: 1 }, link: { label: 'Open schedule', to: '/work/schedules/c_backup' }, profile: 'default' },
    { id: 'i_gw_ha', sev: 'warning', sub: 'gateway', title: 'Discord messages to homeassistant are not delivered', detected: now() - 3 * 60_000,
      cause: 'homeassistant is bound to Discord, but its gateway is stopped. Messages in #homelab queue for 24 hours, then they are dropped.',
      fix: { label: 'Start gateway', tier: 2 }, link: { label: 'Gateway', to: '/connect/gateway' }, profile: 'homeassistant' },
    { id: 'i_disk', sev: 'info', sub: 'resources', title: 'Checkpoints use 9.4 GB of disk', detected: now() - 6 * 3600_000,
      cause: 'Disk is 72% full. Shadow-git checkpoints older than 30 days account for 7.1 GB. At the current rate the disk passes 85% in about 3 weeks.',
      fix: { label: 'Prune checkpoints older than 30 days', tier: 3 }, link: { label: 'Checkpoints', to: '/workspace/checkpoints' } },
    { id: 'i_oauth', sev: 'info', sub: 'providers', title: 'Google Workspace sign-in expires in 5 hours', detected: now() - 40 * 60_000,
      cause: 'The google-workspace skill (default, property) loses access to Sheets and Calendar when the token expires. Tonight’s ledger sync would fail.',
      fix: { label: 'Reconnect…', tier: 0, nav: '/system/keys' }, link: { label: 'Keys & Auth', to: '/system/keys' }, profile: 'property' },
  ],
};
// Issues clear on recovery even when fixed elsewhere (Home repair chip, Profiles › Gateway).
const recovered = (i) => (i.id === 'i_dispatch' && data.health.find((h) => h.id === 'dispatcher')?.state === 'online')
  || (i.id === 'i_gw_ha' && getProfile('homeassistant')?.gateway === 'running');
const issueOpen = (i) => !H.ignored.has(i.id) && !H.fixed.some((f) => f.id === i.id) && !recovered(i);
function subState(ctx, s) {
  if (!s.shared) return s;
  const x = ctx.data.health.find((h) => h.id === (s.id === 'dispatcher' ? 'dispatcher' : s.id));
  let state = x?.state || 'online';
  let reason = x?.detail || '';
  if (s.id === 'gateway') {
    const stopped = ctx.data.profiles.filter((p) => p.gateway !== 'running' && p.channels.length);
    if (stopped.length) { state = 'degraded'; reason = `${ctx.data.profiles.filter((p) => p.gateway === 'running').length} of ${ctx.data.profiles.length} profiles running · ${stopped.map((p) => p.name).join(', ')} stopped with bound channels`; }
  }
  if (s.id === 'scheduler' && issueOpen(H.issues.find((i) => i.id === 'i_backup'))) { state = 'degraded'; reason = `${reason} · last backup verify failed`; }
  return { ...s, state, reason, metric: x?.metric || s.metric };
}
const fmtSec = (ts) => { const s = Math.max(0, Math.round((now() - ts) / 1000)); return s < 60 ? `${s}s ago` : `${fmtAgo(ts)} ago`; };

function issueCard(ctx, i) {
  const sev = SEV[i.sev];
  const sub = H.subs.find((s) => s.id === i.sub);
  return html`<li class="hl-issue" data-sev="${i.sev}" data-tone="${sev.tone}" aria-labelledby="hl-i-${i.id}">
    <div class="hl-issue__top"><span class="status" data-tone="${sev.tone}">${icon(sev.icon)}<span>${sev.label}</span></span><span class="subtle">${sub.name}</span><span class="mono subtle hl-issue__when">${fmtAgo(i.detected)} ago</span></div>
    <h3 class="hl-issue__title" id="hl-i-${i.id}">${i.title}</h3>
    ${i.recurring ? html`<p class="hl-recur">${icon('history', 'i-sm')}${i.recurring}<span class="sr-only">. Flagged automatically; clears after it recovers.</span></p>` : ''}
    <p class="hl-issue__cause"><span class="sr-only">Cause: </span>${i.cause}</p>
    <div class="hl-issue__foot">
      ${i.profile ? profileTag(i.profile) : ''}
      <span class="hl-issue__acts">
        <a class="btn btn--ghost btn--sm" href="${ctx.href(i.link.to)}">${i.link.label}</a>
        <button type="button" class="btn btn--secondary btn--sm" data-ignore="${i.id}">Ignore</button>
        <button type="button" class="btn btn--primary btn--sm" data-fix="${i.id}" aria-describedby="hl-t-${i.id}">${icon(i.fix.tier >= 2 ? 'fingerprint' : 'tool')}${i.fix.label}</button>
      </span>
      <span class="hl-tier" id="hl-t-${i.id}">${TIER[i.fix.tier]}</span>
    </div>
  </li>`;
}

export default {
  routes: ['/observe/health'],
  title: 'Health',
  group: 'observe',
  render(ctx) {
    const d = ctx.data;
    const subs = H.subs.map((s) => subState(ctx, s));
    const open = H.issues.filter(issueOpen).sort((a, b) => ['critical', 'warning', 'info'].indexOf(a.sev) - ['critical', 'warning', 'info'].indexOf(b.sev));
    const ignored = H.issues.filter((i) => H.ignored.has(i.id));
    const bad = subs.filter((s) => s.state !== 'online');
    const host = d.health.find((h) => h.id === 'resources')?.host || { cpu: 0.34, mem: 0.61, disk: 0.72 };
    const counts = Object.keys(SEV).map((k) => [k, open.filter((i) => i.sev === k).length]).filter(([, n]) => n);
    const gauge = (label, v, detail) => {
      const tone = v >= 0.85 ? 'danger' : v >= 0.7 ? 'warning' : 'success';
      return html`<div class="hl-gauge"><div class="hl-gauge__top"><span class="overline">${label}</span><span class="hl-gauge__v">${Math.round(v * 100)}%</span></div>
        <div class="progress" data-tone="${tone}" role="img" aria-label="${label} ${Math.round(v * 100)}%"><i style="--p:${Math.round(v * 100)}%"></i></div><span class="subtle mono hl-gauge__d">${detail}</span></div>`;
    };
    const disk = [['Checkpoints', 9.4], ['Session state.db (6 profiles)', 3.1], ['Logs', 2.1], ['Skills + venvs', 1.6], ['Backups (local)', 42.0]];
    const maxDisk = Math.max(...disk.map((x) => x[1]));
    return html`<div class="hl">
      ${pageHeader({
        overline: 'Observe · Repairs',
        title: 'Health',
        subtitle: html`<span data-sum>${open.length ? `${open.length} issue${open.length === 1 ? '' : 's'} to repair` : 'No open issues'} · ${bad.length ? `${bad.length} subsystem${bad.length === 1 ? '' : 's'} degraded` : 'all subsystems online'}</span> · last full check <span data-ts="${H.lastRun}">${fmtSec(H.lastRun)}</span>`,
        actions: html`<button type="button" class="btn btn--primary" data-run ${H.running ? raw('disabled aria-busy="true"') : ''}>${H.running ? html`<span class="spinner" aria-hidden="true"></span>Checking…` : html`${icon('refresh')}Run health check`}</button>`,
      })}

      <section class="section hl-issues" aria-labelledby="hl-h-issues">
        <div class="section__head"><h2 class="section__title" id="hl-h-issues">${icon('tool')}Repairs ${open.length ? html`<span class="count" aria-hidden="true">${open.length}</span>` : ''}</h2>
          <span class="hl-sevs">${counts.map(([k, n]) => html`<span class="tag" data-tone="${SEV[k].tone}">${n} ${SEV[k].label.toLowerCase()}</span>`)}</span></div>
        ${open.length
          ? html`<ul class="hl-issue-list">${open.map((i) => issueCard(ctx, i))}</ul>`
          : html`<div class="panel panel--pad row">${statusBadge('succeeded', { label: 'Nothing to repair' })}<span class="subtle">Issues appear here with their cause and a fix. Recurring failures are flagged automatically.</span></div>`}
        ${H.fixed.length ? html`<div class="hl-fixed panel"><p class="overline">Fixed this session</p><ul class="plain">${H.fixed.map((f) => html`<li>${icon('succeeded', 'i-sm')}<span>${f.title}</span><span class="subtle mono">${fmtAgo(f.at)} ago</span></li>`)}</ul></div>` : ''}
        ${ignored.length ? html`<details class="hl-ignored"><summary>${icon('chev-r', 'i-sm')}Ignored (${ignored.length})</summary><ul class="plain">${ignored.map((i) => html`<li><span class="tag" data-tone="${SEV[i.sev].tone}">${SEV[i.sev].label}</span><span class="hl-ignored__t">${i.title}</span><button type="button" class="btn btn--ghost btn--sm" data-unignore="${i.id}">Restore</button></li>`)}</ul></details>` : ''}
      </section>

      <section class="section hl-subs" aria-labelledby="hl-h-subs">
        <div class="section__head"><h2 class="section__title" id="hl-h-subs">${icon('heartbeat')}Subsystems</h2><span class="subtle hl-n">${subs.length - bad.length} of ${subs.length} online</span></div>
        <ul class="hl-sublist panel">${subs.map((s) => html`<li><details class="hl-sub" data-sub="${s.id}" ${s.state !== 'online' ? raw('open') : ''}>
          <summary>
            <span class="list-row__icon" aria-hidden="true">${icon(s.icon)}</span>
            <span class="hl-sub__main"><span class="hl-sub__name">${s.name}</span><span class="hl-sub__reason">${s.reason}</span>${s.recurring && s.state !== 'online' ? html`<span class="hl-recur">${icon('history', 'i-sm')}${s.recurring}</span>` : ''}</span>
            <span class="hl-sub__end">${H.running ? html`<span class="status status--plain" data-tone="running"><span class="spinner" aria-hidden="true"></span><span>Checking</span></span>` : statusBadge(s.state === 'online' ? 'online' : s.state === 'offline' ? 'offline' : 'degraded')}<span class="mono subtle hl-sub__ago" data-ts="${s.checked}">${fmtSec(s.checked)}</span></span>
            ${icon('chev-d', 'hl-sub__chev')}
          </summary>
          <dl class="hl-checks">${s.checks.map(([k, v]) => html`<div><dt>${k}</dt><dd class="mono">${v}</dd></div>`)}</dl>
        </details></li>`)}</ul>
      </section>

      <section class="section hl-host" aria-labelledby="hl-h-host">
        <div class="section__head"><h2 class="section__title" id="hl-h-host">${icon('cpu')}Host</h2><span class="subtle mono hl-n">hermes-lab · macOS 26.4 · arm64</span></div>
        <div class="panel panel--pad hl-hostpanel">
          <div class="hl-gauges">${gauge('CPU', host.cpu, 'load 1.21 · 0.94 · 0.80')}${gauge('Memory', host.mem, '9.8 of 16 GB')}${gauge('Disk', host.disk, '344 of 478 GB')}</div>
          <dl class="hl-facts">
            <div><dt>Uptime</dt><dd class="mono">12d 4h</dd></div><div><dt>Hermes</dt><dd class="mono">${d.version.hermes} <a href="${ctx.href('/system/maintenance')}">${d.version.latest} available</a></dd></div>
            <div><dt>Caduceus</dt><dd class="mono">${d.version.caduceus}</dd></div><div><dt>Python</dt><dd class="mono">3.11.9</dd></div>
            <div><dt>Node</dt><dd class="mono">22.12</dd></div><div><dt>Backups</dt><dd class="mono">last OK 2d ago</dd></div>
          </dl>
          <div class="hl-disk"><p class="overline">Disk by Hermes data</p><ul class="hl-bars">${disk.map(([k, v]) => html`<li><span>${k}</span><span class="hl-bar" aria-hidden="true"><i style="--p:${((v / maxDisk) * 100).toFixed(0)}%"></i></span><span class="mono">${v.toFixed(1)} GB</span></li>`)}</ul></div>
        </div>
      </section>
    </div>`;
  },

  mount(root, ctx) {
    const d = ctx.data;
    const tick = setInterval(() => root.querySelectorAll('[data-ts]').forEach((el) => { el.textContent = fmtSec(+el.dataset.ts); }), 5000);
    const fixed = (i, msg, detail) => {
      H.fixed.unshift({ id: i.id, title: i.title, at: now() });
      ctx.refresh();
      ctx.toast(msg, { detail });
      document.querySelector('#main #hl-h-issues')?.setAttribute('tabindex', '-1');
      document.querySelector('#main #hl-h-issues')?.focus({ preventScroll: true });
    };
    const runFix = async (i) => {
      if (i.id === 'i_dispatch') {
        const t = getTask('t_1038');
        const ok = await ctx.openDialog({ tier: 1, title: 'Reclaim t_1038?', body: 'Terminates the silent worker and returns “Sync rent ledger to the portfolio sheet” to <strong>Ready</strong>. The dispatcher picks it up again on the next tick. Partial output is kept on the run.', profile: t?.assignee || 'property', confirmLabel: 'Reclaim t_1038' });
        if (!ok) return;
        if (t) { t.status = 'ready'; t.stale = false; }
        const x = d.health.find((h) => h.id === 'dispatcher');
        Object.assign(x, { state: 'online', metric: '0 stale', detail: 'All workers reporting' });
        const s = H.subs.find((y) => y.id === 'dispatcher');
        s.checks[1][1] = '2 healthy · 0 stale';
        s.checked = now();
        fixed(i, 'Reclaimed t_1038', 'Dispatcher healthy · recurring flag clears after 24 h without a repeat');
      } else if (i.id === 'i_backup') {
        const ok = await ctx.openDialog({ tier: 1, title: 'Re-run “Nightly backup verify” now?', body: 'Runs <span class="mono">verify_backup.sh</span> once outside its schedule (every day at 02:30). Output is delivered to Telegram and Inbox.', profile: 'default', confirmLabel: 'Run now' });
        if (!ok) return;
        ctx.toast('Started backup verify', { tone: 'info', detail: 'run cr_9031 · about 40 s' });
        setTimeout(() => { if (!H.fixed.some((f) => f.id === i.id)) fixed(i, 'Backup verify passed', 'Re-downloaded 2026-10-05.tar.zst · sha256 OK'); }, 2200);
      } else if (i.id === 'i_gw_ha') {
        const ok = await ctx.openDialog({ tier: 2, title: 'Start the gateway for homeassistant?', body: 'Starts <span class="mono">hermes gateway</span> for homeassistant. 3 queued Discord messages in #homelab are delivered.', profile: 'homeassistant', confirmLabel: 'Start gateway' });
        if (!ok) return;
        const p = getProfile('homeassistant');
        if (p) p.gateway = 'running';
        H.subs.find((y) => y.id === 'gateway').checked = now();
        fixed(i, 'Gateway started for homeassistant', '3 queued messages delivered');
      } else if (i.id === 'i_disk') {
        const ok = await ctx.openDialog({ tier: 3, danger: true, title: 'Prune checkpoints older than 30 days?', object: 'checkpoints', body: 'Deletes 1,812 shadow-git snapshots across all working directories (7.1 GB). Snapshots from the last 30 days are kept.', recoverability: 'This cannot be undone. Pruned checkpoints cannot be restored; file history in your own git repos is not affected.', confirmLabel: 'Prune 7.1 GB' });
        if (!ok) return;
        const x = d.health.find((h) => h.id === 'resources');
        if (x?.host) { x.host = { ...x.host, disk: 0.71 }; x.detail = 'CPU 34% · RAM 61% · Disk 71%'; x.metric = 'disk 71%'; }
        fixed(i, 'Pruned 1,812 checkpoints', 'Freed 7.1 GB');
      } else if (i.fix.nav) {
        ctx.navigate(i.fix.nav);
      }
    };
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.fix) runFix(H.issues.find((i) => i.id === b.dataset.fix));
      else if (b.dataset.ignore) {
        const i = H.issues.find((x) => x.id === b.dataset.ignore);
        H.ignored.add(i.id);
        ctx.refresh();
        ctx.toast(`Ignored: ${i.title}`, { detail: 'It returns if it happens again', undo: () => { H.ignored.delete(i.id); ctx.refresh(); } });
      } else if (b.dataset.unignore) {
        H.ignored.delete(b.dataset.unignore);
        ctx.refresh();
      } else if ('run' in b.dataset) runCheck(ctx);
    });
    return () => clearInterval(tick);
  },

  paletteActions(ctx) {
    return [{ label: 'Run health check', icon: 'heartbeat', sub: 'Checks every subsystem now', run: () => runCheck(ctx) }];
  },
};

async function runCheck(ctx) {
  if (H.running) return;
  H.running = true;
  ctx.refresh();
  await new Promise((r) => setTimeout(r, 1400));
  H.running = false;
  H.lastRun = now();
  H.subs.forEach((s) => { s.checked = now(); });
  ctx.refresh();
  await overlaysSettled();
  const open = H.issues.filter(issueOpen).length;
  ctx.toast('Health check complete', { tone: open ? 'warning' : 'success', detail: `${H.subs.length} subsystems · ${open} open issue${open === 1 ? '' : 's'}` });
  document.querySelector('#main [data-run]')?.focus();
}
