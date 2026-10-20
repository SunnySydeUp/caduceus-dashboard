// What the agent is doing (M1 #05): pure. Hermes's gateway events (reasoning, tool, subagent, todo, usage) are folded into the state
// the transcript and the context panel draw, and Hermes's stored history is read back into the same cards, so a turn looks the same
// while it runs and when it is opened later. No DOM and no React; the chat engine (`chat-session.ts`) holds the state.
import { stripAnsi } from '@caduceus/contracts/hermes/shared/ansi';
import type { GatewayEvent } from '@caduceus/contracts/hermes/shared/gateway';
import type { SubagentEventPayload, SubagentSnapshot, SubagentStatus, ToolCompletePayload, ToolStartPayload, Usage } from '@caduceus/contracts/hermes/gateway';
import type { HistoryRow } from './history-window.ts';
import { isAutoContinueNote, isFailedTurnNotice } from './turn-recovery.ts';

export type ToolStatus = 'generating' | 'running' | 'done' | 'failed' | 'incomplete';

/** One tool call, from the model writing its arguments to its result. */
export interface ToolActivity {
  kind: 'tool';
  key: string;
  /** Hermes's id for the call; absent until `tool.start` (the model is still writing the arguments). */
  id: string | undefined;
  name: string;
  status: ToolStatus;
  /** What the call is about, in a few words (a file, a query). */
  context?: string;
  args?: Record<string, unknown>;
  /** The result as text: Hermes's own words, or the result as indented JSON. */
  output?: string;
  /** A one-line result (`Entry added.`). */
  summary?: string;
  /** Why the call failed, in the tool's words. */
  error?: string;
  /** A unified diff of the file change the call made. */
  diff?: string;
  durationS?: number;
  /** Hermes classified the output as risky (prompt injection, secrets). */
  risk?: { level: string; findings: string[]; redacted: boolean };
}

/** The model's reasoning: streamed chunks, or a whole block. */
export interface ReasoningActivity {
  kind: 'reasoning';
  key: string;
  text: string;
  /** It is still arriving. */
  streaming: boolean;
  /** What Hermes says it is doing while it thinks (a spinner caption), when it has said. */
  caption?: string;
}

export type SubagentState = SubagentStatus | 'delegated';

