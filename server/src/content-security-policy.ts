// The Content-Security-Policy of every answer: the app's own files and nothing else may run, load or connect. What the page really needs, and no more:
// - scripts: its own files, and the one inline script of `index.html` (it sets the device's look before the first paint), by hash;
// - styles: its own files, and inline `style` attributes (React sets them);
// - images: its own, `data:` and `blob:` (an attachment, a chart, an SVG as an image) and `https:` (a reply may show a remote image; whether it should is the owner's to decide);
// - connections: its own address, WebSockets to it included;
// - frames: its own files (a PDF preview) and `data:`/`blob:` documents; the HTML preview is an `srcdoc` frame with a sandbox and a policy of its own;
// - no plug-ins, no `<base>`, forms go only to itself, and only this origin may frame it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The hashes (`'sha256-…'`) of the inline scripts of the app shell, which the policy lets run. */
export function inlineScriptHashes(webRoot: string | undefined): string[] {
  if (webRoot === undefined) return [];
  let html: string;
  try {
    html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  } catch {
    return [];
  }
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => `'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
}

export function contentSecurityPolicy(scriptHashes: readonly string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self' blob: data:",
    "object-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}
