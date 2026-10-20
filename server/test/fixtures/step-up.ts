// Shared helper for tests that need the owner to hold a step-up grant: the passkey ceremonies, played by a software
// authenticator (the system-boundary stand-in for the browser's passkey provider).
import { createSoftwareAuthenticator, type CreationOptions, type RequestOptions, type SoftwareAuthenticator } from './software-authenticator.ts';

async function post(url: string, route: string, cookie: string, body?: unknown): Promise<Response> {
  return fetch(`${url}${route}`, {
    method: 'POST',
    headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The origin passkeys are made at on this Mac: `localhost`, since a relying-party ID cannot be an IP address. */
function passkeyOrigin(url: string): string {
  return `http://localhost:${new URL(url).port}`;
}

/** Registers a passkey for the signed-in owner (`cookie`) on a new software authenticator, and returns it. */
export async function addPasskey(url: string, cookie: string, name = 'Test passkey'): Promise<SoftwareAuthenticator> {
  const authenticator = createSoftwareAuthenticator();
  const options = (await (await post(url, '/_caduceus/api/auth/passkeys/registration-options', cookie)).json()) as CreationOptions;
  const res = await post(url, '/_caduceus/api/auth/passkeys', cookie, { name, response: authenticator.register(options, passkeyOrigin(url)) });
  if (!res.ok) throw new Error(`Registering a passkey: HTTP ${res.status} ${await res.text()}`);
  return authenticator;
}

/** Gives the session of `cookie` a step-up grant (about 5 minutes), with a passkey of `authenticator`. */
export async function stepUp(url: string, cookie: string, authenticator: SoftwareAuthenticator): Promise<void> {
  const options = (await (await post(url, '/_caduceus/api/auth/step-up/options', cookie)).json()) as RequestOptions;
  const res = await post(url, '/_caduceus/api/auth/step-up', cookie, { response: authenticator.assert(options, passkeyOrigin(url)) });
  if (!res.ok) throw new Error(`Step-up: HTTP ${res.status} ${await res.text()}`);
}
