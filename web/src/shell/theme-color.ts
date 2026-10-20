// The browser's title bar (Android, desktop) and status bar (iOS) follow the look this device has chosen (M0 #12): the page sets
// `<meta name="theme-color">` to the canvas colour it is actually painting, so the chrome around the app matches it in every skin,
// light and dark. `index.html` ships two static tags (the default canvas, light and dark) for the moments before this runs.
import { subscribeAppearance } from './appearance-store.ts';

let managed: HTMLMetaElement | undefined;

/** Reads the canvas the page paints (`--cd-bg-canvas` resolved through skin, theme and the operating system's scheme) into the one theme-color tag. */
function apply(): void {
  const colour = getComputedStyle(document.body).backgroundColor;
  if (!managed) {
    // The static tags pick by the operating system's scheme, which the chosen theme may overrule: from here on there is one tag, and it is right.
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((tag) => tag.remove());
    managed = document.createElement('meta');
    managed.name = 'theme-color';
    document.head.append(managed);
  }
  if (managed.content !== colour) managed.content = colour;
}

/** Keeps the theme colour in step with the appearance (a choice, the operating system's light or dark) for as long as the page lives. */
export function startThemeColorSync(): void {
  apply();
  // Stylesheets may still be loading when the first call runs, and the skin and theme arrive in the attributes.
  window.addEventListener('load', apply);
  subscribeAppearance(apply);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}
