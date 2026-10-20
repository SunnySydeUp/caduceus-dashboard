// The sheets that take a session out of Hermes as a file and bring one back (M1 #17). Export reads Hermes's export of the session and builds the file
// here (`session-export.ts`); Import checks the file before anything is sent (`session-import.ts`), shows what it holds and which profile it goes into, and
// Hermes imports it. What the files are made of is Hermes's; Caduceus keeps nothing.
import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { fetchTiered } from '../../tiered.ts';
import { deliverFile, themeTokens } from './export-delivery.ts';
import { fetchProfileCards } from '../profiles/profiles-data.ts';
import { readHermes } from './read-hermes.ts';
import { EXPORT_FORMATS, exportFile, readExport, type ExportFormat } from './session-export.ts';
import { describeProblem, IMPORT_LIMITS, importSessions, parseImport, type ParsedImport } from './session-import.ts';
import { ChangeButton } from './SessionOrganiser.tsx';
import { nameOf } from './sessions-actions.ts';
import type { SessionItem } from './sessions-model.ts';
import './export-import.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Choosing a format and taking the session out as a file: a download, or on a phone the operating system's share sheet. */
export function ExportSheet({ item, profile, onClose }: { item: SessionItem; profile: string; onClose(): void }) {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const legend = useId();

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = await readHermes(`/api/sessions/${encodeURIComponent(item.id)}/export?profile=${encodeURIComponent(item.profile ?? profile)}`);
      const file = exportFile(readExport(body), format, { tokens: themeTokens() });
      const how = await deliverFile(file);
      if (how === 'cancelled') {
        setBusy(false);
        return;
      }
      toast(how === 'shared' ? `Shared ${file.filename}.` : `Saved ${file.filename} to your downloads.`);
      onClose();
    } catch (failure) {
      setError(`Hermes did not give the session: ${messageOf(failure)}`);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Export session" onClose={onClose}>
      <form
        className="sl-sheet__form"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <p className="sl-sheet__note">
          “{nameOf(item)}” as a file, built in this browser from what Hermes holds. See <Term id="session-export">exporting</Term> for what each format keeps.
        </p>
        <fieldset className="ei__formats">
          <legend id={legend} className="field__label">
            Format
          </legend>
          {EXPORT_FORMATS.map((option) => (
            <label key={option.value} className="ei__option">
              <input type="radio" name="export-format" value={option.value} checked={format === option.value} onChange={() => setFormat(option.value)} />
              <span>
                <span>{option.label}</span>
                <small>{option.sub}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <div className="banner__content">
              <p>{error}</p>
            </div>
          </div>
        )}
        <div className="sl-sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="download" small />
            {busy ? 'Preparing…' : 'Export'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

type Picked = { name: string; parsed: ParsedImport } | { name: string; unreadable: string };

const MAX_MB = IMPORT_LIMITS.totalBytes / 1024 / 1024;

/** Choosing a JSON or JSONL file, the checks it passes or the place it fails, then the profile it goes into and the import. */
export function ImportSheet({ profile, onClose, onImported }: { profile: string; onClose(): void; onImported(): void }) {
  const [picked, setPicked] = useState<Picked>();
  const [target, setTarget] = useState(profile);
  const [profiles, setProfiles] = useState<string[]>([profile]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileId = useId();
  const targetId = useId();

  useEffect(() => {
    let current = true;
    fetchProfileCards().then(
      (cards) => current && setProfiles(cards.map((card) => card.name).includes(profile) ? cards.map((card) => card.name) : [profile, ...cards.map((card) => card.name)]),
      // Hermes did not list its profiles: the tab's own is still a profile to import into.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [profile]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(undefined);
    if (!file) {
      setPicked(undefined);
      return;
    }
    if (file.size > IMPORT_LIMITS.totalBytes) {
      setPicked({ name: file.name, unreadable: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; Hermes takes at most ${MAX_MB} MB at once.` });
      return;
    }
    try {
      setPicked({ name: file.name, parsed: parseImport(await file.text(), file.name) });
    } catch (failure) {
      setPicked({ name: file.name, unreadable: `The file could not be read: ${messageOf(failure)}` });
    }
  };

  const parsed = picked && 'parsed' in picked ? picked.parsed : undefined;
  const ready = parsed?.ok ? parsed : undefined;

  const run = async () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    const outcome = await importSessions({ send: fetchTiered, profile: target, sessions: ready.sessions });
    setBusy(false);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') {
      setError(outcome.message);
      return;
    }
    toast(outcome.message);
    onImported();
    onClose();
  };

  return (
    <Sheet title="Import sessions" onClose={onClose} detents={['half', 'full']}>
      <form
        className="sl-sheet__form"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <p className="sl-sheet__note">
          Bring back sessions from a JSON or JSONL file, such as one made by <Term id="session-export">Export</Term> or by <code>hermes sessions export</code>. The file is checked here first.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={fileId}>
            File
          </label>
          <input id={fileId} className="input ei__file" type="file" accept=".json,.jsonl,.ndjson,application/json" onChange={(event) => void choose(event)} />
        </div>
        {picked && 'unreadable' in picked && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <div className="banner__content">
              <strong>{picked.name} cannot be imported</strong>
              <p>{picked.unreadable}</p>
            </div>
          </div>
        )}
        {picked && parsed && !parsed.ok && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <div className="banner__content">
              <strong>{picked.name} cannot be imported</strong>
              <ul className="ei__problems">
                {parsed.problems.map((problem, index) => (
                  <li key={index}>{describeProblem(problem)}</li>
                ))}
              </ul>
              {parsed.more > 0 && <p>…and {parsed.more} more.</p>}
            </div>
          </div>
        )}
        {picked && ready && (
          <section className="ei__preview" aria-label="What the file holds">
            <p>
              <strong>
                {ready.sessions.length} session{ready.sessions.length === 1 ? '' : 's'}
              </strong>{' '}
              and <strong>{ready.messageCount.toLocaleString('en-US')}</strong> message{ready.messageCount === 1 ? '' : 's'}, from {picked.name} ({ready.format === 'jsonl' ? 'JSONL' : 'JSON'}).
            </p>
            <ul className="ei__sessions">
              {ready.sessions.slice(0, 5).map((session) => (
                <li key={session.id}>
                  <span>{session.title || 'Untitled chat'}</span>
                  <small>{session.messageCount} messages</small>
                </li>
              ))}
              {ready.sessions.length > 5 && <li className="subtle">…and {ready.sessions.length - 5} more</li>}
            </ul>
            <div className="field">
              <label className="field__label" htmlFor={targetId}>
                Import into profile
              </label>
              <select id={targetId} className="input" value={target} onChange={(event) => setTarget(event.target.value)}>
                {profiles.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="field__help">A session whose id the profile already has is skipped.</p>
            </div>
          </section>
        )}
        {error && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <div className="banner__content">
              <strong>Hermes did not import</strong>
              <p>{error}</p>
            </div>
          </div>
        )}
        <div className="sl-sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <ChangeButton type="submit" className="btn btn--primary" disabled={!ready || busy} aria-busy={busy}>
            {busy ? 'Importing…' : ready ? `Import into ${target}…` : 'Import…'}
          </ChangeButton>
        </div>
      </form>
    </Sheet>
  );
}
