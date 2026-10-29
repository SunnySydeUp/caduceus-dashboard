// Passkeys in the browser: the WebAuthn ceremonies against the Caduceus API, and the step-up the API can ask for.
// The WebAuthn library loads when a ceremony starts, not with the first screen: nothing on Today needs it.
const webauthn = () => import('@simplewebauthn/browser');

/** Whether this browser can make and use passkeys at all (what `browserSupportsWebAuthn` of the library answers, without loading it). */
export const passkeysSupported = (): boolean => typeof PublicKeyCredential === 'function';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { Passkey, StepUpRequired } from '@caduceus/contracts/caduceus-api';
import { STEP_UP_MS } from '@caduceus/contracts/policy/tiers';

/** A failed passkey ceremony, with a message for the owner. */
export class PasskeyError extends Error {
  /** The owner closed the passkey prompt, it timed out, or Caduceus cancelled it. */
  readonly cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.cancelled = cancelled;
  }
}

/** POSTs JSON to the Caduceus API (same origin, so the browser sends the Origin the server checks). */
export function postJson(path: string, body?: unknown, method = 'POST'): Promise<Response> {
  return fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The `error` code of a Caduceus API refusal, if it has one. */
export async function errorCode(res: Response): Promise<string | undefined> {
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => undefined);
  return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : undefined;
}

/** Runs a WebAuthn ceremony, turning the browser's refusal into a message for the owner. */
async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // @simplewebauthn/browser's WebAuthnError keeps the browser's DOMException name.
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyError('The passkey prompt was closed or timed out. Try again.', true);
    if (name === 'InvalidStateError') throw new PasskeyError('This device or password manager already holds a passkey for Caduceus.');
    if (name === 'SecurityError') throw new PasskeyError('Passkeys only work at the address Caduceus is set up for. Open Caduceus there and try again.');
    throw new PasskeyError('The browser could not use a passkey here.');
  }
}

/**
 * Makes a passkey on this device (or its password manager) and registers it under `name`. The first passkey needs
 * nothing; adding another needs a step-up with one the owner already has (T2), which `fetchWithStepUp` asks for.
 */
export async function registerPasskey(name: string): Promise<Passkey> {
  const optionsRes = await fetchWithStepUp(() => postJson('/_caduceus/api/auth/passkeys/registration-options'));
  if (!optionsRes.ok) {
    if ((await errorCode(optionsRes)) === 'step-up-required') throw new PasskeyError('Not added: confirming with a passkey was cancelled.', true);
    throw new PasskeyError(`Caduceus could not start adding a passkey (HTTP ${optionsRes.status}).`);
  }
  const optionsJSON: PublicKeyCredentialCreationOptionsJSON = await optionsRes.json();
  const response = await ceremony(async () => (await webauthn()).startRegistration({ optionsJSON }));
  const res = await fetchWithStepUp(() => postJson('/_caduceus/api/auth/passkeys', { name, response }));
  if (!res.ok) throw new PasskeyError('Caduceus could not verify the new passkey. Try again.');
  return res.json();
}

/**
 * Signs in with a passkey. `conditional` offers the owner's passkeys in the password field's autofill instead of
 * opening a prompt (the browser's conditional UI); it resolves only once the owner picks one. Resolves `true` once
 * signed in.
 */
export async function signInWithPasskey(conditional: boolean): Promise<boolean> {
  const optionsRes = await postJson('/_caduceus/api/auth/passkey-sign-in/options');
  if (!optionsRes.ok) throw new PasskeyError(`Caduceus could not start a passkey sign-in (HTTP ${optionsRes.status}).`);
  const optionsJSON: PublicKeyCredentialRequestOptionsJSON = await optionsRes.json();
  const response = await ceremony(async () => (await webauthn()).startAuthentication({ optionsJSON, useBrowserAutofill: conditional }));
  const res = await postJson('/_caduceus/api/auth/passkey-sign-in', { response });
  if (!res.ok) throw new PasskeyError('That passkey is not one of this Caduceus owner’s passkeys.');
  return true;
}

/** Cancels a waiting conditional-UI sign-in, so a prompt can be opened instead. */
export async function cancelPasskeyPrompt(): Promise<void> {
  (await webauthn()).WebAuthnAbortService.cancelCeremony();
}

/**
 * When this page last saw the server grant a step-up, as the time it ends. A plan, not a promise: the server decides (and
 * forgets grants when it restarts), so a request the server still refuses goes through `fetchWithStepUp` as usual.
 */
let stepUpEndsAt = 0;

/** Whether the owner confirmed with a passkey recently enough that the server is likely to still honour it. */
export function stepUpLive(now = Date.now()): boolean {
  return now < stepUpEndsAt;
}

/**
 * How many passkeys the owner has, or `undefined` when Caduceus cannot be asked. A confirmation that needs a passkey checks it as it opens, so it can say
 * up front that there is none instead of failing at the last step.
 */
export async function passkeyCount(): Promise<number | undefined> {
  const res = await fetch('/_caduceus/api/auth/methods').catch(() => undefined);
  const body: unknown = res?.ok ? await res.json().catch(() => undefined) : undefined;
  const count = typeof body === 'object' && body !== null && 'passkeys' in body ? (body.passkeys as { count?: unknown } | null)?.count : undefined;
  return typeof count === 'number' ? count : undefined;
}

/** Confirms with a passkey: the current session gets a step-up grant for about 5 minutes. */
export async function stepUp(): Promise<void> {
  const optionsRes = await postJson('/_caduceus/api/auth/step-up/options');
  if ((await errorCode(optionsRes)) === 'no-passkey') throw new PasskeyError('There is no passkey to confirm with yet. Add one in Settings › Security.');
  if (!optionsRes.ok) throw new PasskeyError(`Caduceus could not start the confirmation (HTTP ${optionsRes.status}).`);
  const optionsJSON: PublicKeyCredentialRequestOptionsJSON = await optionsRes.json();
  const response = await ceremony(async () => (await webauthn()).startAuthentication({ optionsJSON }));
  const res = await postJson('/_caduceus/api/auth/step-up', { response });
  if (!res.ok) throw new PasskeyError('Caduceus could not verify the passkey. Try again.');
  // Planned a little short, so a request is not sent in the last second of a grant.
  stepUpEndsAt = Date.now() + STEP_UP_MS - 15_000;
}

/** Shows the step-up prompt; resolves `true` once the owner has confirmed with a passkey, `false` if they cancel. */
type StepUpPrompt = () => Promise<boolean>;
let stepUpPrompt: StepUpPrompt | undefined;

/** Installed by the step-up dialog while it is mounted. */
export function setStepUpPrompt(prompt: StepUpPrompt | undefined): void {
  stepUpPrompt = prompt;
}

/** Asks the owner to confirm with a passkey, through the step-up dialog: for a call the server refused for want of one that is not a Caduceus API call (a gateway call). Resolves `true` once they have. */
export async function askStepUp(): Promise<boolean> {
  return stepUpPrompt ? stepUpPrompt() : false;
}

/**
 * Calls the Caduceus API, and when the server answers `403 step-up-required`, asks the owner to confirm with a
 * passkey and retries once. If the owner cancels, the 403 is returned.
 */
export async function fetchWithStepUp(send: () => Promise<Response>): Promise<Response> {
  const res = await send();
  const required: StepUpRequired['error'] = 'step-up-required';
  if (res.status !== 403 || (await errorCode(res)) !== required || !stepUpPrompt) return res;
  return (await stepUpPrompt()) ? send() : res;
}
