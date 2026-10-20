// The picture of an attached image in the transcript (M1 #10): Hermes keeps the file on its disk and the message names its path, so the page asks
// Hermes for it (`GET /api/fs/read-data-url`, through the proxy's file guard) and shows it from a blob address. The last few are kept, so scrolling
// back to a message does not read the file again.

const KEPT = 48;
const cache = new Map<string, Promise<string | undefined>>();

async function read(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(`/api/fs/read-data-url?path=${encodeURIComponent(path)}`);
    if (!res.ok) return undefined;
    const { dataUrl } = (await res.json()) as { dataUrl?: unknown };
    if (typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(dataUrl)) return undefined;
    return URL.createObjectURL(await (await fetch(dataUrl)).blob());
  } catch {
    return undefined;
  }
}

/** The blob address of an image Hermes holds, or undefined when it cannot be read (gone, too large, refused). */
export function mediaUrl(path: string): Promise<string | undefined> {
  const kept = cache.get(path);
  if (kept) {
    // Most recently used goes last.
    cache.delete(path);
    cache.set(path, kept);
    return kept;
  }
  const reading = read(path).then((url) => {
    // A failure is not kept: the next look tries again.
    if (url === undefined) cache.delete(path);
    return url;
  });
  cache.set(path, reading);
  for (const [oldest, old] of cache) {
    if (cache.size <= KEPT) break;
    cache.delete(oldest);
    void old.then((url) => url && URL.revokeObjectURL(url));
  }
  return reading;
}
