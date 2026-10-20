import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { CopyText } from './CopyText.tsx';
import type { CreatedWebhook } from './webhook-actions.ts';

/**
 * The one place a webhook's secret is shown. It lives only in the props of this dialog (the screen holds it in state while the
 * dialog is open and drops it on close): Caduceus has no copy and Hermes will not list it again. A tap outside or Escape does not
 * close it, so a stray gesture cannot lose a secret nobody has copied yet.
 */
export function SecretDialog({ created, onClose }: { created: CreatedWebhook; onClose(): void }) {
  const { webhook, secret } = created;
  return (
    <Sheet
      title={`Secret for ${webhook.name}`}
      role="alertdialog"
      dismissOnScrim={false}
      escapable={false}
      initialFocus="[data-copy-first] button"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          <Icon name="check" />
          I have saved the secret
        </button>
      }
    >
      <div className="wh-secret-box">
        <div className="banner" data-tone="warning" role="note">
          <Icon name="alert" />
          <span className="banner__content">
            <span className="banner__title">This is the only time it is shown.</span>
            <span className="banner__body"> Caduceus does not keep it and Hermes does not list it. Copy it now and give it to the service that will post events. If it is lost, delete the webhook and create it again.</span>
          </span>
        </div>
        <div className="field">
          <span className="field__label">Secret</span>
          <code className="wh-secret mono" data-testid="webhook-secret">
            {secret}
          </code>
          <div className="wh-secret__actions" data-copy-first>
            <CopyText text={secret} what="the secret" label="Copy secret" />
          </div>
          <p className="field__help">
            It is a <Term id="one-time-secret">one-time secret</Term>: nobody can look it up again.
          </p>
        </div>
        <div className="field">
          <span className="field__label">Address to post events to</span>
          <code className="wh-url mono">{webhook.url}</code>
          <div className="wh-secret__actions">
            <CopyText text={webhook.url} what="the address" label="Copy address" />
          </div>
          <p className="field__help">Hermes checks each event against the secret before it acts on it. That address is on this machine unless you expose the receiver’s port yourself.</p>
        </div>
      </div>
    </Sheet>
  );
}
