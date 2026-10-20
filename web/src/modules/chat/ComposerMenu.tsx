// The menu above the message box (M1 #09): slash commands from Hermes's catalogue (`/`), the arguments Hermes completes after one, and path references
// (`@` and `~/`) from Hermes's file listing. One listbox for all three: the textarea keeps the focus, ↑ ↓ move, Enter or Tab choose, Escape closes, and a
// tap or click chooses too. The words of every row are Hermes's; the rules (what filters, what is denied, what a choice writes) are in `slash-menu.ts` and
// `path-reference.ts`. A screen reader hears the highlighted row from a live region, since the textarea is not a combobox.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CompletionItem } from '@caduceus/contracts/hermes/gateway';
import { applyPath, listingPath, pathItems, pathTokenAt, type FolderEntry, type PathItem } from './path-reference.ts';
import { applyArgument, applyCommand, filterEntries, slashEntries, slashStage, type SlashEntry } from './slash-menu.ts';
import { useExecQuickCommands } from './composer-data.ts';
import type { Chat } from './chat-session.ts';

/** One row of the menu, whatever it lists. */
interface Row {
  id: string;
  label: string;
  detail: string;
  /** Switched off: it cannot be chosen, and these are the words that say why. */
  disabled?: string;
  note?: string;
  /** A heading to draw above this row (the first of a group). */
  group?: string;
  choose?: () => { text: string; caret: number };
}

/** More rows than this are not drawn for a typed query: the owner narrows it by typing. */
const MAX_FILTERED = 50;
const ARGUMENT_LIMIT = 60;

export interface ComposerMenu {
  /** The rows to show; none means the menu is closed. */
  rows: Row[];
  active: number;
  /** What the live region says: the highlighted row. */
  announcement: string;
  listId: string;
  /** What the box should do for this key (true: the menu used it). */
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean;
  choose(index: number): void;
  setActive(index: number): void;
  label: string;
}

interface Options {
  chat: Chat | undefined;
  profile: string;
  text: string;
  caret: number;
  /** The folder the session's agent works in (`state.cwd`, else the profile's default). */
  workspace: string | undefined;
  onEdit(edit: { text: string; caret: number }): void;
}

type Listing = { path: string; entries: FolderEntry[] } | { path: string; error: string };

