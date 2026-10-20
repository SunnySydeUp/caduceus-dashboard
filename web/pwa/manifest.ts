// The web app manifest (M0 #12). Build-time only: `vite-plugin.ts` writes it to `manifest.webmanifest`. It lives outside
// `web/src` because it is not part of the bundle (and `lint:ui` keeps raw colours out of `web/src`; the colours here are
// design tokens, checked against `tokens.css` by `web/test/pwa-manifest.test.ts`).

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: 'image/png' | 'image/svg+xml';
  purpose: 'any' | 'maskable';
}

export interface ManifestShortcut {
  name: string;
  short_name: string;
  url: string;
  icons: Pick<ManifestIcon, 'src' | 'sizes' | 'type'>[];
}

export interface AppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  display: 'standalone';
  scope: string;
  start_url: string;
  /** `--cd-bg-canvas` of the default look (Desk, light): the launch splash and the title bar before the page paints. */
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  shortcuts: ManifestShortcut[];
}

export function appManifest(): AppManifest {
  return {
    // The app's identity for browsers: never change it. A different id is a different app, and every install is orphaned.
    id: '/',
    name: 'Caduceus Dashboard',
    short_name: 'Caduceus',
    description: 'A mobile-first dashboard for Hermes Agent.',
    lang: 'en',
    display: 'standalone',
    scope: '/',
    start_url: '/today',
    // Once it runs, the page sets <meta name="theme-color"> from the chosen look (web/src/shell/theme-color.ts).
    theme_color: '#f5f6f7',
    background_color: '#f5f6f7',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press the installed app's icon (Android, desktop). The addresses are the registry's: web/test/pwa-manifest.test.ts.
    shortcuts: [
      { name: 'Today', short_name: 'Today', url: '/today', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Health', short_name: 'Health', url: '/observe/health', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
