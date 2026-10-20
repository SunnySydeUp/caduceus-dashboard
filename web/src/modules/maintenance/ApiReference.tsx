// System › Maintenance › API reference (M5 #13): every REST operation and gateway method Caduceus was built against, read from the contracts it pins (never from
// Hermes's own docs pages), each with the risk tier Caduceus gives it. Read-only.
import { useEffect, useMemo, useState } from 'react';
import type { ApiReference as Reference } from '@caduceus/contracts/caduceus-api';
import { Term } from '../../shell/Term.tsx';
import { filterReference, referenceGroups, type ReferenceFilter } from './api-reference-model.ts';
import { MaintenanceFrame } from './MaintenanceFrame.tsx';
import './maintenance.css';

/** How many entries show before the owner asks for more: there are hundreds. */
const PAGE = 60;

const TIER_LABEL: Record<string, string> = { T0: 'Tier 0', T1: 'Tier 1', T2: 'Tier 2', T3: 'Tier 3', denied: 'Denied' };

export function ApiReference() {
  const [reference, setReference] = useState<Reference>();
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<ReferenceFilter>({ query: '', tier: 'all', kind: 'all' });
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    void fetch('/_caduceus/api/maintenance/api-reference')
      .then((res) => (res.ok ? (res.json() as Promise<Reference>) : Promise.reject(new Error(String(res.status)))))
      .then(setReference)
      .catch(() => setFailed(true));
  }, []);

  const matches = useMemo(() => (reference ? filterReference([...reference.rest, ...reference.gateway], filter) : []), [reference, filter]);
  const groups = useMemo(() => referenceGroups(matches.slice(0, shown)), [matches, shown]);
  const change = (next: Partial<ReferenceFilter>) => {
    setFilter((before) => ({ ...before, ...next }));
    setShown(PAGE);
  };

  return (
    <MaintenanceFrame tab="api" subtitle={reference ? `Pinned from Hermes ${reference.version}` : 'The contracts Caduceus was built against'}>
      <p className="help-text">
        Every operation Caduceus knows, with the <Term id="risk-tiers">tier</Term> it gives it. Anything not listed is denied. This is read from the pinned contracts, not from Hermes.
      </p>
      <div className="mt-bar">
        <input className="input mt-search" type="search" value={filter.query} onChange={(event) => change({ query: event.target.value })} placeholder="Search by path, method, name or words" aria-label="Search the API reference" />
        <select className="input" value={filter.kind} onChange={(event) => change({ kind: event.target.value as ReferenceFilter['kind'] })} aria-label="Which interface">
          <option value="all">REST and gateway</option>
          <option value="rest">REST</option>
          <option value="gateway">Gateway</option>
        </select>
        <select className="input" value={filter.tier} onChange={(event) => change({ tier: event.target.value as ReferenceFilter['tier'] })} aria-label="Which tier">
          <option value="all">Every tier</option>
          {Object.entries(TIER_LABEL).map(([tier, label]) => (
            <option key={tier} value={tier}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {failed && <p role="alert">Caduceus did not give the reference. Try again in a moment.</p>}
      {!reference && !failed && <p role="status">Loading…</p>}
      {reference && (
        <>
          <p className="mt-note" role="status">
            {matches.length} {matches.length === 1 ? 'entry' : 'entries'}
          </p>
          {groups.map(({ group, entries }) => (
            <section key={group} className="mt-news" aria-label={group}>
              <h2 className="mt-section__title">{group}</h2>
              <ul className="mt-ref">
                {entries.map((entry) => (
                  <li key={`${entry.method} ${entry.name}`} className="mt-ref__row">
                    <span className="mt-ref__method">{entry.method}</span>
                    <code className="mt-code mt-ref__name">{entry.name}</code>
                    <span className="mt-badge" data-tone={entry.tier === 'denied' ? 'danger' : entry.tier === 'T0' ? 'success' : 'warning'}>
                      {TIER_LABEL[entry.tier]}
                      {entry.read && entry.tier !== 'T0' ? ' · read' : ''}
                    </span>
                    {entry.summary && <span className="mt-note mt-ref__summary">{entry.summary}</span>}
                    {entry.params && entry.params.length > 0 && <span className="mt-note mt-ref__summary">Parameters: {entry.params.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {matches.length > shown && (
            <button type="button" className="btn btn--secondary" onClick={() => setShown((before) => before + PAGE)}>
              Show more
            </button>
          )}
        </>
      )}
    </MaintenanceFrame>
  );
}
