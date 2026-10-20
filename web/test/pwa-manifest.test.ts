import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { appManifest } from '../pwa/manifest.ts';
import { parseColour, parseTokens, tokensFor } from '../src/contrast.ts';
import { createAppRegistry } from '../src/modules/index.ts';

// The web app manifest (M0 #12): what a browser installs, as a pure value. The build writes it to `manifest.webmanifest`.
describe('the manifest', () => {
  test('names a stable app identity, and starts the app on Today inside its own scope', () => {
    const manifest = appManifest();

    // Changing the id makes a browser treat the app as a different one: every existing install is orphaned. Not by accident.
    expect(manifest.id).toBe('/');
    expect(manifest.name).toBe('Caduceus Dashboard');
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/today');
  });

  test('has the icons installing needs (192 and 512), a maskable one, and every icon is a file of the declared type and size', () => {
    const { icons } = appManifest();

    const offered = (purpose: string) => icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
    expect(offered('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
    // A maskable icon is cropped to whatever shape the launcher uses, so the artwork has to be its own file (full bleed, inside the safe zone).
    expect(offered('maskable')).toContain('512x512');
    for (const icon of icons) {
      const file = fs.readFileSync(new URL(`../public${icon.src}`, import.meta.url));
      if (icon.type === 'image/png') {
        // IHDR: the width and the height are the first two 32-bit numbers after the 8-byte signature and the chunk header.
        expect(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
      } else {
        expect(icon.type).toBe('image/svg+xml');
        expect(file.toString('utf8')).toMatch(/^<svg\b/);
      }
    }
  });

  test('has shortcuts to Today and Health, at the addresses those screens have in the app', () => {
    const registry = createAppRegistry();
    const { shortcuts } = appManifest();

    expect(shortcuts.map((shortcut) => [shortcut.name, shortcut.url])).toEqual([
      ['Today', '/today'],
      ['Health', '/observe/health'],
    ]);
    // A shortcut to a route the app no longer has would open the "not found" screen from the launcher.
    expect(shortcuts.map((shortcut) => shortcut.url)).toEqual([registry.module('today')?.path, registry.module('health')?.path]);
    for (const shortcut of shortcuts) {
      expect(shortcut.icons.map((icon) => icon.sizes)).toContain('192x192');
    }
  });

  test('opens on the canvas colour of the default look, so the splash screen and the title bar match the app', () => {
    const sheet = parseTokens(fs.readFileSync(new URL('../../docs/design/tokens.css', import.meta.url), 'utf8'));
    const canvasOf = (theme: 'light' | 'dark') => tokensFor(sheet, { theme, skin: 'desk', density: 'auto', prefersDark: false, pointer: 'fine', viewportRem: 90 }).colour('--cd-bg-canvas');
    const { theme_color, background_color } = appManifest();

    expect(parseColour(theme_color)).toEqual(canvasOf('light'));
    expect(parseColour(background_color)).toEqual(canvasOf('light'));
    // The two tags `index.html` ships for the moments before the page runs: the default canvas, light and dark, per the operating system.
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const metaFor = (scheme: 'light' | 'dark') => new RegExp(`<meta name="theme-color" content="(#[0-9a-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)"`).exec(html)?.[1];
    expect(parseColour(metaFor('light') ?? '')).toEqual(canvasOf('light'));
    expect(parseColour(metaFor('dark') ?? '')).toEqual(canvasOf('dark'));
  });
});
