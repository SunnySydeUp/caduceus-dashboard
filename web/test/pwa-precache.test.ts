import { describe, expect, test } from 'vitest';
import { precacheManifest, rendererOnlyChunks, type BuiltFile, type ChunkGraphNode } from '../pwa/precache.ts';

// What a build puts in the service worker's cache (M0 #12), and the version that tells one build from another.
const build = (overrides: Record<string, string> = {}): BuiltFile[] =>
  Object.entries({
    'index.html': '<script type="module" src="/assets/index-3f9a1c.js"></script>',
    'assets/index-3f9a1c.js': 'export {};',
    'assets/index-8b2d44.css': 'body{}',
    'assets/Home-77ab01.js': 'export const Home = 1;',
    'manifest.webmanifest': '{"id":"/"}',
    'icons/icon-192.png': 'png',
    'icons/icon.svg': '<svg/>',
    ...overrides,
  }).map(([path, bytes]) => ({ path, bytes }));

describe('the precache list', () => {
  test('is the shell: the page, every hashed file, the manifest and the icons', () => {
    const { urls } = precacheManifest(build());

    expect(urls).toEqual(['/assets/Home-77ab01.js', '/assets/index-3f9a1c.js', '/assets/index-8b2d44.css', '/icons/icon-192.png', '/icons/icon.svg', '/index.html', '/manifest.webmanifest']);
  });

  test('leaves out the worker itself, source maps and the compressed copies a build leaves beside files', () => {
    const { urls } = precacheManifest(
      build({ 'sw.js': 'self', 'assets/index-3f9a1c.js.map': '{}', 'assets/index-3f9a1c.js.gz': 'gz', 'assets/index-3f9a1c.js.br': 'br', 'index.html.gz': 'gz', 'assets/index-8b2d44.css.zst': 'zst' }),
    );

    expect(urls).toEqual(precacheManifest(build()).urls);
  });
});

describe('the build version', () => {
  const versionOf = (files: BuiltFile[]) => precacheManifest(files).version;

  test('is the same for the same shell in any order, and a new one for any change to a file, a path or the list of files', () => {
    const files = build();

    expect(versionOf(files)).toMatch(/^[0-9a-f]{12}$/);
    expect(versionOf([...files].reverse())).toBe(versionOf(files));
    // The same length, so it is the bytes themselves that tell the two apart.
    expect(versionOf(build({ 'assets/index-3f9a1c.js': 'import {};' }))).not.toBe(versionOf(files));
    expect(versionOf(build({ 'icons/extra.png': 'png' }))).not.toBe(versionOf(files));
    expect(versionOf(files.slice(1))).not.toBe(versionOf(files));
    // The same bytes under another path are another shell.
    expect(versionOf(files.map((file) => (file.path === 'icons/icon.svg' ? { ...file, path: 'icons/logo.svg' } : file)))).not.toBe(versionOf(files));
  });

  test('does not move for what is not in the shell: a source map, a compressed copy, or the worker', () => {
    expect(versionOf(build({ 'sw.js': 'self v2', 'assets/index-3f9a1c.js.map': '{"v":2}', 'assets/index-3f9a1c.js.gz': 'other gz' }))).toBe(versionOf(build()));
  });
});

// The chat's heavy renderers (Mermaid with its diagram engines, KaTeX, the highlighter; M1 #04) are lazy chunks that a reply needing one
// fetches on the spot. They are megabytes, and not the shell: the worker does not cache them (offline, such a block shows its source).
describe('the renderer chunks left out of the precache', () => {
  const chunk = (fileName: string, imports: string[] = [], dynamicImports: string[] = [], extra: Partial<ChunkGraphNode> = {}): ChunkGraphNode => ({ fileName, imports, dynamicImports, isEntry: false, facade: undefined, ...extra });
  const isRoot = (node: ChunkGraphNode) => /node_modules\/(mermaid|katex)\//.test(node.facade ?? '');
  const graph = [
    chunk('assets/index.js', ['assets/shell.js'], ['assets/Chat.js', 'assets/Home.js'], { isEntry: true }),
    chunk('assets/shell.js'),
    chunk('assets/Home.js', ['assets/shell.js']),
    chunk('assets/Chat.js', ['assets/shell.js', 'assets/shared.js'], ['assets/mermaid.js', 'assets/katex.js']),
    chunk('assets/shared.js'),
    chunk('assets/mermaid.js', ['assets/elk.js', 'assets/shared.js'], ['assets/sequence.js'], { facade: '/x/node_modules/mermaid/dist/mermaid.mjs' }),
    chunk('assets/sequence.js', ['assets/elk.js']),
    chunk('assets/elk.js'),
    chunk('assets/katex.js', [], [], { facade: '/x/node_modules/katex/dist/katex.mjs' }),
  ];

  test('are the chunks only a renderer reaches, with what only they reach', () => {
    expect([...rendererOnlyChunks(graph, isRoot)].sort()).toEqual(['assets/elk.js', 'assets/katex.js', 'assets/mermaid.js', 'assets/sequence.js']);
  });

  test('a chunk the shell reaches too stays in, even when a renderer uses it as well', () => {
    expect(rendererOnlyChunks(graph, isRoot).has('assets/shared.js')).toBe(false);
  });

  test('with no renderer there is nothing to leave out', () => {
    expect(rendererOnlyChunks(graph.slice(0, 5), isRoot).size).toBe(0);
  });
});
