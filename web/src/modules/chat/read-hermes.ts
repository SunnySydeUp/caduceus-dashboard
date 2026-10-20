// Reads a path of Hermes's REST API through Caduceus (the page's `fetch`), and says why it failed in Hermes's words.
export async function readHermes(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });
  if (response.ok) return response.json();
  const body: unknown = await response.json().catch(() => undefined);
  const detail = typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string' ? body.detail : undefined;
  throw new Error(detail ?? `Hermes answered ${response.status} to ${path.split('?')[0]}`);
}
