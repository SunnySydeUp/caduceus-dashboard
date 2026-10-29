// What the owner does about a notice (M3 #09): a tap runs the action the source put on it. An action that needs words first (Reject + note, Answer,
// Reassign) opens a sheet with one field; on a phone the sheet sits above the soft keyboard (`--kb-inset`), so the field and its button stay in view.
// The sheet says what it is about (the item's title and what it says), and its button says that a confirmation follows, which shows the words again.
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { InboxAction } from '@caduceus/contracts/inbox';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { runNoticeAction, type NoticeOutcome } from './inbox-actions.ts';
import { doneWords } from './inbox-model.ts';

type Input = NonNullable<InboxAction['input']>;

/** What an action is about, for the sheet that asks for words and for the toast after it: the item's title, what it says (the question, the worker's note) and whose it is. */
export interface ActionAbout {
  title: string;
  quote?: string;
  profile?: string;
}

function InputSheet({ action, input, about, busy, error, onSend, onClose }: { action: InboxAction; input: Input; about: ActionAbout | undefined; busy: boolean; error: string | undefined; onSend(text: string): void; onClose(): void }) {
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
        {about && (
          <blockquote className="ib-about">
            <b>{about.title}</b>
            {about.quote && <p>{about.quote}</p>}
          </blockquote>
        )}
        <label className="field__label" htmlFor={id}>
          {input.label}
        </label>
        <textarea id={id} className="input" rows={4} value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} />
        {error && (
          <p className="field__error" role="alert">
            <Icon name="alert" small />
            {error}
          </p>
        )}
        <WriteButton type="submit" className="btn btn--primary" disabled={!ready || busy}>
          {action.confirm ? 'Review and send' : action.label}
        </WriteButton>
      </form>
    </Sheet>
  );
}

/** Runs notice actions, with the sheet for the ones that need words; `sheet` goes anywhere in the tree. `onFailed` hears why an action did not go. */
export function useNoticeActions(onFailed?: (message: string) => void): { run(action: InboxAction, about?: ActionAbout): void; busy: string | undefined; sheet: ReactNode } {
  const [asking, setAsking] = useState<{ action: InboxAction; about: ActionAbout | undefined }>();
  const [busy, setBusy] = useState<string>();
  /** Why the last try did not go, said in the sheet that is open for it: the words are there to try again. */
  const [sheetError, setSheetError] = useState<string>();
  const send = async (action: InboxAction, about: ActionAbout | undefined, typed?: string) => {
    setBusy(action.id);
    setSheetError(undefined);
    const outcome: NoticeOutcome = await runNoticeAction(action, typed).catch((failure): NoticeOutcome => ({ kind: 'failed', message: failure instanceof Error ? failure.message : String(failure) }));
    setBusy(undefined);
    if (outcome.kind === 'done') {
      setAsking(undefined);
      const { message, detail } = doneWords(action, about?.profile);
      toast(message, { tone: 'success', ...(detail === undefined ? {} : { detail }) });
    } else if (outcome.kind === 'failed') {
      if (action.input) setSheetError(outcome.message);
      else if (onFailed) onFailed(outcome.message);
      else toast(outcome.message, { tone: 'danger' });
    }
  };
  return {
    run: (action, about) => (action.input ? setAsking({ action, about }) : void send(action, about)),
    busy,
    sheet: asking?.action.input && <InputSheet action={asking.action} input={asking.action.input} about={asking.about} busy={busy !== undefined} error={sheetError} onSend={(text) => void send(asking.action, asking.about, text)} onClose={() => { setAsking(undefined); setSheetError(undefined); }} />,
  };
}
