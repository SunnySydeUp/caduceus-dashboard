import { useEffect, useId, useState, type CSSProperties } from 'react';
import { useBlocker } from '@tanstack/react-router';
import type { FileSnapshot } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Rich } from '../chat/Rich.tsx';
import { saveFile } from './behaviour-actions.ts';
import { fetchSnapshots, fetchSnapshotText, useFileRead, useMemoryUse } from './behaviour-data.ts';
import { BEHAVIOUR_FILES, fileRef, leavesWithEdits, lineDiff, memoryMeter, yamlProblem, type BehaviourFileId, type YamlProblem } from './behaviour-files.ts';
import type { ProfileCard } from './profiles-model.ts';

type Pane = 'edit' | 'preview' | 'split';

const PANE_LABELS: Record<Pane, string> = { edit: 'Edit', preview: 'Preview', split: 'Split' };

/** All the state of one file's editor: what Hermes holds, what the owner has typed, and what a save came to. */
function useEditor(card: ProfileCard, id: BehaviourFileId) {
  const file = BEHAVIOUR_FILES[id];
  const ref = fileRef(id, card.name, card.path);
  const { result, reload } = useFileRead(ref);
  /** What the editor was made from: the text Hermes held when it was loaded or last saved. */
  const [base, setBase] = useState<string>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** A save is out, from the first click until it settles (the confirmation and the write); `busy` is only the part after the owner confirmed. */
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [problem, setProblem] = useState<YamlProblem>();
  const dirty = base !== undefined && text !== base;

  // The first answer (and the one after a file is chosen again) fills the editor; a later reload never replaces typing.
  useEffect(() => {
    if (result?.state === 'ready' && (base === undefined || !dirty)) {
      setBase(result.text);
      setText(result.text);
    }
    // `dirty` and `base` are read at the moment an answer arrives, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  useEffect(() => {
    if (id !== 'config') return;
    let current = true;
    void yamlProblem(text).then((found) => current && setProblem(found));
    return () => {
      current = false;
    };
  }, [id, text]);

  const memory = useMemoryUse(card.name);
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => leavesWithEdits(dirty, current, next), enableBeforeUnload: () => dirty, withResolver: true });

  const save = async (against = base) => {
    if (asking || base === undefined || against === undefined) return;
    setAsking(true);
    setFailure(undefined);
    try {
      // The button says Saving only once the owner has confirmed: until then the confirmation is what is on screen.
      const outcome = await saveFile(card.name, file, ref, text, against, () => setBusy(true));
      if (outcome.kind === 'saved') {
        setConflict(undefined);
        setBase(text);
        toast(`${file.label} saved`, { tone: 'success', detail: 'The text it replaced is in History.' });
        void memory.reload();
      } else if (outcome.kind === 'conflict') setConflict(outcome.current);
      else if (outcome.kind === 'failed') setFailure(outcome.message);
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };
  /** The file changed in Hermes and the owner chose its text over their own. */
  const useHermes = () => {
    if (conflict === undefined) return;
    setBase(conflict);
    setText(conflict);
    setConflict(undefined);
  };
  /** The file was changed in Hermes by a restore or a reset: the editor shows what is there now. */
  const reloadFromHermes = async () => {
    const read = await reload();
    if (read.state === 'ready') {
      setBase(read.text);
      setText(read.text);
      setConflict(undefined);
      setFailure(undefined);
    }
    void memory.reload();
  };

  return { file, ref, result, base, text, setText, dirty, busy, asking, failure, conflict, problem, save, useHermes, reloadFromHermes, blocker, memory };
}

type Editor = ReturnType<typeof useEditor>;

