// What the page remembers about its link to Hermes, so a screen that cannot be sure says since when it last was. Pure: `connection.ts` keeps the one copy.

/** Whether the link is healthy now, and when it last stopped being (ms since the epoch; `undefined` until it has dropped once). */
export interface LinkMemory {
  healthy: boolean;
  lastHealthyAt: number | undefined;
}

export const FIRST_LINK: LinkMemory = { healthy: true, lastHealthyAt: undefined };

/** The memory after the link reads `healthy` at `now`, and whether that is a recovery (it was unhealthy and is healthy again). Same memory back when nothing changed. */
export function nextLinkMemory(previous: LinkMemory, healthy: boolean, now: number): { memory: LinkMemory; recovered: boolean } {
  if (healthy === previous.healthy) return { memory: previous, recovered: false };
  if (healthy) return { memory: { healthy: true, lastHealthyAt: previous.lastHealthyAt }, recovered: true };
  return { memory: { healthy: false, lastHealthyAt: now }, recovered: false };
}

/** A time of day, plus the weekday when it is not today: "9:14 AM", "Tue 9:14 PM". */
export function clockWords(at: number, now: number): string {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return new Date(at).toDateString() === new Date(now).toDateString() ? time : `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** What a live line says in place of itself while the link is down: when it was last true. */
export function asOfWords(at: number | undefined, now: number): string {
  return at === undefined ? 'Can’t check right now' : `As of ${clockWords(at, now)}`;
}

/** What an action that needs the network says while the device is offline: its name, then why it is off. */
export const NEEDS_CONNECTION = 'Needs a connection';

/** The accessible name of a switched-off network action: "Retry. Needs a connection". */
export function needsConnection(label: string): string {
  return `${label}. ${NEEDS_CONNECTION}`;
}
