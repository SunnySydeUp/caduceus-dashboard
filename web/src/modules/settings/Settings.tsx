import { useId, useMemo, useState } from 'react';
import { useHealth } from '../../health.ts';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useRegistry } from '../../shell/registry-context.tsx';
import { indexSettings, searchSettings } from './settings-search.ts';

/** Settings: a search over every setting, and the list of the panels every registered module declares. */
export function Settings() {
  const panels = useRegistry().settingsPanels();
  const index = useMemo(() => indexSettings(panels), [panels]);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSettings(index, query), [index, query]);
  const searching = query.trim() !== '';
  const searchId = useId();
  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle="Choose a section, or search for a setting." />
      <div className="settings-search">
        <label className="sr-only" htmlFor={searchId}>
          Search settings
        </label>
        <input id={searchId} type="search" className="input" placeholder="Search settings" autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {searching ? (
        <>
          <p className="sr-only" role="status">
            {results.length === 0 ? 'No settings match.' : `${results.length} ${results.length === 1 ? 'setting' : 'settings'} found.`}
          </p>
          {results.length === 0 ? (
            <p className="help-text">No setting matches “{query.trim()}”. Try another word, such as “theme”, “password” or “shortcut”.</p>
          ) : (
            <ul className="list panel">
              {results.map((result) => (
                <li key={`${result.panelId}/${result.fieldId}`}>
                  <AppLink className="list-row" to={result.path}>
                    <span className="list-row__main">
                      <span className="list-row__title">{result.label}</span>
                      <span className="list-row__sub">{result.panelTitle}</span>
                    </span>
                    <Icon name="chev-r" className="list-row__chev" />
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <ul className="list panel">
          <RepairsRow />
          {panels.map((panel) => (
            <li key={`${panel.moduleId}:${panel.id}`}>
              <AppLink className="list-row" to={panel.path}>
                <span className="list-row__icon">
                  <Icon name={panel.icon} />
                </span>
                <span className="list-row__main">
                  <span className="list-row__title">{panel.title}</span>
                  <span className="list-row__sub">{panel.summary}</span>
                </span>
                <Icon name="chev-r" className="list-row__chev" />
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settings' first row: how many Repairs are open, from the same live report Health shows, and the way to Health. */
function RepairsRow() {
  const { report, unreachable } = useHealth();
  const open = report?.repairs.length;
  const worst = report?.repairs[0];
  return (
    <li>
      <AppLink className="list-row" to="/observe/health">
        <span className="list-row__icon">
          <Icon name="tool" />
        </span>
        <span className="list-row__main">
          <span className="list-row__title">Repairs</span>
          <span className="list-row__sub" role="status">
            {open === undefined
              ? unreachable
                ? 'Caduceus could not be reached to count them.'
                : 'Counting…'
              : open === 0
                ? 'Nothing to repair.'
                : `${open === 1 ? '1 open Repair' : `${open} open Repairs`}. The worst: ${worst?.title}.`}
          </span>
        </span>
        {open !== undefined && open > 0 && (
          <span className="count" aria-hidden="true">
            {open}
          </span>
        )}
        <Icon name="chev-r" className="list-row__chev" />
      </AppLink>
    </li>
  );
}