function sizeWords(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** The snapshots of a file, with Restore. A restore is a save like any other (Tier 3), and it snapshots the text it replaces. */
function History({ card, editor, onClose }: { card: ProfileCard; editor: Editor; onClose(): void }) {
  const { file, ref } = editor;
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>();
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<FileSnapshot>();
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const readOnly = useReadOnly();

  useEffect(() => {
    void fetchSnapshots(ref).then(setSnapshots, () => setFailed(true));
    // The list is read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setText(undefined);
    if (chosen) void fetchSnapshotText(chosen.id).then(setText, () => setFailed(true));
  }, [chosen]);

  const restore = async () => {
    if (text === undefined || editor.base === undefined) return;
    setBusy(true);
    try {
      const outcome = await saveFile(card.name, file, ref, text, editor.base);
      if (outcome.kind === 'saved') {
        toast(`Restored the earlier ${file.label}`, { tone: 'success', detail: 'The text it replaced is in History too.' });
        await editor.reloadFromHermes();
        onClose();
      } else if (outcome.kind === 'conflict') toast(`${file.label} changed in Hermes after you opened it. Close History and review the change first.`, { tone: 'warning' });
      else if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`History of ${file.label}`}
      detents={['half', 'full']}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Close
          </button>
          <WriteButton type="button" className="btn btn--primary" disabled={chosen === undefined || text === undefined || busy || editor.dirty || readOnly} aria-busy={busy} onClick={() => void restore()}>
            <Icon name="history" />
            Restore this version…
          </WriteButton>
        </>
      }
    >
      <div className="fe-history">
        <p className="subtle">
          Caduceus keeps the text each save or reset replaced, as a <Term id="snapshot">snapshot</Term>, up to 20 per file. Restoring one saves it as the file’s text, and keeps the text it replaces too.
        </p>
        {editor.dirty && <p className="field__help">Save or discard your edits before restoring: a restore changes the file in Hermes.</p>}
        {failed && (
          <p className="field__error" role="alert">
            <Icon name="alert" small />
            <span>Caduceus could not read the snapshots.</span>
          </p>
        )}
        {snapshots?.length === 0 && <p className="empty__text">No snapshots yet. The first save of this file keeps the text it replaces.</p>}
        {snapshots && snapshots.length > 0 && (
          <ul className="list fe-snapshots" aria-label="Snapshots, newest first">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <button type="button" className="list__row fe-snapshot" aria-pressed={chosen?.id === snapshot.id} onClick={() => setChosen(snapshot)}>
                  <time dateTime={snapshot.at}>{new Date(snapshot.at).toLocaleString()}</time>
                  <span className="subtle">{sizeWords(snapshot.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen && (
          <section aria-label="The chosen version">
            <h3>Text of this version</h3>
            {text === undefined ? <p role="status">Loading…</p> : <pre className="fe-snapshot-text" tabIndex={0}>{text === '' ? '(empty)' : text}</pre>}
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** What a save found when the file had changed in Hermes: both texts side by side as a diff, and three ways on. */
function Conflict({ editor }: { editor: Editor }) {
  const rows = lineDiff(editor.conflict ?? '', editor.text);
  return (
    <section className="banner fe-conflict" data-tone="warning" role="alert" aria-labelledby="fe-conflict-title">
      <Icon name="alert" />
      <div className="banner__content">
        <strong id="fe-conflict-title">{editor.file.label} changed in Hermes after you opened it</strong>
        <p>Nothing was saved. Below is what Hermes has now (red) and what you have typed (green).</p>
        <pre className="fe-diff" tabIndex={0} aria-label="Differences between Hermes’s text and yours">
          {rows.length === 0 ? '(no differences)' : rows.map((row, index) => (
            <span key={index} className="fe-diff__row" data-kind={row.kind}>
              <span aria-hidden="true">{row.kind === 'removed' ? '− ' : row.kind === 'added' ? '+ ' : '  '}</span>
              <span className="sr-only">{row.kind === 'removed' ? 'Hermes has: ' : row.kind === 'added' ? 'You typed: ' : ''}</span>
              {row.text}
              {'\n'}
            </span>
          ))}
        </pre>
        <div className="row">
          <button type="button" className="btn btn--secondary btn--sm" onClick={editor.useHermes}>
            Use Hermes’s text
          </button>
          <WriteButton type="button" className="btn btn--primary btn--sm" disabled={editor.asking} onClick={() => void editor.save(editor.conflict)}>
            Save my text over it…
          </WriteButton>
        </div>
      </div>
    </section>
  );
}

function LeaveBanner({ editor }: { editor: Editor }) {
  if (editor.blocker.status !== 'blocked') return null;
  return (
    <div className="banner fe-leave" data-tone="warning" role="alertdialog" aria-labelledby="fe-leave-title">
      <Icon name="alert" />
      <div className="banner__content">
        <strong id="fe-leave-title">Leave without saving?</strong>
        <p>Your edits to {editor.file.label} will be lost.</p>
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary btn--sm" autoFocus onClick={() => editor.blocker.reset?.()}>
          Keep editing
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => editor.blocker.proceed?.()}>
          Discard
        </button>
      </div>
    </div>
  );
}

function Meter({ editor }: { editor: Editor }) {
  const kind = editor.file.memory;
  const facts = kind && editor.memory.use?.[kind];
  if (!kind || !facts) return null;
  const meter = memoryMeter(editor.text, facts.limit);
  return (
    <div className="fe-meter">
      <div className="progress" data-tone={meter.over ? 'danger' : meter.percent >= 90 ? 'warning' : 'success'} role="img" aria-label={`${meter.used} of ${meter.limit} characters`}>
        <i style={{ '--p': `${meter.percent}%` } as CSSProperties} />
      </div>
      <p className="field__help">
        {meter.used.toLocaleString()} of {meter.limit.toLocaleString()} characters{meter.over ? ': over the limit, so Hermes will not let the agent add more until this is shorter' : ''}. On disk Hermes holds {sizeWords(facts.bytes)}.
      </p>
    </div>
  );
}

/** The editor itself: Preview, Edit or Split, the save bar, the problems and the history. */
function EditorBody({ card, editor, onDone }: { card: ProfileCard; editor: Editor; onDone?: () => void }) {
  const { file, result } = editor;
  const textId = useId();
  const paneLabelId = useId();
  const wide = useSizeClass() === 'large';
  const readOnly = useReadOnly();
  const panes: Pane[] = file.markdown ? (wide ? ['edit', 'preview', 'split'] : ['edit', 'preview']) : ['edit'];
  const [pane, setPane] = useState<Pane>(file.markdown ? 'edit' : 'edit');
  const shown: Pane = panes.includes(pane) ? pane : 'edit';
  const [history, setHistory] = useState(false);

  if (!result) return <p role="status">Loading {file.label}…</p>;
  if (result.state === 'failed') {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">{result.message}</span>
      </div>
    );
  }
  if (result.state === 'unsafe') {
    return (
      <div className="banner" data-tone="warning" role="status">
        <Icon name="info" />
        <span className="banner__content">{result.reason} Edit it from Hermes’s command line instead.</span>
      </div>
    );
  }
  const blocked = readOnly ? 'Read-only mode is on: Caduceus is not changing anything in Hermes.' : editor.problem ? `${editor.problem.message} (line ${editor.problem.line}, column ${editor.problem.column})` : undefined;
  const editing = (
    <div className="field fe-text">
      <label className="field__label" htmlFor={textId}>
        {file.label}
      </label>
      <textarea
        id={textId}
        className={file.markdown ? 'input input--mono fe-area' : 'input input--mono fe-area fe-area--yaml'}
        value={editor.text}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        aria-invalid={editor.problem ? true : undefined}
        aria-describedby={editor.problem ? `${textId}-problem` : undefined}
        onChange={(event) => editor.setText(event.target.value)}
      />
    </div>
  );
  const preview = (
    <div className="panel panel--pad fe-preview" aria-label={`Preview of ${file.label}`}>
      {editor.text.trim() === '' ? <p className="subtle">Nothing to preview yet.</p> : <Rich text={editor.text} anchor={`behaviour-${file.id}`} />}
    </div>
  );

  return (
    <div className="fe">
      <LeaveBanner editor={editor} />
      {editor.conflict !== undefined && <Conflict editor={editor} />}
      <div className="fe-bar">
        {panes.length > 1 && (
          <>
            <span id={paneLabelId} className="sr-only">
              Show
            </span>
            <RadioGroup labelledBy={paneLabelId} className="seg" value={shown} options={panes.map((value) => ({ value, label: PANE_LABELS[value] }))} onChange={setPane} />
          </>
        )}
        <span className="fe-bar__state" role="status">
          {editor.dirty ? 'Unsaved changes' : result.exists ? 'Saved' : 'Not created yet'}
        </span>
        <button type="button" className="btn btn--secondary" onClick={() => setHistory(true)}>
          <Icon name="history" />
          History
        </button>
        {onDone && (
          <button type="button" className="btn btn--secondary" onClick={onDone}>
            Close
          </button>
        )}
        <WriteButton type="button" className="btn btn--primary" disabled={!editor.dirty || editor.asking || blocked !== undefined} title={blocked} aria-busy={editor.busy} onClick={() => void editor.save()}>
          <Icon name="lock" small />
          {editor.busy ? 'Saving…' : 'Review and save…'}
        </WriteButton>
      </div>
      {editor.problem && (
        <p className="field__error" id={`${textId}-problem`} role="alert">
          <Icon name="alert" small />
          <span>
            Not valid YAML, so it cannot be saved: {editor.problem.message} (line {editor.problem.line}, column {editor.problem.column}).
          </span>
        </p>
      )}
      {editor.failure && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          <span>{editor.failure}</span>
        </p>
      )}
      <Meter editor={editor} />
      {shown === 'edit' && editing}
      {shown === 'preview' && preview}
      {shown === 'split' && (
        <div className="fe-split">
          {editing}
          {preview}
        </div>
      )}
      {history && <History card={card} editor={editor} onClose={() => setHistory(false)} />}
    </div>
  );
}

/** The editor inside a full-screen sheet (phones): closing it with unsaved edits asks first. */
function EditorSheet({ card, id, onClose }: { card: ProfileCard; id: BehaviourFileId; onClose(): void }) {
  const editor = useEditor(card, id);
  const [leaving, setLeaving] = useState(false);
  const tryClose = () => (editor.dirty ? setLeaving(true) : onClose());
  return (
    <Sheet title={editor.file.label} className="fe-sheet" detents={['full']} dismissOnScrim={false} onClose={tryClose}>
      {leaving && (
        <div className="banner fe-leave" data-tone="warning" role="alertdialog" aria-labelledby="fe-sheet-leave-title">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="fe-sheet-leave-title">Leave without saving?</strong>
            <p>Your edits to {editor.file.label} will be lost.</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" autoFocus onClick={() => setLeaving(false)}>
              Keep editing
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
              Discard
            </button>
          </div>
        </div>
      )}
      <EditorBody card={card} editor={editor} onDone={tryClose} />
    </Sheet>
  );
}

/** config.yaml on a phone: read as it is, with the way to edit it on a larger screen. */
function ConfigOnPhone({ card }: { card: ProfileCard }) {
  const { result } = useFileRead(fileRef('config', card.name, card.path));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link copied', { tone: 'success', detail: 'Open it on a computer to edit config.yaml.' });
    } catch {
      toast('Copying is not allowed here. Open this address on a computer.', { tone: 'warning' });
    }
  };
  return (
    <div className="fe">
      <div className="banner" data-tone="info" role="status">
        <Icon name="monitor" />
        <div className="banner__content">
          <p>config.yaml is edited on a larger screen, where a mistake in the YAML is easy to see. Here it is read-only.</p>
        </div>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copy()}>
          <Icon name="copy" small />
          Copy link for desktop
        </button>
      </div>
      {!result && <p role="status">Loading config.yaml…</p>}
      {result?.state === 'ready' && <pre className="fe-readonly" tabIndex={0} aria-label="config.yaml, read only">{result.text}</pre>}
      {result && result.state !== 'ready' && <p className="field__error">{result.state === 'failed' ? result.message : result.reason}</p>}
    </div>
  );
}

/**
 * One behaviour file of a profile, with its editor: inline on a wide screen, in a full-screen sheet on a phone (config.yaml is read-only
 * on a phone). Hermes holds the file; Caduceus keeps only the snapshots of what each write replaced.
 */
export function FileEditor({ card, id }: { card: ProfileCard; id: BehaviourFileId }) {
  const compact = useSizeClass() === 'compact';
  const [open, setOpen] = useState(false);
  const file = BEHAVIOUR_FILES[id];
  return (
    <section className="panel panel--pad fe-file" aria-labelledby={`fe-${id}-title`}>
      <div className="fe-file__head">
        <h3 id={`fe-${id}-title`}>{file.label}</h3>
        <p className="subtle">{file.blurb}</p>
      </div>
      {compact && id === 'config' && <ConfigOnPhone card={card} />}
      {compact && id !== 'config' && (
        <>
          <div className="row">
            <WriteButton type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
              <Icon name="type" />
              Edit {file.label}
            </WriteButton>
          </div>
          {open && <EditorSheet card={card} id={id} onClose={() => setOpen(false)} />}
        </>
      )}
      {!compact && <InlineEditor card={card} id={id} />}
    </section>
  );
}

function InlineEditor({ card, id }: { card: ProfileCard; id: BehaviourFileId }) {
  const editor = useEditor(card, id);
  return <EditorBody card={card} editor={editor} />;
}
