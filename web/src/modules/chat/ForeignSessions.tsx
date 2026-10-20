// The sheet of Claude Code and Codex sessions (M1 #16): the logs those tools left on the machine Hermes runs on, a preview of the tail of one, and
// Import into this tab's profile. Hermes finds, reads and imports them (`foreign-sessions.ts`); this only draws what it answers.
import { useCallback, useEffect, useId, useState } from 'react';
import { gatewayConnection } from '../../gateway.ts';
import { Icon } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { folderName, importForeign, listForeign, previewForeign, turnsLabel, type ForeignPage, type ForeignPreview, type ForeignSession, type ForeignSource } from './foreign-sessions.ts';
import { ChangeButton } from './SessionOrganiser.tsx';
import { activityLabel } from './sessions-model.ts';
import './foreign-sessions.css';

type Filter = ForeignSource | 'all';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
] as const;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface Listing {
  rows: ForeignSession[];
  nextOffset: number | undefined;
  unreadable: number;
  loading: boolean;
  /** Why Hermes could not list them, in its words. */
  error: string | undefined;
  loaded: boolean;
}

const FIRST: Listing = { rows: [], nextOffset: undefined, unreadable: 0, loading: true, error: undefined, loaded: false };

/** Hermes's pages of sessions of one tool (or both), a page at a time; changing the filter starts again, and an answer for an earlier one is dropped. */
function useListing(profile: string, filter: Filter): { listing: Listing; more(): void; retry(): void } {
  const [listing, setListing] = useState<Listing>(FIRST);
  const [attempt, setAttempt] = useState(0);
  const source = filter === 'all' ? undefined : filter;
  useEffect(() => {
    let current = true;
    setListing(FIRST);
    listForeign(gatewayConnection().client, { profile, source }).then(
      (page) => current && setListing({ ...page, loading: false, error: undefined, loaded: true }),
      (error: unknown) => current && setListing({ ...FIRST, loading: false, error: messageOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [profile, source, attempt]);
  const more = useCallback(() => {
    if (listing.nextOffset === undefined || listing.loading) return;
    const offset = listing.nextOffset;
    setListing((was) => ({ ...was, loading: true, error: undefined }));
    listForeign(gatewayConnection().client, { profile, source, offset }).then(
      (page: ForeignPage) => setListing((was) => ({ rows: [...was.rows, ...page.rows], nextOffset: page.nextOffset, unreadable: was.unreadable + page.unreadable, loading: false, error: undefined, loaded: true })),
      (error: unknown) => setListing((was) => ({ ...was, loading: false, error: messageOf(error) })),
    );
  }, [listing.nextOffset, listing.loading, profile, source]);
  return { listing, more, retry: () => setAttempt((n) => n + 1) };
}

type PreviewState = { kind: 'loading' } | { kind: 'ready'; preview: ForeignPreview } | { kind: 'failed'; message: string };

function usePreview(profile: string, row: ForeignSession | undefined): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  useEffect(() => {
    if (row === undefined) return;
    let current = true;
    setState({ kind: 'loading' });
    previewForeign(gatewayConnection().client, { profile, id: row.id }).then(
      (preview) => current && setState({ kind: 'ready', preview }),
      (error: unknown) => current && setState({ kind: 'failed', message: messageOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [profile, row]);
  return state;
}

const sub = (row: ForeignSession): string[] => [row.label, folderName(row.cwd), turnsLabel(row.turnCount)].filter((part): part is string => part !== undefined);

function Rows({ rows, onOpen }: { rows: readonly ForeignSession[]; onOpen(row: ForeignSession): void }) {
  const now = Date.now() / 1000;
  return (
    <ul className="fs__rows">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" className="fs__row" onClick={() => onOpen(row)}>
            <span className="fs__icon" aria-hidden="true">
              <Icon name={row.source === 'claude' ? 'code' : 'terminal'} />
            </span>
            <span className="fs__main">
              <span className="fs__title">{row.title || row.label}</span>
              <span className="fs__sub">{sub(row).join(' · ')}</span>
            </span>
            <span className="fs__time">{activityLabel(row.mtime, { now })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface ForeignSessionsProps {
  /** The tab's profile: where an import goes. */
  profile: string;
  /** The session to open on, when the sheet comes back after a declined confirmation. */
  initial?: ForeignSession;
  onClose(): void;
  /** An import changed the profile's sessions. */
  onImported(): void;
  /** The owner declined the confirmation: the sheet opens again on `row`. */
  onReopen(row: ForeignSession): void;
}

export function ForeignSessions({ profile, initial, onClose, onImported, onReopen }: ForeignSessionsProps) {
  const [filter, setFilter] = useState<Filter>(initial?.source ?? 'all');
  const [chosen, setChosen] = useState<ForeignSession | undefined>(initial);
  const filterLabel = useId();
  const { listing, more, retry } = useListing(profile, filter);
  const preview = usePreview(profile, chosen);
  const navigate = useAppNavigate();

  const openImported = (storedId: string) => navigate(`/chat/${encodeURIComponent(storedId)}`);

  const importChosen = async (row: ForeignSession, turns: number) => {
    // A confirmation dialog never opens over a sheet.
    onClose();
    await closeAllLayers();
    const confirmed = await confirmTier({
      tier: 'T1',
      moduleId: 'chat',
      action: 'chat.import-foreign-session',
      label: `Import this ${row.label} session into ${profile}?`,
      text: `Hermes copies the conversation (${turnsLabel(turns)}) into the profile ${profile} as a new chat. The ${row.label} log is only read, never changed.`,
      object: row.title || row.label,
      profile,
      confirmLabel: `Import into ${profile}`,
    });
    if (!confirmed) {
      onReopen(row);
      return;
    }
    try {
      const imported = await importForeign(gatewayConnection().client, { profile, id: row.id });
      onImported();
      await openImported(imported.storedId);
    } catch (error) {
      toast(messageOf(error), { tone: 'danger' });
    }
  };

  const loadedPreview = preview.kind === 'ready' ? preview.preview : undefined;
  const footer = chosen && (
    <div className="sl-sheet__actions">
      <button type="button" className="btn btn--secondary" onClick={() => setChosen(undefined)}>
        <Icon name="chev-l" small />
        Back to the list
      </button>
      {loadedPreview?.alreadyImported !== undefined ? (
        <button type="button" className="btn btn--primary" onClick={() => void openImported(loadedPreview.alreadyImported!)}>
          Open the imported chat
        </button>
      ) : (
        <ChangeButton type="button" className="btn btn--primary" data-act="import-foreign" disabled={loadedPreview === undefined} onClick={() => void importChosen(chosen, loadedPreview!.total)}>
          <Icon name="download" small />
          Import into {profile}
        </ChangeButton>
      )}
    </div>
  );

  return (
    <Sheet title="Claude Code & Codex" detents={['full']} className="fs" footer={footer} onClose={onClose}>
      {chosen === undefined ? (
        <div className="fs__list">
          <p className="field__help">
            Each of these is a <Term id="foreign-session">session</Term> that Claude Code or Codex saved on the machine Hermes runs on. Pick one to read the end of it, then import it into {profile}.
          </p>
          <p id={filterLabel} className="sr-only">
            Show sessions of
          </p>
          <RadioGroup<Filter> labelledBy={filterLabel} className="seg fs__filter" value={filter} options={FILTERS} onChange={setFilter} />
          {listing.error && (
            <div className="banner" data-tone="danger" role="alert">
              <Icon name="alert" />
              <div className="banner__content">
                <strong>Hermes did not give the sessions</strong>
                <p>{listing.error}</p>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={listing.rows.length === 0 ? retry : more}>
                <Icon name="refresh" small />
                Try again
              </button>
            </div>
          )}
          {listing.unreadable > 0 && (
            <p className="banner" data-tone="warning" role="status">
              <Icon name="alert" />
              <span className="banner__content">Hermes could not read {listing.unreadable} of these logs, so they are not listed.</span>
            </p>
          )}
          {listing.loading && listing.rows.length === 0 && <p className="subtle">Asking Hermes…</p>}
          {listing.loaded && listing.rows.length === 0 && (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="code" />
              </span>
              <h3>No sessions found</h3>
              <p>Hermes found no {filter === 'all' ? 'Claude Code or Codex' : FILTERS.find((entry) => entry.value === filter)!.label} sessions on this machine.</p>
            </div>
          )}
          <Rows rows={listing.rows} onOpen={setChosen} />
          {listing.nextOffset !== undefined && (
            <button type="button" className="btn btn--secondary fs__more" aria-busy={listing.loading} disabled={listing.loading} onClick={more}>
              Show more
            </button>
          )}
        </div>
      ) : (
        <div className="fs__preview">
          <h3 className="fs__preview-title">{chosen.title || chosen.label}</h3>
          <p className="field__help">{sub(chosen).join(' · ')}</p>
          {preview.kind === 'loading' && <p className="subtle">Asking Hermes…</p>}
          {preview.kind === 'failed' && (
            <div className="banner" data-tone="danger" role="alert">
              <Icon name="alert" />
              <div className="banner__content">
                <strong>Hermes did not give this session</strong>
                <p>{preview.message}</p>
              </div>
            </div>
          )}
          {loadedPreview && (
            <>
              {loadedPreview.alreadyImported !== undefined && (
                <p className="banner" data-tone="info" role="status">
                  <Icon name="info" />
                  <span className="banner__content">
                    Already imported into {profile}. <AppLink to={`/chat/${encodeURIComponent(loadedPreview.alreadyImported)}`}>Open that chat</AppLink>
                  </span>
                </p>
              )}
              <p className="field__help">{loadedPreview.truncated ? `The end of the conversation: the last ${loadedPreview.messages.length} of ${turnsLabel(loadedPreview.total)}, long turns cut short. Importing brings all of it.` : `The whole conversation: ${turnsLabel(loadedPreview.total)}.`}</p>
              <ol className="fs__turns">
                {loadedPreview.messages.map((turn, index) => (
                  <li key={index} className="fs__turn" data-role={turn.role}>
                    <span className="overline">{turn.role === 'user' ? 'You' : chosen.label}</span>
                    <span className="fs__turn-text">{turn.content}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