/** One delegated child agent. */
export interface SubagentActivity {
  kind: 'subagent';
  key: string;
  id: string;
  goal: string;
  status: SubagentState;
  model?: string;
  /** The child's own session: its activity is the chat of this id. */
  childSessionId?: string;
  toolCount?: number;
  /** The tool the child called last. */
  lastTool?: string;
  /** What the child said or thought last. */
  note?: string;
  summary?: string;
  durationS?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type ActivityItem = ToolActivity | ReasoningActivity | SubagentActivity;

/** A turn's parts in the order they happened: text, and runs of activity between the texts. */
export type TurnSegment = { kind: 'text'; text: string } | { kind: 'activity'; items: ActivityItem[] };

export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

const TODO_STATUSES: readonly Todo['status'][] = ['pending', 'in_progress', 'completed', 'cancelled'];

/** The agent's task list from a `todo.updated` payload (or a resume's `todo_state`): rows that are not tasks are left out. */
export function todosOf(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row: unknown, index) => {
    if (typeof row !== 'object' || row === null) return [];
    const { id, content, status } = row as Record<string, unknown>;
    if (typeof content !== 'string') return [];
    return [{ id: id === undefined ? String(index) : String(id), content, status: TODO_STATUSES.find((known) => known === status) ?? 'pending' }];
  });
}

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** Why a tool result is a failure, when it is one: tools report an `error`, `success: false`, or (as plain text) that the call could not be made. */
export function failureOf(result: unknown): string | undefined {
  const fields = record(result);
  if (fields) {
    if (typeof fields.error === 'string' && fields.error !== '') return fields.error;
    if (fields.success === false) return typeof fields.message === 'string' ? fields.message : 'The tool reported a failure.';
    if (fields.status === 'error') return typeof fields.message === 'string' ? fields.message : 'The tool reported an error.';
    return undefined;
  }
  if (typeof result === 'string' && /^(error\b|tool '[^']*' does not exist)/i.test(result.trim())) return result.trim();
  return undefined;
}

/** How much of a tool's output a card keeps: a card is a summary, and a result of megabytes is not a thing to put on a phone. */
export const OUTPUT_LIMIT = 20_000;

/** A result as text. Strings stay as they are; anything else is indented JSON. */
function outputText(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more characters not shown` : text;
}

/** The diff a tool's result carries: the plain unified diff when there is one, else the terminal-coloured one Hermes rendered, without the colours. */
function diffOf(result: unknown, inline: unknown): string | undefined {
  const plain = record(result)?.diff;
  if (typeof plain === 'string' && plain !== '') return plain;
  return typeof inline === 'string' && inline !== '' ? stripAnsi(inline) : undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A tool's card from its completed result (a live `tool.complete` and a stored tool row say the same things). */
function finishTool(tool: ToolActivity, { args, result, durationS, summary, resultText, inlineDiff }: { args?: unknown; result: unknown; durationS?: unknown; summary?: unknown; resultText?: unknown; inlineDiff?: unknown }): ToolActivity {
  const error = failureOf(result);
  const diff = diffOf(result, inlineDiff);
  return {
    ...tool,
    status: error === undefined ? 'done' : 'failed',
    ...(record(args) ? { args: record(args) } : {}),
    output: text(resultText) ?? outputText(result),
    ...(text(summary) ? { summary: text(summary) } : {}),
    ...(error === undefined ? {} : { error }),
    ...(diff === undefined ? {} : { diff }),
    ...(num(durationS) === undefined ? {} : { durationS: num(durationS) }),
  };
}

/** The kaomoji spinner captions Hermes streams as "thinking" text (`(⊙_⊙) analyzing...`): a status line, not the model's thoughts. */
const isCaption = (words: string) => /(\.{3}|…)\s*$/.test(words) && !words.includes('\n') && words.length <= 80;

/** Appends to the activity run at the end of the turn (starting one if the turn's last part is text). */
function inLastRun(segments: readonly TurnSegment[], change: (items: ActivityItem[]) => ActivityItem[]): TurnSegment[] {
  const last = segments.at(-1);
  if (last?.kind === 'activity') return [...segments.slice(0, -1), { kind: 'activity', items: change(last.items) }];
  return [...segments, { kind: 'activity', items: change([]) }];
}

/** Changes the one tool card `match` finds, wherever in the turn it is. */
function withTool(segments: readonly TurnSegment[], match: (tool: ToolActivity) => boolean, change: (tool: ToolActivity) => ToolActivity): TurnSegment[] | undefined {
  for (const [index, segment] of segments.entries()) {
    if (segment.kind !== 'activity') continue;
    const at = segment.items.findIndex((item) => item.kind === 'tool' && match(item));
    if (at < 0) continue;
    const items = segment.items.map((item, position) => (position === at ? change(item as ToolActivity) : item));
    return segments.map((part, position) => (position === index ? { kind: 'activity', items } : part));
  }
  return undefined;
}

let generated = 0;
/** A key for a card that has no id yet. Module-wide, so that two turns' keys never meet. */
const nextKey = (prefix: string) => `${prefix}-g${++generated}`;

/**
 * Takes one gateway event of the turn into its parts. Events that are not about what the agent is doing return `segments` as they
 * are. Deltas of the reply text are folded here too, so that the order of text and activity is kept.
 */
export function foldTurn(segments: readonly TurnSegment[], event: Pick<GatewayEvent, 'type' | 'payload'>): readonly TurnSegment[] {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'message.delta': {
      const words = text(payload.text);
      if (words === undefined) return segments;
      // The model has gone on from thinking to saying.
      const settled = closeReasoning(segments);
      const last = settled.at(-1);
      return last?.kind === 'text' ? [...settled.slice(0, -1), { kind: 'text', text: last.text + words }] : [...settled, { kind: 'text', text: words }];
    }
    case 'reasoning.delta':
    case 'thinking.delta': {
      const words = typeof payload.text === 'string' ? payload.text : '';
      if (words === '') return segments;
      const run = segments.at(-1);
      const open = run?.kind === 'activity' && run.items.at(-1)?.kind === 'reasoning' && (run.items.at(-1) as ReasoningActivity).streaming ? (run.items.at(-1) as ReasoningActivity) : undefined;
      if (event.type === 'thinking.delta' && isCaption(words)) {
        // A caption only says what an open reasoning card is doing; with none open there is nothing to caption.
        return open ? inLastRun(segments, (items) => [...items.slice(0, -1), { ...open, caption: words }]) : segments;
      }
      return inLastRun(segments, (items) => (open ? [...items.slice(0, -1), { ...open, text: open.text + words }] : [...items, { kind: 'reasoning', key: nextKey('reasoning'), text: words, streaming: true }]));
    }
    case 'reasoning.available': {
      // A whole block, for providers that do not stream their reasoning. Hermes also sends the reply itself this way when the model
      // said nothing separately: that is the reply, not a thought.
      const words = text(payload.text);
      const said = segments.flatMap((segment) => (segment.kind === 'text' ? [segment.text.trim()] : []));
      if (words === undefined || said.includes(words.trim())) return segments;
      const streamed = segments.flatMap((segment) => (segment.kind === 'activity' ? segment.items : [])).some((item) => item.kind === 'reasoning' && item.text.trim() === words.trim());
      if (streamed) return segments;
      return inLastRun(segments, (items) => [...items, { kind: 'reasoning', key: nextKey('reasoning'), text: words, streaming: false }]);
    }
    case 'tool.generating': {
      const name = text(payload.name);
      if (name === undefined) return segments;
      return inLastRun(closeReasoning(segments), (items) => [...items, { kind: 'tool', key: nextKey('tool'), id: undefined, name, status: 'generating' }]);
    }
    case 'tool.start': {
      const start = payload as unknown as ToolStartPayload;
      if (!start.tool_id || !start.name) return segments;
      const started = (tool: ToolActivity): ToolActivity => ({
        ...tool,
        id: start.tool_id,
        key: `tool-${start.tool_id}`,
        status: 'running',
        ...(text(start.context) ? { context: text(start.context) } : {}),
        ...(record(start.args) ? { args: record(start.args) } : {}),
      });
      // The card the model's `tool.generating` made is the one that starts (the first still without an id of that name).
      const adopted = withTool(segments, (tool) => tool.id === undefined && tool.name === start.name, started);
      if (adopted) return adopted;
      return inLastRun(closeReasoning(segments), (items) => [...items, started({ kind: 'tool', key: '', id: undefined, name: start.name, status: 'generating' })]);
    }
    case 'tool.complete': {
      const done = payload as unknown as ToolCompletePayload;
      if (!done.tool_id) return segments;
      const finished = (tool: ToolActivity) => finishTool(tool, { args: done.args, result: done.result, durationS: done.duration_s, summary: done.summary, resultText: done.result_text, inlineDiff: done.inline_diff });
      const changed = withTool(segments, (tool) => tool.id === done.tool_id, finished);
      if (changed) return changed;
      // A completion with no start (the tool's start was not sent): the card is made whole from the completion.
      return inLastRun(segments, (items) => [...items, finished({ kind: 'tool', key: `tool-${done.tool_id}`, id: done.tool_id, name: done.name, status: 'running' })]);
    }
    case 'tool.output_risk': {
      const { tool_id: id, risk, findings, redacted } = payload as { tool_id?: string; risk?: unknown; findings?: unknown; redacted?: unknown };
      if (typeof risk !== 'string' || risk === 'low') return segments;
      return withTool(segments, (tool) => tool.id === id, (tool) => ({ ...tool, risk: { level: risk, findings: Array.isArray(findings) ? findings.map(String) : [], redacted: redacted === true } })) ?? segments;
    }
    case 'subagent.spawn_requested':
    case 'subagent.start': {
      const child = subagentOf(payload as unknown as SubagentEventPayload, undefined);
      if (child === undefined) return segments;
      const present = segments.some((segment) => segment.kind === 'activity' && segment.items.some((item) => item.kind === 'subagent' && item.id === child.id));
      return present ? segments : inLastRun(closeReasoning(segments), (items) => [...items, child]);
    }
    default:
      return segments;
  }
}

/** Reasoning that the model finished (it went on to a tool call): it is no longer arriving. */
function closeReasoning(segments: readonly TurnSegment[]): readonly TurnSegment[] {
  const last = segments.at(-1);
  if (last?.kind !== 'activity' || !last.items.some((item) => item.kind === 'reasoning' && item.streaming)) return segments;
  return [...segments.slice(0, -1), { kind: 'activity', items: last.items.map((item) => (item.kind === 'reasoning' ? { ...item, streaming: false } : item)) }];
}

/** A turn that ended: nothing in it is arriving any more, and a tool that never reported is left as it was. */
export function endTurn(segments: readonly TurnSegment[]): readonly TurnSegment[] {
  return segments.map((segment) =>
    segment.kind === 'activity' ? { kind: 'activity', items: segment.items.map((item) => (item.kind === 'reasoning' ? { ...item, streaming: false } : item.kind === 'tool' && (item.status === 'generating' || item.status === 'running') ? { ...item, status: 'incomplete' as const } : item)) } : segment,
  );
}

const SUBAGENT_STATES: readonly SubagentStatus[] = ['queued', 'running', 'completed', 'failed', 'error', 'timeout', 'interrupted'];
/** The states a child does not leave. */
export const SUBAGENT_FINAL: readonly SubagentState[] = ['completed', 'failed', 'error', 'timeout', 'interrupted'];

function subagentOf(payload: SubagentEventPayload, before: SubagentActivity | undefined): SubagentActivity | undefined {
  const id = text(payload.subagent_id) ?? before?.id ?? (typeof payload.task_index === 'number' ? `task-${payload.task_index}` : undefined);
  if (id === undefined) return undefined;
  const status = SUBAGENT_STATES.find((known) => known === payload.status);
  const note = text(payload.text) ?? text(payload.tool_preview);
  return {
    kind: 'subagent',
    key: before?.key ?? `subagent-${id}`,
    id,
    goal: text(payload.goal) ?? before?.goal ?? 'Subagent',
    status: status ?? before?.status ?? 'running',
    ...(text(payload.model) ?? before?.model ? { model: text(payload.model) ?? before?.model } : {}),
    ...(text(payload.child_session_id) ?? before?.childSessionId ? { childSessionId: text(payload.child_session_id) ?? before?.childSessionId } : {}),
    ...(num(payload.tool_count) ?? before?.toolCount ? { toolCount: num(payload.tool_count) ?? before?.toolCount } : {}),
    ...(text(payload.tool_name) ?? before?.lastTool ? { lastTool: text(payload.tool_name) ?? before?.lastTool } : {}),
    ...(note ?? before?.note ? { note: note ?? before?.note } : {}),
    ...(text(payload.summary) ?? before?.summary ? { summary: text(payload.summary) ?? before?.summary } : {}),
    ...(num(payload.duration_seconds) ?? before?.durationS ? { durationS: num(payload.duration_seconds) ?? before?.durationS } : {}),
    ...(num(payload.input_tokens) ?? before?.inputTokens ? { inputTokens: num(payload.input_tokens) ?? before?.inputTokens } : {}),
    ...(num(payload.output_tokens) ?? before?.outputTokens ? { outputTokens: num(payload.output_tokens) ?? before?.outputTokens } : {}),
  };
}

/** The session's children, in the order they started: they go on after the turn that spawned them, so they are kept apart from the turn. */
export function foldSubagents(children: readonly SubagentActivity[], event: Pick<GatewayEvent, 'type' | 'payload'>): readonly SubagentActivity[] {
  if (!event.type.startsWith('subagent.')) return children;
  const payload = (event.payload ?? {}) as unknown as SubagentEventPayload;
  const id = text(payload.subagent_id);
  const before = id === undefined ? undefined : children.find((child) => child.id === id);
  const next = subagentOf(payload, before);
  if (next === undefined) return children;
  // A thinking or progress line about a child Hermes has not announced yet starts it; a late line about a finished child does not reopen it.
  const settled = before !== undefined && SUBAGENT_FINAL.includes(before.status) && payload.status == null;
  const merged = settled ? before : next;
  return before === undefined ? [...children, merged] : children.map((child) => (child === before ? merged : child));
}

/** The children Hermes lists as running now, added to the ones the page already knows (what the page has seen of a child is more than a snapshot says). */
export function withSnapshots(known: readonly SubagentActivity[], snapshots: readonly SubagentSnapshot[]): SubagentActivity[] {
  const added = snapshots.flatMap((snapshot): SubagentActivity[] =>
    known.some((child) => child.id === snapshot.subagent_id)
      ? []
      : [
          {
            kind: 'subagent',
            key: `subagent-${snapshot.subagent_id}`,
            id: snapshot.subagent_id,
            goal: text(snapshot.goal) ?? 'Subagent',
            status: SUBAGENT_STATES.find((state) => state === snapshot.status) ?? 'running',
            ...(text(snapshot.model) ? { model: text(snapshot.model) } : {}),
            ...(num(snapshot.tool_count) === undefined ? {} : { toolCount: num(snapshot.tool_count) }),
            ...(text(snapshot.last_tool) ? { lastTool: text(snapshot.last_tool) } : {}),
          },
        ],
  );
  return [...known, ...added];
}

/** The transcript's subagent cards as the session knows the children now: a child that went on after its card was made shows how it is. */
export function withLiveSubagents(items: readonly ActivityItem[], children: readonly SubagentActivity[]): ActivityItem[] {
  if (children.length === 0) return items as ActivityItem[];
  return items.map((item) => (item.kind === 'subagent' ? (children.find((child) => child.id === item.id) ?? item) : item));
}

// ── Hermes's stored history, as cards ─────────────────────────────────────────────────────────────────────────────────────────

/** A transcript entry read from history: a bubble of what was said, or a run of activity. */
export type HistoryEntry =
  | { kind: 'bubble'; id: number; role: 'user' | 'assistant'; text: string; /** When Hermes wrote the row (seconds since the epoch). */ at?: number; /** Hermes's note in place of a reply for a turn that failed. */ failed?: true; /** Hermes's note that it picked an interrupted turn up again (a user-role row the owner did not write). */ continued?: true }
  | { kind: 'activity'; items: ActivityItem[] };

const parseJson = (content: unknown): unknown => {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part: unknown) => (typeof part === 'string' ? [part] : record(part) && typeof record(part)!.text === 'string' ? [record(part)!.text as string] : [])).join('\n');
};

/** The subagents a `delegate_task` result says it started, as cards ("delegated": how they ended is not in the result). */
function delegated(call: string, result: unknown): SubagentActivity[] {
  const fields = record(result);
  const ids = fields?.subagent_ids;
  if (!Array.isArray(ids)) return [];
  const goals = Array.isArray(fields?.goals) ? fields.goals : [];
  return ids.flatMap((id: unknown, index) => (typeof id === 'string' ? [{ kind: 'subagent' as const, key: `subagent-${id}`, id, goal: typeof goals[index] === 'string' ? goals[index] : `Subagent for ${call}`, status: 'delegated' as const }] : []));
}

/**
 * Hermes's rows as what the transcript draws, in order: the owner's prompts and Hermes's words as bubbles, and between them the
 * reasoning, the tool calls and the children as runs of cards. A tool call takes the result of the row that answers it.
 */
export function entriesOf(rows: readonly HistoryRow[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const pending = new Map<string, { tool: ToolActivity; entry: Extract<HistoryEntry, { kind: 'activity' }> }>();
  const run = (): Extract<HistoryEntry, { kind: 'activity' }> => {
    const last = entries.at(-1);
    if (last?.kind === 'activity') return last;
    const made: Extract<HistoryEntry, { kind: 'activity' }> = { kind: 'activity', items: [] };
    entries.push(made);
    return made;
  };
  for (const row of rows) {
    if (row.display_kind === 'hidden') continue;
    if (row.role === 'user') {
      const words = textOf(row.content);
      if (words !== '') entries.push({ kind: 'bubble', id: row.id, role: 'user', text: words, ...(typeof row.timestamp === 'number' ? { at: row.timestamp } : {}), ...(isAutoContinueNote(row, words) ? { continued: true as const } : {}) });
    } else if (row.role === 'assistant') {
      const thought = text(row.reasoning) ?? text(row.reasoning_content);
      if (thought) run().items.push({ kind: 'reasoning', key: `reasoning-r${row.id}`, text: thought, streaming: false });
      const words = textOf(row.content);
      if (words !== '') entries.push({ kind: 'bubble', id: row.id, role: 'assistant', text: words, ...(typeof row.timestamp === 'number' ? { at: row.timestamp } : {}), ...(isFailedTurnNotice(words) ? { failed: true as const } : {}) });
      for (const call of Array.isArray(row.tool_calls) ? row.tool_calls : []) {
        const fields = record(call);
        const fn = record(fields?.function);
        const id = text(fields?.id) ?? text(fields?.call_id);
        const name = text(fn?.name);
        if (id === undefined || name === undefined) continue;
        const args = record(parseJson(fn?.arguments));
        const tool: ToolActivity = { kind: 'tool', key: `tool-${id}`, id, name, status: 'incomplete', ...(args ? { args } : {}) };
        const into = run();
        into.items.push(tool);
        pending.set(id, { tool, entry: into });
      }
    } else if (row.role === 'tool') {
      const id = text(row.tool_call_id);
      const call = id === undefined ? undefined : pending.get(id);
      if (!call || id === undefined) continue;
      const result = parseJson(row.content);
      const finished = finishTool(call.tool, { result });
      const at = call.entry.items.indexOf(call.tool);
      call.entry.items.splice(at, 1, finished, ...delegated(call.tool.name, result));
      pending.delete(id);
    }
  }
  return entries;
}

// ── Usage ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a reply cost: the tokens, and how fast they came. */
export interface ReplyStats {
  input: number | undefined;
  output: number | undefined;
  total: number | undefined;
  /** Output tokens per second. */
  tps: number | undefined;
}

/** The footer of a reply from the usage Hermes reported at the end of its turn; `elapsedMs` (the page's own clock) stands in when Hermes does not say how fast. */
export function statsOf(usage: Usage | null | undefined, elapsedMs: number): ReplyStats | undefined {
  if (!usage) return undefined;
  const input = num(usage.input) ?? num(usage.prompt);
  const output = num(usage.output) ?? num(usage.completion);
  const total = num(usage.total) ?? (input !== undefined && output !== undefined ? input + output : undefined);
  // A turn that was stopped before the model counted anything reports zeros: that is no footer.
  if (!input && !output && !total) return undefined;
  const reported = num(usage.avg_tps);
  const measured = output !== undefined && elapsedMs > 0 ? output / (elapsedMs / 1000) : undefined;
  return { input, output, total, tps: reported !== undefined && reported > 0 ? reported : measured };
}

/** A reply's footer in words: `80 in · 20 out · 42.5 tokens/s`. */
export function footerText(stats: ReplyStats): string {
  const count = (value: number) => value.toLocaleString('en');
  return [
    stats.input === undefined ? undefined : `${count(stats.input)} in`,
    stats.output === undefined ? undefined : `${count(stats.output)} out`,
    stats.tps === undefined ? undefined : `${count(Math.round(stats.tps * 10) / 10)} tokens/s`,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}

// ── Activity modes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How agent work shows in the transcript. */
export type ActivityMode = 'worklog' | 'stream' | 'final';
export const ACTIVITY_MODES: readonly ActivityMode[] = ['worklog', 'stream', 'final'];
export const DEFAULT_ACTIVITY_MODE: ActivityMode = 'worklog';

export const parseActivityMode = (value: unknown): ActivityMode | undefined => ACTIVITY_MODES.find((mode) => mode === value);

/** The Hermes settings that go with a mode: `details_mode` (how its own clients draw sections) and `tool_progress` (whether it sends tool events at all; the `verbose` key of `config.set`). */
export function hermesSettingsFor(mode: ActivityMode): { details_mode: 'collapsed' | 'expanded' | 'hidden'; tool_progress: 'all' | 'off' } {
  switch (mode) {
    case 'worklog':
      return { details_mode: 'collapsed', tool_progress: 'all' };
    case 'stream':
      return { details_mode: 'expanded', tool_progress: 'all' };
    case 'final':
      return { details_mode: 'hidden', tool_progress: 'off' };
  }
}

/** What the transcript shows of a run of cards in a mode: Final only shows none; the others show them all. */
export function shownActivity(items: readonly ActivityItem[], mode: ActivityMode): ActivityItem[] {
  return mode === 'final' ? [] : (items as ActivityItem[]);
}

/** Whether a card opens by itself: Worklog keeps cards closed, Stream opens them. A card that failed is open in both, so that nothing hides it. */
export function opensByDefault(item: ActivityItem, mode: ActivityMode): boolean {
  if (mode === 'stream') return true;
  return item.kind === 'tool' && item.status === 'failed';
}

// ── Notices ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Notice {
  tone: 'success';
  message: string;
  detail?: string;
}

const clip = (words: string) => (words.length > 120 ? `${words.slice(0, 119)}…` : words);

/** A toast for events that say the agent saved something to its memory or skills: the memory tool and the skill manager finishing, and the summary Hermes's background review gives. */
export function noticeOf(event: Pick<GatewayEvent, 'type' | 'payload'>): Notice | undefined {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (event.type === 'review.summary') {
    const summary = text(payload.text);
    if (summary === undefined) return undefined;
    const bare = summary.replace(/^\s*[^\p{L}\p{N}]+/u, '');
    if (/memory/i.test(bare)) return { tone: 'success', message: 'Memory saved', detail: clip(bare) };
    if (/skill/i.test(bare)) return { tone: 'success', message: 'Skill saved', detail: clip(bare) };
    return undefined;
  }
  if (event.type !== 'tool.complete') return undefined;
  const { name, args, result } = payload as { name?: unknown; args?: unknown; result?: unknown };
  if (failureOf(result) !== undefined) return undefined;
  const action = text(record(args)?.action);
  if (name === 'memory' && (action === 'add' || action === 'replace')) {
    return { tone: 'success', message: 'Memory saved', ...(text(record(args)?.content) ? { detail: clip(text(record(args)?.content)!) } : {}) };
  }
  if (name === 'skill_manage' && (action === 'create' || action === 'edit' || action === 'patch' || action === 'write_file')) {
    return { tone: 'success', message: 'Skill saved', ...(text(record(args)?.name) ? { detail: clip(text(record(args)?.name)!) } : {}) };
  }
  return undefined;
}
