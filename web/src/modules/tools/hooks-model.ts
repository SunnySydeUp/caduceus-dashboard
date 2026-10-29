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

export interface HookEventGroup {
  title: string;
  events: { id: string; label: string }[];
}

/** Plain words for the events owners reach for. An event not listed shows its Hermes name as it is. */
const EVENT_WORDS: Record<string, string> = {
  pre_tool_call: 'Before a tool runs',
  post_tool_call: 'After a tool runs',
  transform_terminal_output: 'Change what a terminal command printed',
  transform_tool_result: 'Change what a tool returned',
  pre_llm_call: 'Before the model is called',
  post_llm_call: 'After the model answers',
  transform_llm_output: 'Change the model’s reply',
  on_stream_start: 'When a reply starts streaming',
  on_stream_delta: 'Each time a piece of a reply streams in',
  on_stream_end: 'When a reply has finished streaming',
  pre_api_request: 'Before a request to the model provider',
  post_api_request: 'After a request to the model provider',
  api_request_error: 'When a request to the model provider fails',
  on_session_start: 'When a session starts',
  on_session_end: 'When a session ends',
  on_session_reset: 'When a session is reset',
  on_session_delete: 'When a session is deleted',
  subagent_start: 'When a helper agent starts',
  subagent_stop: 'When a helper agent stops',
  pre_gateway_dispatch: 'When a chat message arrives, before it is answered',
  agent_loop_stopped: 'When a running turn is stopped',
  pre_approval_request: 'Before Hermes asks you to approve something',
  post_approval_response: 'After you answer an approval',
};

const EVENT_GROUPS: { title: string; matches(id: string): boolean }[] = [
  { title: 'Tools', matches: (id) => id.includes('tool') },
  { title: 'Sessions and helper agents', matches: (id) => id.includes('session') || id.includes('subagent') || id.includes('skill') },
  { title: 'Model requests', matches: (id) => id.includes('api_') || id.includes('_api') || id.includes('auxiliary') },
  { title: 'Replies', matches: (id) => id.includes('llm') || id.includes('stream') || id.includes('interim') || id === 'pre_verify' },
  { title: 'Chat messages and approvals', matches: (id) => id.includes('gateway') || id.includes('approval') || id.includes('human_input') || id === 'agent_loop_stopped' },
];

/** The events Hermes lists in groups with plain words, in the order Hermes gave them; what no group takes is last, under Other. */
export function groupHookEvents(events: readonly string[]): HookEventGroup[] {
  const groups: HookEventGroup[] = [...EVENT_GROUPS.map(({ title }) => ({ title, events: [] })), { title: 'Other', events: [] }];
  for (const id of events) {
    const index = EVENT_GROUPS.findIndex((group) => group.matches(id));
    const words = EVENT_WORDS[id];
    groups[index < 0 ? groups.length - 1 : index].events.push({ id, label: words ? `${words} · ${id}` : id });
  }
  return groups.filter((group) => group.events.length > 0);
}
