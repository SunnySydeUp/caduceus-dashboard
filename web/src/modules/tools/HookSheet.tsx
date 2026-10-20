import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { emptyHookForm, hookProblems, type HookForm } from './hooks-model.ts';

interface HookSheetProps {
  profile: string;
  /** The events Hermes can run a hook on. */
  events: readonly string[];
  onSubmit(form: HookForm): Promise<boolean>;
  onClose(): void;
}

/** The create form of a shell hook: a full-screen sheet on a phone, a dialog elsewhere. The command is typed whole; the confirmation shows it again. */
export function HookSheet({ profile, events, onSubmit, onClose }: HookSheetProps) {
  const id = useId();
  const [form, setForm] = useState<HookForm>(emptyHookForm);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = attempted ? hookProblems(form, events) : {};
  const set = (change: Partial<HookForm>) => setForm((current) => ({ ...current, ...change }));

  const submit = async () => {
    setAttempted(true);
    if (Object.keys(hookProblems(form, events)).length > 0) return;
    setBusy(true);
    const done = await onSubmit(form);
    setBusy(false);
    if (done) onClose();
  };

  const error = (name: keyof HookForm) =>
    shown[name] ? (
      <p className="field__error" id={`${id}-${name}-error`} role="alert">
        <Icon name="alert" small />
        {shown[name]}
      </p>
    ) : null;
  const invalid = (name: keyof HookForm) => ({ 'aria-invalid': shown[name] ? true : undefined, 'aria-describedby': shown[name] ? `${id}-${name}-error` : undefined });

  return (
    <Sheet
      title={`Create a hook · ${profile}`}
      detents={['full']}
      className="tl-sheet"
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="tl-actions tl-foot">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="check" />
            Create hook…
          </WriteButton>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="tl-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="tl-note">
          A <Term id="shell-hook">shell hook</Term> is a command Hermes runs on this computer, with the access of your account, when an event happens in a session of this profile. Creating one is a Tier 3 action: the confirmation shows the whole command and you type it.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-event`}>
            Event
          </label>
          <select id={`${id}-event`} data-first className="input" value={form.event} {...invalid('event')} onChange={(event) => set({ event: event.target.value })}>
            <option value="">Choose an event…</option>
            {events.map((event) => (
              <option key={event} value={event}>
                {event}
              </option>
            ))}
          </select>
          {error('event')}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-command`}>
            Command
          </label>
          <input id={`${id}-command`} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="/Users/you/hooks/notify.sh" value={form.command} {...invalid('command')} onChange={(event) => set({ command: event.target.value })} />
          <p className="field__help">One line: the path of a script, or a program and its arguments. Hermes sends the event’s details to it as JSON on its standard input.</p>
          {error('command')}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-matcher`}>
            Matcher (optional)
          </label>
          <input id={`${id}-matcher`} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="terminal" value={form.matcher} onChange={(event) => set({ matcher: event.target.value })} />
          <p className="field__help">For tool events: which tool calls the hook applies to. Empty means all of them.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-timeout`}>
            Timeout in seconds (optional)
          </label>
          <input id={`${id}-timeout`} className="input input--mono" inputMode="numeric" autoComplete="off" value={form.timeout} placeholder="60" {...invalid('timeout')} onChange={(event) => set({ timeout: event.target.value })} />
          <p className="field__help">How long Hermes lets the command run. Hermes uses 60 when this is empty.</p>
          {error('timeout')}
        </div>
      </form>
    </Sheet>
  );
}
