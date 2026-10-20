// What Connect › Webhooks knows about Hermes's webhook receiver and its subscriptions, free of the DOM and of React. It is made only
// of what Hermes answers (`GET /api/webhooks`) and nothing is kept (D1: Hermes is the source of truth). Hermes never lists a
// subscription's secret, only whether one is set: the secret is in the one answer to creating it, and nowhere after.

/** A subscription: a named address that an outside service posts events to, which Hermes turns into an agent run or a message. */
export interface Webhook {
  name: string;
  description: string;
  events: string[];
  /** Where the result goes: `log`, or a platform's name (`telegram`). */
  deliver: string;
  /** The payload is sent as the message, with no agent run. */
  deliverOnly: boolean;
  prompt: string;
  /** A script Hermes runs on the payload first; a subscription with one runs code, so creating it is Tier 3. */
  script: string;
  skills: string[];
  createdAt: string | undefined;
  /** The address the outside service posts to. */
  url: string;
  secretSet: boolean;
  enabled: boolean;
}

export interface WebhookReceiver {
  /** The webhook platform is switched on in the profile's config. */
  enabled: boolean;
  baseUrl: string;
  subscriptions: Webhook[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function parseWebhook(raw: unknown): Webhook | undefined {
  const route = record(raw);
  if (typeof route.name !== 'string' || route.name === '') return undefined;
  return {
    name: route.name,
    description: text(route.description),
    events: strings(route.events),
    deliver: text(route.deliver) || 'log',
    deliverOnly: route.deliver_only === true,
    prompt: text(route.prompt),
    script: text(route.script),
    skills: strings(route.skills),
    createdAt: text(route.created_at) || undefined,
    url: text(route.url),
    secretSet: route.secret_set === true,
    enabled: route.enabled !== false,
  };
}

/** Hermes's receiver and subscriptions, in the order it gave them; an answer that is not one is a receiver that is off with none. */
export function parseWebhooks(body: unknown): WebhookReceiver {
  const answer = record(body);
  return {
    enabled: answer.enabled === true,
    baseUrl: text(answer.base_url),
    subscriptions: (Array.isArray(answer.subscriptions) ? answer.subscriptions : []).flatMap((raw) => parseWebhook(raw) ?? []),
  };
}

/** Where Hermes lists a profile's webhooks: each profile has its own receiver and subscriptions. */
export const webhooksListPath = (profile: string) => `/api/webhooks?profile=${encodeURIComponent(profile)}`;

/** What the create form holds: text as typed. */
export interface WebhookDraft {
  name: string;
  description: string;
  /** Event names separated by commas or new lines; none means every event. */
  events: string;
  prompt: string;
  /** Skills for the run, separated by commas or new lines. */
  skills: string;
  deliver: string;
  deliverOnly: boolean;
  deliverChatId: string;
  script: string;
}

export const emptyDraft = (): WebhookDraft => ({ name: '', description: '', events: '', prompt: '', skills: '', deliver: 'log', deliverOnly: false, deliverChatId: '', script: '' });

/** The name as Hermes will keep it: trimmed, lower case, spaces as hyphens. */
export const webhookName = (typed: string): string => typed.trim().toLowerCase().replaceAll(' ', '-');

const list = (typed: string): string[] => typed.split(/[,\n]/).flatMap((item) => (item.trim() === '' ? [] : [item.trim()]));

/** The problems Hermes would refuse a draft for, by field, in Hermes's own words. A draft with none is `{}`. */
export function validateWebhookForm(draft: WebhookDraft): Partial<Record<'name' | 'deliver', string>> {
  const problems: Partial<Record<'name' | 'deliver', string>> = {};
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(webhookName(draft.name))) problems.name = 'Invalid name. Use lowercase alphanumeric with hyphens/underscores.';
  if (draft.deliverOnly && (draft.deliver.trim() || 'log') === 'log') problems.deliver = "Direct delivery requires a real target (telegram, discord, …), not 'log'.";
  return problems;
}

/** A change the page sends to Hermes. */
export interface WebhookRequestToSend {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

/** Creates a subscription. Hermes makes its secret and answers with it once. */
export function createRequest(draft: WebhookDraft, profile: string): WebhookRequestToSend {
  const script = draft.script.trim();
  const chat = draft.deliverChatId.trim();
  return {
    method: 'POST',
    path: `/api/webhooks?profile=${encodeURIComponent(profile)}`,
    body: {
      name: webhookName(draft.name),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      events: list(draft.events),
      prompt: draft.prompt,
      skills: list(draft.skills),
      deliver: draft.deliver.trim() || 'log',
      deliver_only: draft.deliverOnly,
      ...(chat ? { deliver_chat_id: chat } : {}),
      ...(script ? { script } : {}),
    },
  };
}

/** Hermes's answer to a create: the subscription, and its secret, which is in no other answer. */
export function readCreated(body: unknown): { webhook: Webhook | undefined; secret: string | undefined } {
  const answer = record(body);
  return { webhook: parseWebhook(answer), secret: typeof answer.secret === 'string' && answer.secret !== '' ? answer.secret : undefined };
}

/** Switches one subscription on or off. Hermes reloads its file, so no restart is needed. */
export function setEnabledRequest(name: string, enabled: boolean, profile: string): WebhookRequestToSend {
  return { method: 'PUT', path: `/api/webhooks/${encodeURIComponent(name)}/enabled?profile=${encodeURIComponent(profile)}`, body: { enabled } };
}

/** Deletes one subscription. Hermes insists on the profile being named for a delete, so it always is. */
export function deleteRequest(name: string, profile: string): WebhookRequestToSend {
  return { method: 'DELETE', path: `/api/webhooks/${encodeURIComponent(name)}?profile=${encodeURIComponent(profile)}` };
}

/** The tier of creating `draft`, as the policy map has it: a subscription with a script runs code, so it is Tier 3. */
export const webhookTier = (draft: WebhookDraft): 'T2' | 'T3' => (draft.script.trim() === '' ? 'T2' : 'T3');

/** Switching the receiver on: Hermes restarts the gateway itself when it can, and says so; when it could not, a restart is waiting. */
export function readEnableAnswer(body: unknown): { needsRestart: boolean; restartStarted: boolean } {
  const answer = record(body);
  return { needsRestart: answer.needs_restart === true, restartStarted: answer.restart_started === true };
}

/** Switches the profile's webhook receiver on. Hermes writes the config and restarts the gateway to apply it. */
export function enableReceiverRequest(profile: string): WebhookRequestToSend {
  return { method: 'POST', path: `/api/webhooks/enable?profile=${encodeURIComponent(profile)}` };
}
