// The push watcher (M2 #03; architecture §4): it listens to what the Inbox listens to (the same sources, through the Inbox, and the activity feed of finished
// runs) and tells each subscribed device, in the words of `push-rules.ts`, of what that device asked to hear of. Rules of delivery:
//  - Presence: nothing is sent while any Caduceus page of the owner is in view.
//  - Dedupe: a device is told of one Hermes state once. The claim is written to the store before the message goes, so a reconnect, a second look at the same
//    list, or a restart of Caduceus never tells it again.
//  - What a device put aside in its Inbox (a snooze, a dismissal) is not pushed to it: it asks the Inbox, not Hermes.
//  - Quiet hours hold a message back until they end (it is still there to be told of); a digest turns the FYI categories into one message at its hour.
import type { PushCategory, PushMessage } from '@caduceus/contracts/push';
import type { InboxItem } from '@caduceus/contracts/inbox';
import type { CaduceusStore } from './caduceus-store.ts';
import type { ActivityFeed } from './inbox-activity.ts';
import type { Inbox } from './inbox.ts';
import type { Presence } from './presence.ts';
import { digestDue, inQuietHours, messageFor, notification, pushCategoryOf } from './push-rules.ts';
import type { PushSubscriptions, Subscription } from './push.ts';
import { sendPush, type PushOutcome } from './web-push.ts';

const DAY_MS = 24 * 3600_000;
const KEEP_LOG_MS = 30 * DAY_MS;

export interface PushWatcher {
  /** Sends a device a notification now, whatever its settings say: the one it asks for from Settings. `not-subscribed` when it has no subscription. */
  sendTest(deviceId: string): Promise<PushOutcome | 'not-subscribed'>;
  close(): void;
}

export interface PushWatcherDeps {
  store: CaduceusStore;
  subscriptions: PushSubscriptions;
  inbox: Inbox;
  activity: ActivityFeed;
  presence: Presence;
  now: () => number;
  /** How often the watcher looks again with no change to prompt it: a lapsed presence, the end of quiet hours, a digest's hour. */
  tickMs: number;
  /** The `sub` of the VAPID token: who the push service may contact about this sender. */
  subject: string;
  fetch?: typeof fetch;
  /** Tests only: the push service is a stand-in on this Mac's loopback. */
  allowLoopback?: boolean;
  /** Told after every look at the Inbox, so that a test can wait for the watcher to have seen what it changed. */
  looked?: () => void;
}

/** What one device may be told of: an Inbox item, or a run that finished. */
interface Candidate {
  /** What a dedupe claim and an override are made against. */
  key: string;
  ref: string;
  category: PushCategory;
  fyi: boolean;
  title: string;
  message(origin: string, badge: number): PushMessage;
  urgent: boolean;
}

const candidateOfItem = (item: InboxItem): Candidate | undefined => {
  const category = pushCategoryOf(item);
  if (!category) return undefined;
  return { key: `${item.id}|${item.stamp}`, ref: item.ref, category, fyi: item.group === 'fyi', title: item.kind === 'notice' ? item.title : item.sessionTitle, message: (origin, badge) => messageFor(item, origin, badge), urgent: item.group === 'decision' };
};

