// Keys & Auth (mobile §4 "Models / Keys", architecture §5): search-first; OAuth device-code sheet;
// masked API keys with T3 Reveal that auto-hides after 30 s; Replace / Remove (T2); credential pools;
// custom endpoints. PROTOTYPE: pools, endpoints and full key values are screen-local mock data.
import { html, raw, esc, icon, statusBadge, profileTag, pageHeader, emptyState, fmtAgo as fmtAgoRaw, fuzzy, overlaysSettled, uid } from '../shared.js';
/** fmtAgo that reads well before " ago" ("a moment ago", never "just now ago"). */
const fmtAgo = (ts, o) => { const s = fmtAgoRaw(ts, o); return s === 'just now' ? 'a moment' : s; };

const CSS_HREF = new URL('./keys.css', import.meta.url).href;
if (!document.querySelector(`link[href="${CSS_HREF}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS_HREF }));

const REVEAL_MS = 30_000;
const KIND = { k_deepseek: 'model', k_zai: 'model', k_openrouter: 'model', k_firecrawl: 'tool', k_telegram: 'channel', k_discord: 'channel' };
const GROUPS = [['model', 'Model providers', 'cpu'], ['tool', 'Tools', 'tool'], ['channel', 'Channel bots', 'broadcast']];
const FULL = {
  k_deepseek: 'sk-FAKE-prototype-not-a-real-key-a91c', k_zai: 'zai-FAKE-prototype-not-a-real-key-4be0', k_openrouter: 'sk-or-v1-FAKE-prototype-not-a-real-key-7d21',
  k_telegram: '7731000000:AAH-FAKE-prototype-not-a-real-token-q9', k_discord: 'MTE-FAKE.prototype.not-a-real-token-x4',
};
const OAUTH_META = {
  o_nous: { url: 'https://portal.nousresearch.com/device', icon: 'bolt', what: 'Hermes models and tool gateway' },
  o_google: { url: 'https://www.google.com/device', icon: 'calendar', what: 'Sheets, Docs, Calendar (google-workspace skill)' },
  o_linear: { url: 'https://linear.app/oauth/device', icon: 'link', what: 'Linear MCP server for coder' },
};
const POOLS = [
  { provider: 'DeepSeek', env: 'DEEPSEEK_API_KEY', strategy: 'round_robin', creds: [
    { id: 'pd1', label: 'personal', masked: 'sk-…a91c', state: 'active', reqs: 412 },
    { id: 'pd2', label: 'lab-backup', masked: 'sk-…03fe', state: 'active', reqs: 380 },
  ] },
  { provider: 'Z.ai', env: 'ZAI_API_KEY', strategy: 'fill_first', creds: [
    { id: 'pz1', label: 'main', masked: 'zai-…4be0', state: 'cooldown', until: Date.now() + 12 * 60_000, reqs: 1890, note: '429 rate limit' },
    { id: 'pz2', label: 'overflow', masked: 'zai-…77a1', state: 'active', reqs: 240 },
    { id: 'pz3', label: 'old-trial', masked: 'zai-…c0d9', state: 'exhausted', reqs: 0, note: 'quota exhausted until 1 Nov' },
  ] },
  { provider: 'OpenRouter', env: 'OPENROUTER_API_KEY', strategy: 'least_used', creds: [
    { id: 'po1', label: 'default', masked: 'sk-or-…7d21', state: 'active', reqs: 12 },
  ] },
];
const STRATEGIES = [['fill_first', 'Fill first'], ['round_robin', 'Round robin'], ['least_used', 'Least used'], ['random', 'Random']];
const ENDPOINTS = [
  { id: 'e_vllm', name: 'local-vllm', url: 'http://10.0.0.5:8000/v1', compat: 'OpenAI-compatible', models: ['qwen3.6-32b-awq'], key: false, status: 'online', latency: 180 },
  { id: 'e_lms', name: 'lmstudio-mac', url: 'http://studio.local:1234/v1', compat: 'OpenAI-compatible', models: ['gemma-4-27b', 'phi-5'], key: false, status: 'offline', latency: null, error: 'Connection refused (studio.local:1234)' },
];

const revealed = new Map(); // keyId → expiry timestamp (survives re-renders until it expires)
let filter = { q: '', mine: false, attention: false };
let api = null; // set by mount(): palette actions call into the mounted screen

const keyStatus = (k) => (k.status === 'valid' ? statusBadge('succeeded', { label: 'Valid', variant: 'plain' }) : statusBadge('waiting', { label: 'Missing', variant: 'plain' }));
function oauthState(o) {
  if (o.status !== 'signed_in') return { badge: statusBadge('offline', { label: 'Not connected' }), attn: true };
  const left = o.expires - Date.now();
  if (left < 864e5) return { badge: statusBadge('degraded', { label: `Expires ${fmtAgo(o.expires)}` }), attn: true };
  return { badge: statusBadge('online', { label: 'Signed in' }), attn: false };
}
const matchQ = (q, text) => !q || fuzzy(q, text) >= 0;

function keyRow(ctx, k) {
  const exp = revealed.get(k.id);
  const on = exp && exp > Date.now();
  const left = on ? Math.ceil((exp - Date.now()) / 1000) : 0;
  const compact = ctx.size === 'compact';
  return html`<tr data-key="${k.id}">
    <td class="cell-main"><div class="ky-prov"><span class="cell-title">${k.provider}</span><code class="ky-env">${k.env}</code></div></td>
    <td data-label="Value" class="ky-valcell">${k.status === 'missing'
      ? html`<span class="subtle">Not set</span>`
      : on
        ? html`<div class="ky-reveal" role="group" aria-label="${k.env} revealed">
            <code class="ky-full" data-full>${FULL[k.id] || k.masked}</code>
            <div class="ky-reveal__bar"><span class="progress" data-tone="warning" aria-hidden="true"><i style="--p:${(left / 30) * 100}%" data-bar></i></span><span class="ky-reveal__t" data-left aria-live="off">Hides in ${left}s</span></div>
            <div class="ky-reveal__acts"><button type="button" class="btn btn--secondary btn--sm" data-copy="${k.id}">${icon('copy')}Copy</button><button type="button" class="btn btn--ghost btn--sm" data-hide="${k.id}">${icon('lock')}Hide now</button></div>
          </div>`
        : html`<code class="ky-masked">${k.masked}</code>`}</td>
    <td class="cell-status">${keyStatus(k)}</td>
    <td data-label="Used by"><span class="ky-users">${k.profiles.map((p) => profileTag(p))}</span></td>
    <td data-label="Last used" class="mono ky-last">${k.lastUsed ? `${fmtAgo(k.lastUsed)} ago` : '—'}${k.rotated ? html`<span class="subtle"> · rotated ${fmtAgo(k.rotated)} ago</span>` : ''}</td>
    <td class="cell-actions"><div class="ky-acts">${k.status === 'missing'
      ? html`<button type="button" class="btn btn--primary btn--sm" data-replace="${k.id}">${icon('plus')}Add key</button>`
      : html`${on ? '' : html`<button type="button" class="btn btn--secondary btn--sm${compact ? ' btn--icon' : ''}" data-reveal="${k.id}" aria-label="Reveal ${k.env}">${icon('eye')}${compact ? '' : 'Reveal'}</button>`}
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-more="${k.id}" aria-label="More actions for ${k.env}" aria-haspopup="dialog">${icon('dots-v')}</button>`}</div></td>
  </tr>`;
}

export default {
  routes: ['/system/keys'],
  title: 'Keys & Auth',
  group: 'system',
  render(ctx) {
    const d = ctx.data;
    const p = ctx.profile;
    const q = filter.q.trim();
    const mineOK = (profiles) => !filter.mine || profiles.includes(p.name);
    const oauth = d.oauth.filter((o) => matchQ(q, `${o.provider} ${o.account || ''} ${OAUTH_META[o.id]?.what}`) && (!filter.attention || oauthState(o).attn));
    const keys = d.keys.filter((k) => matchQ(q, `${k.provider} ${k.env} ${k.profiles.join(' ')}`) && mineOK(k.profiles) && (!filter.attention || k.status !== 'valid'));
    const pools = POOLS.filter((pl) => matchQ(q, `${pl.provider} ${pl.env} pool ${pl.creds.map((c) => c.label).join(' ')}`) && (!filter.attention || pl.creds.some((c) => c.state !== 'active')));
    const eps = ENDPOINTS.filter((e) => matchQ(q, `${e.name} ${e.url} ${e.models.join(' ')} endpoint`) && (!filter.attention || e.status !== 'online'));
    const attnCount = d.oauth.filter((o) => oauthState(o).attn).length + d.keys.filter((k) => k.status !== 'valid').length + POOLS.filter((pl) => pl.creds.some((c) => c.state !== 'active')).length + ENDPOINTS.filter((e) => e.status !== 'online').length;
    const nothing = !oauth.length && !keys.length && !pools.length && !eps.length;
    return html`<div class="ky">
      ${pageHeader({
        overline: html`System · profile ${p.name}`,
        title: 'Keys & Auth',
        subtitle: html`Credentials in <span class="mono">~/.hermes/.env</span> and OAuth tokens. Values stay masked; every reveal is audited.`,
        actions: html`<button type="button" class="btn btn--primary" data-addkey>${icon('plus')}Add key</button>`,
      })}
      <div class="ky-search" role="search">
        <div class="input-wrap">${icon('search')}<input id="ky-q" class="input" type="search" value="${filter.q}" placeholder="Search providers, env vars, endpoints" aria-label="Search keys and logins" autocomplete="off" data-q></div>
        <div class="ky-chips" role="group" aria-label="Filters">
          <button type="button" class="chip" aria-pressed="${String(filter.mine)}" data-f="mine">${icon('user')}Used by ${p.name}</button>
          <button type="button" class="chip" aria-pressed="${String(filter.attention)}" data-f="attention">${icon('alert')}Needs attention <span class="count" aria-hidden="true">${attnCount}</span><span class="sr-only">, ${attnCount}</span></button>
        </div>
      </div>
      ${nothing ? emptyState({ icon: 'key', title: 'Nothing matches', body: 'Try a provider name such as DeepSeek, an env var such as ZAI_API_KEY, or clear the filters.', action: html`<button type="button" class="btn btn--secondary" data-clear>Clear search</button>` }) : ''}

      ${oauth.length ? html`<section class="section" aria-labelledby="ky-oauth">
        <div class="section__head"><h2 class="section__title" id="ky-oauth">${icon('user')}OAuth logins</h2></div>
        <ul class="list panel">${oauth.map((o) => {
          const s = oauthState(o);
          const m = OAUTH_META[o.id] || {};
          return html`<li class="ky-oauth">
            <span class="list-row__icon">${icon(m.icon || 'link')}</span>
            <div class="ky-oauth__main"><span class="list-row__title">${o.provider}</span><span class="list-row__sub">${o.account ? html`<span class="mono">${o.account}</span> · ` : ''}${m.what}</span>
              <span class="ky-oauth__state">${s.badge}${o.status === 'signed_in' ? html`<span class="subtle mono">until ${new Date(o.expires).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>` : ''}</span></div>
            <div class="ky-oauth__acts">${o.status === 'signed_in'
              ? html`<button type="button" class="btn ${s.attn ? 'btn--primary' : 'btn--secondary'} btn--sm" data-connect="${o.id}">${icon('refresh')}Reconnect</button><button type="button" class="btn btn--danger-quiet btn--sm" data-disconnect="${o.id}">Disconnect</button>`
              : html`<button type="button" class="btn btn--primary btn--sm" data-connect="${o.id}">${icon('link')}Connect</button>`}</div>
          </li>`;
        })}</ul>
      </section>` : ''}

      ${keys.length ? GROUPS.map(([g, title, ic]) => {
        const rows = keys.filter((k) => KIND[k.id] === g);
        if (!rows.length) return '';
        return html`<section class="section" aria-labelledby="ky-g-${g}">
          <div class="section__head"><h2 class="section__title" id="ky-g-${g}">${icon(ic)}${title}</h2><span class="subtle ky-n">${rows.length}</span></div>
          <div class="dl-wrap panel"><table class="dl ky-table"><thead><tr><th scope="col">Provider</th><th scope="col">Value</th><th scope="col">Status</th><th scope="col">Used by</th><th scope="col">Last used</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${rows.map((k) => keyRow(ctx, k))}</tbody></table></div>
        </section>`;
      }) : ''}

      ${pools.length ? html`<section class="section" aria-labelledby="ky-pool">
        <div class="section__head"><h2 class="section__title" id="ky-pool">${icon('stack')}Credential pools</h2></div>
        <p class="muted ky-lead">Several keys for one provider. Hermes rotates between them and cools a key down after a 429.</p>
        <div class="ky-pools">${pools.map((pl, pi) => html`<div class="panel ky-pool">
          <div class="ky-pool__head"><h3>${pl.provider}</h3><code class="ky-env">${pl.env}</code>
            <label class="ky-pool__strat"><span class="sr-only">Rotation strategy for ${pl.provider}</span><select class="input" data-strategy="${pi}">${STRATEGIES.map(([v, l]) => html`<option value="${v}" ${v === pl.strategy ? raw('selected') : ''}>${l}</option>`)}</select></label></div>
          <ul class="ky-creds">${pl.creds.map((c) => html`<li>
            <span class="ky-cred__main"><span class="ky-cred__label">${c.label}</span><code class="ky-masked">${c.masked}</code></span>
            <span class="ky-cred__state">${c.state === 'active' ? statusBadge('online', { label: 'Active' }) : c.state === 'cooldown' ? statusBadge('paused', { label: `Cooling down · ${fmtAgo(c.until)}` }) : statusBadge('blocked', { label: 'Exhausted' })}
              <span class="subtle mono">${c.reqs.toLocaleString()} req today${c.note ? ` · ${c.note}` : ''}</span></span>
          </li>`)}</ul>
          <button type="button" class="btn btn--ghost btn--sm ky-pool__add" data-addcred="${pi}">${icon('plus')}Add credential</button>
        </div>`)}</div>
      </section>` : ''}

      ${eps.length ? html`<section class="section" aria-labelledby="ky-ep">
        <div class="section__head"><h2 class="section__title" id="ky-ep">${icon('server')}Custom endpoints</h2><button type="button" class="btn btn--secondary btn--sm" data-addep>${icon('plus')}Add endpoint</button></div>
        <ul class="list panel">${eps.map((e) => html`<li class="ky-ep">
          <span class="list-row__icon">${icon('server')}</span>
          <div class="ky-ep__main"><span class="list-row__title">${e.name}</span><code class="ky-ep__url">${e.url}</code>
            <span class="list-row__meta"><span>${e.compat}</span><span>${e.models.length} model${e.models.length === 1 ? '' : 's'}: <span class="mono">${e.models.join(', ')}</span></span><span>${e.key ? 'API key set' : 'No API key'}</span></span>
            ${e.error ? html`<span class="ky-ep__err">${icon('alert', 'i-sm')}${e.error}</span>` : ''}</div>
          <div class="ky-ep__acts">${e.status === 'online' ? statusBadge('online', { label: `Online · ${e.latency}ms` }) : statusBadge('offline', { label: 'Unreachable' })}
            <button type="button" class="btn btn--secondary btn--sm" data-test="${e.id}">${icon('heartbeat')}Test</button></div>
        </li>`)}</ul>
      </section>` : ''}
      <p class="subtle ky-foot">${icon('shield', 'i-sm')}Reveals, replacements and removals are written to the audit log (<a href="${ctx.href('/system/security')}">Security</a>). Copying clears the clipboard after 60 s where the browser allows it.</p>
    </div>`;
  },

  mount(root, ctx) {
    const d = ctx.data;
    const p = ctx.profile;
    const keyById = (id) => d.keys.find((k) => k.id === id);
    const q = root.querySelector('[data-q]');
    let qTimer = 0;
    q?.addEventListener('input', () => {
      filter.q = q.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { const pos = q.selectionStart; ctx.refresh(); const n = document.getElementById('ky-q'); n?.focus(); n?.setSelectionRange(pos, pos); }, 120);
    });

    // Reveal countdown (one ticker for every revealed key)
    const tick = setInterval(() => {
      let expired = false;
      for (const [id, exp] of revealed) {
        const left = Math.ceil((exp - Date.now()) / 1000);
        const row = root.querySelector(`tr[data-key="${id}"]`);
        if (left <= 0) { revealed.delete(id); expired = true; continue; }
        if (row) { row.querySelector('[data-left]').textContent = `Hides in ${left}s`; row.querySelector('[data-bar]').style.setProperty('--p', `${(left / 30) * 100}%`); }
      }
      if (expired) { const had = root.contains(document.activeElement) && document.activeElement.closest('.ky-reveal'); ctx.refresh(); if (had) document.querySelector('#main h1')?.focus(); ctx.toast('Key hidden again', { tone: 'info', timeout: 2500 }); }
    }, 1000);

    const reveal = (k) => ctx.openDialog({
      tier: 3, title: `Reveal ${k.env}?`, object: k.env, profile: p.name,
      body: `Shows the full ${esc(k.provider)} key for 30 seconds, then masks it again. The reveal is written to the audit log with this device, IP and time.`,
      recoverability: 'Anyone who can see this screen can copy the key. If it leaks, replace it here and revoke it at the provider.',
      confirmLabel: 'Reveal for 30 s',
    }).then((ok) => {
      if (!ok) return;
      revealed.set(k.id, Date.now() + REVEAL_MS);
      ctx.refresh();
      document.querySelector(`#main tr[data-key="${k.id}"] [data-copy]`)?.focus();
    });

    const replace = (k) => {
      const id = uid('rk');
      const adding = k.status === 'missing';
      ctx.openSheet({
        title: `${adding ? 'Add' : 'Replace'} ${k.env}`,
        body: `<p class="muted">${esc(k.provider)} · used by ${k.profiles.map(esc).join(', ')}. The new value is validated with a test request before it is saved.</p>
          <div class="field"><label class="field__label" for="${id}">New value</label><div class="ky-secret"><input id="${id}" class="input input--mono" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key"><button type="button" class="btn btn--ghost btn--icon" data-peek aria-label="Show value" aria-pressed="false">${icon('eye')}</button></div>
          <p class="field__help" data-hint>Paste is allowed. Nothing is sent until you confirm with your passkey.</p></div>`,
        footer: `<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-go disabled>${icon('fingerprint')}${adding ? 'Save key…' : 'Replace key…'}</button>`,
        initialFocus: 'input',
        onMount(panel, layer) {
          const input = panel.querySelector('input');
          const go = panel.querySelector('[data-go]');
          const hint = panel.querySelector('[data-hint]');
          input.addEventListener('input', () => {
            const v = input.value.trim();
            go.disabled = v.length < 12;
            hint.textContent = !v ? 'Paste is allowed. Nothing is sent until you confirm with your passkey.' : v.length < 12 ? 'That looks too short for an API key.' : `Looks like a ${k.provider} key ending …${v.slice(-4)}.`;
          });
          panel.querySelector('[data-peek]').addEventListener('click', (e) => { const b = e.currentTarget; const show = input.type === 'password'; input.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide value' : 'Show value'); });
          go.addEventListener('click', async () => {
            const v = input.value.trim();
            layer.close();
            await overlaysSettled();
            const ok = await ctx.openDialog({ tier: 2, title: `${adding ? 'Save' : 'Replace'} ${k.env}?`, body: `Writes <span class="mono">${esc(k.env)}</span> to <span class="mono">~/.hermes/.env</span>. Profiles using it pick it up on their next request${adding ? '' : '; the old value is discarded'}.`, profile: p.name, confirmLabel: adding ? 'Save key' : 'Replace key' });
            if (!ok) return;
            const prefix = (k.masked || v).split('…')[0].replace(/[^a-z-]/gi, '') || v.slice(0, 3);
            k.masked = `${prefix}…${v.slice(-4)}`;
            FULL[k.id] = v;
            k.status = 'valid';
            k.rotated = Date.now();
            revealed.delete(k.id);
            ctx.refresh();
            ctx.toast(`${k.env} ${adding ? 'saved' : 'replaced'}`, { detail: `Test request OK · ${k.masked}` });
          });
        },
      });
    };
    const remove = (k) => ctx.openDialog({
      tier: 2, danger: true, title: `Remove ${k.env}?`, profile: p.name, confirmLabel: 'Remove key',
      body: `Deletes the value from <span class="mono">~/.hermes/.env</span>. ${k.profiles.length ? `<strong>${k.profiles.map(esc).join(', ')}</strong> lose access to ${esc(k.provider)} until a new key is added.` : ''}`,
    }).then((ok) => {
      if (!ok) return;
      Object.assign(k, { status: 'missing', masked: null, lastUsed: null });
      revealed.delete(k.id);
      ctx.refresh();
      ctx.toast(`${k.env} removed`, { tone: 'info', detail: 'Audit logged' });
    });

    const deviceCode = (o) => {
      const m = OAUTH_META[o.id] || { url: 'https://example.com/device' };
      const code = ['WDJB-MJHT', 'QK7F-2LPX', 'HV9R-T3NC'][d.oauth.indexOf(o) % 3];
      let timer = 0, approve = 0;
      ctx.openSheet({
        title: `Connect ${o.provider}`,
        body: `<ol class="ky-steps">
            <li><p><strong>Open</strong> this page on any device where you are signed in to ${esc(o.provider)}:</p>
              <div class="ky-copyrow"><code class="ky-url">${esc(m.url)}</code><button type="button" class="btn btn--secondary btn--sm" data-cp="${esc(m.url)}" aria-label="Copy link">${icon('copy')}</button><a class="btn btn--secondary btn--sm" href="${esc(m.url)}" target="_blank" rel="noopener">${icon('external')}Open</a></div></li>
            <li><p><strong>Enter</strong> this code:</p>
              <div class="ky-code"><span class="ky-code__v mono" aria-label="Code ${esc(code.split('').join(' '))}">${esc(code)}</span><button type="button" class="btn btn--primary btn--sm" data-cp="${esc(code)}">${icon('copy')}Copy code</button></div></li>
          </ol>
          <div class="ky-wait" role="status" data-wait><span class="spinner" aria-hidden="true"></span><span data-waittext>Waiting for approval… code expires in 15:00</span></div>
          <p class="subtle ky-note">Scopes: ${esc(m.what)}. Tokens are stored in <span class="mono">~/.hermes/auth.json</span>, never in the browser.</p>`,
        footer: '<button type="button" class="btn btn--ghost btn--sm ky-sim" data-sim>Prototype: simulate approval</button><button type="button" class="btn btn--secondary" data-close>Cancel</button>',
        onMount(panel, layer) {
          let left = 900;
          const wt = panel.querySelector('[data-waittext]');
          timer = setInterval(() => { left--; wt.textContent = `Waiting for approval… code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; }, 1000);
          panel.querySelectorAll('[data-cp]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.cp); } catch { /* */ } ctx.toast('Copied', { tone: 'info', timeout: 2000 }); }));
          const done = () => {
            clearInterval(timer); clearTimeout(approve);
            const w = panel.querySelector('[data-wait]');
            w.dataset.ok = '';
            w.innerHTML = `${icon('succeeded')}<span>Approved as ${esc(o.account || 'sam@hermes-lab.dev')}</span>`;
            setTimeout(() => {
              Object.assign(o, { status: 'signed_in', account: o.account || 'sam@hermes-lab.dev', expires: Date.now() + 30 * 864e5 });
              layer.close();
              ctx.refresh();
              ctx.toast(`${o.provider} connected`, { detail: `${o.account} · valid 30 days` });
            }, 700);
          };
          panel.querySelector('[data-sim]').addEventListener('click', done);
          approve = setTimeout(done, 9000);
          return () => { clearInterval(timer); clearTimeout(approve); };
        },
      });
    };

    root.addEventListener('change', (e) => {
      const s = e.target.closest('[data-strategy]');
      if (!s) return;
      const pl = POOLS[+s.dataset.strategy];
      const prev = pl.strategy;
      pl.strategy = s.value;
      ctx.toast(`${pl.provider} pool: ${STRATEGIES.find((x) => x[0] === s.value)[1].toLowerCase()}`, { undo: () => { pl.strategy = prev; ctx.refresh(); } });
    });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.f) { filter[b.dataset.f] = !filter[b.dataset.f]; ctx.refresh(); document.querySelector(`#main [data-f="${b.dataset.f}"]`)?.focus(); }
      else if ('clear' in b.dataset) { filter = { q: '', mine: false, attention: false }; ctx.refresh(); document.getElementById('ky-q')?.focus(); }
      else if (b.dataset.reveal) reveal(keyById(b.dataset.reveal));
      else if (b.dataset.hide) { revealed.delete(b.dataset.hide); ctx.refresh(); document.querySelector(`#main [data-reveal="${b.dataset.hide}"]`)?.focus(); }
      else if (b.dataset.copy) {
        try { await navigator.clipboard.writeText(FULL[b.dataset.copy]); } catch { /* */ }
        ctx.toast('Key copied', { tone: 'warning', detail: 'Clipboard clears in 60 s' });
        setTimeout(() => navigator.clipboard?.writeText('').catch(() => {}), 60_000);
      } else if (b.dataset.replace) replace(keyById(b.dataset.replace));
      else if (b.dataset.more) {
        const k = keyById(b.dataset.more);
        ctx.openSheet({
          title: k.env,
          body: `<ul class="ky-acts-list">
            <li><button type="button" class="ky-act" data-a="reveal">${icon('eye')}<span><span>Reveal…</span><small>Tier 3 · type the name · hides after 30 s</small></span></button></li>
            <li><button type="button" class="ky-act" data-a="replace">${icon('refresh')}<span><span>Replace…</span><small>Tier 2 · passkey</small></span></button></li>
            <li><button type="button" class="ky-act ky-act--danger" data-a="remove">${icon('trash')}<span><span>Remove…</span><small>Tier 2 · passkey</small></span></button></li></ul>`,
          onMount(panel, layer) {
            panel.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('click', async () => {
              layer.close();
              await overlaysSettled();
              ({ reveal, replace, remove })[x.dataset.a](k);
            }));
          },
        });
      } else if (b.dataset.connect) deviceCode(d.oauth.find((o) => o.id === b.dataset.connect));
      else if (b.dataset.disconnect) {
        const o = d.oauth.find((x) => x.id === b.dataset.disconnect);
        ctx.openDialog({ tier: 2, danger: true, title: `Disconnect ${o.provider}?`, body: `Revokes the token for <span class="mono">${esc(o.account)}</span>. ${esc(OAUTH_META[o.id]?.what || '')} stops working until you connect again.`, profile: p.name, confirmLabel: 'Disconnect' })
          .then((ok) => { if (!ok) return; Object.assign(o, { status: 'signed_out', expires: null }); ctx.refresh(); ctx.toast(`${o.provider} disconnected`, { tone: 'info' }); });
      } else if ('addkey' in b.dataset) {
        const missing = d.keys.find((k) => k.status === 'missing');
        if (missing) replace(missing); else ctx.toast('All known providers have keys', { tone: 'info' });
      } else if (b.dataset.addcred) {
        const pl = POOLS[+b.dataset.addcred];
        replace({ id: `pool_${pl.provider}`, env: `${pl.env} (pool)`, provider: pl.provider, profiles: d.keys.find((k) => k.env === pl.env)?.profiles || [], status: 'missing', masked: null });
      } else if (b.dataset.test) {
        const ep = ENDPOINTS.find((x) => x.id === b.dataset.test);
        b.disabled = true;
        b.innerHTML = '<span class="spinner" aria-hidden="true"></span>Testing…';
        await new Promise((r) => setTimeout(r, 900));
        if (ep.status === 'online') { ep.latency = 150 + Math.round(Math.random() * 80); ctx.refresh(); ctx.toast(`${ep.name} responded in ${ep.latency} ms`, { detail: `GET ${ep.url}/models · ${ep.models.length} models` }); }
        else { ctx.refresh(); ctx.toast(`${ep.name} is unreachable`, { tone: 'danger', detail: ep.error }); }
      } else if ('addep' in b.dataset) {
        const id = uid('ep');
        ctx.openSheet({
          title: 'Add a custom endpoint',
          body: `<div class="field"><label class="field__label" for="${id}-n">Name</label><input id="${id}-n" class="input input--mono" placeholder="e.g. ollama-nas" autocomplete="off"></div>
            <div class="field"><label class="field__label" for="${id}-u">Base URL</label><input id="${id}-u" class="input input--mono" type="url" inputmode="url" placeholder="http://nas.local:11434/v1"><p class="field__help">OpenAI-compatible <span class="mono">/v1</span> root.</p></div>
            <div class="field"><label class="field__label" for="${id}-k">API key <span class="subtle">(optional)</span></label><input id="${id}-k" class="input input--mono" type="password" autocomplete="off"></div>`,
          footer: `<button type="button" class="btn btn--secondary" data-close>Cancel</button><button type="button" class="btn btn--primary" data-go>${icon('lock')}Add endpoint…</button>`,
          initialFocus: 'input',
          onMount(panel, layer) {
            panel.querySelector('[data-go]').addEventListener('click', async () => {
              const name = panel.querySelector(`#${id}-n`).value.trim() || 'ollama-nas';
              const url = panel.querySelector(`#${id}-u`).value.trim() || 'http://nas.local:11434/v1';
              const key = !!panel.querySelector(`#${id}-k`).value;
              layer.close();
              await overlaysSettled();
              const ok = await ctx.openDialog({ tier: 3, title: `Add endpoint ${name}?`, object: name, profile: p.name, body: `Writes <span class="mono">custom_providers.${esc(name)}</span> to config.yaml${key ? ' and its key to .env' : ''}. Models it serves become selectable in Models.`, recoverability: 'Restorable: config.yaml.bak keeps the previous file. Remove the endpoint to undo.', confirmLabel: 'Add endpoint' });
              if (!ok) return;
              ENDPOINTS.push({ id: uid('e'), name, url, compat: 'OpenAI-compatible', models: ['llama-4-scout'], key, status: 'online', latency: 95 });
              ctx.refresh();
              ctx.toast(`Added ${name}`, { detail: '1 model discovered' });
            });
          },
        });
      }
    });
    api = { reveal: (id) => reveal(keyById(id)), connect: (id) => deviceCode(d.oauth.find((o) => o.id === id)) };
    return () => { clearInterval(tick); clearTimeout(qTimer); api = null; };
  },

  paletteActions(ctx) {
    return [{
      label: 'Reveal key…', icon: 'eye', sub: 'Tier 3 · audited · hides after 30 s',
      run: () => {
        const keys = ctx.data.keys.filter((k) => k.status === 'valid');
        ctx.openSheet({
          title: 'Reveal which key?',
          body: `<div class="plist" role="list">${keys.map((k) => `<button type="button" class="plist__row" role="listitem" data-pick="${k.id}"><span class="list-row__icon">${icon('key')}</span><span class="plist__main"><span class="plist__name">${esc(k.provider)}</span><span class="plist__sub mono">${esc(k.env)} · ${esc(k.masked)}</span></span><span></span>${icon('chev-r')}</button>`).join('')}</div>`,
          onMount(panel, layer) {
            panel.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
              layer.close();
              await overlaysSettled();
              api?.reveal(b.dataset.pick);
            }));
          },
        });
      },
    }, { label: 'Connect an OAuth login…', icon: 'link', sub: 'Device code', run: () => { const o = ctx.data.oauth.find((x) => x.status !== 'signed_in') || ctx.data.oauth[0]; api?.connect(o.id); } }];
  },
};
