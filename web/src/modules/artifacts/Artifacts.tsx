import { useId, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { ARTIFACT_KINDS, ARTIFACT_SOURCE_TYPES, MIN_ARTIFACT_CAP_BYTES, type Artifact } from '@caduceus/contracts/artifacts';
import { Icon, type IconName } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ArtifactViewer, DownloadButton } from './ArtifactViewer.tsx';
import { deleteArtifact, pinArtifact, restoreArtifact, setCap, useArtifacts } from './artifacts-data.ts';
import { filterQuery, filtersOf, KIND_LABELS, SOURCE_LABELS, sizeWords, sourceHref } from './artifacts-model.ts';
import './artifacts.css';

const KIND_ICON: Record<Artifact['kind'], IconName> = { markdown: 'book', html: 'browser', image: 'camera', pdf: 'file', text: 'file', file: 'package' };
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const MEBIBYTE = 1024 * 1024;

function Storage({ bytes, capBytes, onChanged }: { bytes: number; capBytes: number; onChanged(): void }) {
  const id = useId();
  const [text, setText] = useState(String(Math.round(capBytes / MEBIBYTE)));
  const megabytes = Number(text);
  const valid = Number.isInteger(megabytes) && megabytes * MEBIBYTE >= MIN_ARTIFACT_CAP_BYTES;
  const save = async () => {
    const outcome = await setCap(megabytes * MEBIBYTE);
    toast(outcome.kind === 'done' ? 'Size limit saved' : outcome.kind === 'failed' ? outcome.message : 'Not saved', { tone: outcome.kind === 'done' ? 'success' : 'danger' });
    onChanged();
  };
  return (
    <details className="art-storage-box">
      <summary className="art-storage__summary">
        Storage: {sizeWords(bytes)} of {sizeWords(capBytes)}
      </summary>
      <p className="subtle">
        When Artifacts is over its limit, the oldest artifacts are removed first. Pinned ones are never removed, so a pinned artifact can keep it over the limit.
      </p>
      <div className="art-storage">
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Size limit (MB)
          </label>
          <input id={id} className="input" inputMode="numeric" value={text} onChange={(event) => setText(event.target.value)} aria-invalid={!valid} />
        </div>
        <WriteButton type="button" className="btn btn--secondary" disabled={!valid} onClick={() => void save()}>
          Save limit
        </WriteButton>
      </div>
    </details>
  );
}

