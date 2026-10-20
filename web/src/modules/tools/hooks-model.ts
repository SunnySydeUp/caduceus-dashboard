// Agents › Tools & MCP › Hooks: Hermes's shell hooks read as rows, the create form checked and turned into the requests Hermes takes. Pure: no
// DOM, no React, no fetch. Hermes is the source of truth (D1): a row is what Hermes lists now. A shell hook is a command Hermes runs when an
// event happens, so the command is always shown whole, never shortened.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A request to Hermes: the route's tier is the policy map's, not decided here. */
export interface HookRequest {
  method: 'POST' | 'DELETE';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body: Record<string, unknown>;
}

const route = (profile: string) => `/api/ops/hooks?profile=${encodeURIComponent(profile)}`;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

export interface Hook {
  event: string;
  command: string;
  /** Which tool calls the hook applies to (a pattern), when it has one. */
  matcher: string | undefined;
  /** Seconds Hermes lets the command run, when the hook sets it. */
  timeout: number | undefined;
  /** The profile whose config holds the hook. */
  profile: string;
  /** Hermes has the owner's consent on record for this command: without it the hook does not fire. */
  allowed: boolean;
  /** Hermes can run the command as configured: its script is there and can be run. Hermes says false for a command it cannot find a script in. */
  executable: boolean;
}

export interface HookList {
  hooks: Hook[];
  /** The events Hermes can run a hook on, for the form. */
  events: string[];
}

/** `GET /api/ops/hooks`: the hooks in the profile's config, in Hermes's order, and the events the form offers. */
export function parseHooks(body: unknown, profile: string): HookList {
  const record = isRecord(body) ? body : {};
  const listed = Array.isArray(record.hooks) ? record.hooks : [];
  const hooks = listed.flatMap((entry): Hook[] => {
    if (!isRecord(entry) || typeof entry.event !== 'string' || typeof entry.command !== 'string') return [];
    return [{ event: entry.event, command: entry.command, matcher: text(entry.matcher), timeout: typeof entry.timeout === 'number' ? entry.timeout : undefined, profile, allowed: entry.allowed === true, executable: entry.executable === true }];
  });
  const events = Array.isArray(record.valid_events) ? record.valid_events.filter((event): event is string => typeof event === 'string') : [];
  return { hooks, events };
}

export interface HookForm {
  event: string;
  command: string;
  matcher: string;
  /** Seconds, as typed. */
  timeout: string;
}

export const emptyHookForm: HookForm = { event: '', command: '', matcher: '', timeout: '' };

export type HookProblems = Partial<Record<keyof HookForm, string>>;

/** What is wrong with the form, field by field, in words. What only Hermes can judge (whether the command is safe to run) is not checked here. */
export function hookProblems(form: HookForm, events: readonly string[]): HookProblems {
  const problems: HookProblems = {};
  if (form.event.trim() === '') problems.event = 'Choose the event the hook runs on.';
  else if (events.length > 0 && !events.includes(form.event.trim())) problems.event = `Hermes has no event called ${form.event.trim()}.`;
  if (form.command.trim() === '') problems.command = 'Give the command to run.';
  else if (/[\r\n]/.test(form.command.trim())) problems.command = 'Use one line: a command and its arguments, or the path of a script.';
  const timeout = form.timeout.trim();
  if (timeout !== '' && !/^[1-9]\d*$/.test(timeout)) problems.timeout = 'Give the seconds as a whole number, such as 30, or leave it empty.';
  return problems;
}

/**
 * `POST /api/ops/hooks` (Tier 3): Hermes writes the hook into the profile's config and records the owner's consent for the command, so that
 * it fires from the next session on. The typed confirmation is the command, whole.
 */
export function hookCreate(form: HookForm, profile: string): HookRequest {
  const matcher = form.matcher.trim();
  const timeout = form.timeout.trim();
  return { method: 'POST', path: route(profile), body: { event: form.event.trim(), command: form.command.trim(), ...(matcher === '' ? {} : { matcher }), ...(timeout === '' ? {} : { timeout: Number(timeout) }), approve: true } };
}

/** `DELETE /api/ops/hooks` (Tier 2): Hermes takes the hook out of the profile's config and withdraws its consent. */
export function hookRemove(hook: Pick<Hook, 'event' | 'command'>, profile: string): HookRequest {
  return { method: 'DELETE', path: route(profile), body: { event: hook.event, command: hook.command } };
}
