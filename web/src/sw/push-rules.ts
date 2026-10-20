// What the service worker does with a push message and a tap on its notification (M2 #03). Pure, so that it can be tested without a browser; `service-worker.ts`
// is the thin part that calls the browser. A browser that draws declarative Web Push (RFC 8030, Safari 18.4 and later) never gets here for those messages; every
// other browser hands the same JSON to the worker, which shows it the same way.

export interface ShownNotification {
  title: string;
  body: string;
  /** Where a tap goes; always an address of this origin. */
  url: string;
  /** The Needs-decision count for the app badge, when the message says one. */
  badge: number | undefined;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** A tap goes to an address of Caduceus's own origin and nowhere else: a path is resolved against it, and anything foreign or missing opens Today. */
function ownAddress(navigate: unknown, origin: string): string {
  if (typeof navigate !== 'string' || navigate === '') return `${origin}/today`;
  try {
    const url = new URL(navigate, origin);
    return url.origin === origin ? url.href : `${origin}/today`;
  } catch {
    return `${origin}/today`;
  }
}

/** The notification for a message's text; a message nobody can read still shows that something is there. */
export function readPush(raw: string | undefined, origin: string): ShownNotification {
  const generic = { title: 'Caduceus', body: 'Something needs you.', url: `${origin}/today`, badge: undefined };
  if (raw === undefined || raw === '') return generic;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...generic, body: raw.slice(0, 300) };
  }
  const message = record(parsed);
  // The declarative form puts everything in `notification`; a plain object (an older server, a hand-made test message) has the same fields at the top.
  const fields = message.web_push === 8030 ? record(message.notification) : message;
  const badge = fields.app_badge;
  return {
    title: typeof fields.title === 'string' && fields.title !== '' ? fields.title : generic.title,
    body: typeof fields.body === 'string' ? fields.body : generic.body,
    url: ownAddress(fields.navigate, origin),
    badge: typeof badge === 'number' && Number.isInteger(badge) && badge >= 0 ? badge : undefined,
  };
}

export interface WindowSummary {
  url: string;
  focused: boolean;
}

/** Where a tap goes: into the Caduceus window that is open (the one in front if several), or a new window. */
export function clickTarget(url: string, windows: readonly WindowSummary[]): { kind: 'reuse'; index: number } | { kind: 'open' } {
  const origin = new URL(url).origin;
  const ours = windows.flatMap((window, index) => (new URL(window.url).origin === origin ? [{ window, index }] : []));
  const chosen = ours.find((entry) => entry.window.focused) ?? ours[0];
  return chosen ? { kind: 'reuse', index: chosen.index } : { kind: 'open' };
}
