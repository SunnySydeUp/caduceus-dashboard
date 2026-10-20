// System › Plugins › Catalogue: Hermes's curated plugins, each with what it does, what it adds and what it asks for. Search, a category and an
// installed filter narrow it; Install opens the sheet that shows the entry's facts and confirms. The list comes from Hermes each time.
import { useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { capabilityWords } from './InstallSheet.tsx';
import { categoriesOf, filterCatalogue, type Catalogue, type CatalogueEntry, type CatalogueFilter } from './plugins-model.ts';
import './plugins.css';

const SHOW = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Not installed' },
  { value: 'installed', label: 'Installed' },
] as const satisfies readonly { value: CatalogueFilter['show']; label: string }[];

/** How many entries show before the owner asks for more: the catalogue holds hundreds. */
const PAGE = 24;

function EntryCard({ entry, onInstall }: { entry: CatalogueEntry; onInstall(entry: CatalogueEntry): void }) {
  const adds = capabilityWords(entry.capabilities);
  return (
    <li className="pl-card" data-entry={entry.name}>
      <div className="pl-card__top">
        <div className="pl-card__id">
          <h3 className="pl-card__name">{entry.name}</h3>
          <p className="pl-card__sub">
            {entry.category} · {entry.maintainer || 'unknown maintainer'}
          </p>
        </div>
        {entry.installed ? <StatusBadge state="succeeded" label={entry.updateAvailable ? 'Installed, update pinned' : 'Installed'} variant="plain" /> : <span className="tag">{entry.tier === 'official' ? 'Official' : 'Community'}</span>}
      </div>
      <p className="pl-card__desc">{entry.description}</p>
      {adds && <p className="pl-card__sub">{adds}</p>}
      <div className="pl-card__actions">
        {!entry.installed && (
          <WriteButton type="button" className="btn btn--secondary btn--sm" aria-label={`Install ${entry.name}`} onClick={() => onInstall(entry)}>
            <Icon name="download" small />
            Install
          </WriteButton>
        )}
      </div>
    </li>
  );
}

export function CataloguePanel({ catalogue, failed, retry, onInstall }: { catalogue: Catalogue | undefined; failed: boolean; retry(): void; onInstall(entry: CatalogueEntry): void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [show, setShow] = useState<CatalogueFilter['show']>('all');
  const [pages, setPages] = useState(1);
  const entries = catalogue?.entries ?? [];
  const categories = useMemo(() => categoriesOf(entries), [entries]);
  const filtered = useMemo(() => filterCatalogue(entries, { query, category, show }), [entries, query, category, show]);
  const shown = filtered.slice(0, pages * PAGE);

  return (
    <div className="pl-panel">
      <p className="help-text">
        The <Term id="catalogue">catalogue</Term> is a list Hermes keeps of <Term id="plugin">plugins</Term> it has checked. Each is installed at one pinned commit. Installing runs the plugin’s code on this Mac.
      </p>
      {failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not give the catalogue{catalogue ? ': what shows is from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      <div className="pl-bar">
        <div className="input-wrap pl-search" role="search">
          <Icon name="search" />
          <input
            type="search"
            className="input"
            placeholder="Search the catalogue"
            aria-label="Search the catalogue"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPages(1);
            }}
          />
        </div>
        <div className="field pl-category">
          <label className="sr-only" htmlFor="pl-category">
            Category
          </label>
          <select
            id="pl-category"
            className="input"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPages(1);
            }}
          >
            <option value="all">All categories ({entries.length})</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} ({item.count})
              </option>
            ))}
          </select>
        </div>
        <span id="pl-show-label" className="sr-only">
          Show
        </span>
        <RadioGroup
          labelledBy="pl-show-label"
          className="seg"
          value={show}
          options={SHOW}
          onChange={(value) => {
            setShow(value);
            setPages(1);
          }}
        />
      </div>
      {!catalogue && !failed && <p role="status">Loading the catalogue…</p>}
      {catalogue && filtered.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="package" />
          </span>
          <p>No catalogue plugin matches.</p>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              setQuery('');
              setCategory('all');
              setShow('all');
            }}
          >
            Clear the search
          </button>
        </div>
      )}
      {shown.length > 0 && (
        <>
          <p className="pl-note" role="status">
            {filtered.length === 1 ? '1 plugin' : `${filtered.length} plugins`}
          </p>
          <ul className="pl-cards" aria-label="Catalogue">
            {shown.map((entry) => (
              <EntryCard key={entry.name} entry={entry} onInstall={onInstall} />
            ))}
          </ul>
          {shown.length < filtered.length && (
            <button type="button" className="btn btn--secondary pl-more" onClick={() => setPages((count) => count + 1)}>
              Show {Math.min(PAGE, filtered.length - shown.length)} more
            </button>
          )}
        </>
      )}
    </div>
  );
}
