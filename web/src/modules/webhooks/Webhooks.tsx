import { useState } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { CopyText } from './CopyText.tsx';
import { CreateWebhook } from './CreateWebhook.tsx';
import { SecretDialog } from './SecretDialog.tsx';
import { createWebhook, deleteWebhook, enableReceiver, setWebhookEnabled, type CreatedWebhook } from './webhook-actions.ts';
import { useWebhooks } from './webhooks-data.ts';
import type { Webhook, WebhookDraft } from './webhooks-model.ts';
import '../profiles/profiles.css';
import './webhooks.css';

interface MenuAction {
  id: string;
  icon: IconName;
  label: string;
  sub?: string;
  danger?: boolean;
  run(): void;
}

/** A card's ⋮ menu, as a sheet (mobile spec §2: nothing is hover-only). */
function WebhookMenu({ webhook, actions, onClose }: { webhook: Webhook; actions: MenuAction[]; onClose(): void }) {
  return (
    <Sheet title={webhook.name} onClose={onClose}>
      <ul className="pf-acts">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              className={`pf-act${action.danger ? ' pf-act--danger' : ''}`}
              onClick={() => {
                onClose();
                // The sheet is closed before the next dialog opens, so the layers never stack.
                void closeAllLayers().then(action.run);
              }}
            >
              <Icon name={action.icon} />
              <span>
                <span>{action.label}</span>
                {action.sub && <small>{action.sub}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function WebhookCard({ webhook, busy, onToggle, onMenu }: { webhook: Webhook; busy: boolean; onToggle(): void; onMenu(): void }) {
  return (
    <li className="wh-card" data-enabled={webhook.enabled}>
      <div className="wh-card__top">
        <div className="wh-card__id">
          <h3 className="wh-card__name">{webhook.name}</h3>
          <StatusBadge state={webhook.enabled ? 'online' : 'offline'} label={webhook.enabled ? 'On' : 'Off'} variant="plain" />
        </div>
        <WriteButton type="button" role="switch" className="switch" aria-checked={webhook.enabled} aria-label={webhook.name} disabled={busy} onClick={onToggle} />
      </div>
      {webhook.description && <p className="wh-card__desc">{webhook.description}</p>}
      <code className="wh-card__url mono">{webhook.url}</code>
      <div className="wh-card__tags">
        {webhook.events.length === 0 ? <span className="tag">Every event</span> : webhook.events.map((event) => <span key={event} className="tag mono">{event}</span>)}
        <span className="tag" data-tone="accent">
          {webhook.deliverOnly ? `Sends the payload to ${webhook.deliver}` : `Result to ${webhook.deliver}`}
        </span>
        {webhook.skills.map((skill) => (
          <span key={skill} className="tag mono">
            skill {skill}
          </span>
        ))}
        {webhook.script && <span className="tag" data-tone="warning">Runs a script</span>}
        <span className="tag">{webhook.secretSet ? 'Secret set' : 'No secret'}</span>
      </div>
      <div className="wh-card__actions">
        <CopyText text={webhook.url} what={`the address of ${webhook.name}`} label="Copy address" />
        <button type="button" className="btn btn--ghost btn--icon wh-card__more" aria-label={`Actions for ${webhook.name}`} aria-haspopup="dialog" onClick={onMenu}>
          <Icon name="dots-v" />
        </button>
      </div>
    </li>
  );
}

/** Connect › Webhooks: Hermes's webhook receiver and the subscriptions of the profile this tab is scoped to. */
export function Webhooks() {
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const view = useWebhooks(profile);
  const { receiver } = view;
  const [creating, setCreating] = useState(false);
  /** The secret of the webhook just created, for as long as its dialog is open; nothing else holds it. */
  const [created, setCreated] = useState<CreatedWebhook>();
  const [menu, setMenu] = useState<Webhook>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [switching, setSwitching] = useState(false);

  const working = async (name: string, run: () => Promise<void>) => {
    setBusy((now) => new Set(now).add(name));
    try {
      await run();
    } finally {
      setBusy((now) => {
        const next = new Set(now);
        next.delete(name);
        return next;
      });
    }
  };

  const switchOn = async () => {
    if (!profile) return;
    setSwitching(true);
    const outcome = await enableReceiver(profile);
    setSwitching(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') toast(`The webhook receiver of ${profile} is on`, { detail: outcome.body.restartStarted ? 'Hermes is restarting the gateway to apply it.' : 'It applies when the gateway restarts.' });
    if (outcome.kind !== 'cancelled') await view.reload();
  };

  /** Runs the create; the form closes only when Hermes made the webhook, and then its secret is shown once. */
  const create = async (draft: WebhookDraft): Promise<boolean> => {
    if (!profile) return false;
    const outcome = await createWebhook(draft, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    setCreated(outcome.body);
    await view.reload();
    return true;
  };

  const toggle = (webhook: Webhook) =>
    profile &&
    working(webhook.name, async () => {
      const outcome = await setWebhookEnabled(webhook, profile, !webhook.enabled);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') toast(`${webhook.name} is switched ${webhook.enabled ? 'off' : 'on'} for ${profile}`, { detail: webhook.enabled ? 'Hermes now refuses its events.' : 'Hermes accepts its events again.' });
      await view.reload();
    });

  const remove = (webhook: Webhook) =>
    profile &&
    working(webhook.name, async () => {
      const outcome = await deleteWebhook(webhook, profile);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') toast(`Deleted ${webhook.name} from ${profile}`);
      if (outcome.kind !== 'cancelled') await view.reload();
    });

  const menuActions = (webhook: Webhook): MenuAction[] => [
    { id: 'copy', icon: 'copy', label: 'Copy address', sub: webhook.url, run: () => void navigator.clipboard?.writeText(webhook.url).then(() => toast('Copied the address'), () => toast('Could not copy: this browser did not allow it', { tone: 'warning' })) },
    { id: 'toggle', icon: 'sliders', label: webhook.enabled ? 'Switch off' : 'Switch on', sub: webhook.enabled ? 'Hermes refuses its events until it is back on' : 'Hermes accepts its events again', run: () => void toggle(webhook) },
    { id: 'delete', icon: 'trash', label: 'Delete…', sub: `You confirm · from ${profile}`, danger: true, run: () => void remove(webhook) },
  ];

  const empty = receiver !== undefined && receiver.subscriptions.length === 0;

  return (
    <div className="wh">
      <PageHeader
        overline="Connect"
        title="Webhooks"
        subtitle={
          profile ? (
            <span className="wh-head__meta">
              <Sigil name={profile} size="xs" />
              <span>
                Webhooks of <strong>{profile}</strong>
              </span>
              {receiver && <span className="subtle">{receiver.subscriptions.length} {receiver.subscriptions.length === 1 ? 'subscription' : 'subscriptions'}</span>}
            </span>
          ) : undefined
        }
        actions={
          receiver?.enabled ? (
            <WriteButton type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              Create webhook
            </WriteButton>
          ) : undefined
        }
      />
      <p className="help-text">
        A <Term id="webhook">webhook</Term> is an address an outside service, such as GitHub, posts events to. Hermes turns each event into an agent run or a message. Each one has a <Term id="one-time-secret">one-time secret</Term> that proves an event is genuine. The receiver belongs to the profile’s <AppLink to="/connect/gateway">gateway</AppLink>.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its webhooks could not be listed{receiver ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!receiver && !view.failed && <Loading label="Loading webhooks…" lines={3} onRetry={() => void view.reload()} />}
      {receiver && (
        <section className="wh-receiver" aria-label="Webhook receiver">
          <div className="wh-receiver__text">
            <h2 className="wh-receiver__title">
              Receiver
              <StatusBadge state={receiver.enabled ? 'online' : 'offline'} label={receiver.enabled ? 'On' : 'Off'} variant="plain" />
            </h2>
            <p className="wh-receiver__note">
              {receiver.enabled ? (
                <>
                  Listens at <span className="mono">{receiver.baseUrl}</span>. That address is on this machine: an outside service reaches it only if you expose that port yourself, with a tunnel or a reverse proxy.
                </>
              ) : (
                'The webhook platform is off for this profile, so nothing can be created. Switching it on restarts the profile’s gateway.'
              )}
            </p>
          </div>
          {!receiver.enabled && (
            <WriteButton type="button" className="btn btn--primary" disabled={switching} aria-busy={switching} onClick={() => void switchOn()}>
              <Icon name="lock" />
              Switch on the receiver…
            </WriteButton>
          )}
        </section>
      )}
      {empty && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="webhook" />
          </span>
          <p>No webhooks yet.</p>
          <p>A webhook lets GitHub, Stripe or any service you run start Hermes when something happens. {receiver.enabled ? 'Create one to get its address and its secret.' : 'Switch the receiver on first, then create one.'}</p>
          {receiver.enabled ? (
            <WriteButton type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              Create webhook
            </WriteButton>
          ) : (
            <button type="button" className="btn btn--primary" disabled title="Switch the receiver on first">
              <Icon name="plus" />
              Create webhook
            </button>
          )}
        </div>
      )}
      {receiver && receiver.subscriptions.length > 0 && profile && (
        <ul className="wh-cards" aria-label="Webhooks">
          {receiver.subscriptions.map((webhook) => (
            <WebhookCard key={webhook.name} webhook={webhook} busy={busy.has(webhook.name)} onToggle={() => void toggle(webhook)} onMenu={() => setMenu(webhook)} />
          ))}
        </ul>
      )}
      {profile && creating && <CreateWebhook profile={profile} onCreate={create} onClose={() => setCreating(false)} />}
      {created && <SecretDialog created={created} onClose={() => setCreated(undefined)} />}
      {menu && <WebhookMenu webhook={menu} actions={menuActions(menu)} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
