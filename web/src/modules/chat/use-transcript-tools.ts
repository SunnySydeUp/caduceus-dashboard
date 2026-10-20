// The transcript's tools as the conversation screen uses them (M1 #15): which roles are shown, search inside the transcript with next and
// previous, and expand all / collapse all. The logic is `transcript-tools.ts`; this holds the state and ties it to the screen: a match is
// scrolled to, the card that holds it opens, and a search reads the whole chat first (a window opened at a search hit holds a part of it).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardControl } from './ActivityCards.tsx';
import type { Chat, ChatMessage } from './chat-session.ts';
import { ALL_ROLES, filterItems, findMatches, findUnits, firstAtOrAfter, indexOfMatch, matchId, stepMatch, type FindUnit, type MatchId, type Role, type RoleSet, type TranscriptEntry } from './transcript-tools.ts';
import type { FindView } from './use-find-highlights.ts';

export interface TranscriptTools<T extends TranscriptEntry> {
  /** The entries the role filters leave. */
  shown: T[];
  roles: RoleSet;
  setRole(role: Role, on: boolean): void;
  find: {
    open: boolean;
    query: string;
    setQuery(next: string): void;
    /** How many matches, and the number (from 1) of the one the reader is at; none until there is a match. */
    count: number;
    position: number | undefined;
    step(direction: 1 | -1): void;
    /** The whole chat is being read from Hermes so that the search covers it. */
    loading: boolean;
    show(): void;
    hide(): void;
  };
  /** For the highlighter in the transcript; undefined when the search is closed. */
  view: FindView | undefined;
  /** For the cards. */
  cards: CardControl;
  expandAll(open: boolean): void;
}

export interface TranscriptToolsOptions<T extends TranscriptEntry> {
  items: readonly T[];
  chat: Pick<Chat, 'loadAll'> | undefined;
  /** The chat holds only part of the transcript (Hermes has more before or after what is loaded). */
  partial: boolean;
  /** The words to search for as the chat opens (a search hit's query): the search starts open, at the first match at or after `focusKey`. */
  initialQuery: string | undefined;
  focusKey: string | undefined;
  /** Scrolls to an item of the transcript. */
  onJump(key: string): void;
}

export function useTranscriptTools<T extends TranscriptEntry>({ items, chat, partial, initialQuery, focusKey, onJump }: TranscriptToolsOptions<T>): TranscriptTools<T> {
  const [roles, setRoles] = useState<RoleSet>(ALL_ROLES);
  const shown = useMemo(() => filterItems(items, roles), [items, roles]);
  const [open, setOpen] = useState(initialQuery !== undefined);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [at, setAt] = useState<MatchId>();
  const [nonce, setNonce] = useState(0);
  const [reveal, setReveal] = useState<CardControl['reveal']>();
  const [command, setCommand] = useState<CardControl['command']>();

  // A new hit's words in the address of a chat that is already open replace the search.
  useEffect(() => {
    if (initialQuery === undefined) return;
    setQuery(initialQuery);
    setOpen(true);
    setAt(undefined);
  }, [initialQuery]);

  // The searchable words of a message are worked out once: the transcript changes with every chunk of a reply, and most of it did not.
  const known = useRef(new WeakMap<ChatMessage, FindUnit[]>());
  const units = useMemo(
    () =>
      !open
        ? []
        : shown.flatMap((entry) => {
            let found = known.current.get(entry.message);
            if (!found) known.current.set(entry.message, (found = findUnits([entry])));
            return found;
          }),
    [open, shown],
  );
  const matches = useMemo(() => findMatches(units, query), [units, query]);
  const index = indexOfMatch(units, matches, at);

  const select = (position: number | undefined) => {
    const match = position === undefined ? undefined : matches[position];
    if (!match) return;
    const id = matchId(units, match);
    setAt(id);
    setNonce((n) => n + 1);
    if (id.cardKey !== undefined) setReveal({ cardKey: id.cardKey, nonce: nonce + 1 });
    onJump(id.itemKey);
  };
  const selectRef = useRef(select);
  selectRef.current = select;

  // A search that has no place yet (it was just typed, or the match it was at is gone) goes to the first match at or after the message it was opened from.
  useEffect(() => {
    if (!open || matches.length === 0) {
      if (at !== undefined && matches.length === 0) setAt(undefined);
      return;
    }
    if (index === undefined) selectRef.current(firstAtOrAfter(units, matches, shown, focusKey));
    // Only the matches decide; `select` reads the latest of everything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matches]);

  // A search covers the whole chat: what Hermes holds beyond the loaded window is read first.
  const loadedAll = useRef<unknown>(undefined);
  useEffect(() => {
    if (!open || !partial || !chat || loadedAll.current === chat) return;
    loadedAll.current = chat;
    void chat.loadAll();
  }, [open, partial, chat]);

  return {
    shown,
    roles,
    setRole: (role, on) => setRoles((was) => ({ ...was, [role]: on })),
    find: {
      open,
      query,
      setQuery,
      count: matches.length,
      position: index === undefined ? undefined : index + 1,
      step: (direction) => select(stepMatch(index, matches.length, direction)),
      loading: open && partial,
      show: () => setOpen(true),
      hide: () => {
        setOpen(false);
        setAt(undefined);
        setReveal(undefined);
      },
    },
    view: open && query.trim() !== '' ? { query, at, nonce } : undefined,
    cards: { command, reveal },
    expandAll: (all) => setCommand((was) => ({ open: all, nonce: (was?.nonce ?? 0) + 1 })),
  };
}
