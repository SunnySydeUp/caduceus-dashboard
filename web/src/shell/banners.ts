import { useSyncExternalStore } from 'react';
import type { IconName } from '../icons.tsx';

/** The tones of `[data-tone]` in the stylesheet. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'running' | 'paused' | 'stale' | 'blocked' | 'accent';

export interface BannerAction {
  label: string;
  /** An in-app path the action links to. */
  to?: string;
  onClick?(): void;
}

/** A notice pinned under the app bar (information architecture §3): offline, read-only, gateway down, update available… */
export interface Banner {
  id: string;
  /** Lower shows first; only the first banner is visible, the rest sit behind a "+N more" pill. */
  priority: number;
  tone: Tone;
  icon: IconName;
  title: string;
  body?: string;
  actions?: BannerAction[];
  /** The owner may dismiss it, until the page is reloaded. */
  dismissible?: boolean;
  /** Called when the owner dismisses it, for a banner whose dismissal outlasts the page (it is remembered, say). */
  onDismiss?(): void;
  /**
   * News, not a fault (an update is available): it never pushes down a page that is already on screen, since it arrives after the page has
   * painted and the owner may be reading or reaching for a button. It waits and shows with the next page the owner opens.
   */
  quiet?: boolean;
  /** Page paths (and everything under them) where the banner does not show: it would only point at the page the owner is on, or crowd a screen that needs the room (a chat thread). */
  hideOn?: string[];
}

let banners: Banner[] = [];
const dismissed = new Set<string>();
const listeners = new Set<() => void>();

const publish = (next: Banner[]) => {
  banners = next;
  listeners.forEach((notify) => notify());
};

/** Shows a banner, or updates the one with the same id. A dismissed banner stays hidden. */
export function setBanner(banner: Banner): void {
  if (dismissed.has(banner.id)) return;
  publish([...banners.filter((b) => b.id !== banner.id), banner].sort((a, b) => a.priority - b.priority));
}

export function clearBanner(id: string): void {
  if (banners.some((b) => b.id === id)) publish(banners.filter((b) => b.id !== id));
}

export function dismissBanner(id: string): void {
  banners.find((banner) => banner.id === id)?.onDismiss?.();
  dismissed.add(id);
  clearBanner(id);
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/**
 * The banners to show on the page at `pathname`, in priority order: all but the quiet ones, which show once a page change has let them in (`letIn` is their
 * ids), and all but the ones that stay away from this page (`Banner.hideOn`).
 */
export function shownBanners(all: readonly Banner[], letIn: readonly string[], pathname = ''): Banner[] {
  return all.filter((banner) => (!banner.quiet || letIn.includes(banner.id)) && !banner.hideOn?.some((path) => pathname === path || pathname.startsWith(`${path}/`)));
}

/** The ids of the quiet banners waiting now: a page change lets all of them in. */
export function quietIds(all: readonly Banner[]): string[] {
  return all.filter((banner) => banner.quiet).map((banner) => banner.id);
}

/** The banners to show, in priority order. */
export function useBanners(): Banner[] {
  return useSyncExternalStore(subscribe, () => banners);
}
