// Home (IA §1, mobile §4): Waiting for you → Running now → Health → Spend → Recent → Quick launch.
import {
  html, raw, esc, icon, statusBadge, profileTag, sourceTag, pageHeader, fmtAgo, fmtDur, fmtMoney,
  SOURCES, inScope, actionableCount, getTask, getSession,
} from '../shared.js';

const KIND = {
  approval: { label: 'Approval', icon: 'terminal' },
  clarify: { label: 'Question', icon: 'question' },
  review: { label: 'Review gate', icon: 'flag' },
  needs_input: { label: 'Needs input', icon: 'waiting' },
  pairing: { label: 'Pairing', icon: 'user-plus' },
};
/** `code` spans in titles → <code>; everything else escaped. */
const codeify = (s) => raw(esc(s).replace(/`([^`]+)`/g, '<code>$1</code>'));

function runningItems(ctx) {
  const d = ctx.data;
  const out = [];
  for (const s of d.sessions) {
    if (!s.live || s.liveState !== 'running' || s.source === 'kanban' || !inScope(s.profile, ctx.scope)) continue;
    out.push({ id: s.id, kind: 'chat', title: s.title, href: `/chat/${s.id}`, profile: s.profile, source: s.source, started: s.started, detail: s.preview, state: 'running', model: s.model });
  }
  for (const t of d.tasks) {
    if (t.status !== 'running' || !inScope(t.assignee, ctx.scope)) continue;
    const run = t.runs[t.runs.length - 1];
    out.push({ id: run.id, kind: 'task', title: t.title, href: `/work/tasks/${t.id}`, profile: t.assignee, source: 'kanban', started: run.started, detail: t.stale ? `No heartbeat for ${fmtAgo(t.heartbeat)}` : `${t.id}${t.step_key ? ` · stage ${t.step_key}` : ''} · turn ${run.turn}${t.goal_mode ? `/${t.goal_max_turns} (goal)` : ''}`, state: t.stale ? 'stale' : 'running', model: t.model_override, taskId: t.id });
  }
  for (const j of d.cron) {
    if (j.state !== 'running' || !inScope(j.profile, ctx.scope)) continue;
    out.push({ id: j.runs[0].id, kind: 'cron', title: j.name, href: `/work/schedules/${j.id}`, profile: j.profile, source: 'cron', started: j.runningSince, detail: `${j.human} · ${j.runs[0].output}`, state: 'running' });
  }
  return out;
}

function waitingCard(item) {
  const k = KIND[item.kind] || { label: item.kind, icon: 'waiting' };
  let actions = '';
  if (item.kind === 'approval') actions = html`<button type="button" class="btn btn--primary btn--sm" data-resolve="${item.id}" data-verb="Allowed once">Allow once</button><button type="button" class="btn btn--danger-quiet btn--sm" data-resolve="${item.id}" data-verb="Denied">Deny</button>`;
  else if (item.kind === 'review') actions = html`<button type="button" class="btn btn--primary btn--sm" data-resolve="${item.id}" data-verb="Approved">Approve</button>`;
  else if (item.kind === 'needs_input') actions = html`<button type="button" class="btn btn--primary btn--sm" data-answer="${item.id}">Answer…</button>`;
  else if (item.kind === 'pairing') actions = html`<button type="button" class="btn btn--primary btn--sm" data-pair="${item.id}">Approve…</button>`;
  return html`<li class="wcard">
    <div class="wcard__top">${icon(k.icon, 'i-sm')}<span class="overline">${k.label}</span><span class="mono" style="font-size:var(--cd-text-xs)">${fmtAgo(item.created)}</span></div>
    <div class="wcard__title"><a href="#/inbox/${item.id}" data-href="/inbox/${item.id}">${codeify(item.title)}</a></div>
    <p class="wcard__preview">${item.preview}</p>
    ${item.kind === 'clarify' ? html`<div class="wcard__choices" role="group" aria-label="Answer choices">${item.choices.slice(0, 3).map((c) => html`<button type="button" class="chip" data-choice="${item.id}" data-v="${c}">${c}</button>`)}</div>` : ''}
    <div class="wcard__foot">${item.profile ? profileTag(item.profile) : html`<span></span>`}${actions}</div>
  </li>`;
}

export default {
  routes: ['/home'],
  title: 'Home',
  group: 'top',
  render(ctx) {
    const d = ctx.data;
    const sc = ctx.scope;
    const waiting = d.inbox.filter((i) => i.needsAction && !i.resolved && inScope(i.profile, sc));
    const failed = d.inbox.filter((i) => i.urgency === 'failed' && !i.resolved && inScope(i.profile, sc));
    const running = runningItems(ctx);
    const recent = d.sessions.filter((s) => !s.live && !s.archived && inScope(s.profile, sc)).sort((a, b) => b.updated - a.updated).slice(0, 5);
    const sp = d.spend;
    const degraded = d.health.filter((x) => x.state !== 'online');
    const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const scopeLabel = sc === 'all' ? 'All profiles' : sc;
    const tile = (label, amount, budget) => {
      const p = amount / budget;
      const tone = p >= 1 ? 'danger' : p >= sp.budget.warnAt ? 'warning' : 'accent';
      return html`<div class="spend__tile">
        <p class="overline">${label}</p>
        <p class="stat__value">${fmtMoney(amount)}</p>
        <div class="progress" data-tone="${tone}" role="img" aria-label="${Math.round(p * 100)}% of ${fmtMoney(budget)} budget"><i style="--p:${Math.min(100, p * 100).toFixed(0)}%"></i></div>
        <p class="spend__of mono">${Math.round(p * 100)}% of ${fmtMoney(budget)}</p>
      </div>`;
    };
    const maxSrc = Math.max(...sp.bySource.map((s) => s.amount));

    return html`<div class="home">
      <div class="home__head">${pageHeader({
        overline: today,
        title: 'Home',
        subtitle: `${scopeLabel} · ${waiting.length} waiting for you · ${running.filter((r) => r.state === 'running').length} running${failed.length ? ` · ${failed.length} failed` : ''}`,
        actions: ctx.size === 'large' ? html`<a class="btn btn--primary" href="${ctx.href('/chat/new')}">${icon('plus')}New chat</a>` : '',
      })}</div>

      <section class="section home__wait" aria-labelledby="h-wait">
        <div class="section__head">
          <h2 class="section__title" id="h-wait">${icon('waiting')}Waiting for you ${waiting.length ? html`<span class="count" aria-hidden="true">${waiting.length}</span>` : ''}</h2>
          <a class="section__link" href="${ctx.href('/inbox')}">Open Inbox${failed.length ? ` (+${failed.length} failed)` : ''}${icon('chev-r', 'i-sm')}</a>
        </div>
        ${waiting.length
          ? html`<ul class="strip" aria-label="${waiting.length} items need you">${waiting.map(waitingCard)}</ul>`
          : html`<div class="panel panel--pad row">${statusBadge('succeeded', { label: 'Nothing needs you' })}<span class="subtle">Approvals, questions and reviews land here and in Inbox.</span></div>`}
      </section>

      <section class="section home__run" aria-labelledby="h-run">
        <div class="section__head"><h2 class="section__title" id="h-run">Running now</h2><a class="section__link" href="${ctx.href('/work/board')}">Board${icon('chev-r', 'i-sm')}</a></div>
        ${running.length ? html`<ul class="list panel">${running.map((r) => html`<li class="run-row">
            <span class="list-row__icon run-row__icon" aria-hidden="true">${icon(SOURCES[r.source]?.icon || 'chat')}</span>
            <a class="run-row__title" href="${ctx.href(r.href)}">${r.title}</a>
            <div class="run-row__meta">${statusBadge(r.state, { variant: 'plain' })}${profileTag(r.profile)}<span>${SOURCES[r.source]?.label}</span></div>
            <div class="run-row__detail">${r.detail}</div>
            <div class="run-row__actions">
              ${r.state === 'stale'
                ? html`<span class="mono run-row__elapsed" style="color:var(--cd-tone-stale-fg)">stale</span>`
                : html`<span class="mono run-row__elapsed" data-elapsed="${r.started}" aria-label="Elapsed">${fmtDur((Date.now() - r.started) / 1000)}</span>`}
              <button type="button" class="btn btn--secondary btn--sm" data-steer="${r.id}" ${r.kind === 'cron' || r.state === 'stale' ? raw('disabled') : ''}>${icon('steer')}Steer</button>
              <button type="button" class="btn btn--danger-quiet btn--sm" data-stop="${r.id}">${icon('stop')}Stop</button>
            </div>
          </li>`)}</ul>`
          : html`<div class="panel panel--pad subtle">Nothing is running for ${scopeLabel}.</div>`}
      </section>

      <section class="section home__health" aria-labelledby="h-health">
        <div class="section__head"><h2 class="section__title" id="h-health">Health</h2><a class="section__link" href="${ctx.href('/observe/health')}">Details${icon('chev-r', 'i-sm')}</a></div>
        <div class="hchips" role="list">${d.health.map((x) => html`<a role="listitem" class="chip hchip" href="${ctx.href('/observe/health')}" aria-label="${x.name}: ${x.state === 'online' ? 'Online' : 'Degraded'}, ${x.metric}">
          <span class="dot" data-tone="${x.state === 'online' ? 'success' : 'warning'}" aria-hidden="true"></span>${x.name}<span class="mono">${x.metric}</span></a>`)}</div>
        ${degraded.map((x) => html`<div class="banner" data-tone="warning">${icon('alert')}
          <div class="banner__content"><div class="banner__title">${x.name} degraded</div><div class="banner__body">${x.detail}. ${x.reason}</div>
            <div class="banner__actions"><button type="button" class="btn btn--secondary btn--sm" data-repair="${x.id}">${icon('tool')}${x.fix.label}</button></div></div><span></span></div>`)}
      </section>

      <section class="section home__spend" aria-labelledby="h-spend">
        <div class="section__head"><h2 class="section__title" id="h-spend">Spend vs budget</h2><a class="section__link" href="${ctx.href('/observe/insights')}">Insights${icon('chev-r', 'i-sm')}</a></div>
        <div class="panel panel--pad spend">
          <div class="spend__tiles">${tile('Today', sp.today, sp.budget.day)}${tile('This week', sp.week, sp.budget.week)}${tile('This month', sp.month, sp.budget.month)}</div>
          ${sp.week / sp.budget.week >= sp.budget.warnAt ? html`<p class="spend__note">${icon('alert', 'i-sm')}Weekly spend passed ${Math.round(sp.budget.warnAt * 100)}%. Unattended work pauses at 100%; chats are never blocked.</p>` : ''}
          <div class="stack" style="gap:var(--cd-space-2)">
            <p class="overline">By source · this week</p>
            <ul class="bars">${sp.bySource.map((s) => html`<li>${sourceTag(s.source)}<span class="bar" aria-hidden="true"><i style="--p:${((s.amount / maxSrc) * 100).toFixed(0)}%"></i></span><span class="mono">${fmtMoney(s.amount)}</span></li>`)}</ul>
          </div>
        </div>
      </section>

      <section class="section home__recent" aria-labelledby="h-recent">
        <div class="section__head"><h2 class="section__title" id="h-recent">Recent sessions</h2><a class="section__link" href="${ctx.href('/chat')}">All sessions${icon('chev-r', 'i-sm')}</a></div>
        <ul class="list panel">${recent.map((s) => html`<li><a class="list-row" href="${ctx.href('/chat/' + s.id)}">
          <span class="list-row__icon">${icon(SOURCES[s.source]?.icon || 'chat')}</span>
          <span class="list-row__main"><span class="list-row__title">${s.pinned ? html`<span class="sr-only">Pinned: </span>` : ''}${s.title}</span><span class="list-row__sub">${s.preview}</span>
            <span class="list-row__meta">${profileTag(s.profile)}<span>${SOURCES[s.source]?.label}</span>${s.project ? html`<span class="mono">${s.project}</span>` : ''}</span></span>
          <span class="list-row__end">${s.pinned ? icon('pin', 'i-sm') : ''}<span class="mono">${fmtAgo(s.updated)}</span></span>
        </a></li>`)}</ul>
      </section>

      <section class="section home__quick" aria-labelledby="h-quick">
        <div class="section__head"><h2 class="section__title" id="h-quick">Quick launch</h2></div>
        <div class="quick">
          <a class="btn btn--primary" href="${ctx.href('/chat/new')}">${icon('chat')}New chat</a>
          <a class="btn btn--secondary" href="${ctx.href('/work/tasks/new')}">${icon('tasks')}New task</a>
          <a class="btn btn--secondary" href="${ctx.href('/work/playbooks')}">${icon('playbook')}Run playbook</a>
        </div>
      </section>
    </div>`;
  },

  mount(root, ctx) {
    const d = ctx.data;
    const resolve = (id, msg, detail) => {
      const item = d.inbox.find((i) => i.id === id);
      item.resolved = true;
      ctx.refresh();
      ctx.toast(msg, { detail, undo: () => { item.resolved = false; ctx.refresh(); } });
    };
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      const item = (id) => d.inbox.find((i) => i.id === id);
      if (t.dataset.resolve) {
        const it = item(t.dataset.resolve);
        resolve(it.id, `${t.dataset.verb}: ${it.title.replace(/`/g, '').replace(/^Approve /, '').replace(/\?$/, '')}`, `${it.profile} · ${it.source.id}`);
      } else if (t.dataset.choice) {
        const it = item(t.dataset.choice);
        resolve(it.id, `Answered “${t.dataset.v}”`, `${it.profile} · ${it.source.id}`);
      } else if (t.dataset.answer) {
        const it = item(t.dataset.answer);
        ctx.openSheet({
          title: 'Answer and unblock',
          body: `<p class="muted">${esc(it.preview)}</p><div class="field"><label class="field__label" for="ans">Your answer</label><textarea id="ans" class="input" rows="3">Use 7 Nov — the tenant's email extends the lease by agreement.</textarea><p class="field__help">Posted as a comment on ${esc(it.source.id)}; the task returns to Ready.</p></div>`,
          footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-send>Send answer</button>',
          initialFocus: 'textarea',
          onMount(panel, layer) {
            panel.querySelector('[data-send]').addEventListener('click', () => { layer.close(); resolve(it.id, 'Answer sent; task unblocked', `${it.source.id} → ready`); });
          },
        });
      } else if (t.dataset.pair) {
        const it = item(t.dataset.pair);
        ctx.openDialog({ tier: 1, title: 'Approve @mara_k on Telegram?', body: 'Mara K. can then DM this profile and start sessions. Pairing code <span class="mono">4F7-K2Q</span> matches the request.', profile: it.profile, confirmLabel: 'Approve pairing' })
          .then((ok) => { if (ok) resolve(it.id, 'Paired @mara_k', 'telegram · default'); });
      } else if (t.dataset.steer) {
        const id = t.dataset.steer;
        ctx.openSheet({
          title: 'Steer the running agent',
          body: `<p class="muted">Guidance is injected at the next turn without stopping the run.</p><div class="field"><label class="field__label" for="steer">Message</label><textarea id="steer" class="input" rows="3" placeholder="e.g. Skip the integration tests for now"></textarea></div>`,
          footer: '<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-send>Send steer</button>',
          initialFocus: 'textarea',
          onMount(panel, layer) {
            panel.querySelector('[data-send]').addEventListener('click', () => { layer.close(); ctx.toast('Steer sent', { detail: `${id} · applies next turn` }); });
          },
        });
      } else if (t.dataset.stop) {
        const r = runningItems(ctx).find((x) => x.id === t.dataset.stop);
        ctx.openDialog({ tier: 1, title: `Stop “${r.title}”?`, body: `The run <span class="mono">${esc(r.id)}</span> is interrupted after the current tool call. Its transcript and partial output are kept.`, profile: r.profile, danger: true, confirmLabel: 'Stop run' })
          .then((ok) => {
            if (!ok) return;
            if (r.kind === 'chat') getSession(r.id).liveState = 'cancelled';
            if (r.kind === 'task') { const task = getTask(r.taskId); task.status = 'ready'; task.stale = false; task.runs[task.runs.length - 1].status = 'cancelled'; }
            if (r.kind === 'cron') d.cron.find((j) => j.runs[0].id === r.id).state = 'active';
            ctx.refresh();
            ctx.toast(`Stopped ${r.title}`, { tone: 'info', detail: r.id });
          });
      } else if (t.dataset.repair) {
        const x = d.health.find((h) => h.id === t.dataset.repair);
        ctx.openDialog({ tier: x.fix.tier, title: `${x.fix.label}?`, body: 'Terminates the silent worker and returns the task to <strong>Ready</strong>. The dispatcher picks it up again on the next tick.', profile: getTask(x.fix.taskId).assignee, confirmLabel: x.fix.label })
          .then((ok) => {
            if (!ok) return;
            const task = getTask(x.fix.taskId);
            task.status = 'ready'; task.stale = false;
            x.state = 'online'; x.metric = '0 stale'; x.detail = 'All workers reporting';
            ctx.refresh();
            ctx.toast(`Reclaimed ${task.id}`, { detail: 'Dispatcher healthy' });
          });
      }
    });
    const tick = setInterval(() => {
      root.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDur((Date.now() - +el.dataset.elapsed) / 1000); });
    }, 1000);
    return () => clearInterval(tick);
  },

  paletteActions(ctx) {
    const n = actionableCount(ctx.scope);
    return [{ label: `Review ${n} waiting item${n === 1 ? '' : 's'}`, icon: 'inbox', run: () => ctx.navigate('/inbox') }];
  },
};
