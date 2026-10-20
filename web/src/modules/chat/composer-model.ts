// What the chat composer's chips and context ring show, free of the DOM and of React (M1 #08): which chips the owner sees and how they
// rearrange them, how full the context is, and what the credential warning says. Hermes is the source of truth for every value; the
// only thing here that Caduceus keeps is the chips' order and visibility (`contracts/chat-chips.ts`, stored by the server).
import type { ChipId, ChipPreference } from '@caduceus/contracts/chat-chips';
import type { SessionCompressResult, Usage } from '@caduceus/contracts/hermes/gateway';
import { REASONING_LEVELS } from '../models/model-settings.ts';

/** The chips to draw, in the owner's order, without the ones they switched off. */
export function shownChips({ order, hidden }: ChipPreference): ChipId[] {
  return order.filter((id) => !hidden.includes(id));
}

/** Moves a chip one place earlier or later in the order. A chip at the end it is moved towards stays. */
export function moveChip(preference: ChipPreference, id: ChipId, direction: 'earlier' | 'later'): ChipPreference {
  const at = preference.order.indexOf(id);
  const to = direction === 'earlier' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= preference.order.length) return preference;
  const order = [...preference.order];
  [order[at], order[to]] = [order[to]!, order[at]!];
  return { ...preference, order };
}

/** Hides a chip that shows, shows one that is hidden. A hidden chip keeps its place in the order. */
export function toggleChip(preference: ChipPreference, id: ChipId): ChipPreference {
  return { ...preference, hidden: preference.hidden.includes(id) ? preference.hidden.filter((hidden) => hidden !== id) : [...preference.hidden, id] };
}

const number = new Intl.NumberFormat('en');

export interface ContextRing {
  /** How full the context window is, 0 to 100; undefined until Hermes has measured it. */
  percent: number | undefined;
  /** `warn` from 70%, `danger` from 90%: when the owner should consider compressing. */
  tone: 'ok' | 'warn' | 'danger' | 'unknown';
  /** What a screen reader says, and the ring's tooltip. */
  label: string;
  /** What the session has cost so far and the share of prompt tokens Hermes read from the provider's cache, when Hermes says. */
  cost: string | undefined;
  cache: string | undefined;
}

/** The ring's state from what Hermes last said about the session's usage (`session.usage`, the end of each turn). */
export function contextRing(usage: Usage | undefined): ContextRing {
  const used = usage?.context_used;
  const max = usage?.context_max;
  const cost = usage?.cost_usd == null ? undefined : `$${usage.cost_usd.toFixed(4)}`;
  const cache = usage?.cache_hit_pct == null ? undefined : `${Math.round(usage.cache_hit_pct)}% cache hits`;
  if (used == null || !max) return { percent: undefined, tone: 'unknown', label: 'Context use is not known until the first reply', cost, cache };
  const percent = Math.min(100, Math.round((used / max) * 100));
  return {
    percent,
    tone: percent >= 90 ? 'danger' : percent >= 70 ? 'warn' : 'ok',
    label: `${percent}% of the context window used (${number.format(used)} of ${number.format(max)} tokens)`,
    cost,
    cache,
  };
}

/**
 * The usage to show once Hermes has compressed the conversation. Hermes's usage after a compression has no context fields (the window is not
 * measured again until the next reply), so the size it says the request has now is the context used, against the window the page already knew.
 */
export function afterCompression(before: Usage | undefined, result: Pick<SessionCompressResult, 'before_tokens' | 'after_tokens' | 'usage' | 'summary'>): Usage | undefined {
  const merged: Usage | undefined = result.usage ? { ...before, ...result.usage } : before;
  // Nothing was compressed: the sizes Hermes gives are its own estimate of the whole request, which says nothing new about what the provider counted.
  if (result.after_tokens == null || result.summary?.noop) return merged;
  const max = merged?.context_max ?? before?.context_max;
  return { ...merged, context_used: result.after_tokens, ...(max ? { context_max: max, context_percent: Math.round((result.after_tokens / max) * 100) } : {}) };
}

/** A newer usage report over an older one: a field the newer one leaves out or gives as null keeps its last value (Hermes reports the context size only after a model call). */
export function mergeUsage(before: Usage | undefined, next: Usage): Usage {
  return { ...before, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value != null)) };
}

/** One variable of Hermes's environment, as the page needs it: its name, the provider it belongs to, whether it is a secret and whether Hermes has it. Never its value, nor a preview of it. */
export interface EnvVar {
  name: string;
  provider: string;
  isSet: boolean;
  isSecret: boolean;
}

/** Reads the body of `GET /api/env`. Hermes redacts the values it sends; the preview it adds to a variable that is set is dropped here all the same, so that nothing of a key is held. */
export function parseEnv(body: unknown): EnvVar[] {
  if (typeof body !== 'object' || body === null) return [];
  return Object.entries(body).flatMap(([name, row]): EnvVar[] => {
    if (typeof row !== 'object' || row === null) return [];
    const { provider, is_set: isSet, is_password: isSecret } = row as Record<string, unknown>;
    return typeof provider === 'string' && typeof isSet === 'boolean' ? [{ name, provider, isSet, isSecret: isSecret === true }] : [];
  });
}

export interface CredentialIssue {
  provider: string;
  /** The variable a key for the provider goes in. */
  keyVar: string;
  /** Why, in words. */
  reason: string;
}

/**
 * Whether the chat's provider has no credential: Hermes keeps secret variables for it and none is set. A provider with no such variable (a custom
 * endpoint, a sign-in) is not judged: Hermes's environment cannot say.
 */
export function credentialIssue({ provider, env }: { provider: string | undefined; env: readonly EnvVar[] }): CredentialIssue | undefined {
  if (!provider) return undefined;
  const keys = env.filter((row) => row.provider === provider && row.isSecret);
  return keys.length > 0 && !keys.some((row) => row.isSet) ? { provider, keyVar: keys[0]!.name, reason: `Hermes has no key for ${provider}.` } : undefined;
}

/**
 * The environment alone cannot show every credential: a bridge, a sign-in or a pooled key serves a provider with no variable set. So a missing variable
 * is a candidate, and Hermes's own strict check (`setup.runtime_check` for that provider) has the last word: it is a warning only when Hermes says it
 * cannot serve the provider, or could not be asked.
 */
export function confirmedIssue(candidate: CredentialIssue | undefined, verdict: { ok: boolean; error?: string | null } | undefined): CredentialIssue | undefined {
  if (!candidate) return undefined;
  return verdict?.ok === true ? undefined : candidate;
}

export const CHIP_LABELS: Record<ChipId, string> = { profile: 'Agent', model: 'Model', reasoning: 'Effort', workspace: 'Folder', toolsets: 'Toolsets' };

/** The reasoning efforts a chat can be set to (`config.set reasoning`): Hermes's levels, and Off (`none`: thinking disabled). Hermes has no word for going back to the profile's default from a session pick. */
export const CHAT_REASONING: readonly { value: string; label: string }[] = [{ value: 'none', label: 'Off' }, ...REASONING_LEVELS.filter((level) => level.value !== '')];

/** The last part of a path, for a chip that has little room (the whole path is its tooltip). */
export function folderName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}
