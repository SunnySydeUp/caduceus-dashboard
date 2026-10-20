// What decides whether and when a device is told (M2 #03), free of the clock, the store and the network: the Inbox item's push category, a device's quiet
// hours and digest on its own clock, and the words of a notification.
import { DIGEST_HOUR, type PushCategory, type PushDigest, type PushMessage, type PushSettings } from '@caduceus/contracts/push';
import type { InboxItem } from '@caduceus/contracts/inbox';

/** The minutes since midnight, and the calendar day and hour, on a device's clock. */
function localClock(zone: string, at: number): { minutes: number; day: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return { minutes: hour * 60 + Number(parts.minute), day: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

const DAY_MS = 24 * 3600_000;

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Whether `at` falls in the device's quiet hours: from `start` (included) to `end` (excluded) on its clock, over midnight when `end` is the earlier. */
export function inQuietHours(quiet: PushSettings['quietHours'], zone: string, at: number): boolean {
  if (!quiet.enabled) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  const { minutes } = localClock(zone, at);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * Whether a digest holding something first queued at `since` is due at `at`: an hourly one when the device's clock has reached the next hour after it,
 * a daily one at the next `DIGEST_HOUR` after it. So a digest never goes the moment something is queued, which would be no digest at all.
 */
export function digestDue(digest: PushDigest, zone: string, since: number, at: number): boolean {
  if (digest === 'off') return false;
  const now = localClock(zone, at);
  const first = localClock(zone, since);
  const key = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}`;
  if (digest === 'hourly') return key(now.day, now.hour) > key(first.day, first.hour);
  const nextDay = new Date(Date.parse(`${first.day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const boundary = first.hour < DIGEST_HOUR ? key(first.day, DIGEST_HOUR) : key(nextDay, DIGEST_HOUR);
  return key(now.day, now.hour) >= boundary;
}

/** Which of a device's categories an Inbox item belongs to; `undefined` for one that is never pushed. */
export function pushCategoryOf(item: InboxItem): PushCategory | undefined {
  if (item.kind === 'approval' || item.kind === 'clarify') return 'approvals';
  if (item.category === 'pairing') return 'pairing';
  if (item.ref.startsWith('budget:')) return 'budget';
  if (item.ref.startsWith('update:')) return 'updates';
  if (item.category === 'work' && item.group === 'decision') return 'reviews';
  if (item.group === 'failed') return 'failures';
  if (item.group === 'decision') return 'approvals';
  return undefined;
}

const clip = (text: string, length: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

/** The notification for an Inbox item: the decision as its title, the exact preview as its body, and where a tap goes: Today for what needs a decision (it is answered there), Notices on the item for the rest. */
export function messageFor(item: InboxItem, origin: string, badge: number): PushMessage {
  const where = item.profile ?? 'Hermes';
  let title: string;
  let body: string;
  if (item.kind === 'approval') {
    title = `Approve \`${clip(item.command, 60)}\` on ${where}?`;
    body = item.description === '' ? item.command.slice(0, 400) : `${item.command.slice(0, 400)}\n${clip(item.description, 120)}`;
  } else if (item.kind === 'clarify') {
    const [first] = item.questions;
    title = `${where} asks: ${clip(first?.question ?? 'a question', 80)}`;
    body = first && first.choices.length > 0 ? first.choices.join(' · ') : `In “${clip(item.sessionTitle, 60)}”. Open to answer.`;
  } else {
    title = clip(item.title, 100);
    body = clip(item.detail ?? '', 300);
  }
  return notification(title, body, item.group === 'decision' ? `${origin}/today` : `${origin}/notices/${encodeURIComponent(item.id)}`, badge);
}

export function notification(title: string, body: string, navigate: string, badge: number): PushMessage {
  return { web_push: 8030, notification: { title, body, lang: 'en', dir: 'ltr', navigate, silent: false, app_badge: badge } };
}