/** Workspace › Artifacts: what runs, tasks and chats handed in, filtered by where it came from and what it is, opened in a viewer, and deleted with an undo. */
export function Artifacts() {
  const search = useSearch({ strict: false }) as { source?: unknown; kind?: unknown; open?: unknown };
  const navigate = useAppNavigate();
  const filters = filtersOf(search);
  const { artifacts, reload } = useArtifacts(filters);
  const sourceId = useId();
  const kindId = useId();
  const ready = artifacts.state === 'ready' ? artifacts : undefined;
  const open = typeof search.open === 'string' ? ready?.artifacts.find((artifact) => artifact.id === search.open) : undefined;
  const go = (next: { source?: string; kind?: string; open?: string }) => void navigate(`/workspace/artifacts${filterQuery({ source: filtersOf(next).source, kind: filtersOf(next).kind }, next.open === undefined ? {} : { open: next.open })}`, { replace: true });
  const filtered = filters.source !== undefined || filters.kind !== undefined;

  const remove = async (artifact: Artifact) => {
    const outcome = await deleteArtifact(artifact);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    go({ ...filters });
    toast(`Deleted “${artifact.title}”`, {
      detail: 'Undo brings it back for a minute.',
      timeout: Math.min(outcome.body.undoMs, 30_000),
      undo: () => void restoreArtifact(artifact).then((restored) => {
        toast(restored.kind === 'done' ? 'Brought back' : restored.kind === 'failed' ? restored.message : 'Not restored', { tone: restored.kind === 'done' ? 'success' : 'danger' });
        return reload();
      }),
    });
    await reload();
  };
  const pin = async (artifact: Artifact) => {
    const outcome = await pinArtifact(artifact, !artifact.pinned);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    await reload();
  };

  return (
    <div className="art">
      <PageHeader overline="Workspace" title="Artifacts" subtitle={<>Reports and files that runs, tasks and chats handed in. A <Term id="deep-research">Deep Research</Term> report lands here when its run finishes.</>} />
      <div className="art-filters">
        <div className="field">
          <label className="field__label" htmlFor={sourceId}>
            Source
          </label>
          <select id={sourceId} className="input" value={filters.source ?? ''} onChange={(event) => go({ ...filters, source: event.target.value })}>
            <option value="">All sources</option>
            {ARTIFACT_SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SOURCE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={kindId}>
            Kind
          </label>
          <select id={kindId} className="input" value={filters.kind ?? ''} onChange={(event) => go({ ...filters, kind: event.target.value })}>
            <option value="">All kinds</option>
            {ARTIFACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {artifacts.state === 'loading' && <p role="status">Loading…</p>}
      {artifacts.state === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{artifacts.message}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {ready && ready.artifacts.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="package" />
          </span>
          <p>
            {filtered
              ? 'No artifact matches these filters.'
              : 'Nothing here yet. Run the Deep Research playbook and its report is kept here when the run finishes. You can also keep a file from a task’s Attachments tab or from a chat’s Artifacts tab.'}
          </p>
          {filtered ? (
            <button type="button" className="btn btn--secondary" onClick={() => go({})}>
              Clear the filters
            </button>
          ) : (
            <AppLink className="btn btn--primary" to="/work/playbooks">
              Open Playbooks
            </AppLink>
          )}
        </div>
      )}
      {ready && ready.artifacts.length > 0 && (
        <div className="art-split" data-open={open === undefined ? undefined : ''}>
          <ul className="art-list" aria-label="Artifacts">
            {ready.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button type="button" className="art-item" aria-pressed={open?.id === artifact.id} onClick={() => go({ ...filters, open: artifact.id })}>
                  <Icon name={KIND_ICON[artifact.kind]} />
                  <span className="art-item__text">
                    <span>{artifact.title}</span>
                    <small>
                      {artifact.pinned ? 'Pinned · ' : ''}
                      {SOURCE_LABELS[artifact.source.type]}: {artifact.source.label} · {sizeWords(artifact.size)} · {when(artifact.createdAt)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {open && (
            <section className="art-detail" aria-label={`Artifact ${open.title}`}>
              <button type="button" className="btn btn--ghost btn--sm art-back" onClick={() => go({ ...filters })}>
                <Icon name="chev-l" small />
                All artifacts
              </button>
              <div className="art-bar">
                <h2 className="art-h grow">{open.title}</h2>
                <DownloadButton artifact={open} />
                <WriteButton type="button" className="btn btn--secondary btn--sm" aria-pressed={open.pinned} onClick={() => void pin(open)}>
                  <Icon name="pin" small />
                  {open.pinned ? 'Unpin' : 'Pin'}
                </WriteButton>
                <WriteButton type="button" className="btn btn--danger btn--sm" onClick={() => void remove(open)}>
                  <Icon name="trash" small />
                  Delete…
                </WriteButton>
              </div>
              <p className="art-facts">
                <span>{KIND_LABELS[open.kind]}</span>
                <span>{open.name}</span>
                <span>{sizeWords(open.size)}</span>
                <span>{when(open.createdAt)}</span>
              </p>
              <AppLink className="btn btn--ghost btn--sm art-source" to={sourceHref(open)}>
                <Icon name="link" small />
                From {SOURCE_LABELS[open.source.type].toLowerCase()}: {open.source.label}
              </AppLink>
              <p className="help-text">
                A file has no share link of its own: sharing is per chat. Download the file to send it as it is
                {open.source.type === 'session' && (
                  <>
                    , or{' '}
                    <AppLink to={sourceHref(open)}>open the chat</AppLink> and use Share there
                  </>
                )}
                .
              </p>
              <ArtifactViewer artifact={open} />
            </section>
          )}
        </div>
      )}
      {ready && <Storage key={ready.usage.capBytes} bytes={ready.usage.bytes} capBytes={ready.usage.capBytes} onChanged={() => void reload()} />}
    </div>
  );
}
