// How a module calls a Hermes route that is not a plain read. The route's tier comes from the policy map the server
// enforces; the shared confirmation dialog is shown for it; the request goes out the way the server expects (a T3 with a
// typed confirmation the server has bound to it). The server decides in the end: this only asks first, and refuses what it
// already knows will be refused, so the owner is not asked for nothing.
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import type { RequestFacts } from '@caduceus/contracts/policy/rest';
import { DENIED_MESSAGES, PROFILE_REQUIRED_MESSAGE } from '@caduceus/contracts/policy/tiers';
import type { ConfirmRequest } from './palette.ts';
import type { TierConfirmer } from './shell/tier-confirmation.ts';
import type { Recoverability } from './tier-flow.ts';

/** How the confirmation dialog names what a request does. A T1 or higher needs it. */
export interface Confirmation {
  /** What is about to happen: "Restart the gateway?". */
  title: string;
  /** A sentence about it. */
  text?: string;
  /** The name of what it changes. A T3 asks for it to be typed; the title stands in when there is none. */
  object?: string;
  /** The profile chip; when absent, the profile the request names (its path, query or body). */
  profile?: string;
  confirmLabel?: string;
  /** A T3 says whether it can be undone. */
  recoverability?: Recoverability;
}

export interface TieredRequest {
  method: string;
  /** The Hermes path with its query, exactly as it is sent: `/api/profiles/coder`. */
  path: string;
  /** A JSON body, sent as `application/json`. */
  body?: Record<string, unknown>;
  /** A file upload, sent as the form it is (the browser sets its content type). It has no JSON body to bind a T3 confirmation to, so the confirmation is for the request line only. */
  form?: FormData;
  /** Headers sent with the request besides its content type (a save names the text it was made from: `x-caduceus-base-sha256`). */
  headers?: Record<string, string>;
  confirm?: Confirmation;
  /** The owner already confirmed, in a dialog of the caller's own, the larger action this T1 request is a step of: it is sent without a second dialog. A T2 or T3 still asks. */
  alreadyConfirmed?: boolean;
  /** Every file the request writes is in a workspace Caduceus knows: the server lowers a write from a T3 to what a workspace costs (`lowerInWorkspace`, architecture §5), so it is asked as that. */
  inWorkspace?: boolean;
}

export type TieredResult =
  /** The request was sent; this is the server's answer (which may still be a refusal, such as a step-up the owner cancelled). */
  | { kind: 'sent'; response: Response }
  /** The owner declined in the dialog. Nothing was sent, and nothing needs saying. */
  | { kind: 'cancelled' }
  /** Not sent: the policy refuses it (denied, read-only, offline), or the server refused its confirmation. */
  | { kind: 'refused'; refusal: PolicyRefusal };

/** The boundaries `fetchTiered` stands on. */
export interface TieredDeps {
  fetch(path: string, init: RequestInit): Promise<Response>;
  /** The tiered dialog, or `undefined` while none is mounted. Read on every call. */
  confirmer(): TierConfirmer | undefined;
  /** Sends a request, and when the server answers `step-up-required`, asks for a passkey and sends it again (`fetchWithStepUp`). */
  withStepUp(send: () => Promise<Response>): Promise<Response>;
  online(): boolean;
  readOnly(): boolean;
  /** SHA-256 of a text, in hex. */
  sha256(text: string): Promise<string>;
}

const OFFLINE_MESSAGE = 'You are offline. This action is never queued: do it when you are back online.';
export const READ_ONLY_MESSAGE = 'Read-only mode is on: Caduceus is not changing anything in Hermes.';

const refused = (refusal: PolicyRefusal): TieredResult => ({ kind: 'refused', refusal });

/** The refusal in a server answer, or a plain one for an answer that has none. */
async function refusalFrom(response: Response): Promise<PolicyRefusal> {
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body === 'object' && body !== null && 'error' in body && 'message' in body) return body as PolicyRefusal;
  return { error: 'denied', message: `Caduceus could not confirm this (HTTP ${response.status}).` };
}

