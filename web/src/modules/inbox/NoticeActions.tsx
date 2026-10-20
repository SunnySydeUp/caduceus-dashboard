// What the owner does about a notice (M3 #09): a tap runs the action the source put on it. An action that needs words first (Reject + note, Answer,
// Reassign) opens a sheet with one field; on a phone the sheet sits above the soft keyboard (`--kb-inset`), so the field and its button stay in view.
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { InboxAction } from '@caduceus/contracts/inbox';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { runNoticeAction, type NoticeOutcome } from './inbox-actions.ts';

type Input = NonNullable<InboxAction['input']>;

function InputSheet({ action, input, busy, onSend, onClose }: { action: InboxAction; input: Input; busy: boolean; onSend(text: string): void; onClose(): void }) {
  const [text, setText] = useState('');
  const id = useId();
  const ready = !input.required || text.trim() !== '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !busy) onSend(text.trim());
  };
  return (
    <Sheet title={action.label} className="ib-sheet" initialFocus="textarea" onClose={onClose}>
      <form className="ib-note" onSubmit={submit}>
        <label className="field__label" htmlFor={id}>
          {input.label}
        </label>
        <textarea id={id} className="input" rows={4} value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} />
        <WriteButton type="submit" className="btn btn--primary" disabled={!ready || busy}>
          {action.label}
        </WriteButton>
      </form>
    </Sheet>
  );
}

/** Runs notice actions, with the sheet for the ones that need words; `sheet` goes anywhere in the tree. `onFailed` hears why an action did not go. */
export function useNoticeActions(onFailed?: (message: string) => void): { run(action: InboxAction): void; busy: string | undefined; sheet: ReactNode } {
  const [asking, setAsking] = useState<InboxAction>();
  const [busy, setBusy] = useState<string>();
  const send = async (action: InboxAction, typed?: string) => {
    setBusy(action.id);
    const outcome: NoticeOutcome = await runNoticeAction(action, typed).catch((failure): NoticeOutcome => ({ kind: 'failed', message: failure instanceof Error ? failure.message : String(failure) }));
    setBusy(undefined);
    if (outcome.kind === 'done') {
      setAsking(undefined);
      toast(`${action.label}: sent`, { tone: 'success' });
    } else if (outcome.kind === 'failed') {
      if (onFailed) onFailed(outcome.message);
      else toast(outcome.message, { tone: 'danger' });
    }
  };
  return {
    run: (action) => (action.input ? setAsking(action) : void send(action)),
    busy,
    sheet: asking?.input && <InputSheet action={asking} input={asking.input} busy={busy !== undefined} onSend={(text) => void send(asking, text)} onClose={() => setAsking(undefined)} />,
  };
}
