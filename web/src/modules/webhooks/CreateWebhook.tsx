import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Term } from '../../shell/Term.tsx';
import { emptyDraft, validateWebhookForm, webhookName, webhookTier, type WebhookDraft } from './webhooks-model.ts';

/** Where a result can go besides the log: a hint for the field, not a limit (Hermes accepts any platform it knows). */
const TARGETS = ['log', 'telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'email', 'sms'];

function Problem({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {text}
    </p>
  );
}

/**
 * The create form, a full-height sheet with a sticky Create on a phone and a dialog elsewhere. Problems show from the first Create on,
 * in Hermes's own words; `onCreate` runs the tiered request and says whether the form is done.
 */
export function CreateWebhook({ profile, onCreate, onClose }: { profile: string; onCreate(draft: WebhookDraft): Promise<boolean>; onClose(): void }) {
  const formId = useId();
  const id = useId();
  const [draft, setDraft] = useState<WebhookDraft>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = attempted ? validateWebhookForm(draft) : {};
  const tier = webhookTier(draft);
  const set = <K extends keyof WebhookDraft>(key: K, value: WebhookDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setAttempted(true);
    if (Object.keys(validateWebhookForm(draft)).length > 0) {
      requestAnimationFrame(() => document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    const done = await onCreate(draft);
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Sheet
      title={`Create a webhook for ${profile}`}
      detents={['full']}
      className="wh-sheet"
      initialFocus={`[id="${id}-name"]`}
      onClose={onClose}
      footer={
        <WriteButton type="submit" form={formId} className="btn btn--primary" disabled={busy} aria-busy={busy}>
          <Icon name="lock" />
          {tier === 'T3' ? 'Create (Tier 3)…' : 'Create…'}
        </WriteButton>
      }
    >
      <form
        id={formId}
        className="wh-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="help-text">
          A webhook is an address an outside service posts events to. Hermes makes its <Term id="one-time-secret">one-time secret</Term> when you create it, and shows it once.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-name`}>
            Name <span className="wh-required">(required)</span>
          </label>
          <input
            id={`${id}-name`}
            className="input input--mono"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={draft.name}
            aria-invalid={problems.name ? true : undefined}
            aria-describedby={[`${id}-name-help`, problems.name ? `${id}-name-error` : undefined].filter(Boolean).join(' ')}
            onChange={(event) => set('name', event.target.value)}
          />
          <p className="field__help" id={`${id}-name-help`}>
            It becomes the end of the address: {draft.name.trim() === '' ? 'webhooks/name' : `webhooks/${webhookName(draft.name)}`}. Lowercase letters, numbers, hyphens and underscores.
          </p>
          <Problem id={`${id}-name-error`} text={problems.name} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-description`}>
            Description
          </label>
          <input id={`${id}-description`} className="input" value={draft.description} onChange={(event) => set('description', event.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-events`}>
            Events
          </label>
          <input id={`${id}-events`} className="input input--mono" autoCapitalize="off" spellCheck={false} value={draft.events} aria-describedby={`${id}-events-help`} onChange={(event) => set('events', event.target.value)} />
          <p className="field__help" id={`${id}-events-help`}>
            The event names it accepts, separated by commas, such as push, pull_request. Empty accepts every event.
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-prompt`}>
            Prompt
          </label>
          <textarea id={`${id}-prompt`} className="input" rows={4} value={draft.prompt} aria-describedby={`${id}-prompt-help`} onChange={(event) => set('prompt', event.target.value)} />
          <p className="field__help" id={`${id}-prompt-help`}>
            What the agent is asked for each event. Use {'{field}'} to put a field of the payload in it, such as {'{repository.name}'}.
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-deliver`}>
            Send the result to
          </label>
          <input id={`${id}-deliver`} className="input input--mono" list={`${id}-targets`} autoCapitalize="off" spellCheck={false} value={draft.deliver} aria-invalid={problems.deliver ? true : undefined} aria-describedby={problems.deliver ? `${id}-deliver-error` : undefined} onChange={(event) => set('deliver', event.target.value)} />
          <datalist id={`${id}-targets`}>
            {TARGETS.map((target) => (
              <option key={target} value={target} />
            ))}
          </datalist>
          <Problem id={`${id}-deliver-error`} text={problems.deliver} />
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.deliverOnly} onChange={(event) => set('deliverOnly', event.target.checked)} />
          <span>Send the payload as the message, with no agent run</span>
        </label>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-chat`}>
            Chat to send it to
          </label>
          <input id={`${id}-chat`} className="input input--mono" autoCapitalize="off" spellCheck={false} value={draft.deliverChatId} aria-describedby={`${id}-chat-help`} onChange={(event) => set('deliverChatId', event.target.value)} />
          <p className="field__help" id={`${id}-chat-help`}>
            The chat id on that platform. Empty uses the platform’s home channel.
          </p>
        </div>
        <details className="wh-advanced" open={draft.script.trim() !== '' || draft.skills.trim() !== ''}>
          <summary>Advanced</summary>
          <div className="wh-form">
            <div className="field">
              <label className="field__label" htmlFor={`${id}-skills`}>
                Skills
              </label>
              <input id={`${id}-skills`} className="input input--mono" autoCapitalize="off" spellCheck={false} value={draft.skills} aria-describedby={`${id}-skills-help`} onChange={(event) => set('skills', event.target.value)} />
              <p className="field__help" id={`${id}-skills-help`}>
                Skills the agent loads for each event, separated by commas.
              </p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-script`}>
                Script
              </label>
              <input id={`${id}-script`} className="input input--mono" autoCapitalize="off" spellCheck={false} value={draft.script} aria-describedby={`${id}-script-help`} onChange={(event) => set('script', event.target.value)} />
              <p className="field__help" id={`${id}-script-help`}>
                A script Hermes runs on every event first. It runs code on this machine, so a webhook with one is a Tier 3 action: you type its name to confirm.
              </p>
            </div>
          </div>
        </details>
      </form>
    </Sheet>
  );
}
