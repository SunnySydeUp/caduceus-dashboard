// What a build puts in the service worker's cache (M0 #12), and the version that tells one build from another. Build-time and
// pure: `vite-plugin.ts` hands it the files of `web/dist` and writes the answer into the worker.
import crypto from 'node:crypto';

/** A file of the build: its path below `web/dist` (forward slashes) and its content. */
export interface BuiltFile {
  path: string;
  bytes: Uint8Array | string;
}

/** Files of `web/dist` that are not the shell's: the worker is fetched by the browser itself, and the rest are copies or debugging aids. */
const NOT_THE_SHELL = /^sw\.js$|\.(map|gz|br|zst)$/;

export interface PrecacheManifest {
  /** The addresses to cache, sorted. */
  urls: string[];
  /**
   * Names the build: a hash of every shell file's path and content. The worker carries it, so a build that changes anything the
   * app is made of changes the worker's own bytes (which is how a browser learns there is an update) and gets a cache of its own.
   */
  version: string;
}

export function precacheManifest(files: readonly BuiltFile[]): PrecacheManifest {
  const shell = files.filter((file) => !NOT_THE_SHELL.test(file.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  const hash = crypto.createHash('sha256');
  for (const file of shell) {
    // Length-prefixed, so no two different shells can feed the hash the same stream.
    const bytes = typeof file.bytes === 'string' ? Buffer.from(file.bytes) : file.bytes;
    hash.update(`${file.path.length}:${file.path}${bytes.length}:`).update(bytes);
  }
  return { urls: shell.map((file) => `/${file.path}`), version: hash.digest('hex').slice(0, 12) };
}

/** A chunk of the build, as far as the precache cares: what it loads at once (`imports`) and what it may load later (`dynamicImports`). */
export interface ChunkGraphNode {
  fileName: string;
  imports: readonly string[];
  dynamicImports: readonly string[];
  isEntry: boolean;
  /** The module the chunk was made for (a dynamic import's target), when it has one. */
  facade: string | undefined;
}

/**
 * The chunks that only a renderer reaches (`isRoot` picks the chunks made for the renderer libraries): those chunks and everything
 * that only they load. Reachability starts from the entry and from every lazy chunk that is not a renderer, so a chunk the shell
 * shares with a renderer stays in the shell. These are not precached: they are megabytes of diagram engines a message may never need.
 */
export function rendererOnlyChunks(chunks: readonly ChunkGraphNode[], isRoot: (chunk: ChunkGraphNode) => boolean): Set<string> {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const roots = new Set(chunks.filter(isRoot).map((chunk) => chunk.fileName));
  const reached = new Set<string>();
  const visit = (fileName: string) => {
    if (reached.has(fileName) || roots.has(fileName)) return;
    reached.add(fileName);
    const chunk = byName.get(fileName);
    chunk?.imports.forEach(visit);
    chunk?.dynamicImports.forEach(visit);
  };
  chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName));
  return new Set(chunks.filter((chunk) => !reached.has(chunk.fileName)).map((chunk) => chunk.fileName));
}
