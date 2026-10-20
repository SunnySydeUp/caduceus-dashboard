import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { addMemory } from './hindsight-actions.ts';
import { memoryProblem, parseTags } from './hindsight-model.ts';
import './memory.css';

/** Adds a memory to a bank by hand (T1). Hindsight takes it in and extracts facts from it in the background. */
export function AddMemorySheet({ profile, bank, onClose, onAdded }: { profile: string; bank: string; onClose(): void; onAdded(): void }) {
  const id = useId();
  const readOnly = useReadOnly();
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const submit = async () => {
    const parsed = parseTags(tags);
    const invalid = memoryProblem(content, parsed);
    if (invalid) return setProblem(invalid);
    setProblem(undefined);
    setBusy(true);
    const outcome = await addMemory(bank, profile, content, parsed);
    setBusy(false);
    if (outcome.kind === 'failed') return setProblem(outcome.message);
    if (outcome.kind !== 'done') return;
    toast('Memory added', { detail: 'Hindsight is extracting facts from it. It may take a moment to show in the list.' });
    onAdded();
    onClose();
  };

  return (
    <Sheet
      title={`Add a memory to ${bank}`}
      detents={['full']}
      className="mm-sheet"
      onClose={onClose}
      footer={
        <div className="mm-actions mm-foot">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy || readOnly} aria-busy={busy}>
            <Icon name="check" />
            Add memory…
          </WriteButton>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="mm-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {readOnly && <p className="mm-note" role="status">Caduceus is in read-only mode, so nothing can be added.</p>}
        <div className="field">
          <label className="field__label" htmlFor={`${id}-content`}>
            What should Hindsight remember?
          </label>
          <textarea id={`${id}-content`} className="input mm-area" rows={6} value={content} onChange={(event) => setContent(event.target.value)} />
          <p className="field__help">Write it as a sentence or a few: Hindsight reads it and keeps the facts it finds.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-tags`}>
            Tags (optional)
          </label>
          <input id={`${id}-tags`} className="input" value={tags} onChange={(event) => setTags(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <p className="field__help">Words separated by commas or spaces. Recall can be narrowed by them.</p>
        </div>
        {problem && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">{problem}</span>
          </div>
        )}
      </form>
    </Sheet>
  );
}
