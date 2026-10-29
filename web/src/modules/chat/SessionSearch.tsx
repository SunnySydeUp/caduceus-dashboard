// Search in the sessions pane (M1 #15): a field at the top of the list, and, while it holds words, the sessions whose messages have them in
// place of the list. Hermes does the searching (its own index; this keeps nothing); each result shows the words around the match, the
// session's title, profile and date, and opens the session at the first message that matches. The query lives in the address (`?q=`).
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { useTakingLonger } from '../../shell/Loading.tsx';
import { readHermes } from './read-hermes.ts';
import { hitPath, hitDetail, searchSessions, type SearchHit } from './session-search.ts';
import { sourceIcon } from './sessions-model.ts';

/** How long the typing pauses before Hermes is asked (each search is a request to it). */
const PAUSE_MS = 250;

export interface SearchState {
  hits: SearchHit[];
  /** Hermes is being asked. */
  searching: boolean;
  /** Why the last search failed, in Hermes's words. */
  error: string | undefined;
  /** The query the hits answer. */
  answered: string;
  /** The owner stopped waiting for this query: Hermes is not asked again until they say so. */
  cancelled: boolean;
  /** Stops waiting for Hermes's answer. */
  cancel(): void;
  /** Asks again after a cancel. */
  retry(): void;
}

/** Hermes's hits for what is typed, once the typing pauses; an answer for an earlier query is dropped. Nothing is asked for a blank query. */
export function useSessionSearch(profile: string, query: string): SearchState {
  const [state, setState] = useState<Omit<SearchState, 'cancel' | 'retry'>>({ hits: [], searching: false, error: undefined, answered: '', cancelled: false });
  const [round, setRound] = useState(0);
  const request = useRef<AbortController>(undefined);
  const wanted = query.trim();
  useEffect(() => {
    if (wanted === '') {
      setState((was) => (was.hits.length === 0 && !was.searching && was.error === undefined && !was.cancelled ? was : { hits: [], searching: false, error: undefined, answered: '', cancelled: false }));
      return;
    }
    let current = true;
    const abort = new AbortController();
    request.current = abort;
    setState((was) => ({ ...was, searching: true, cancelled: false }));
    const timer = setTimeout(() => {
      searchSessions((path) => readHermes(path, abort.signal), wanted, { profile }).then(
        (hits) => current && setState({ hits, searching: false, error: undefined, answered: wanted, cancelled: false }),
        (error: unknown) => current && !abort.signal.aborted && setState((was) => ({ ...was, searching: false, error: error instanceof Error ? error.message : String(error), answered: wanted })),
      );
    }, PAUSE_MS);
    return () => {
      current = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [profile, wanted, round]);
  return {
    ...state,
    cancel: () => {
      request.current?.abort();
      setState((was) => ({ ...was, searching: false, cancelled: true }));
    },
    retry: () => setRound((count) => count + 1),
  };
}

/** The field. It holds what is typed at once and tells the address after a pause, so that typing never waits for the router. */
export function SearchField({ query, onQuery, onDown }: { query: string; onQuery(next: string): void; onDown(): void }) {
  const [typed, setTyped] = useState(query);
  const sent = useRef(query);
  // A query that arrives from outside (a link, Back) replaces what is typed.
  useEffect(() => {
    if (query !== sent.current) {
      sent.current = query;
      setTyped(query);
    }
  }, [query]);
  useEffect(() => {
    if (typed === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = typed;
      onQuery(typed);
    }, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed, onQuery]);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onDown();
    } else if (event.key === 'Escape' && typed !== '') {
      event.preventDefault();
      event.stopPropagation();
      sent.current = '';
      setTyped('');
      onQuery('');
    }
  };
  return (
    <form className="sl__search input-wrap" role="search" onSubmit={(event) => event.preventDefault()}>
      <Icon name="search" />
      <input
        type="search"
        className="input sl__search-input"
        aria-label="Search messages in all sessions"
        placeholder="Search messages…"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </form>
  );
}

/** The snippet Hermes cut, with the words the query matched marked. */
function Snippet({ hit }: { hit: SearchHit }) {
  return (
    <span className="sl__snippet">
      {hit.snippet.map((part, index) => (part.match ? <mark key={index} className="sl__match">{part.text}</mark> : <Fragment key={index}>{part.text}</Fragment>))}
    </span>
  );
}

/** The results, in place of the list. ↑ and ↓ move between them (↑ from the first goes back to the field); each is a link. */
export function SearchResults({ state, query, profile, now }: { state: SearchState; query: string; profile: string; now: number }) {
  const list = useRef<HTMLUListElement>(null);
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...(list.current?.querySelectorAll<HTMLElement>('a') ?? [])];
    const at = links.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    if (event.key === 'ArrowUp' && at <= 0) document.querySelector<HTMLInputElement>('.sl__search-input')?.focus();
    else links[Math.min(links.length - 1, event.key === 'ArrowDown' ? at + 1 : at - 1)]?.focus();
  };
  const { hits, searching, error, answered, cancelled } = state;
  const wanted = query.trim();
  const fresh = answered === wanted;
  const waiting = searching && !fresh;
  const late = useTakingLonger(waiting);
  const stopped = cancelled && !fresh;
  return (
    <div className="sl__results" aria-busy={waiting}>
      <p className="subtle sl__status" role="status">
        {error !== undefined || stopped ? '' : waiting ? (late ? `Still searching ${profile}… Hermes is slow to answer.` : `Searching ${profile}…`) : `${hits.length === 0 ? 'No' : hits.length} session${hits.length === 1 ? '' : 's'} in ${profile} ${hits.length === 0 ? 'has' : hits.length === 1 ? 'has' : 'have'} “${answered}”`}
      </p>
      {late && waiting && (
        <button type="button" className="btn btn--ghost btn--sm sl__action" onClick={state.cancel}>
          Cancel
        </button>
      )}
      {stopped && (
        <>
          <p className="subtle sl__status" role="status">
            Search stopped.
          </p>
          <button type="button" className="btn btn--secondary btn--sm sl__action" onClick={state.retry}>
            Search again
          </button>
        </>
      )}
      {error !== undefined && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>Hermes did not answer the search</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {hits.length > 0 && (
        <ul ref={list} className="sl__hits" aria-label="Search results" onKeyDown={move}>
          {hits.map((hit) => (
            <li key={`${hit.profile}/${hit.sessionId}`}>
              <AppLink className="sl__row sl__hit" to={hitPath(hit, answered)} data-session-id={hit.sessionId}>
                <span className="sl__icon" aria-hidden="true">
                  <Icon name={sourceIcon(hit.source ?? '')} small />
                </span>
                <span className="sl__main">
                  <span className="sl__title">{hit.title}</span>
                  <Snippet hit={hit} />
                  <span className="sl__sub">
                    <span className="tag">{hit.profile}</span>
                    <span>{hitDetail(hit, now)}</span>
                  </span>
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
