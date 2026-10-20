// How the chat behaves for its owner (M1 #20): send key, completion sound, timestamps, transcript density, auto-follow, the pin limit and the default
// activity mode. These are Caduceus preferences (R1): Hermes knows nothing of them and its config is never written for them. Each is either the
// device's (a phone may send with Enter while the laptop sends with ⌘ Enter) or the owner's (every device they sign in on). Shared by the server, which
// validates and stores them, and the web app, which applies them.

export const SEND_KEYS = ['auto', 'mod-enter', 'enter'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;
export const ACTIVITY_DEFAULTS = ['worklog', 'stream', 'final'] as const;

export interface DeviceBehaviour {
  /** What sends a message: Automatic (Enter with a fine pointer, ⌘/Ctrl+Enter on touch), ⌘/Ctrl+Enter (Enter is a new line, as it must be on a phone) or Enter (Shift+Enter is a new line). */
  sendKey: (typeof SEND_KEYS)[number];
  /** A short sound when a reply is complete. */
  completionSound: boolean;
  /** The time each message was written, under it. */
  timestamps: boolean;
  /** How much room the messages of a transcript take. */
  transcriptDensity: (typeof DENSITIES)[number];
  /** A reply that is arriving keeps the transcript scrolled to its end, until the reader scrolls up. */
  autoFollow: boolean;
}

export interface AccountBehaviour {
  /** How many sessions can be pinned at once. */
  pinLimit: number;
  /** The activity mode a device that never chose one starts with. */
  activityMode: (typeof ACTIVITY_DEFAULTS)[number];
}

export interface ChatBehaviour {
  device: DeviceBehaviour;
  account: AccountBehaviour;
}

export const MIN_PIN_LIMIT = 1;
export const MAX_PIN_LIMIT = 50;

export const DEFAULT_DEVICE_BEHAVIOUR: DeviceBehaviour = { sendKey: 'auto', completionSound: false, timestamps: false, transcriptDensity: 'comfortable', autoFollow: true };

/** The key that sends on this device: a key the owner chose, or for Automatic Enter where the pointer is fine (a mouse or trackpad) and ⌘/Ctrl+Enter on touch. */
export function resolveSendKey(setting: DeviceBehaviour['sendKey'], finePointer: boolean): 'mod-enter' | 'enter' {
  if (setting !== 'auto') return setting;
  return finePointer ? 'enter' : 'mod-enter';
}

export const DEFAULT_ACCOUNT_BEHAVIOUR: AccountBehaviour = { pinLimit: 10, activityMode: 'worklog' };

const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T => options.includes(value as T);

/** Which scope each setting belongs to, for the label the settings screen shows. */
export const BEHAVIOUR_SCOPE = { sendKey: 'device', completionSound: 'device', timestamps: 'device', transcriptDensity: 'device', autoFollow: 'device', pinLimit: 'account', activityMode: 'account' } as const;

/** A change to the device's behaviour: only the settings it names, each valid; otherwise `undefined`. */
export function parseDeviceChange(value: unknown): Partial<DeviceBehaviour> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const change: Partial<DeviceBehaviour> = {};
  for (const [key, setting] of Object.entries(value)) {
    if (key === 'sendKey' && oneOf(SEND_KEYS, setting)) change.sendKey = setting;
    else if (key === 'transcriptDensity' && oneOf(DENSITIES, setting)) change.transcriptDensity = setting;
    else if ((key === 'completionSound' || key === 'timestamps' || key === 'autoFollow') && typeof setting === 'boolean') change[key] = setting;
    else return undefined;
  }
  return change;
}

/** A change to the owner's behaviour, the same way. */
export function parseAccountChange(value: unknown): Partial<AccountBehaviour> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const change: Partial<AccountBehaviour> = {};
  for (const [key, setting] of Object.entries(value)) {
    if (key === 'pinLimit' && typeof setting === 'number' && Number.isInteger(setting) && setting >= MIN_PIN_LIMIT && setting <= MAX_PIN_LIMIT) change.pinLimit = setting;
    else if (key === 'activityMode' && oneOf(ACTIVITY_DEFAULTS, setting)) change.activityMode = setting;
    else return undefined;
  }
  return change;
}

/** What was stored, as complete behaviour: a setting that is missing or no longer valid is the default. */
export function deviceBehaviourOf(stored: unknown): DeviceBehaviour {
  const record = typeof stored === 'object' && stored !== null ? stored : {};
  const valid: Partial<DeviceBehaviour> = {};
  for (const [key, setting] of Object.entries(record)) Object.assign(valid, parseDeviceChange({ [key]: setting }));
  return { ...DEFAULT_DEVICE_BEHAVIOUR, ...valid };
}

export function accountBehaviourOf(stored: unknown): AccountBehaviour {
  const record = typeof stored === 'object' && stored !== null ? stored : {};
  const valid: Partial<AccountBehaviour> = {};
  for (const [key, setting] of Object.entries(record)) Object.assign(valid, parseAccountChange({ [key]: setting }));
  return { ...DEFAULT_ACCOUNT_BEHAVIOUR, ...valid };
}
