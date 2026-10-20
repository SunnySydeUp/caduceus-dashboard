// Placeholder for every route without a prototyped screen (and the fallback
// when a wave-2 screen file is missing or throws while loading).
import { html, raw, esc, icon, pageHeader, profileTag, navGroups } from '../shared.js';

const codeify = (s) => raw(esc(s).replace(/`([^`]+)`/g, '<code>$1</code>'));

export default {
  routes: ['*'],
  title: (ctx) => ctx.module.title,
  group: 'any',
  render(ctx) {
    const m = ctx.module;
    if (m.id === 'notfound') {
      return html`<div class="module-page">
        ${pageHeader({ title: 'Page not found', subtitle: 'No Caduceus route matches this address.' })}
        <div class="panel panel--pad"><dl class="kv"><dt>path</dt><dd class="mono">${ctx.path || '/'}</dd></dl></div>
        <div class="toolbar"><a class="btn btn--primary" href="${ctx.href('/home')}">${icon('home')}Go home</a><a class="btn btn--secondary" href="${ctx.href('/more')}">All modules</a></div>
      </div>`;
    }
    const group = navGroups.find((g) => g.id === m.group)?.title;
    const params = Object.entries(ctx.params);
    return html`<div class="module-page">
      ${pageHeader({ overline: group || '', title: m.title, subtitle: m.summary })}
      ${m.profileScoped ? html`<div class="row"><span class="subtle">Scoped to</span>${profileTag(ctx.profile.name)}<span class="subtle">· change it with the profile chip</span></div>` : ''}
      <div class="banner" data-tone="info">${icon('info')}
        <div class="banner__content">
          <div class="banner__title">Not prototyped — see feature-traceability.md</div>
          <div class="banner__body">${ctx.fallback
            ? html`The screen file <span class="mono">screens/${ctx.fallback.file}.js</span> is not available yet, so this placeholder stands in. `
            : ''}Every feature of this module is mapped to its Hermes interface and milestone in the traceability matrix.</div>
          <div class="banner__actions"><a class="btn btn--secondary btn--sm" href="../feature-traceability.md" target="_blank" rel="noopener">${icon('external')}Open feature-traceability.md</a></div>
        </div><span></span>
      </div>
      <section class="section" aria-labelledby="mod-contents">
        <h2 class="section__title" id="mod-contents">What this module contains</h2>
        <ul class="contents panel">${m.contents.map((c) => html`<li>${codeify(c)}</li>`)}</ul>
      </section>
      <section class="section" aria-labelledby="mod-route">
        <h2 class="section__title" id="mod-route">Route</h2>
        <div class="panel panel--pad"><dl class="kv">
          <dt>pattern</dt><dd class="mono">${ctx.route?.path || '—'}</dd>
          <dt>path</dt><dd class="mono">${ctx.path}</dd>
          ${params.map(([k, v]) => html`<dt>:${k}</dt><dd class="mono">${v}</dd>`)}
          ${Object.keys(ctx.query).length ? html`<dt>query</dt><dd class="mono">${new URLSearchParams(ctx.query).toString()}</dd>` : ''}
          <dt>profile scope</dt><dd>${m.crossProfile ? 'Cross-profile (All profiles by default)' : m.profileScoped ? 'Profile-only' : 'Install-wide'}</dd>
        </dl></div>
      </section>
    </div>`;
  },
};
