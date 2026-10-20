import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Icon } from '../icons.tsx';
import type { AppModule } from '../app-registry.ts';
import { deskNavigation } from './nav-order.ts';
import { AppLink } from './navigation.tsx';
import { NavBadgeCount } from './NavBadgeCount.tsx';
import { PageHeader } from './PageHeader.tsx';
import { useRegistry } from './registry-context.tsx';

function ModuleRows({ modules }: { modules: AppModule[] }) {
  return (
    <ul className="list panel">
      {modules.map((module) => (
        <li key={module.id}>
          <AppLink className="list-row" to={module.path}>
            <span className="list-row__icon">
              <Icon name={module.icon} />
            </span>
            <span className="list-row__main">
              <span className="list-row__title">{module.title}</span>
              <span className="list-row__sub">{module.summary}</span>
            </span>
            <NavBadgeCount badge={module.badge} />
            <Icon name="chev-r" className="list-row__chev" />
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** Control: every module that is not Today, Talk or Work, in the groups the old sidebar had, with search. A phone's More tab opens it. */
export function Control() {
  const registry = useRegistry();
  const router = useRouter();
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const needle = query.trim().toLowerCase();

  // A search matches every module, the destinations' too; without one, Control lists the modules that have no destination.
  const { destinations, control } = deskNavigation(registry, []);
  const listed = control.map(({ group, modules }) => ({ id: group.id as string, title: group.title, modules }));
  const everything = [...destinations.map(({ id, title, modules }) => ({ id: id as string, title, modules })), ...listed];
  const sections = needle ? everything.map((section) => ({ ...section, modules: section.modules.filter((m) => `${m.title} ${m.summary}`.toLowerCase().includes(needle)) })) : listed;
  const shown = sections.filter((section) => section.modules.length > 0);

  const search = (value: string) => {
    setQuery(value);
    // List state lives in the URL (information architecture §7); typing does not add history entries.
    const params = new URLSearchParams(location.search);
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    const text = params.toString();
    router.history.replace(`${location.pathname}${text ? `?${text}` : ''}`);
  };

  return (
    <div className="control">
      <PageHeader title="Control" subtitle="Everything that is not Today, Talk or Work." />
      <div className="control__search">
        <label className="sr-only" htmlFor="control-q">
          Search modules
        </label>
        <div className="input-wrap">
          <Icon name="search" />
          <input id="control-q" className="input" type="search" placeholder="Search modules" value={query} autoComplete="off" onChange={(event) => search(event.target.value)} />
        </div>
      </div>
      <div className="control__results" aria-live="polite">
        {shown.length === 0 && (
          <div className="empty">
            <div className="empty__icon">
              <Icon name="search" />
            </div>
            <h3>No module matches</h3>
            <p>Nothing is called “{query.trim()}”.</p>
          </div>
        )}
        {shown.map((section) => (
          <section key={section.id} className="control__group" aria-labelledby={`control-${section.id}`}>
            <h2 className="overline" id={`control-${section.id}`}>
              {section.title}
            </h2>
            <ModuleRows modules={section.modules} />
          </section>
        ))}
      </div>
    </div>
  );
}