export function createTieredFetch(deps: TieredDeps): (request: TieredRequest) => Promise<TieredResult> {
  return async ({ method, path, body, form, headers, confirm, alreadyConfirmed, inWorkspace }) => {
    // The policy tables are large (the whole route map of Hermes) and only a request that is not a plain read needs them: they load with the first such request, not with the first screen.
    const { classifyRest, lacksExplicitProfile, lowerInWorkspace, profileOf, resolveTier } = await import('@caduceus/contracts/policy/rest');
    const url = new URL(path, 'http://caduceus.local');
    const match = classifyRest(method, url.pathname);
    if (!match.ok) return refused({ error: 'denied', tier: 'denied', reason: match.reason, message: match.message });
    const facts: RequestFacts = { query: url.searchParams, body };
    let policy = resolveTier(match, facts);
    if (inWorkspace) policy = lowerInWorkspace(match.operation, policy, facts);
    if (policy.tier === 'denied') {
      const reason = policy.reason ?? 'not-proxied';
      return refused({ error: 'denied', tier: 'denied', reason, operation: match.operation, message: DENIED_MESSAGES[reason] });
    }
    if (deps.readOnly() && (!policy.read || policy.tier === 'T3')) {
      return refused({ error: 'read-only', tier: policy.tier, operation: match.operation, message: READ_ONLY_MESSAGE });
    }
    if (lacksExplicitProfile(match, facts)) return refused({ error: 'profile-required', tier: policy.tier, operation: match.operation, message: PROFILE_REQUIRED_MESSAGE });
    if ((policy.tier === 'T2' || policy.tier === 'T3') && !deps.online()) {
      return refused({ error: 'offline', tier: policy.tier, operation: match.operation, message: OFFLINE_MESSAGE });
    }

    const json = body === undefined ? undefined : JSON.stringify(body);
    const jsonHeaders = json === undefined ? undefined : { 'content-type': 'application/json' };
    const send = (extraHeaders?: Record<string, string>) => () => deps.fetch(path, { method, headers: { ...jsonHeaders, ...headers, ...extraHeaders }, body: form ?? json });
    if (policy.tier === 'T0' || (policy.tier === 'T1' && alreadyConfirmed)) return { kind: 'sent', response: await send()() };

    const ask = deps.confirmer();
    if (!ask || !confirm) {
      if (!confirm) throw new Error(`${match.operation} is ${policy.tier}: pass the details its confirmation dialog shows.`);
      return refused({ error: 'confirmation-required', tier: policy.tier, operation: match.operation, message: 'The confirmation dialog is not available.' });
    }
    const request: ConfirmRequest = {
      tier: policy.tier,
      moduleId: 'hermes',
      action: match.operation,
      label: confirm.title,
      text: confirm.text,
      object: confirm.object,
      profile: confirm.profile ?? profileOf(match, facts) ?? undefined,
      confirmLabel: confirm.confirmLabel,
      recoverability: confirm.recoverability,
    };
    const answer = await ask(request);
    if (!answer) return { kind: 'cancelled' };
    if (policy.tier === 'T1') return { kind: 'sent', response: await send()() };
    if (policy.tier === 'T2') return { kind: 'sent', response: await deps.withStepUp(send()) };

    // T3: the server binds the typed confirmation to this request line (and body) and answers with a one-use token.
    const target = confirm.object ?? confirm.title;
    const bodySha256 = json === undefined ? undefined : await deps.sha256(json);
    const minted = await deps.withStepUp(() =>
      deps.fetch('/_caduceus/api/policy/confirmations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: `${method.toUpperCase()} ${path}`, target, typed: answer.typed ?? target, ...(bodySha256 ? { bodySha256 } : {}) }),
      }),
    );
    if (!minted.ok) return refused(await refusalFrom(minted));
    const { token }: { token: string } = await minted.json();
    return { kind: 'sent', response: await deps.withStepUp(send({ 'x-caduceus-confirmation': token })) };
  };
}
