import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { searchCatalogue, type CatalogueModel, type CatalogueProvider, type ModelChoice, type ProviderState } from './model-catalogue.ts';
import { useModelCatalogue } from './model-data.ts';
import './models.css';

export interface ModelPickerProps {
  /** The profile whose catalogue and credentials the list is for. */
  profile: string;
  /** What the profile uses now: it is marked in the list. */
  value?: ModelChoice;
  /** Adds a first choice that puts the slot back on auto (an auxiliary slot); `selected` marks it as the current one. */
  auto?: { label: string; selected: boolean; choice: ModelChoice };
  /** Providers that do not belong in this list (Mixture-of-Agents cannot serve an auxiliary slot). */
  hideProviders?: readonly string[];
  /** The owner chose a model. The picker stays open and shows it is busy until the promise settles: the host closes it when the choice took. */
  onPick(choice: ModelChoice): void | Promise<void>;
}

const STATE_WORDS: Record<ProviderState, string | undefined> = {
  ready: undefined,
  'needs-setup': 'Needs setup',
  'no-models': 'No models listed',
  'saved-list': 'Saved list',
};

function ModelRow({ provider, model, selected, busy, onPick }: { provider: CatalogueProvider; model: CatalogueModel; selected: boolean; busy: boolean; onPick(): void }) {
  const locked = model.badges.some((badge) => badge.id === 'locked');
  return (
    <li>
      <button type="button" className="mp-model" aria-current={selected ? 'true' : undefined} disabled={busy || locked} onClick={onPick}>
        <span className="mp-model__main">
          <span className="mp-model__id mono truncate">{model.id}</span>
          {model.price && !model.badges.some((badge) => badge.id === 'free') && (
            <span className="mp-model__price subtle">
              {model.price.input} in{model.price.output ? ` · ${model.price.output} out` : ''} per million tokens
            </span>
          )}
          <span className="mp-model__badges">
            {model.badges.map((badge) => (
              <span key={badge.id} className="tag" data-tone={badge.id === 'locked' ? 'warning' : badge.id === 'free' ? 'success' : 'neutral'}>
                {badge.label}
              </span>
            ))}
          </span>
        </span>
        {selected && (
          <span className="mp-model__now tag" data-tone="accent">
            <Icon name="check" small />
            In use
          </span>
        )}
        <span className="sr-only">{`, from ${provider.name}`}</span>
      </button>
    </li>
  );
}

function ProviderGroup({ provider, value, busy, searching, onPick, headingLevel = 3 }: { provider: CatalogueProvider; value: ModelChoice | undefined; busy: boolean; searching: boolean; onPick(choice: ModelChoice): void; headingLevel?: 3 | 4 }) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as 'h3';
  const word = STATE_WORDS[provider.state];
  return (
    <section className="mp-group" aria-labelledby={headingId}>
      <Heading id={headingId} className="mp-group__title">
        <span className="truncate">{provider.name}</span>
        {provider.isCurrent && (
          <span className="tag" data-tone="accent">
            Current provider
          </span>
        )}
        {word && (
          <span className="tag" data-tone={provider.state === 'needs-setup' ? 'neutral' : 'warning'}>
            {word}
          </span>
        )}
      </Heading>
      {provider.note && <p className="mp-group__note subtle">{provider.note}</p>}
      {provider.models.length > 0 && (
        <ul className="mp-models">
          {provider.models.map((model) => (
            <ModelRow
              key={model.id}
              provider={provider}
              model={model}
              selected={value?.provider === provider.slug && value.model === model.id}
              busy={busy}
              onPick={() => onPick({ provider: provider.slug, model: model.id })}
            />
          ))}
        </ul>
      )}
      {provider.unlisted > 0 && !searching && (
        <p className="mp-group__note subtle">
          Hermes has {provider.unlisted} more models for {provider.name} than this list shows.
        </p>
      )}
    </section>
  );
}

/**
 * The shared model picker (M4 #03): Hermes's live catalogue for a profile with search, grouping by provider, capability badges and
 * a Refresh. It only reads Hermes and reports the choice; the screen that uses it (Models, the composer chip, the brief editor, the
 * profile builder) sets the model through its own tiered request. A provider whose models Hermes could not list or check, or that
 * has no credential, is labelled and never hidden, and when Hermes stops answering the last list it gave stays, said to be the last.
 */
