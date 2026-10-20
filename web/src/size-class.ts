// The window size classes the shell adapts to (information architecture §2). The window width is the only input:
// navigation never depends on the device.

/** `compact` < 600 ≤ `medium` < 1200 ≤ `large` (px). */
export type SizeClass = 'compact' | 'medium' | 'large';

/** The tokens' `--breakpoint-rail` and `--breakpoint-sidebar` (`docs/design/tokens.css`, 37.5rem and 75rem) in px. */
const MEDIUM_MIN_WIDTH = 600;
const LARGE_MIN_WIDTH = 1200;

export function sizeClassForWidth(widthPx: number): SizeClass {
  if (widthPx >= LARGE_MIN_WIDTH) return 'large';
  return widthPx >= MEDIUM_MIN_WIDTH ? 'medium' : 'compact';
}

/** The primary navigation a size class shows: a bottom tab bar, a navigation rail, or the grouped sidebar. */
export type NavMode = 'bar' | 'rail' | 'sidebar';

/** The owner may collapse the large layout's sidebar to the rail (remembered per device). */
export function navModeFor(size: SizeClass, sidebarCollapsed: boolean): NavMode {
  if (size === 'compact') return 'bar';
  return size === 'large' && !sidebarCollapsed ? 'sidebar' : 'rail';
}