export function useComposerMenu({ chat, profile, text, caret, workspace, onEdit }: Options): ComposerMenu {
  const listId = useId();
  const token = useMemo(() => pathTokenAt(text, caret), [text, caret]);
  const stage = useMemo(() => (token ? undefined : slashStage(text, caret)), [token, text, caret]);
  const exec = useExecQuickCommands(profile);
  const [entries, setEntries] = useState<SlashEntry[] | string>();
  const [argumentItems, setArgumentItems] = useState<{ text: string; items: CompletionItem[] }>();
  const [listing, setListing] = useState<Listing>();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<{ text: string; caret: number }>();

  // Hermes's catalogue, once the owner starts a command. It is read again for another chat (its skills differ).
  const wantsCatalogue = stage?.stage === 'command';
  useEffect(() => {
    if (!wantsCatalogue || !chat || exec === undefined) return;
    let current = true;
    chat.commandCatalog().then(
      (catalog) => current && setEntries(slashEntries(catalog, exec)),
      () => current && setEntries('Hermes did not list its commands.'),
    );
    return () => {
      current = false;
    };
  }, [wantsCatalogue, chat, exec]);

  // The arguments Hermes completes after a command. Only the answer to the latest text is kept.
  const argumentText = stage?.stage === 'argument' ? stage.text : undefined;
  useEffect(() => {
    if (argumentText === undefined || !chat) return;
    let current = true;
    chat.completeSlash(argumentText).then(
      (items) => current && setArgumentItems({ text: argumentText, items }),
      () => current && setArgumentItems({ text: argumentText, items: [] }),
    );
    return () => {
      current = false;
    };
  }, [argumentText, chat]);

  // The folder of a path reference. It is listed again only when the folder changes, not at every letter typed in it.
  const folder = token ? listingPath(token, workspace) : undefined;
  useEffect(() => {
    if (folder === undefined || !chat) return;
    let current = true;
    chat.listFolder(folder).then(
      (found) => current && setListing({ path: folder, entries: found }),
      (error: unknown) => current && setListing({ path: folder, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [folder, chat]);

  const built = useMemo((): Row[] => {
    if (token) {
      if (folder === undefined) return [{ id: 'none', label: 'No workspace yet', detail: 'Hermes has not said which folder this chat works in, so there is nothing to list.', disabled: 'No workspace' }];
      if (listing?.path !== folder) return [];
      if ('error' in listing) return [{ id: 'error', label: 'Hermes would not list this folder', detail: listing.error, disabled: listing.error }];
      return pathItems(token, listing.entries).map((item: PathItem, index) => ({
        id: `p${index}`,
        label: item.label,
        detail: item.detail,
        choose: () => applyPath(text, token, item),
      }));
    }
    if (stage?.stage === 'command') {
      if (entries === undefined) return [];
      if (typeof entries === 'string') return [{ id: 'error', label: entries, detail: 'Type the command in full.', disabled: entries }];
      const typed = stage.query;
      const shown = filterEntries(entries, typed).slice(0, typed === '' ? undefined : MAX_FILTERED);
      let lastGroup: string | undefined;
      return shown.map((entry) => {
        const group = typed === '' && entry.group !== lastGroup ? entry.group : undefined;
        lastGroup = entry.group;
        return {
          id: entry.command,
          label: entry.command,
          detail: entry.description,
          ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
          ...(entry.note === undefined ? {} : { note: entry.note }),
          ...(group === undefined ? {} : { group }),
          choose: () => applyCommand(text, entry),
        };
      });
    }
    if (stage?.stage === 'argument') {
      if (argumentItems?.text !== stage.text) return [];
      return argumentItems.items.slice(0, ARGUMENT_LIMIT).map((item, index) => ({
        id: `a${index}`,
        label: item.display ?? item.text,
        detail: item.meta ?? '',
        choose: () => applyArgument(text, caret, item.text),
      }));
    }
    return [];
  }, [token, stage, folder, listing, entries, argumentItems, text, caret]);

  const open = dismissed?.text !== text || dismissed.caret !== caret;
  const rows = open ? built : [];
  // The first row that can be chosen is the one under the cursor when the list changes.
  const key = rows.map((row) => row.id).join('\n');
  const firstChoosable = rows.findIndex((row) => row.disabled === undefined);
  const lastKey = useRef('');
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setActive(Math.max(0, firstChoosable));
  }, [key, firstChoosable]);
  const at = Math.min(active, Math.max(0, rows.length - 1));

  const choose = (index: number) => {
    const row = rows[index];
    if (!row?.choose || row.disabled !== undefined) return;
    onEdit(row.choose());
  };
  const current = rows[at];
  const announcement = current
    ? [current.label, current.detail, current.disabled !== undefined ? `Not available. ${current.disabled}` : current.note, `${at + 1} of ${rows.length}`].filter(Boolean).join('. ')
    : '';

  return {
    rows,
    active: at,
    announcement,
    listId,
    label: token ? 'Files and folders' : stage?.stage === 'argument' ? 'Options' : 'Commands',
    setActive,
    choose,
    onKeyDown(event) {
      if (rows.length === 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      switch (event.key) {
        case 'ArrowDown':
          setActive((at + 1) % rows.length);
          break;
        case 'ArrowUp':
          setActive((at - 1 + rows.length) % rows.length);
          break;
        case 'Home':
        case 'End':
          return false;
        case 'Enter':
        case 'Tab':
          // A switched-off row is not chosen; Enter does nothing then (the live region says why) and Tab goes on as it does.
          if (rows[at]?.choose === undefined || rows[at]?.disabled !== undefined) {
            if (event.key === 'Tab') return false;
            break;
          }
          choose(at);
          break;
        case 'Escape':
          setDismissed({ text, caret });
          break;
        default:
          return false;
      }
      event.preventDefault();
      return true;
    },
  };
}

/** The listbox. It sits above the message box; the textarea keeps the focus. */
export function ComposerMenuView({ menu }: { menu: ComposerMenu }) {
  const list = useRef<HTMLUListElement>(null);
  // Keeps the highlighted row in view while ↑ ↓ move through a long list.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [menu.active, menu.rows.length]);
  if (menu.rows.length === 0) return null;
  return (
    <div className="cmenu">
      <ul ref={list} id={menu.listId} className="cmenu__list" role="listbox" aria-label={menu.label}>
        {menu.rows.map((row, index) => (
          <li key={row.id} role="presentation">
            {row.group !== undefined && <p className="cmenu__group">{row.group}</p>}
            <div
              role="option"
              id={`${menu.listId}-${index}`}
              className="cmenu__row"
              // Never in the tab order (the message box keeps the focus), but focusable, which a scrolling list needs to be reachable by keyboard.
              tabIndex={-1}
              aria-selected={index === menu.active}
              aria-disabled={row.disabled !== undefined || undefined}
              onMouseMove={() => index !== menu.active && menu.setActive(index)}
              // The click chooses; the press must not take the focus out of the message box.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => menu.choose(index)}
            >
              <span className="cmenu__label">{row.label}</span>
              <span className="cmenu__detail">{row.detail}</span>
              {row.disabled !== undefined && row.choose !== undefined && <span className="cmenu__why">{row.disabled}</span>}
              {row.note !== undefined && <span className="chip cmenu__note">{row.note}</span>}
            </div>
          </li>
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {menu.announcement}
      </p>
    </div>
  );
}
