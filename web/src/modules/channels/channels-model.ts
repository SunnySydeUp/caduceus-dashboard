// What Connect › Channels knows about a messaging platform, free of the DOM and of React. It is made only of what Hermes answers
// (`GET /api/messaging/platforms`) and nothing is kept (D1: Hermes is the source of truth). Hermes never sends a stored value, only
// its redaction of it, so every field here is write-only: the page can say a value is set, and can replace or clear it.
export interface ChannelField {
  /** The environment variable in the profile's `.env` that Hermes keeps the value in. */
  key: string;
  label: string;
  description: string;
  url: string | undefined;
  required: boolean;
  /** Hermes says the value is a credential (a token, a password, a secret). */
  secret: boolean;
  isSet: boolean;
  /** Hermes's redaction of the stored value (`1234...6789` or `***`); `null` when nothing is set. */
  redacted: string | null;
  advanced: boolean;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  docsUrl: string | undefined;
  enabled: boolean;
  configured: boolean;
  gatewayRunning: boolean;
  /** Hermes's own word for where the platform is: `connected`, `disabled`, `not_configured`, `pending_restart`, … */
  state: string;
  /** What Hermes says went wrong, when something did. */
  error: string | undefined;
  /** The name of the platform's home channel, when it has one. */
  homeChannel: string | undefined;
  /** Where a platform that takes inbound requests (a webhook) is reached, behind a multiplexed gateway. */
  ingressUrl: string | undefined;
  fields: ChannelField[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const optional = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

function parseField(raw: unknown): ChannelField | undefined {
  const field = record(raw);
  if (typeof field.key !== 'string') return undefined;
  return {
    key: field.key,
    label: text(field.prompt) || field.key,
    description: text(field.description),
    url: optional(field.url),
    required: field.required === true,
    secret: field.is_password === true,
    isSet: field.is_set === true,
    redacted: typeof field.redacted_value === 'string' ? field.redacted_value : null,
    advanced: field.advanced === true,
  };
}

/** The name of a home channel: Hermes gives `{ chat_id, name }`. */
function homeName(home: unknown): string | undefined {
  const { name, chat_id } = record(home);
  return optional(name) ?? optional(typeof chat_id === 'number' ? String(chat_id) : chat_id);
}

/** The platforms in Hermes's answer, in the order it gave them; an answer that is not a list is no platforms. */
export function parseChannels(body: unknown): { channels: Channel[]; startCommand: string | undefined } {
  const answer = record(body);
  const channels = (Array.isArray(answer.platforms) ? answer.platforms : []).flatMap((raw): Channel[] => {
    const platform = record(raw);
    if (typeof platform.id !== 'string') return [];
    return [
      {
        id: platform.id,
        name: text(platform.name) || platform.id,
        description: text(platform.description),
        docsUrl: optional(platform.docs_url),
        enabled: platform.enabled === true,
        configured: platform.configured === true,
        gatewayRunning: platform.gateway_running === true,
        state: text(platform.state),
        error: optional(platform.error_message),
        homeChannel: homeName(platform.home_channel),
        ingressUrl: optional(platform.ingress_url),
        fields: (Array.isArray(platform.env_vars) ? platform.env_vars : []).flatMap((entry) => parseField(entry) ?? []),
      },
    ];
  });
  return { channels, startCommand: optional(answer.gateway_start_command) };
}

export interface ChannelStatus {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** The rung of the shared status ladder (`shell/StatusBadge.tsx`) that shows it. */
  badge: 'online' | 'offline' | 'degraded' | 'failed' | 'reconnecting';
  /** The platform has nothing configured yet, so Configure is the card's main action. */
  setup: boolean;
}

const sentence = (state: string) => {
  const words = state.replaceAll('_', ' ').trim();
  return words === '' ? 'Unknown' : words[0].toUpperCase() + words.slice(1);
};

/** Hermes's state in words, with the tone and the rung that show it. */
export function channelStatus(channel: Channel): ChannelStatus {
  const setup = !channel.configured;
  switch (channel.state) {
    case 'connected':
      return { label: 'Connected', tone: 'success', badge: 'online', setup };
    case 'disabled':
      return { label: 'Disabled', tone: 'neutral', badge: 'offline', setup };
    case 'not_configured':
      return { label: 'Not set up', tone: 'neutral', badge: 'offline', setup };
    case 'pending_restart':
      return { label: 'Waiting for a gateway restart', tone: 'warning', badge: 'degraded', setup };
    case 'gateway_stopped':
      return { label: 'Gateway stopped', tone: 'warning', badge: 'degraded', setup };
    case 'startup_failed':
      return { label: 'Failed to start', tone: 'danger', badge: 'failed', setup };
    case 'fatal':
      return { label: 'Failed', tone: 'danger', badge: 'failed', setup };
    case 'disconnected':
      return { label: 'Disconnected', tone: 'danger', badge: 'failed', setup };
    case 'retrying':
      return { label: 'Reconnecting', tone: 'warning', badge: 'reconnecting', setup };
    case 'paused':
      return { label: 'Paused', tone: 'warning', badge: 'degraded', setup };
    default:
      return { label: sentence(channel.state), tone: 'neutral', badge: 'offline', setup };
  }
}

/** A channel counts as in use when it is enabled and set up. */
const inUse = (channel: Channel) => channel.enabled && channel.configured;

/** The channels in use first, then the others, each group by name. */
export function orderChannels(channels: readonly Channel[]): Channel[] {
  return [...channels].sort((a, b) => Number(inUse(b)) - Number(inUse(a)) || a.name.localeCompare(b.name));
}

export type ChannelFilter = 'all' | 'active' | 'inactive';

/** Channels matching a search over the name, id and description, and the filter: the ones in use, or the ones that are not. Their order is kept. */
export function filterChannels(channels: readonly Channel[], { query, show }: { query: string; show: ChannelFilter }): Channel[] {
  const needle = query.trim().toLowerCase();
  return orderChannels(channels).filter((channel) => {
    if (show === 'active' && !inUse(channel)) return false;
    if (show === 'inactive' && inUse(channel)) return false;
    return needle === '' || [channel.name, channel.id, channel.description].some((part) => part.toLowerCase().includes(needle));
  });
}

/** The chat apps most owners look for, in the order they are listed. The rest of Hermes's platforms follow in a group of their own. */
export const COMMON_CHANNELS = ['telegram', 'discord', 'slack', 'whatsapp', 'email'] as const;

export interface ChannelGroup {
  id: 'common' | 'other';
  title: string;
  channels: Channel[];
}

/** The channels in two groups: the common chat apps first, in `COMMON_CHANNELS` order, then every other platform. A group with no channel is left out. Order inside the second group is kept. */
export function groupChannels(channels: readonly Channel[]): ChannelGroup[] {
  const rank = (channel: Channel) => (COMMON_CHANNELS as readonly string[]).indexOf(channel.id);
  const common = channels.filter((channel) => rank(channel) >= 0).sort((a, b) => rank(a) - rank(b));
  const other = channels.filter((channel) => rank(channel) < 0);
  const groups: ChannelGroup[] = [
    { id: 'common', title: 'Chat apps', channels: common },
    { id: 'other', title: 'Other platforms and developer tools', channels: other },
  ];
  return groups.filter((group) => group.channels.length > 0);
}

/**
 * Why the Enabled switch of a channel cannot be used yet, in words for beside the switch; `undefined` when it can. A platform that has
 * not been set up cannot be switched on: the words name the first required value that is missing, so the next step is plain.
 */
export function enableBlocker(channel: Channel): string | undefined {
  if (channel.enabled || channel.configured) return undefined;
  const missing = channel.fields.find((field) => field.required && !field.isSet);
  return missing ? `Add the ${missing.label.replace(/^(the|a|an)\s+/i, '').toLowerCase()} first` : `Set up ${channel.name} first`;
}

const TELEGRAM_TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/;
const NUMERIC_ID = /^\d+$/;
const SLACK_MEMBER = /^[UW][A-Z0-9]{2,}$/;

/** Hermes's comma-separated lists: commas split, spaces and empty parts go (a trailing comma is not an error). */
const parts = (value: string) => value.split(',').map((part) => part.trim()).filter((part) => part !== '');

/**
 * Hermes's own rules for values that are clearly in the wrong field (`hermes_cli/web_routers/messaging.py`, `_ENV_VALUE_RULES`),
 * with its words. Hermes checks them again on save; checking here is only so the owner sees the problem beside the field.
 */
const SHAPE_RULES: Record<string, { accepts(value: string): boolean; message: string }> = {
  'telegram TELEGRAM_BOT_TOKEN': { accepts: (value) => TELEGRAM_TOKEN.test(value), message: 'Telegram bot token must be the complete token from @BotFather, such as 123456789:ABC…' },
  'telegram TELEGRAM_ALLOWED_USERS': { accepts: (value) => parts(value).every((id) => NUMERIC_ID.test(id)), message: 'Telegram allowed users must be comma-separated numeric user IDs.' },
  'slack SLACK_BOT_TOKEN': { accepts: (value) => value.startsWith('xoxb-'), message: 'Slack Bot Token must start with xoxb-. Paste the bot token from OAuth & Permissions.' },
  'slack SLACK_APP_TOKEN': { accepts: (value) => value.startsWith('xapp-'), message: 'Slack App Token must start with xapp-. Paste the app-level token from Basic Information > App-Level Tokens.' },
  'slack SLACK_ALLOWED_USERS': { accepts: (value) => parts(value).every((id) => id === '*' || SLACK_MEMBER.test(id)), message: 'Slack allowed user IDs must be comma-separated member IDs like U01ABC2DEF3.' },
};

/** A field whose value is an address of a server: Hermes's own names end in `_URL`. */
const isAddress = (key: string) => key.endsWith('_URL');

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * What is wrong with the form, by field key; empty when nothing is. `values` is what the owner typed (a field they left alone is
 * absent), `clear` the fields they asked to remove. A field Hermes already holds is not asked for again.
 */
export function validateChannelForm(channel: Channel, values: Readonly<Record<string, string>>, { clear = [] }: { clear?: readonly string[] } = {}): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of channel.fields) {
    const value = (values[field.key] ?? '').trim();
    const removed = clear.includes(field.key);
    if (field.required && removed) {
      problems[field.key] = `${field.label} is required, so it cannot be removed.`;
    } else if (field.required && value === '' && !field.isSet) {
      problems[field.key] = `${field.label} is required.`;
    } else if (value !== '') {
      const rule = SHAPE_RULES[`${channel.id} ${field.key}`];
      if (rule && !rule.accepts(value)) problems[field.key] = rule.message;
      else if (isAddress(field.key) && !isWebAddress(value)) problems[field.key] = `${field.label} must be a web address that starts with http:// or https://.`;
    }
  }
  return problems;
}

