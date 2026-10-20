// Shared helper for tests that need a signed-in owner: every page, Caduceus API call and Hermes request needs one.

/** The owner password test servers are set up with. */
export const TEST_OWNER_PASSWORD = 'test owner passphrase';

/**
 * Signs in to a Caduceus server as the owner, from this Mac, setting the owner up first if there is none yet.
 * Returns the `Cookie` header a browser would then send.
 */
export async function ownerCookie(url: string): Promise<string> {
  const { ownerExists } = await (await fetch(`${url}/_caduceus/api/auth/session`)).json();
  const res = await fetch(`${url}/_caduceus/api/auth/${ownerExists ? 'sign-in' : 'setup'}`, {
    method: 'POST',
    headers: { origin: url, 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEST_OWNER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Signing in as the owner: HTTP ${res.status} ${await res.text()}`);
  return res.headers.get('set-cookie')!.split(';')[0];
}
