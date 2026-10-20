// The changes Connect › Webhooks makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (switching
// the receiver on and creating T2, creating with a script T3, delete T1, a subscription's switch T0). The caller shows toasts and
// reloads; this says what happened. Caduceus keeps nothing of what it sends, and a secret is never put in a message or a toast.
import { raiseRestartNeeded } from '../../restart-to-apply.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { createRequest, deleteRequest, enableReceiverRequest, readCreated, readEnableAnswer, setEnabledRequest, webhookName, webhookTier, type Webhook, type WebhookDraft } from './webhooks-model.ts';

/** What came of switching the receiver on: Hermes restarts the gateway itself when it can. */
export interface ReceiverEnabled {
  restartStarted: boolean;
}

/** Switches the profile's webhook receiver on (T2). Hermes writes the config and restarts the gateway; when it could not, the restart-to-apply banner takes over. */
export async function enableReceiver(profile: string): Promise<ActionOutcome<ReceiverEnabled>> {
  const outcome = await runTiered(
    fetchTiered({
      ...enableReceiverRequest(profile),
      confirm: {
        title: `Switch on the webhook receiver for ${profile}?`,
        text: `Hermes turns the webhook platform on in this profile’s config and restarts its gateway to apply it. Chats on that gateway are interrupted for a moment.`,
        object: profile,
        profile,
        confirmLabel: 'Switch on and restart',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const answer = readEnableAnswer(outcome.body);
  if (answer.needsRestart) await raiseRestartNeeded(profile, 'Webhook receiver switched on');
  return { kind: 'done', body: { restartStarted: answer.restartStarted } };
}

/** What a create gives back: the subscription, and its secret, which the caller shows once and drops. */
export interface CreatedWebhook {
  webhook: Webhook;
  secret: string;
}

/** Creates a subscription (T2; with a script T3: its name is typed to confirm). Hermes makes the secret and answers with it once. */
export async function createWebhook(draft: WebhookDraft, profile: string): Promise<ActionOutcome<CreatedWebhook>> {
  const name = webhookName(draft.name);
  const tier = webhookTier(draft);
  const outcome = await runTiered(
    fetchTiered({
      ...createRequest(draft, profile),
      confirm: {
        title: `Create the webhook ${name} for ${profile}?`,
        text: tier === 'T3' ? `The subscription runs ${draft.script.trim()} on every event it receives, so it runs code on this machine. Hermes makes its secret and shows it once.` : 'Hermes makes the subscription’s secret and shows it once. Caduceus does not keep it.',
        object: name,
        profile,
        confirmLabel: 'Create webhook',
        recoverability: { undoable: true, note: 'Delete the webhook to take it back.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const { webhook, secret } = readCreated(outcome.body);
  if (!webhook || !secret) return { kind: 'failed', message: 'Hermes created the webhook but did not give its secret. Delete it and create it again.' };
  return { kind: 'done', body: { webhook, secret } };
}

/** Switches a subscription on or off (T0: no dialog). Hermes reloads its file, so there is no restart. */
export function setWebhookEnabled(webhook: Webhook, profile: string, enabled: boolean): Promise<ActionOutcome> {
  return runTiered(fetchTiered(setEnabledRequest(webhook.name, enabled, profile)));
}

/** Deletes a subscription (T1). The service that posts to it gets a refusal from then on. */
export function deleteWebhook(webhook: Webhook, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...deleteRequest(webhook.name, profile),
      confirm: {
        title: `Delete the webhook ${webhook.name} from ${profile}?`,
        text: `Events posted to ${webhook.url} are refused from now on, and its secret is gone with it. Creating one with the same name makes a new secret.`,
        object: webhook.name,
        profile,
        confirmLabel: 'Delete webhook',
      },
    }),
  );
}
