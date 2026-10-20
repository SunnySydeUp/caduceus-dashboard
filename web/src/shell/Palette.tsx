import { Fragment, useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Icon } from '../icons.tsx';
import { Layer } from '../overlays/Layer.tsx';
import { highlightSegments, hitEntries, paletteEntries, paletteStep, rankEntries, resultsAnnouncement, withHits, type PaletteEntry, type PaletteState } from '../palette.ts';
import { Keycaps, useKeyboard } from './keyboard-context.tsx';
import { useRouteInfo } from './navigation.tsx';
import { useProfileScope } from './profile-context.tsx';
import { useHelpLoaded, useRegistry } from './registry-context.tsx';
import { useSizeClass } from './use-size-class.ts';

/** How long the typing pauses before a module is asked to search (each search is a request to Hermes). */
const SEARCH_PAUSE_MS = 250;

/** An entry's label with the characters the query matched marked. */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  return (
    <>
      {highlightSegments(text, positions).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="palette__match">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The command palette (information architecture §8), opened with ⌘K or Ctrl+K or the app bar's search button: a
 * full-screen sheet on phones, a card near the top elsewhere. It lists every route and module action, ranked by fuzzy
 * match, with the current screen's actions first. Focus stays in the search field; ↑ ↓ move the active result, ↵ runs it
 * and Esc closes. The shell reads only the module registry, so a module that registers shows up here with no change.
 */
export function Palette({ onClose, onRun }: { onClose(): void; onRun(entry: PaletteEntry): void }) {
  const registry = useRegistry();
  const { keymap } = useKeyboard();
  const { moduleId } = useRouteInfo();
  const compact = useSizeClass() === 'compact';
  const listId = useId();
  const [state, setState] = useState<PaletteState>({ query: '', active: 0 });

  // Help pages and glossary terms are searched too; they load as the palette opens (usually they already have) and the list grows when they do.
  const helpLoaded = useHelpLoaded();
  useEffect(() => void registry.loadHelp(), [registry]);
  const entries = useMemo(() => paletteEntries(registry, moduleId, keymap), [registry, moduleId, keymap, helpLoaded]);
  // A module that searches (Chat: the words inside sessions) is asked for what was typed once the typing pauses; an answer for an earlier query is dropped.
  const profile = useProfileScope().effective?.name;
  const [found, setFound] = useState<{ query: string; entries: PaletteEntry[] }>({ query: '', entries: [] });
  useEffect(() => {
    const query = state.query.trim();
    const searches = registry.paletteSearches();
    if (query === '' || searches.length === 0) {
      setFound((was) => (was.entries.length === 0 ? was : { query: '', entries: [] }));
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all(searches.map(({ moduleId, search }) => search(query, { profile, signal: abort.signal }).then((hits) => hitEntries(hits, moduleId), () => [] as PaletteEntry[]))).then((groups) => {
        if (!abort.signal.aborted) setFound({ query, entries: groups.flat() });
      });
    }, SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [registry, state.query, profile]);
  const results = useMemo(() => withHits(rankEntries(entries, state.query), found.query === state.query.trim() ? found.entries : []), [entries, state.query, found]);
  const active = results[state.active];
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    document.getElementById(optionId(state.active))?.scrollIntoView({ block: 'nearest' });
    // The option ids only depend on `listId`, which never changes.
  }, [state.active]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const step = paletteStep(state, { type: 'key', key: event.key }, results.length);
    if (step.state === state && !step.outcome) return;
    event.preventDefault();
    setState(step.state);
    if (step.outcome === 'run' && active) onRun(active.entry);
  };

  return (
    <Layer
      kind="palette"
      className={compact ? 'layer--palette-full' : undefined}
      panelClassName={`palette${compact ? ' palette--full' : ''}`}
      label="Command palette"
      initialFocus="input"
      onClose={onClose}
    >
      <div className="palette__input">
        <Icon name="search" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(state.active) : undefined}
          aria-label="Search pages, actions and help"
          placeholder="Search or jump to…"
          autoComplete="off"
          spellCheck={false}
          value={state.query}
          onChange={(event) => setState(paletteStep(state, { type: 'query', query: event.target.value }, results.length).state)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close search" onClick={onClose} data-close>
          <Icon name="x" />
        </button>
      </div>
      <p className="sr-only" role="status">
        {resultsAnnouncement(results.length)}
      </p>
      <div className="palette__list" role="listbox" id={listId} aria-label="Results" data-body>
        {results.length === 0 && (
          <div className="empty">
            <div className="empty__icon">
              <Icon name="search" />
            </div>
            <h3>No match</h3>
            <p>Nothing is called “{state.query.trim()}”. Try a page name, an action or a word from the help.</p>
          </div>
        )}
        {results.map(({ entry, positions }, index) => (
          <Fragment key={`${entry.group}:${entry.label}:${index}`}>
            {(index === 0 || results[index - 1].entry.group !== entry.group) && (
              <p className="overline palette__group" role="presentation">
                {entry.group}
              </p>
            )}
            <div id={optionId(index)} role="option" aria-selected={index === state.active} className="palette__item" onClick={() => onRun(entry)} onPointerMove={() => state.active !== index && setState({ ...state, active: index })}>
              <Icon name={entry.icon} />
              <span className="grow">
                <span className="palette__label">
                  <Highlighted text={entry.label} positions={positions} />
                </span>
                {entry.sub && <span className="palette__sub">{entry.sub}</span>}
                {entry.snippet && (
                  <span className="palette__snippet">
                    {entry.snippet.map((part, at) => (part.match ? <mark key={at} className="palette__match">{part.text}</mark> : <Fragment key={at}>{part.text}</Fragment>))}
                  </span>
                )}
              </span>
              {entry.tier && entry.tier !== 'T0' && <span className="tag">Tier {entry.tier.slice(1)}</span>}
              {entry.shortcut && <Keycaps binding={entry.shortcut} />}
            </div>
          </Fragment>
        ))}
      </div>
      <div className="palette__foot">
        <span>
          <span className="kbds">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
          </span>{' '}
          move
        </span>
        <span>
          <span className="kbds">
            <kbd>↵</kbd>
          </span>{' '}
          open
        </span>
        <span>
          <span className="kbds">
            <kbd>Esc</kbd>
          </span>{' '}
          close
        </span>
      </div>
    </Layer>
  );
}