export interface HermesRequest {
  method: 'PUT' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

const platformPath = (id: string, profile: string, suffix = '') => `/api/messaging/platforms/${encodeURIComponent(id)}${suffix}?profile=${encodeURIComponent(profile)}`;

/**
 * `PUT /api/messaging/platforms/{id}` (Tier 2): only what the owner typed (trimmed; a value of only spaces is nothing) is sent, the
 * fields they asked to remove, and `enabled` when they switched the platform on or off. A field cannot be both: a typed value wins.
 */
export function channelUpdate(id: string, profile: string, { values = {}, clear = [], enabled }: { values?: Readonly<Record<string, string>>; clear?: readonly string[]; enabled?: boolean }): HermesRequest {
  const env = Object.fromEntries(Object.entries(values).flatMap(([key, value]) => (value.trim() === '' ? [] : [[key, value.trim()]])));
  return {
    method: 'PUT',
    path: platformPath(id, profile),
    body: { ...(enabled === undefined ? {} : { enabled }), env, clear_env: clear.filter((key) => !(key in env)) },
  };
}

/** `POST /api/messaging/platforms/{id}/test`: a read, so it needs no confirmation. */
export const channelTestPath = (id: string, profile: string) => platformPath(id, profile, '/test');

/** After a save: a gateway has to restart for it to apply, unless Hermes says a live multiplexer already built the adapter from it (`hot_served`). */
export function readSaveAnswer(body: unknown): { needsRestart: boolean } {
  return { needsRestart: record(body).hot_served !== true };
}

/**
 * What a test says on the page. Hermes answers a platform that is off before it asks whether it is set up, so a platform with nothing
 * set up is told to enable it: advice the page cannot let anyone follow. For that case the page says what to do in the order it can be done.
 */
export function testResultFor(channel: Channel, answer: { ok: boolean; message: string }): { ok: boolean; message: string } {
  if (answer.ok || channel.configured) return answer;
  return { ok: false, message: `${channel.name} is not set up yet. Set it up first, then enable it and restart the gateway.` };
}

/** Hermes's answer to a test: whether it passed, and its own message about it. */
export function readTestAnswer(body: unknown): { ok: boolean; message: string } {
  const answer = record(body);
  return { ok: answer.ok === true, message: optional(answer.message) ?? 'Hermes did not say how the test went.' };
}

export type BehaviourKind = 'boolean' | 'number' | 'string' | 'select' | 'list';
export type BehaviourValue = boolean | number | string | string[];

export interface BehaviourField {
  /** The dotted path of the key in the profile's `config.yaml` (`discord.auto_thread`). */
  key: string;
  label: string;
  /** One line about what the key does, when Caduceus knows it; `undefined` otherwise. */
  help: string | undefined;
  /** From the config schema: the schema decides what kind of control a key gets, never this module. */
  kind: BehaviourKind;
  options: string[] | undefined;
  /** What the config holds; `undefined` when the key is not set, so Hermes uses its own default. */
  value: BehaviourValue | undefined;
}

export interface BehaviourSection {
  id: 'channel' | 'display' | 'shared';
  title: string;
  fields: BehaviourField[];
}

const KINDS = new Set<string>(['boolean', 'number', 'string', 'select', 'list']);

/** Keys that change how every channel talks, not one platform's: streaming a reply as it is written, and the pause that imitates typing. */
const SHARED_PREFIXES = ['streaming.', 'human_delay.'];

/** One line for each key owners ask about, from the comments of Hermes's own default config. Keys not listed show no help. */
const BEHAVIOUR_HELP: Record<string, string> = {
  require_mention: 'Answer in channels only when someone @mentions the bot.',
  free_response_channels: 'Channel IDs where the bot answers without a mention, separated by commas.',
  free_response_rooms: 'Room IDs where the bot answers without a mention, separated by commas.',
  require_mention_channels: 'Channel IDs where an @mention is always needed, separated by commas.',
  thread_require_mention: 'Ask for an @mention inside threads too.',
  auto_thread: 'Start a thread when someone mentions the bot in a channel.',
  free_response_auto_thread: 'Also start a thread where the bot answers without a mention.',
  history_backfill_limit: 'How many earlier messages the bot reads for context when it is mentioned.',
  allow_cjk_rich_messages: 'Send rich tables for Chinese, Japanese and Korean text. Leave it off if Telegram Desktop or the Mac app shows garbled text.',
  rich_drafts: 'Show experimental rich draft previews while a reply streams in direct messages.',
  'streaming.enabled': 'Show a reply as it is written. When off, each reply arrives as one finished message.',
  'streaming.transport': 'How a streaming reply is shown: auto picks the best way the platform supports.',
  'streaming.edit_interval': 'The fewest seconds between edits of a reply that is being written.',
  'streaming.buffer_threshold': 'Edit the message as soon as this many characters have built up, so short replies feel instant.',
  'streaming.cursor': 'The mark shown at the end of a reply that is still being written.',
  'streaming.fresh_final_after_seconds': 'Telegram only: when the preview was visible this long, send the final text as a new message so its time is the finish time. 0 turns it off.',
  'human_delay.mode': 'Pause before a reply, to imitate typing. Off sends it at once.',
  'human_delay.min_ms': 'The shortest pause, in milliseconds.',
  'human_delay.max_ms': 'The longest pause, in milliseconds.',
};

/** The one line of help for a config key (`discord.auto_thread`): the key's own entry first, then its last word. */
export function behaviourHelp(key: string): string | undefined {
  const tail = key.split('.').pop() ?? key;
  return BEHAVIOUR_HELP[key] ?? BEHAVIOUR_HELP[tail];
}

const ACRONYMS = /\b(cjk|api|url|id|ids|tts|stt|llm)\b/gi;
const segmentWords = (segment: string) => sentence(segment).replace(/^(.)/, (first) => first.toUpperCase()).replace(ACRONYMS, (word) => word.toUpperCase());

const labelOf = (path: string) => path.split('.').map(segmentWords).join(' › ');

function valueAt(config: unknown, key: string): unknown {
  let current: unknown = config;
  for (const segment of key.split('.')) {
    current = record(current)[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

function asValue(kind: BehaviourKind, raw: unknown): BehaviourValue | undefined {
  if (kind === 'boolean') return typeof raw === 'boolean' ? raw : undefined;
  if (kind === 'number') return typeof raw === 'number' ? raw : undefined;
  if (kind === 'list') return Array.isArray(raw) ? raw.map(String) : undefined;
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * The settings of a channel that live in the profile's config rather than in its `.env`: the platform's own block (`discord.*`),
 * its display block (`display.platforms.discord.*`) and what every channel shares. `schema` is `GET /api/config/schema` and
 * `config` is `GET /api/config`; each key is a field of the kind the schema says. Sections with no keys are not listed.
 */
export function behaviourSections(schema: unknown, config: unknown, channelId: string): BehaviourSection[] {
  const declared = record(record(schema).fields);
  const sections: BehaviourSection[] = [
    { id: 'channel', title: 'Behaviour', fields: [] },
    { id: 'display', title: 'Display', fields: [] },
    { id: 'shared', title: 'Every channel: streaming and typing', fields: [] },
  ];
  const ownPrefix = `${channelId}.`;
  const displayPrefix = `display.platforms.${channelId}.`;
  for (const [key, raw] of Object.entries(declared)) {
    const { type, options } = record(raw);
    if (typeof type !== 'string' || !KINDS.has(type)) continue;
    const kind = type as BehaviourKind; // `KINDS` has just said it is one of them
    const section = key.startsWith(displayPrefix) ? sections[1] : key.startsWith(ownPrefix) ? sections[0] : SHARED_PREFIXES.some((prefix) => key.startsWith(prefix)) ? sections[2] : undefined;
    if (!section) continue;
    section.fields.push({
      key,
      label: labelOf(key.slice(section.id === 'channel' ? ownPrefix.length : section.id === 'display' ? displayPrefix.length : 0)),
      help: behaviourHelp(key),
      kind,
      options: kind === 'select' && Array.isArray(options) ? options.map(String) : undefined,
      value: asValue(kind, valueAt(config, key)),
    });
  }
  return sections.filter((section) => section.fields.length > 0);
}

/** Two values are the same when they are equal, or are lists that hold the same items in the same order. */
const same = (a: BehaviourValue | undefined, b: BehaviourValue | undefined) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b);

/** The fields of `fields` whose draft value is not what the config holds. A number that is not a number is left out. */
export function changedBehaviour(fields: readonly BehaviourField[], draft: Readonly<Record<string, BehaviourValue>>): Record<string, BehaviourValue> {
  const changes: Record<string, BehaviourValue> = {};
  for (const field of fields) {
    const next = draft[field.key];
    if (next === undefined || (typeof next === 'number' && !Number.isFinite(next))) continue;
    const before = field.value ?? (field.kind === 'boolean' ? false : undefined);
    if (!same(before, next)) changes[field.key] = next;
  }
  return changes;
}

/** `PUT /api/config` (Tier 3) with only the changed keys, nested as the config file nests them: Hermes merges them over what is there. */
export function behaviourUpdate(profile: string, changes: Readonly<Record<string, BehaviourValue>>): HermesRequest {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const path = key.split('.');
    let node = config;
    for (const segment of path.slice(0, -1)) node = (node[segment] ??= {}) as Record<string, unknown>;
    node[path[path.length - 1]] = value;
  }
  return { method: 'PUT', path: `/api/config?profile=${encodeURIComponent(profile)}`, body: { config } };
}
