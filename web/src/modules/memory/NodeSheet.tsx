import { useEffect, useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { describeNode } from './graph-view.ts';
import { removeNode, saveNode } from './memory-actions.ts';
import { fetchNode } from './memory-data.ts';
import type { GraphNode, NodeAnswer } from './memory-model.ts';

/** One node of the learning graph: its content as Hermes has it now, with edit and delete. */
export function NodeSheet({ node, links, profile, reload, onClose }: { node: GraphNode; links: readonly GraphNode[]; profile: string; reload(): Promise<void>; onClose(): void }) {
  const id = useId();
  const readOnly = useReadOnly();
  const [answer, setAnswer] = useState<NodeAnswer>();
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetchNode(node.id, profile).then(
      (next) => {
        if (!current) return;
        setAnswer(next);
        if (next.ok) setText(next.node.content);
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [node.id, profile, attempt]);

  const loaded = answer?.ok ? answer.node : undefined;
  const changed = loaded !== undefined && text !== loaded.content;

  const save = async () => {
    setBusy(true);
    const outcome = await saveNode(node, text, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Saved “${node.label}”`, { detail: outcome.body.message });
    await reload();
    setAttempt((count) => count + 1);
  };

  const remove = async () => {
    setBusy(true);
    const outcome = await removeNode(node, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Deleted “${node.label}”`, { detail: outcome.body.message });
    await reload();
    onClose();
  };

  return (
    <Sheet
      title={node.label}
      detents={['full']}
      className="mm-sheet"
      onClose={onClose}
      footer={
        loaded ? (
          <div className="mm-actions mm-foot">
            <WriteButton type="submit" form={id} className="btn btn--primary" disabled={!changed || busy || readOnly} aria-busy={busy}>
              <Icon name="check" />
              Save changes…
            </WriteButton>
            <WriteButton type="button" className="btn btn--danger-quiet" disabled={busy || readOnly} onClick={() => void remove()}>
              <Icon name="trash" />
              {node.kind === 'skill' ? 'Archive skill…' : 'Delete chunk…'}
            </WriteButton>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="mm-form">
        <p className="mm-note">{describeNode(node)}.</p>
        {links.length > 0 && <p className="mm-note">Linked to: {links.map((linked) => linked.label).join(', ')}.</p>}
        {readOnly && <p className="mm-note" role="status">Caduceus is in read-only mode, so nothing can be changed here.</p>}
        {failed && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not answer, so this node could not be read.</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setFailed(false), setAttempt((count) => count + 1))}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        )}
        {answer && !answer.ok && (
          <div className="banner" data-tone="warning" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes cannot show this node: {answer.message}. The graph may have changed; close this and look again.</span>
          </div>
        )}
        {!answer && !failed && <p role="status">Reading the node…</p>}
        {loaded && (
          <form
            id={id}
            className="mm-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (changed) void save();
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor={`${id}-text`}>
                {node.kind === 'skill' ? 'SKILL.md' : node.memorySource === 'profile' ? 'Chunk of USER.md' : 'Chunk of MEMORY.md'}
              </label>
              <textarea id={`${id}-text`} className="input input--mono mm-area" rows={12} spellCheck={false} autoCapitalize="off" readOnly={readOnly} value={text} onChange={(event) => setText(event.target.value)} />
              <p className="field__help">{node.kind === 'skill' ? 'Hermes replaces the whole file. Archiving a skill keeps it: `hermes curator restore` brings it back.' : 'Hermes rewrites this one chunk of the file. The file’s old text stays in History.'}</p>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