export function createPushWatcher({ store, subscriptions, inbox, activity, presence, now, tickMs, subject, fetch: send, allowLoopback, looked }: PushWatcherDeps): PushWatcher {
  const { db } = store;
  /** The newest finished run already looked at: a run that finished before Caduceus started is not news. */
  let watermark = Math.max(0, ...activity.events().map((event) => event.seq));
  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;

  const deliver = async (sub: Subscription, message: PushMessage, { urgent, ttl }: { urgent: boolean; ttl: number }): Promise<PushOutcome> => {
    const outcome = await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, JSON.stringify(message), { keys: subscriptions.keys, subject, now: now(), ttl, urgency: urgent ? 'high' : 'normal', allowLoopback, ...(send ? { fetch: send } : {}) });
    if (outcome === 'gone') subscriptions.remove(sub.id);
    else if (outcome === 'sent') subscriptions.sent(sub.deviceId, now());
    return outcome;
  };

  /** Writes the device's claim on a state: `false` when it already had one. */
  const claim = (deviceId: string, key: string): boolean => Number(db.prepare('INSERT OR IGNORE INTO push_log (device_id, key, at) VALUES (?, ?, ?)').run(deviceId, key, now()).changes) > 0;

  const consider = async (sub: Subscription, candidate: Candidate, badge: number, hidden: boolean): Promise<void> => {
    const { settings } = sub;
    const override = settings.overrides[candidate.ref];
    if (override === false || (override !== true && !settings.categories[candidate.category])) return;
    if (db.prepare('SELECT 1 FROM push_log WHERE device_id = ? AND key = ?').get(sub.deviceId, candidate.key)) return;
    if (candidate.fyi && override !== true && settings.digest !== 'off') {
      // Collected now, whatever the clock says: the digest goes when it is due.
      if (claim(sub.deviceId, candidate.key)) db.prepare('INSERT OR IGNORE INTO push_digest (device_id, key, title, at) VALUES (?, ?, ?, ?)').run(sub.deviceId, candidate.key, candidate.title, now());
      return;
    }
    if (!hidden || inQuietHours(settings.quietHours, settings.timeZone, now())) return;
    if (!claim(sub.deviceId, candidate.key)) return;
    await deliver(sub, candidate.message(sub.origin, badge), { urgent: candidate.urgent, ttl: candidate.urgent ? 3600 : DAY_MS / 1000 });
  };

  const flushDigest = async (sub: Subscription, hidden: boolean): Promise<void> => {
    const { settings } = sub;
    const rows = db.prepare('SELECT title, at FROM push_digest WHERE device_id = ? ORDER BY at').all(sub.deviceId) as { title: string; at: number }[];
    if (rows.length === 0 || !hidden || inQuietHours(settings.quietHours, settings.timeZone, now()) || !digestDue(settings.digest, settings.timeZone, rows[0]!.at, now())) return;
    db.prepare('DELETE FROM push_digest WHERE device_id = ?').run(sub.deviceId);
    const titles = rows.map((row) => row.title).join(' · ');
    await deliver(sub, notification(rows.length === 1 ? '1 update' : `${rows.length} updates`, titles.length > 300 ? `${titles.slice(0, 299)}…` : titles, `${sub.origin}/notices`, inbox.state(sub.deviceId).needsDecision), { urgent: false, ttl: DAY_MS / 1000 });
  };

  const look = async (): Promise<void> => {
    const hidden = !presence.visible();
    const finished = activity.events().filter((event) => event.seq > watermark);
    watermark = Math.max(watermark, ...finished.map((event) => event.seq));
    for (const sub of subscriptions.all()) {
      const state = inbox.state(sub.deviceId);
      const candidates = state.items.flatMap((item) => candidateOfItem(item) ?? []);
      for (const event of finished.toReversed()) {
        candidates.push({
          key: `run:${event.seq}`,
          ref: `run:${event.profile ?? ''}:${event.storedSessionId ?? ''}`,
          category: 'finished',
          fyi: true,
          title: `Finished: ${event.title}`,
          urgent: false,
          message: (origin, badge) => notification(`Finished: ${event.title}`, event.profile ?? '', event.storedSessionId ? `${origin}/chat/${encodeURIComponent(event.storedSessionId)}` : `${origin}/today`, badge),
        });
      }
      for (const candidate of candidates) {
        // A run that finished while someone was looking is not news; an item that is still waiting is, once nobody is.
        if (candidate.category === 'finished' && !hidden) continue;
        await consider(sub, candidate, state.needsDecision, hidden);
      }
      await flushDigest(sub, hidden);
    }
    db.prepare('DELETE FROM push_log WHERE at < ?').run(now() - KEEP_LOG_MS);
  };

  /** One look at a time; a prompt that comes during one asks for another straight after. */
  const trigger = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = look()
      .catch(() => undefined)
      .finally(() => {
        running = undefined;
        looked?.();
        if (again) {
          again = false;
          trigger();
        }
      });
  };

  const stops = [inbox.subscribe(trigger), presence.subscribe(trigger), subscriptions.subscribe(trigger)];
  const timer = setInterval(trigger, tickMs);
  timer.unref();
  trigger();

  return {
    async sendTest(deviceId) {
      const sub = subscriptions.get(deviceId);
      if (!sub) return 'not-subscribed';
      return deliver(sub, notification('Test notification', 'Caduceus can reach this device. Tap to open Today.', `${sub.origin}/today`, inbox.state(deviceId).needsDecision), { urgent: false, ttl: 3600 });
    },
    close() {
      stopped = true;
      clearInterval(timer);
      for (const stop of stops) stop();
    },
  };
}

