// The notices an update puts under the app bar (M5 #12): that an update is available (until it is done, or the owner dismisses it) and that Caduceus is
// draining, which every screen shows since a turn started meanwhile would be refused. Pure: the shell hook (`shell/update-banners.ts`) decides when.
import type { DrainState, UpdateCheck } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { Banner } from './shell/banners.ts';

/** Where the Updates screen is: the update-available banner and the Notices item link here. */
export const UPDATES_PATH = '/system/maintenance';

/** Under a lost connection and a read-only notice, over the restart-to-apply banners. */
const DRAIN_PRIORITY = 3;
/** A nudge, below everything that needs the owner now. */
const UPDATE_PRIORITY = 6;

/**
 * The banner for an update that is available, or `undefined` when there is none (a check that could not run is not news). It says which software, what is
 * running now and how far behind it is. It stays off the Updates screen it links to and off a chat thread, where a banner only takes room from the conversation.
 */
export function updateBanner(label: 'Hermes' | 'Caduceus', check: UpdateCheck): Banner | undefined {
  if (!check.update_available) return undefined;
  const behind = check.behind !== null && check.behind > 0 ? `, ${check.behind} ${check.behind === 1 ? 'change' : 'changes'} behind` : '';
  return {
    id: `update-available:${label.toLowerCase()}`,
    priority: UPDATE_PRIORITY,
    tone: 'info',
    icon: 'download',
    title: `${label} has an update`,
    body: `You are running ${check.current_version}${behind}. Nothing changes until you update.`,
    actions: [{ label: 'View update', to: UPDATES_PATH }],
    dismissible: true,
    quiet: true,
    hideOn: [UPDATES_PATH, '/chat'],
  };
}

/** The banner for a drain that is on, or `undefined`. */
export function drainBanner(state: DrainState): Banner | undefined {
  if (!state.active) return undefined;
  return { id: 'drain', priority: DRAIN_PRIORITY, tone: 'warning', icon: 'paused', title: 'New turns are paused', body: `${state.reason ?? 'Caduceus is draining.'} Turns start again when it is done.` };
}

/** The state in the payload of a `caduceus.drain` event, or `undefined` for one that is not a drain state. */
export function drainStateOf(payload: unknown): DrainState | undefined {
  if (!isRecord(payload) || typeof payload.active !== 'boolean') return undefined;
  return { active: payload.active, reason: typeof payload.reason === 'string' ? payload.reason : null, since: typeof payload.since === 'number' ? payload.since : null };
}
