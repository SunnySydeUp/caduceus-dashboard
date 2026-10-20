// The browser's side of exporting a session (M1 #17): the theme as it looks now, and getting the file to the owner. The files are built by
// `session-export.ts`; this is the only part of Export that needs a page.
import { EXPORT_TOKENS, type ExportFile } from './session-export.ts';

/** The CSS property that gives a token's value its concrete form: a colour is `rgb(…)`, a radius is a length, a font is its list. */
function propertyOf(token: string): string {
  if (token.startsWith('--cd-font-')) return 'font-family';
  if (token.startsWith('--cd-radius-')) return 'border-top-left-radius';
  return 'color';
}

/**
 * The current theme's tokens, resolved. A token such as `light-dark(…)` or `color-mix(…)` is only text when it is read from the page's style, and the
 * exported file has no `color-scheme` or tokens of its own to resolve it with; so each is applied to an element and read back as the browser computes it.
 */
export function themeTokens(): Record<string, string> {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  try {
    return Object.fromEntries(
      EXPORT_TOKENS.map((token) => {
        const property = propertyOf(token);
        probe.style.setProperty(property, `var(${token})`);
        return [token, getComputedStyle(probe).getPropertyValue(property).trim()];
      }),
    );
  } finally {
    probe.remove();
  }
}

/** How long the object URL of a download lives: long enough for the browser to start the save. */
const URL_LIFETIME_MS = 30_000;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
}

/**
 * Hands the file over. On a phone (a coarse pointer) that can share files, the operating system's share sheet opens, where the owner saves it to Files,
 * sends it to an app or opens it; anywhere else, or when sharing is not possible, it is a download. `shared` or `downloaded` says which, and `cancelled`
 * that the owner closed the share sheet.
 */
export async function deliverFile({ filename, mime, content }: ExportFile): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const type = `${mime};charset=utf-8`;
  const shareable = new File([content], filename, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [shareable] })) {
    try {
      await navigator.share({ files: [shareable], title: filename });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // The browser would not share (the tap's permission ran out while the export was read): a download still works.
    }
  }
  download(new Blob([content], { type }), filename);
  return 'downloaded';
}
