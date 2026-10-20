// More (IA §2): grouped, searchable list of every module not in the tab bar.
import { html, icon, pageHeader, emptyState, modules, navGroups, fuzzy } from '../shared.js';

const ORDER = ['agents', 'connect', 'workspace', 'observe', 'system', 'settings'];

function rows(ctx, list) {
  return html`<ul class="list panel">${list.map((m) => html`<li><a class="list-row" href="${ctx.href(m.path)}" data-name="${m.title}">
    <span class="list-row__icon">${icon(m.icon)}</span>
    <span class="list-row__main"><span class="list-row__title">${m.title}</span><span class="list-row__sub">${m.summary}</span></span>
    ${icon('chev-r', 'list-row__chev')}
  </a></li>`)}</ul>`;
}
function groups(ctx, q) {
  const pool = q ? modules : modules.filter((m) => ORDER.includes(m.group));
  const scored = q
    ? pool.map((m) => ({ m, s: Math.max(fuzzy(q, m.title) * 2, `${m.summary} ${m.contents.join(' ')}`.toLowerCase().includes(q.toLowerCase()) ? 300 : -1) })).filter((x) => x.s > 0)
    : pool.map((m) => ({ m, s: 0 }));
  if (!scored.length) return emptyState({ icon: 'search', title: 'No module matches', body: `Nothing called “${q}”. The command palette also searches sessions, tasks and settings.` });
  const order = q ? [...new Set(['top', 'work', ...ORDER])] : ORDER;
  return html`${order.map((gid) => {
    const list = scored.filter((x) => x.m.group === gid).sort((a, b) => b.s - a.s).map((x) => x.m);
    if (!list.length) return '';
    const g = navGroups.find((x) => x.id === gid);
    const title = g?.title || (gid === 'settings' ? 'Settings' : 'Main');
    return html`<section class="more__group" aria-labelledby="mg-${gid}"><h2 class="overline" id="mg-${gid}">${title}</h2>${rows(ctx, list)}</section>`;
  })}`;
}

export default {
  routes: ['/more'],
  title: 'More',
  group: 'top',
  render(ctx) {
    const q = ctx.query.q || '';
    return html`<div class="more">
      ${pageHeader({ title: 'More', subtitle: 'Agents, connections, workspace, observability and system settings.' })}
      <div class="more__search">
        <label class="sr-only" for="more-q">Search modules</label>
        <div class="input-wrap">${icon('search')}<input id="more-q" class="input" type="search" placeholder="Search modules" value="${q}" autocomplete="off"></div>
      </div>
      <div class="more__results" data-results aria-live="polite">${groups(ctx, q)}</div>
    </div>`;
  },
  mount(root, ctx) {
    const input = root.querySelector('#more-q');
    const out = root.querySelector('[data-results]');
    input.addEventListener('input', () => {
      out.innerHTML = String(groups(ctx, input.value.trim()));
      // keep the query in the URL without a history entry (list state lives in the URL, IA §7)
      const q = new URLSearchParams(ctx.query);
      if (input.value.trim()) q.set('q', input.value.trim()); else q.delete('q');
      const s = q.toString();
      history.replaceState(history.state, '', `#/more${s ? '?' + s : ''}`);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = out.querySelector('a'); if (first) { e.preventDefault(); first.click(); } }
    });
  },
};
