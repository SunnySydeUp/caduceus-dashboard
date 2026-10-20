// Web Push (M2 #03), shared by the Caduceus server, which sends, and the web app, which subscribes and sets what a device wants to hear.

/** What a device can ask to be notified about, in the order Settings › Notifications lists them. */
export const PUSH_CATEGORIES = {
  approvals: 'Approvals & questions',
  reviews: 'Reviews & blocked tasks',
  failures: 'Failures',
  finished: 'Finished runs',
  pairing: 'Pairing',
  budget: 'Budget',
  updates: 'Updates',
} as const;

export type PushCategory = keyof typeof PUSH_CATEGORIES;

/** How often a device that asked for a digest hears of its FYI categories (finished runs, updates): one notification for all of them, in its own time zone. */
export type PushDigest = 'off' | 'hourly' | 'daily';

/** The hour a daily digest is sent at (device time). */
export const DIGEST_HOUR = 9;

export interface PushSettings {
  categories: Record<PushCategory, boolean>;
  /** No push in the window (device time, `HH:MM`); a window that ends before it starts runs over midnight. */
  quietHours: { enabled: boolean; start: string; end: string };
  /** The device's IANA time zone, which quiet hours and the digest are counted in. */
  timeZone: string;
  digest: PushDigest;
  /** A source's own switch, against the Inbox item's `ref` (`cron:work:abc123`): `true` always notifies, `false` never does, whatever its category says. */
  overrides: Record<string, boolean>;
}

/** What a device that subscribes without saying is given: what needs a decision or has gone wrong, and nothing that is only news. */
export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  categories: { approvals: true, reviews: true, failures: true, finished: false, pairing: true, budget: true, updates: false },
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  timeZone: 'UTC',
  digest: 'off',
  overrides: {},
};

/** A browser's `PushSubscription.toJSON()`. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** `GET /_caduceus/api/push/subscription`: what this device has asked for. */
export interface PushDeviceState {
  subscribed: boolean;
  settings: PushSettings;
}

/** One subscribed device, as Settings › Security lists it. */
export interface PushDevice {
  id: string;
  /** The browser and system, from its user agent. */
  name: string;
  createdAt: number;
  /** When a notification last went to it (ms since the epoch), or `undefined` if none has. */
  lastSentAt: number | undefined;
  /** This is the device asking. */
  current: boolean;
}

/**
 * The message body, in the declarative form of RFC 8030 §"Declarative Web Push" (Safari 18.4 and later show it with no service worker running)
 * that the worker also reads when a browser hands it the message instead. `navigate` is where a tap goes.
 */
export interface PushMessage {
  web_push: 8030;
  notification: {
    title: string;
    body: string;
    lang: 'en';
    dir: 'ltr';
    navigate: string;
    silent: false;
    /** The Needs-decision count for the app badge. */
    app_badge: number;
  };
}