export function ModelPicker({ profile, value, auto, hideProviders = [], onPick }: ModelPickerProps) {
  const { catalogue, failed, loading, reload } = useModelCatalogue(profile);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const searchId = useId();
  const root = useRef<HTMLDivElement>(null);

  /** The arrow keys walk the search box and the models, in the order they are listed; Enter on a model picks it (it is a button). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const stops = [...(root.current?.querySelectorAll<HTMLElement>('input[type="search"], .mp-model:not(:disabled)') ?? [])];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next = stops[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const providers = useMemo(() => (catalogue ? searchCatalogue({ ...catalogue, providers: catalogue.providers.filter((p) => !hideProviders.includes(p.slug)) }, query) : []), [catalogue, hideProviders, query]);
  const usable = providers.filter((provider) => provider.state !== 'needs-setup');
  const unconfigured = providers.filter((provider) => provider.state === 'needs-setup');

  const choose = async (choice: ModelChoice) => {
    setBusy(true);
    try {
      await onPick(choice);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp" ref={root} onKeyDown={onKeyDown}>
      <div className="mp-bar">
        <div className="input-wrap mp-search">
          <Icon name="search" />
          <input id={searchId} className="input" type="search" placeholder="Search models and providers" aria-label="Search models and providers" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button type="button" className="btn btn--secondary" aria-busy={loading} disabled={loading} onClick={() => void reload({ live: true })}>
          <Icon name="refresh" />
          Refresh
        </button>
      </div>
      <p className="mp-hint subtle" role="status">
        {loading ? 'Asking Hermes for its models…' : 'From Hermes’s live catalogue. Refresh asks every provider again.'}
      </p>
      {failed && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <div className="banner__title">Hermes did not answer</div>
            <div className="banner__body">{catalogue ? 'This is the last list Hermes gave. It may be out of date.' : 'The model list could not be loaded.'}</div>
          </div>
          <div className="banner__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </div>
      )}
      {auto && (
        <ul className="mp-models">
          <li>
            <button type="button" className="mp-model" aria-current={auto.selected ? 'true' : undefined} disabled={busy} onClick={() => void choose(auto.choice)}>
              <span className="mp-model__main">
                <span className="mp-model__id">{auto.label}</span>
                <span className="subtle">Hermes chooses the model.</span>
              </span>
              {auto.selected && (
                <span className="mp-model__now tag" data-tone="accent">
                  <Icon name="check" small />
                  In use
                </span>
              )}
            </button>
          </li>
        </ul>
      )}
      {!catalogue && !failed && <p role="status">Loading models…</p>}
      {catalogue && providers.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="search" />
          </span>
          <p>{query ? `No model or provider matches “${query}”.` : 'Hermes listed no providers for this profile.'}</p>
        </div>
      )}
      {usable.map((provider) => (
        <ProviderGroup key={provider.slug} provider={provider} value={value} busy={busy} searching={query !== ''} onPick={(choice) => void choose(choice)} />
      ))}
      {unconfigured.length > 0 && (
        <details className="mp-setup" open={query !== ''}>
          <summary>
            Not set up for this profile ({unconfigured.length})
          </summary>
          <p className="subtle mp-hint">
            Hermes knows these providers, but this profile has no credential for them, so it cannot list their models. Add a credential in Hermes (<span className="mono">hermes model</span>), then press Refresh.
          </p>
          {unconfigured.map((provider) => (
            <ProviderGroup key={provider.slug} provider={provider} value={value} busy={busy} searching={query !== ''} onPick={(choice) => void choose(choice)} headingLevel={4} />
          ))}
        </details>
      )}
    </div>
  );
}

/** The picker in a sheet: full height on a phone, with the search focused first; a dialog on a wide screen. */
export function ModelPickerSheet({ title, onClose, ...picker }: ModelPickerProps & { title: string; onClose(): void }) {
  return (
    <Sheet title={title} detents={['full']} initialFocus='input[type="search"]' onClose={onClose}>
      <ModelPicker {...picker} />
    </Sheet>
  );
}
