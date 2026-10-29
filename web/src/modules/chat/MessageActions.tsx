// The actions of a message (M1 #12): a toolbar that shows on hover or focus where there is a pointer, the ⋮ button that is always there, and the menu both
// open (a press and hold opens it too). Every action of the toolbar is in the menu, so none is reachable only by hovering; the menu is a sheet, which is
// a dialog with its focus kept inside and Escape to close. What each action does is Chat's (it holds the engine); what each message offers is `message-actions.ts`.
import { useId, useState, type FormEvent } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { afterSheet, ChangeButton, MenuList } from './SessionOrganiser.tsx';
import type { MessageActionId, MessageEntry } from './message-actions.ts';
import { CONTINUE_PROMPT, type ChatMessage } from './chat-session.ts';
import type { Interruption } from './turn-recovery.ts';

const ICONS: Record<MessageActionId, IconName> = {
  'copy-text': 'copy',
  'read-aloud': 'speaker',
  'copy-markdown': 'copy',
  edit: 'draft',
  regenerate: 'refresh',
  retry: 'refresh',
  fork: 'git',
  undo: 'history',
  link: 'link',
  task: 'tasks',
};

/** Copying must run inside the tap that asked for it (iOS Safari refuses a clipboard write that comes later), so it runs before the menu closes; the rest wait for the sheet to be gone. */
const COPIES: Partial<Record<MessageActionId, true>> = { 'copy-text': true, 'copy-markdown': true, link: true };

export interface MessageBarProps {
  entries: readonly MessageEntry[];
  /** The menu is open (a press and hold opens it from outside the bar). */
  open: boolean;
  onOpenChange(open: boolean): void;
  onRun(id: MessageActionId): void;
}

/** The hover toolbar and the ⋮ button of one message, and the menu with all its actions. */
export function MessageBar({ entries, open, onOpenChange, onRun }: MessageBarProps) {
  if (entries.length === 0) return null;
  const run = (id: MessageActionId) => {
    if (COPIES[id]) {
      onRun(id);
      onOpenChange(false);
    } else {
      onOpenChange(false);
      afterSheet(() => onRun(id));
    }
  };
  return (
    <div className="msgbar" data-no-press>
      <div className="msgbar__tools" role="toolbar" aria-label="Message actions">
        {entries
          .filter((entry) => entry.quick)
          .map((entry) => {
            const Button = entry.writes ? ChangeButton : 'button';
            return (
              <Button key={entry.id} type="button" className="btn btn--ghost btn--sm msgbar__tool" data-action={entry.id} aria-label={entry.label.replace('…', '')} title={entry.disabled ?? entry.label.replace('…', '')} disabled={entry.disabled !== undefined} onClick={() => onRun(entry.id)}>
                <Icon name={ICONS[entry.id]} small />
              </Button>
            );
          })}
      </div>
      <button type="button" className="btn btn--ghost btn--sm msgbar__more" aria-label="More message actions" aria-haspopup="dialog" onClick={() => onOpenChange(true)}>
        <Icon name="more" small />
      </button>
      {open && (
        <Sheet title="Message" onClose={() => onOpenChange(false)}>
          <MenuList entries={entries.map((entry) => ({ id: entry.id, icon: ICONS[entry.id], label: entry.label, ...(entry.sub === undefined ? {} : { sub: entry.sub }), writes: entry.writes, ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }), run: () => run(entry.id) }))} />
        </Sheet>
      )}
    </div>
  );
}

/** Editing a message of the owner's to send it again: the words in a box, and what Hermes removes to make room (it is a Tier 1 change; the dialog that follows names it). */
export function EditSheet({ initial, later, onSubmit, onClose }: { message: ChatMessage; initial: string; later: { messages: number; replies: number }; onSubmit(text: string): void; onClose(): void }) {
  const [text, setText] = useState(initial);
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() !== '') onSubmit(text);
  };
  return (
    <Sheet title="Edit and resend" initialFocus="textarea" detents={['half', 'full']} onClose={onClose}>
      <form className="field msgedit" onSubmit={submit}>
        <label className="field__label" htmlFor={id}>
          Your message
        </label>
        <textarea id={id} className="input msgedit__box" rows={5} value={text} onChange={(event) => setText(event.target.value)} />
        <p className="field__help">
          {later.messages <= 1 ? 'Hermes replaces this message and answers the new one.' : `Hermes replaces this message and removes the ${later.messages - 1} message${later.messages === 2 ? '' : 's'} after it${later.replies > 0 ? ` (${later.replies} repl${later.replies === 1 ? 'y' : 'ies'})` : ''}, then answers the new one.`}
        </p>
        <div className="sl-sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <ChangeButton type="submit" className="btn btn--primary" disabled={text.trim() === ''}>
            Resend…
          </ChangeButton>
        </div>
      </form>
    </Sheet>
  );
}

/** The reply of a turn that failed: what went wrong in Hermes's words, and Retry (the last turn only: an earlier failure is history). */
export function FailedTurn({ error, retry, busy }: { error: string; retry: (() => void) | undefined; busy: boolean }) {
  return (
    <div className="banner chat__failed" data-tone="danger" role="group" aria-label="This turn failed">
      <Icon name="alert" />
      <div className="banner__content">
        <p className="banner__title">This turn failed</p>
        <p className="banner__body chat__failed-error">{error}</p>
      </div>
      {retry && (
        <div className="banner__actions">
          <ChangeButton type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={retry}>
            <Icon name="refresh" small />
            Retry
          </ChangeButton>
        </div>
      )}
    </div>
  );
}

const INTERRUPTED_WORDS: Record<Interruption, string> = {
  stopped: 'This reply was stopped. Hermes kept what it had written.',
  unanswered: 'This turn was interrupted: Hermes never answered the last message.',
  'cut-off': 'This turn was interrupted after Hermes’s tool work, before it wrote a reply.',
};

/** What follows a turn nobody finished: what happened to it, and the two ways to go on. */
export function InterruptedNotice({ why, onContinue, onRetry }: { why: Interruption; onContinue(): void; onRetry(): void }) {
  return (
    <div className="banner chat__interrupted" data-tone="warning" role="status">
      <Icon name="alert" />
      <div className="banner__content">
        <p className="banner__title">Interrupted</p>
        <p className="banner__body">{INTERRUPTED_WORDS[why]}</p>
      </div>
      <div className="banner__actions">
        <ChangeButton type="button" className="btn btn--secondary btn--sm" title={`Sends “${CONTINUE_PROMPT}”`} onClick={onContinue}>
          <Icon name="play" small />
          Continue
        </ChangeButton>
        <ChangeButton type="button" className="btn btn--secondary btn--sm" title="Takes the last exchange out and sends the message again" onClick={onRetry}>
          <Icon name="refresh" small />
          Retry
        </ChangeButton>
      </div>
    </div>
  );
}
