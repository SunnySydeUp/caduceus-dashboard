// The credential warning (M1 #08): the model the chat will use belongs to a provider Hermes has no key for. Add key saves one in Hermes's environment
// (a passkey confirms it); Switch model opens the picker. The key goes to Hermes and nowhere else: it is not kept here, and the page never reads one back.
import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { saveProviderKey } from './composer-data.ts';
import type { CredentialIssue } from './composer-model.ts';

function AddKeySheet({ profile, issue, onSaved, onClose }: { profile: string; issue: CredentialIssue & { keyVar: string }; onSaved(): void; onClose(): void }) {
  const id = useId();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (key.trim() === '') return;
    setBusy(true);
    setProblem(undefined);
    const outcome = await saveProviderKey(profile, issue.provider, issue.keyVar, key.trim());
    setBusy(false);
    if (outcome.kind === 'failed') return setProblem(outcome.message);
    if (outcome.kind === 'cancelled') return;
    // The key is only ever in this box: it is gone as soon as Hermes has it.
    setKey('');
    toast(`Key saved for ${issue.provider}`, { tone: 'success', detail: `Hermes stored it as ${issue.keyVar}.` });
    onSaved();
    onClose();
  };
  return (
    <Sheet title={`Add a key for ${issue.provider}`} detents={['auto']} initialFocus="input" onClose={onClose}>
      <form className="cfg-field" onSubmit={(event) => void save(event)}>
        <label className="cfg-label" htmlFor={id}>
          API key
        </label>
        <p className="subtle cfg-help" id={`${id}-help`}>
          Hermes saves it as <span className="mono">{issue.keyVar}</span> in the environment of {profile}. Caduceus does not keep it, and it is never shown again.
        </p>
        <input id={id} className="input mono" type="password" value={key} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${id}-help`} aria-invalid={problem ? true : undefined} onChange={(event) => setKey(event.target.value)} />
        {problem && (
          <p className="error-text" role="alert">
            {problem}
          </p>
        )}
        <div className="cfg-inline cfg-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy || key.trim() === ''}>
            Save key
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}

export function CredentialBanner({ profile, issue, onSwitchModel, onSaved }: { profile: string; issue: CredentialIssue | undefined; onSwitchModel(): void; onSaved(): void }) {
  const [adding, setAdding] = useState(false);
  if (!issue) return null;
  return (
    <>
      <div className="banner" data-tone="warning" role="status">
        <Icon name="key" />
        <div className="banner__content">
          <div className="banner__title">No key for {issue.provider}</div>
          <div className="banner__body">Hermes has no credential for this chat’s provider, so its first message would fail. Add a key, or switch to a model that is set up.</div>
        </div>
        <div className="banner__actions">
          <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding(true)}>
            Add key
          </WriteButton>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onSwitchModel}>
            Switch model
          </button>
        </div>
      </div>
      {adding && <AddKeySheet profile={profile} issue={issue} onSaved={onSaved} onClose={() => setAdding(false)} />}
    </>
  );
}
