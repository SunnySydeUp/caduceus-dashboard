/**
 * Whether a refusal is Hermes 0.22 saying that a profile has never held a chat. It has no session store yet, and every read of its sessions and use is
 * answered 503 "Session store is not initialized. Start this profile's gateway to initialize it." For the owner that profile has nothing in it, so a
 * reader takes it as an empty answer; any other refusal stays a failure.
 */
export async function isUninitialisedStore(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  const body: unknown = await response.clone().json().catch(() => undefined);
  const detail = typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  return typeof detail === 'string' && detail.startsWith('Session store is not initialized');
}
