// The build step that makes the web app installable and offline-capable (M0 #12). After Vite has written `web/dist` it:
//   1. writes `manifest.webmanifest` (`manifest.ts`) and links it from `index.html`, which also preloads the lazy shell and Today chunks;
//   2. lists the shell's files and names the build (`precache.ts`), and bundles the service worker as `sw.js` with both written in,
//      so that any change to the app changes the worker's own bytes, which is how a browser learns there is an update;
//   3. leaves a gzip and a Brotli copy beside every text file, which the Caduceus server hands to browsers that take them
//      (`server/src/web-app.ts`): the initial-JS budget is a gzip size, and the server does not compress on the fly.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build, type HtmlTagDescriptor, type Plugin } from 'vite';
import { appManifest } from './manifest.ts';
import { precacheManifest, rendererOnlyChunks, type BuiltFile, type ChunkGraphNode } from './precache.ts';

/** The files worth compressing: text. (Images and fonts are compressed already.) */
const TEXT_FILE = /\.(js|css|html|svg|json|webmanifest)$/;

/** The lazy chunks a first load of Today needs at once: the shell (`App.tsx`) and Today itself. */
const LANDING_CHUNKS = /\/src\/App\.tsx$|\/modules\/today\/Today\.tsx$/;

/** The chunks made for the chat's renderer libraries (M1 #04): lazy, large, and not the shell, so not precached (`rendererOnlyChunks`). */
const RENDERER_CHUNK = /node_modules\/(mermaid|katex)\/|\/modules\/chat\/highlight-languages\.ts$/;
/** Files the renderers load besides chunks: KaTeX's fonts and stylesheet. */
const RENDERER_ASSET = /^assets\/(KaTeX_|katex-)/;

/** Every file below `dir` as the build sees it: its path relative to `dir`, with forward slashes. */
function filesBelow(dir: string, prefix = ''): BuiltFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? filesBelow(path.join(dir, entry.name), `${relative}/`) : [{ path: relative, bytes: fs.readFileSync(path.join(dir, entry.name)) }];
  });
}

export function caduceusPwa(): Plugin {
  let root = '';
  let outDir = '';
  let leftOut = new Set<string>();
  return {
    name: 'caduceus-pwa',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
      const nodes: ChunkGraphNode[] = chunks.map((chunk) => ({ fileName: chunk.fileName, imports: chunk.imports, dynamicImports: chunk.dynamicImports, isEntry: chunk.isEntry, facade: chunk.facadeModuleId ?? undefined }));
      const roots = new Set(chunks.filter((chunk) => chunk.isDynamicEntry && RENDERER_CHUNK.test(chunk.facadeModuleId ?? '')).map((chunk) => chunk.fileName));
      leftOut = rendererOnlyChunks(nodes, (node) => roots.has(node.fileName));
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const tags: HtmlTagDescriptor[] = [{ tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' }];
        // The shell and Today are lazy chunks the entry asks for only once it has downloaded and run, which puts a round trip and the
        // entry's whole download in the middle of a first load. Fetching them beside the entry keeps LCP inside its budget on a slow
        // network (`npm run perf`).
        const chunks = Object.values(context.bundle ?? {}).filter((file) => file.type === 'chunk');
        const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
        const withImports = (start: string[]) => {
          const seen = new Set<string>();
          const visit = (fileName: string) => {
            if (seen.has(fileName)) return;
            seen.add(fileName);
            byName.get(fileName)?.imports.forEach(visit);
          };
          start.forEach(visit);
          return seen;
        };
        const wanted = withImports(chunks.filter((chunk) => chunk.isDynamicEntry && LANDING_CHUNKS.test(chunk.facadeModuleId ?? '')).map((chunk) => chunk.fileName));
        // The entry and what it imports statically are on the page already.
        const loaded = withImports(chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
        const loadedStyles = new Set(chunks.filter((chunk) => loaded.has(chunk.fileName)).flatMap((chunk) => [...(chunk.viteMetadata?.importedCss ?? [])]));
        for (const fileName of wanted) {
          if (!loaded.has(fileName)) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `/${fileName}` }, injectTo: 'head' });
          // The stylesheets of those chunks are asked for only when the chunk runs and imports them, a second round trip in front of the first paint: ask for them now.
          for (const style of byName.get(fileName)?.viteMetadata?.importedCss ?? []) {
            if (!loadedStyles.has(style)) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'style', crossorigin: '', href: `/${style}` }, injectTo: 'head' });
          }
        }
        return tags;
      },
    },
    async closeBundle() {
      fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), `${JSON.stringify(appManifest(), null, 2)}\n`);
      const { urls, version } = precacheManifest(filesBelow(outDir).filter(({ path: name }) => !leftOut.has(name) && !RENDERER_ASSET.test(name)));
      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: 'warn',
        define: { __PRECACHE_URLS__: JSON.stringify(urls), __BUILD_VERSION__: JSON.stringify(version) },
        build: {
          outDir,
          emptyOutDir: false,
          lib: { entry: path.join(root, 'src/sw/service-worker.ts'), formats: ['iife'], name: 'caduceusWorker', fileName: () => 'sw.js' },
        },
      });
      for (const file of filesBelow(outDir).filter(({ path: name }) => TEXT_FILE.test(name))) {
        const bytes = file.bytes as Buffer;
        const target = path.join(outDir, file.path);
        fs.writeFileSync(`${target}.gz`, zlib.gzipSync(bytes, { level: 9 }));
        fs.writeFileSync(`${target}.br`, zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
      }
    },
  };
}
