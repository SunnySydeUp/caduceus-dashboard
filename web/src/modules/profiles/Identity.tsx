import { useEffect, useId, useState, type FormEvent } from 'react';
import { saveAssistantName, useAssistantName } from '../../profile-preferences.ts';
import { toast } from '../../shell/toasts.ts';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { FileEditor } from './FileEditor.tsx';
import type { TabProps } from './ProfileDetail.tsx';

/** The assistant's display name: Caduceus's own preference for this profile, shown in chat headers. Hermes never sees it. */
export function Identity({ card }: TabProps) {
  const id = useId();
  const saved = useAssistantName(card.name);
  const [value, setValue] = useState(saved ?? '');
  const [busy, setBusy] = useState(false);
  // What the server says (it answers a moment after the tab opens) fills the field until the owner has typed.
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (!typed) setValue(saved ?? '');
  }, [saved, typed]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const stored = await saveAssistantName(card.name, value);
      setValue(stored ?? '');
      setTyped(false);
      toast(stored ? `Chats with ${card.name} now say “${stored}”` : 'Assistant name cleared', { tone: 'info' });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The name was not saved.', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <form className="stack pf-form" onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Assistant display name
          </label>
          <input
            id={id}
            className="input"
            value={value}
            maxLength={60}
            autoComplete="off"
            placeholder={card.name}
            aria-describedby={`${id}-help`}
            onChange={(event) => {
              setTyped(true);
              setValue(event.target.value);
            }}
          />
          <p className="field__help" id={`${id}-help`}>
            What chat headers call this profile’s assistant. Caduceus keeps it; it is never written to this profile’s files or to Hermes. Leave it empty to use the profile’s name.
          </p>
        </div>
        <div className="row">
          <WriteButton type="submit" className="btn btn--primary" disabled={busy || value.trim() === (saved ?? '')} aria-busy={busy}>
            Save name
          </WriteButton>
        </div>
      </form>
      <p className="help-text">
        The <Term id="soul">SOUL</Term> is who this agent is. Hermes keeps it in the profile’s SOUL.md and reads it at the start of every conversation.
      </p>
      <FileEditor card={card} id="soul" />
    </div>
  );
}
