// The Chat module's engine (M1 #03): one chat, and the list of a profile's chats, over the page's gateway connection. No DOM
// and no React: the screen reads `state` through `useSyncExternalStore`, and the engine runs under test.
//
// Hermes is the source of truth: nothing about a session or a message is kept here beyond what the page is showing. The list
// is `session.list`, the transcript is what `session.resume` / `session.history` return, and a streamed reply is built from
// the events of the turn.
import { CADUCEUS_SESSION_SOURCE, type ChatLimits } from '@caduceus/contracts/caduceus-api';
import type {
  ApprovalRespondResult,
  CommandDispatchResult,
  CommandsCatalogResult,
  CompletionItem,
  CompleteSlashResult,
  ConfigGetResult,
  ConfigSetResult,
  GoalSnapshot,
  RequestAnswerResult,
  SessionActivateResult,
  SessionCompressResult,
  SessionContextBreakdownResult,
  SessionCreateResult,
  SessionCwdSetResult,
  SessionLiveInfo,
  SessionTitleResult,
  SlashExecResult,
  SessionUsageResult,
  SessionEventsSinceResult,
  SideAgentCompletePayload,
  SessionControlReadResult,
  SessionControlResult,
  SessionControlUpdatePayload,
  SessionCorrectionResult,
  SessionResumeResult,
  SubagentListResult,
  TaskIdResult,
  ToolsConfigureResult,
  ToolsetRow,
  ToolsShowResult,
  Usage,
  SessionUndoResult,
  SessionHistoryResult,
  SessionBranchResult,
} from '@caduceus/contracts/hermes/gateway';
import type { GatewayEvent } from '@caduceus/contracts/hermes/shared/gateway';
import { parseCommandDispatch, parseSlashCommand, type CommandDispatchResponse } from '@caduceus/contracts/hermes/shared/slash';
import type { GatewayConnection } from '../../gateway-connection.ts';
import { approvalParams, cancelledApprovals, clarifyResult, denyNote, needsStepUp, requestOf, settledOf, DEFAULT_CLARIFY_TIMEOUT_S, type ApprovalDecision, type ClarifyAnswers, type OpenRequest, type SettledRequest } from './requests.ts';
import { endTurn, entriesOf, withSnapshots, foldSubagents, foldTurn, hermesSettingsFor, noticeOf, statsOf, todosOf, withLiveSubagents, type ActivityItem, type ActivityMode, type Notice, type ReplyStats, type SubagentActivity, type Todo, type TurnSegment } from './activity.ts';
import { referenceValue, type FolderEntry } from './path-reference.ts';
import { uploadAttachments, type Upload, type UploadStep } from './attachment-upload.ts';
import { aroundUrl, fromAround, fromLatest, latestUrl, mergeLatest, newerUrl, olderUrl, withNewer, withOlder, type HistoryBody, type HistoryWindow } from './history-window.ts';
import { afterCompression, mergeUsage } from './composer-model.ts';
import { createStore, type Store } from './store.ts';
import { editedText, forkFailureWords, forkPlan, forkWasCut } from './message-actions.ts';
import { readStopped, writeStopped } from './turn-recovery.ts';
import { branchStored } from './session-branch.ts';
import { deviceStorage, readQueue, writeQueue, type QueuedMessage, type QueueStorage } from './queue.ts';

/** What picking a model did: it is set, or Hermes warns first (an expensive model) and wants the owner to confirm its words. */
export type ModelSwitch = { kind: 'set'; warning?: string } | { kind: 'confirm'; message: string };

/** One bubble of the transcript. */
export interface ChatMessage {
  /** Hermes's row id for the message, once Hermes holds it (what a link to the message names). */
  id?: number;
  /** When Hermes wrote it (seconds since the epoch). */
  at?: number;
  role: 'user' | 'assistant';
  text: string;
  /** What the agent did, in place of words: reasoning, tool calls and subagents, as cards. Such a message has no text and no id. */
  activity?: ActivityItem[];
  /** What names a message with no Hermes row (a run of cards from history) in the list: the first card's, which does not change as older messages load. */
  key?: string;
  /** The turn that made this reply was stopped: it is what came before the stop. */
  stopped?: true;
  /** What the reply cost (the last reply of a turn that has just finished). */
  stats?: ReplyStats;
  /** The turn failed and this is where its reply would be: what went wrong, in Hermes's words (its own note for the turn when the page was not there to hear the error). */
  failed?: { error: string };
  /** Hermes wrote this into the history, not the owner: it picked a turn that was interrupted up again (`continued`), or this is a steer or the reason of a denied approval, whose words are in `text` and which is drawn as a note (`steered`). */
  note?: 'continued' | 'steered';
  /** The first message of a scheduled run: `text` is the job's own prompt, and this is the instructions Hermes wrote in front of it, shown as a small note. */
  scheduled?: string;
}

/** The turn in progress, or the last one that did not complete: what is shown after the transcript Hermes holds. */
export interface ChatTurn {
  /** The prompt, until Hermes's transcript holds it. */
  user: string | undefined;
  /** The turn so far, in order: the reply's text and the activity between its parts. */
  segments: readonly TurnSegment[];
  status: 'waiting' | 'streaming' | 'failed';
  /** Hermes's tally for the turn, once it is over (until Hermes's transcript holds the reply). */
  stats?: ReplyStats;
  /** What went wrong, for a turn that `failed`. */
  error?: string;
}

/** A `/btw` question or a `/background` prompt: it runs beside the main turn, and its answer is its own, not a message of the chat. */
export interface SideTask {
  /** Hermes's id for the task (`task_id`). */
  id: string;
  kind: 'btw' | 'background';
  /** What was asked. */
  prompt: string;
  status: 'running' | 'done' | 'failed';
  /** The answer, once the task is over (Hermes's words for why, when it failed). */
  answer: string | undefined;
  /** The task finished and the owner has not opened its result yet. */
  unseen: boolean;
}

/**
 * The notes of the chats this page has opened, by profile and stored session. A new chat becomes `/chat/:id` once it has a session, which opens it afresh
 * (a new engine, read back from Hermes): the answers of the commands the owner ran before that must still be there.
 */
const keptNotes = createStore<{ byChat: Readonly<Record<string, readonly CommandNote[]>> }>({ byChat: {} });
const notesKey = (profile: string | undefined, storedId: string | undefined) => (storedId === undefined ? undefined : `${profile ?? ''}/${storedId}`);

/** What a slash command said back, shown in the transcript where the owner typed it (Hermes keeps none of it: it is the page's, and goes with the chat). */
export interface CommandNote {
  id: string;
  /** The command it answers, as `/title`. */
  command: string;
  text: string;
  tone: 'info' | 'warning' | 'danger';
}

/** What running a slash command came to: its words are in `notes` (`noted`), Hermes backed the composer up to a message to edit (`prefill`), it started a turn (`sent`), or it did not run (`failed`, and why is in `notes`). */
export type SlashOutcome = { kind: 'noted' } | { kind: 'prefill'; text: string } | { kind: 'sent' } | { kind: 'failed' };

export interface ChatState {
  /** The stored session id (Hermes's), once the chat has a session. */
  storedId: string | undefined;
  /** What Hermes's transcript holds. */
  messages: ChatMessage[];
  turn: ChatTurn | undefined;
  /** A turn is running (Hermes is working on a prompt). */
  running: boolean;
  /** Hermes's title for the chat, once it has one. */
  title: string | undefined;
  /** The chat is being opened, or caught up with Hermes after the connection came back. */
  syncing: boolean;
  /** `syncing` has taken longer than `CATCH_UP_DELAY_MS`: the screen says "Catching up…". */
  catchingUp: boolean;
  /** What went wrong, in Hermes's words, when something did. */
  error: string | undefined;
  /** Hermes holds messages before the first one loaded (load earlier), or after the last (the window was opened around a message). */
  hasOlder: boolean;
  hasNewer: boolean;
  /** An older or newer page is being read. */
  loadingMore: boolean;
  /** The message a link opened the chat at: the screen scrolls to it and highlights it. */
  focusId: number | undefined;
  /** The agent's task list (`todo.updated`). */
  todos: Todo[];
  /** The children the agent delegated work to, in the order they started. They go on after the turn that spawned them. */
  subagents: SubagentActivity[];
  /** The session's token usage, as Hermes last said (`session.usage`, and the end of each turn). */
  usage: Usage | undefined;
  /** YOLO is on for this session: Hermes runs every command without asking (`session.info`'s `yolo`). */
  yolo: boolean;
  /** Where the session's agent works (Hermes's `cwd`), as an approval says where its command runs. */
  cwd: string | undefined;
  /** The model the session uses (or, before it has a session, the one the owner picked for it), as Hermes names it; undefined while Hermes's own default stands. */
  model: string | undefined;
  provider: string | undefined;
  /** The reasoning effort the session runs with (`session.info`), or the owner's pick for a chat that has no session yet. Empty or undefined: the profile's default. */
  reasoning: string | undefined;
  /** What Hermes is waiting for the owner to decide: approvals and clarify questions, oldest first. They are Hermes's, so a resume hands them over again. */
  requests: OpenRequest[];
  /** Requests that closed without the owner answering them here, and what became of each. */
  settled: SettledRequest[];
  /** How long Hermes waits for a clarify answer (seconds; 0 or less is for ever), from its config. */
  clarifyTimeoutS: number;
  /** What the owner steered the running turn with, in order: Hermes hands each to the agent with its next tool result, so a steer is not an answer yet. Cleared when the turn ends. */
  steers: string[];
  /** Messages the owner queued for after the running turn, in the order they will go. They are the page's (kept in the browser's storage, so a reload keeps them), not Hermes's. */
  queue: QueuedMessage[];
  /** The queue is held: the turn before it was stopped or failed, so the next message waits for the owner (`runQueue`). */
  queuePaused: boolean;
  /** The side tasks started on this page (`/btw`, `/background`), oldest first. Hermes does not list them: one that finishes after a reload still arrives, as an event, and is shown with what it answered. */
  sideTasks: SideTask[];
  /** The session's goal, as Hermes last said (`session.control.read` and `session.control.update`); none when it has none. */
  goal: GoalSnapshot | undefined;
  /** What the slash commands run in this chat answered, oldest first. */
  notes: CommandNote[];
  /** The chat this one was forked from (`session.branch`), by its stored id and title, when it is a fork. Hermes records it; the page reads it. */
  forkedFrom: { id: string; title: string | undefined } | undefined;
  /** The chat is read from Hermes and never resumed (another process owns the session): nothing can be sent, and what the other process writes is read again as Hermes announces it. */
  readOnly: boolean;
}

/** What Continue says to Hermes. */
export const CONTINUE_PROMPT = 'Please continue from where you stopped.';

/** How long catching up with Hermes takes before the screen says so: a quick resume shows nothing. */
export const CATCH_UP_DELAY_MS = 300;

/** What goes with a prompt. */
export interface SendOptions {
  attachments?: readonly Upload[];
  /** Told as each attachment starts, is taken and fails. */
  onProgress?: (step: UploadStep) => void;
}

export interface ChatOptions {
  /** The profile the tab works on (`?profile=`); the engine passes it on every call that takes one. */
  profile?: string;
  /** The workspace the session works in, passed as `cwd`. */
  cwd?: string;
  /** Open this stored session (a deep link `/chat/:id`) instead of starting a new chat. */
  storedId?: string;
  /** Open at this prompt (Hermes's row id), through its messages-around endpoint, instead of at the newest messages. */
  around?: number;
  /** Open the session to read it, never to continue it (another process owns it, or a Kanban worker): the session is not resumed, the transcript is read from Hermes's REST history and read again whenever Hermes announces a change, and nothing can be sent. */
  readOnly?: boolean;
  /** The message to highlight in the window `around` opens (a search hit: the message that matches); the prompt itself when left out. */
  focus?: number;
  /** The activity mode this device chose, if it has chosen one: Hermes's `details_mode` and `tool_progress` are set to match when the session starts. */
  activityMode?: ActivityMode;
  /** Asks the owner to confirm with a passkey (the page's step-up dialog): resolves `true` once they have, `false` if they cancel. A call the server refuses for want of one (Allow always, YOLO) is sent again after it. */
  stepUp?: () => Promise<boolean>;
  /** Told when the agent saves a memory or a skill (the screen raises a toast). */
  notify?: (notice: Notice) => void;
  /** The page's clock in ms, for reply speed when Hermes does not report one. */
  now?: () => number;
  /** Reads a JSON path of Hermes's REST API (the page's own `fetch`); a test passes one that goes through its server. */
  history?: (path: string) => Promise<unknown>;
  /** Where the page keeps this chat's queue and the replies it stopped (the browser's `localStorage` when not given). */
  queueStorage?: QueueStorage;
  /** The page's timers; a test passes its own so that nothing waits on the clock. */
  timers?: { setTimeout(run: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
}

export interface Chat extends Store<ChatState> {
  /** Sends a prompt, with its attachments; the first one of a new chat creates the session. It does not reject: a prompt that could not go sets `error` and resolves false (an attachment Hermes refused is named in it, and nothing was sent). */
  send(text: string, options?: SendOptions): Promise<boolean>;
  /**
   * Edit and resend: replaces user message `id` with `edited` (its attachment lines kept) and everything after it, as one turn (`prompt.submit` with `truncate_before_row_id`). Hermes refuses while a turn runs.
   * It does not reject: a prompt that could not go leaves the transcript as it was, sets `error` and resolves false.
   */
  editAndResend(id: number, edited: string): Promise<boolean>;
  /** Regenerate: asks again for the reply to the last message of the owner's, which Hermes removes with the reply (a turn that failed or was stopped too). Same refusals as `editAndResend`. */
  regenerate(): Promise<boolean>;
  /** Undo: removes the last exchange from Hermes's history (`session.undo`). Resolves with how many messages Hermes removed and the words of the user message that was undone (none when there was nothing to undo). Rejects with Hermes's words (it refuses while a turn runs). */
  undo(): Promise<{ removed: number; message: string | undefined }>;
  /** Reads the chat's title from Hermes again (`session.title`): a title changed from the list, or by the menu, is not an event this chat hears. */
  refreshTitle(): Promise<void>;
  /** Hermes's runtime id of the chat's session, once it has one. A one-shot call (`llm.oneshot`, fast chat) that names it is answered by this session's model. */
  liveSession(): string | undefined;
  /** Retry: Hermes's own `/retry` (a failed or interrupted turn, or the last reply the owner wants again): it takes the last exchange out of its history and sends the message again, so there is never a second copy of it. Resolves true when the message went. */
  retry(): Promise<boolean>;
  /** Continue: asks Hermes to carry on from where an interrupted turn stopped, as a message of the owner's. Resolves true when it went. */
  continueTurn(): Promise<boolean>;
  /**
   * Fork: branches the chat into a new Hermes session (`session.branch`) and resolves with its stored id (the screen opens it). From a message other than the tip (`from`, its row id) the branch is then cut back to it with `session.undo`,
   * and Hermes's own history of the branch is read to check that it ends where it should; the words of a user message that was cut come back as `prefill`, to edit. Rejects with the reason only when Hermes refuses before a branch exists (a turn is running).
   * When the branch exists but could not be cut at that message, it still resolves with the branch (never a stray chat in the list), and `notCut` says in plain words why and what the new chat holds instead.
   */
  fork(from?: number): Promise<{ storedId: string; prefill: string | undefined; notCut?: string }>;
  /** Continues a session in a new one: Hermes branches it (`session.branch`) into a stored child with the whole history, and the child is the chat to open. For a read-only chat the original is resumed for just this and closed again. */
  branch(): Promise<{ storedId: string }>;
  /** Creates the session now, without a prompt (the first `send` does it otherwise). */
  start(): Promise<void>;
  /** Hermes's tools for this session (`tools.show`), read once its agent is built: before that Hermes has no agent to ask and lists every tool there is, bridges the session does not get included. Rejects with Hermes's own words when the agent cannot be built (no provider). */
  tools(): Promise<ToolsShowResult>;
  /** Sets how agent work shows, in Hermes too: `details_mode` and `tool_progress` of the config, and of the running session. Rejects with Hermes's words when it refuses. */
  setActivityMode(mode: ActivityMode): Promise<void>;
  /** Redirects the running turn (`session.steer`): the agent reads the text with its next tool result. It does not reject: a steer Hermes refuses sets `error` and resolves false (the text is still the owner's to keep). */
  steer(text: string): Promise<boolean>;
  /** Queues a message to go after the running turn (at once when nothing is running). */
  enqueue(text: string): void;
  /** Changes the text of a queued message. */
  editQueued(id: string, text: string): void;
  /** Takes a message off the queue and returns its text (so that it can go back into the composer); undefined when it is not there. */
  cancelQueued(id: string): string | undefined;
  /** Lets a held queue go on: its first message is sent once nothing is running. */
  runQueue(): void;
  /** Asks a side question (`prompt.btw`): it is answered from a snapshot of the conversation without disturbing the running turn. It does not reject: a refusal sets `error`. */
  btw(text: string): Promise<void>;
  /** Starts a background prompt (`prompt.background`) on a fresh agent; its result arrives as a finished side task. It does not reject. */
  background(text: string): Promise<void>;
  /** The owner opened the result of a finished side task. */
  readSideTask(id: string): void;
  /** Takes a side task off the screen. */
  dismissSideTask(id: string): void;
  /** Sets the goal (`/goal <text>`; a new text replaces the old goal) and starts working on it: Hermes's kickoff goes as a turn (queued behind a running one). Rejects with Hermes's words when it refuses. */
  setGoal(text: string): Promise<void>;
  /** Runs Hermes's `/learn` with the owner's topic (`command.dispatch`, a passkey first: Tier 2) and sends the prompt Hermes builds from it as a turn (queued behind a running one). Rejects with Hermes's or the policy's words when it does not go; a prompt Hermes then fails to take sets `error`, as `send` does. */
  learn(topic: string): Promise<void>;
  /**
   * Runs a slash command the owner typed, the way Hermes's own clients do: `slash.exec` first, then `command.dispatch` for what the worker leaves to it (quick commands, skills, `/retry`…).
   * Hermes's text goes to `notes`; a prompt it builds (`send`, a skill) goes as a turn, queued behind a running one; `/undo` hands back the message it backed up to. It does not reject: a refusal (the proxy's, with its reason) or an error is a `danger` note and `failed`.
   */
  runSlash(typed: string): Promise<SlashOutcome>;
  /** Hermes's catalogue of commands for this chat: its commands, skills, quick and plugin commands (`commands.catalog`). Read once per session. */
  commandCatalog(): Promise<CommandsCatalogResult>;
  /** What Hermes offers after the text typed so far (`complete.slash`): the arguments of a command, such as the personalities. */
  completeSlash(text: string): Promise<CompletionItem[]>;
  /** Takes a command's note off the screen. */
  dismissNote(id: string): void;
  /** The entries of a folder as Hermes lists them (`GET /api/fs/list`, through the proxy's file guard, which refuses what Caduceus protects): for `@` and `~/` completion. Rejects when the proxy or Hermes refuses; a folder Hermes cannot read is an empty list. */
  listFolder(path: string): Promise<FolderEntry[]>;
  /** Clears the goal (`session.control` `goal.clear`). Rejects with Hermes's words when it refuses. */
  clearGoal(): Promise<void>;
  /** Pauses or resumes the goal (`goal.pause`, `goal.resume`); resuming goes on with a turn. Rejects with Hermes's words when it refuses. */
  pauseGoal(paused: boolean): Promise<void>;
  /** Interrupts the running turn. The part of the reply that came stays. */
  stop(): Promise<void>;
  /** Answers an approval card with the owner's decision. It does not reject: a refused or failed answer leaves the card open with `error` saying why. */
  answerApproval(id: string, decision: ApprovalDecision): Promise<void>;
  /** Answers a clarify card (`answers` by question id: the text, or a list for a multiple-choice question). It does not reject, like `answerApproval`. */
  answerClarify(id: string, answers: ClarifyAnswers): Promise<void>;
  /** Turns YOLO on or off for this session (`config.set yolo`). Turning it on is T2: the owner is asked for a passkey. Rejects with the refusal's words when it does not take. */
  setYolo(on: boolean): Promise<void>;
  /** Picks the model for the chat: a chat with a session switches now (this session only, `config.set model --session`), a new chat starts with it. A model Hermes warns about is not set until it is asked again with `confirmExpensive`. Rejects with Hermes's words when it refuses. */
  setModel(choice: { provider: string; model: string }, options?: { confirmExpensive?: boolean }): Promise<ModelSwitch>;
  /** Sets the reasoning effort for this chat only (`config.set reasoning`, session scope); a new chat starts with it. Rejects with Hermes's words. */
  setReasoning(effort: string): Promise<void>;
  /** Moves the chat's agent to a directory (`session.cwd.set`, which Hermes refuses while a turn runs); a new chat starts there. Rejects with Hermes's words. */
  setWorkspace(cwd: string): Promise<void>;
  /** The directory Hermes's agent works in when a chat picks none (`config.get project`). */
  defaultWorkspace(): Promise<string | undefined>;
  /** The profile's toolsets with whether each is on (`GET /api/tools/toolsets`). */
  toolsets(): Promise<ToolsetRow[]>;
  /** Turns toolsets on or off (`tools.configure`). Hermes writes this to the profile's config, so it holds for every chat of the profile, and rebuilds this session's agent. */
  configureToolsets(action: 'enable' | 'disable', names: string[]): Promise<ToolsConfigureResult>;
  /** How the context window is used, by category (`session.context_breakdown`). */
  contextBreakdown(): Promise<SessionContextBreakdownResult>;
  /** Compresses the conversation (`session.compress`, Hermes refuses while a turn runs); the usage and transcript are what Hermes holds afterwards. */
  compress(focusTopic?: string): Promise<SessionCompressResult>;
  /** Reads the session's usage again (`session.usage`). */
  refreshUsage(): Promise<void>;
  /** Takes a closed request's notice off the screen. */
  dismissSettled(id: string): void;
  /** Reads the page of messages before the first one loaded. */
  loadOlder(): Promise<void>;
  /** Reads the page after the last one loaded (a window opened around a message). */
  loadNewer(): Promise<void>;
  /** Back to the newest messages, from a window opened around a message. */
  showLatest(): Promise<void>;
  /** Reads every page before and after the window until the whole transcript is loaded (search and copy work on what is loaded). Stops at a page Hermes would not give. */
  loadAll(): Promise<void>;
  dispose(): void;
}

/** What a transcript shows: Hermes's messages, then the turn in progress (its prompt unless Hermes already holds it, then its text and cards in the order they came), with the subagent cards as the session knows the children now. */
export function transcriptOf({ messages, turn, hasNewer = false, subagents = [] }: Pick<ChatState, 'messages' | 'turn'> & { hasNewer?: boolean; subagents?: readonly SubagentActivity[] }): ChatMessage[] {
  const resolved = subagents.length === 0 ? messages : messages.map((message) => (message.activity ? { ...message, activity: withLiveSubagents(message.activity, subagents) } : message));
  // A window opened in the middle of the session is not where the turn in progress belongs.
  if (!turn || hasNewer) return resolved;
  // A failed turn Hermes's transcript already closes with its note is that note, not a second copy of the turn.
  if (turn.status === 'failed' && messages.at(-1)?.failed) return resolved;
  const held = turn.user === undefined || (messages.at(-1)?.role === 'user' && messages.at(-1)?.text === turn.user);
  const parts: ChatMessage[] = turn.segments.map((segment) => (segment.kind === 'text' ? { role: 'assistant' as const, text: segment.text } : { role: 'assistant' as const, text: '', activity: withLiveSubagents(segment.items, subagents) }));
  const last = parts.at(-1);
  if (last && !last.activity && turn.stats) last.stats = turn.stats;
  // A turn that has started shows a reply bubble before the first word comes.
  if (parts.length === 0 && turn.status === 'streaming') parts.push({ role: 'assistant', text: '' });
  // A turn that failed and whose note Hermes's transcript does not hold (yet) is still a failed turn.
  if (turn.status === 'failed') parts.push({ role: 'assistant', text: '', failed: { error: turn.error ?? 'The turn failed.' } });
  return [...resolved, ...(held ? [] : [{ role: 'user' as const, text: turn.user! }]), ...parts];
}

/** What the engine needs of the page's gateway connection. */
export type ChatConnection = Pick<GatewayConnection, 'client' | 'status' | 'onReady'>;

export function createChat(connection: ChatConnection, options: ChatOptions = {}): Chat {
  const { client } = connection;
  const profile = options.profile === undefined ? {} : { profile: options.profile };
  const timers = options.timers ?? { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const storage = options.queueStorage ?? deviceStorage();
  const saved = readQueue(storage, options.profile, options.storedId);
  const store = createStore<ChatState>({ storedId: options.storedId, messages: [], turn: undefined, running: false, title: undefined, syncing: false, catchingUp: false, error: undefined, hasOlder: false, hasNewer: false, loadingMore: false, focusId: options.focus ?? options.around, todos: [], subagents: [], usage: undefined, cwd: options.cwd, model: undefined, provider: undefined, reasoning: undefined, yolo: false, requests: [], settled: [], clarifyTimeoutS: DEFAULT_CLARIFY_TIMEOUT_S, steers: [], queue: saved.queue, queuePaused: saved.paused, sideTasks: [], goal: undefined, notes: [...(keptNotes.state.byChat[notesKey(options.profile, options.storedId) ?? ''] ?? [])], forkedFrom: undefined, readOnly: options.readOnly === true });
  const readHistory = options.history ?? (async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
    return response.json();
  });
  /** The part of Hermes's history the page has loaded. */
  let loaded: HistoryWindow | undefined;
  /** The footer of replies, by Hermes's row id: the page keeps what Hermes said a turn cost, since Hermes's transcript does not hold it. */
  const replyStats = new Map<number, ReplyStats>();
  /** Shows the loaded window; `stats` is what the turn that just finished cost, for its last reply. */
  const publish = (window: HistoryWindow, clearTurn = false, stats?: ReplyStats) => {
    loaded = window;
    const entries = entriesOf(window.rows);
    const lastReply = entries.findLast((entry) => entry.kind === 'bubble' && entry.role === 'assistant');
    if (stats && lastReply?.kind === 'bubble') replyStats.set(lastReply.id, stats);
    // Hermes's transcript does not say a reply was stopped: the one that just came back from a stop is kept as stopped by its row, which a reload keeps.
    // A turn stopped before its first word has no reply: Hermes closes it with its failed-turn note, which is a stop here, with no words.
    if (stopPending !== undefined && lastReply?.kind === 'bubble' && (lastReply.text === stopPending || (stopPending === '' && lastReply.failed))) {
      stoppedIds.add(lastReply.id);
      writeStopped(storage, options.profile, store.state.storedId, stoppedIds);
      stopPending = undefined;
    }
    // Hermes closes a turn that failed with a note of its own; the error the page heard is what the bubble says, once Hermes's transcript holds the note.
    if (failurePending !== undefined && lastReply?.kind === 'bubble' && lastReply.failed) {
      failureDetails.set(lastReply.id, failurePending);
      failurePending = undefined;
    }
    store.set({
      messages: entries.map((entry): ChatMessage => {
        if (entry.kind === 'activity') return { role: 'assistant', text: '', activity: entry.items, key: `a-${entry.items[0]!.key}` };
        const footer = replyStats.get(entry.id);
        return {
          id: entry.id,
          ...(entry.at === undefined ? {} : { at: entry.at }),
          role: entry.role,
          text: entry.failed && stoppedIds.has(entry.id) ? '' : entry.text,
          ...(stoppedIds.has(entry.id) ? { stopped: true as const } : {}),
          ...(footer ? { stats: footer } : {}),
          ...(entry.failed && !stoppedIds.has(entry.id) ? { failed: { error: failureDetails.get(entry.id) ?? entry.text } } : {}),
          ...(entry.continued ? { note: 'continued' as const } : entry.steered ? { note: 'steered' as const } : {}),
          ...(entry.scheduled === undefined ? {} : { scheduled: entry.scheduled }),
        };
      }),
      hasOlder: window.hasOlder,
      hasNewer: window.hasNewer,
      ...(clearTurn ? { turn: undefined } : {}),
    });
  };
  let runtimeId: string | undefined;
  /** Hermes's last event number for this session that the page has taken in: nothing at or before it is taken twice. */
  let lastSeq = 0;
  /** Settles when the session's agent is built (Hermes builds it a moment after the session exists) or cannot be. */
  let agent = Promise.withResolvers<void>();
  agent.promise.catch(() => undefined);
  const builtFrom = (tools: unknown) => typeof tools === 'object' && tools !== null && Object.keys(tools).length > 0;
  /** The replies the owner stopped, by Hermes's row id (kept in the storage, by session): its transcript does not say a reply was stopped, so the page remembers which. */
  const stoppedIds = readStopped(storage, options.profile, options.storedId);
  /** The words of a reply that was stopped and has not come back in Hermes's transcript yet. */
  let stopPending: string | undefined;
  /** What went wrong in a turn that failed, by the row of Hermes's note for it, and for a failure whose note has not come back yet. */
  const failureDetails = new Map<number, string>();
  let failurePending: string | undefined;

  const fail = (error: unknown) => store.set({ error: error instanceof Error ? error.message : String(error) });
  /** Shows a queue and keeps it. A queue with nothing in it is not held. */
  const setQueue = (queue: QueuedMessage[], paused = store.state.queuePaused) => {
    const held = queue.length > 0 && paused;
    store.set({ queue, queuePaused: held });
    writeQueue(storage, options.profile, store.state.storedId, { queue, paused: held });
  };
  const holdQueue = () => {
    if (store.state.queue.length > 0) setQueue(store.state.queue, true);
  };
  /** A prompt is on its way to Hermes (and `running` may not say so yet). */
  let delivering = false;
  /** Turns that have ended whose transcript is being read again. */
  let settling = 0;
  /** Sends the next queued message when nothing stands in its way: no turn is running or on its way, the chat is in step with Hermes, and the queue is not held. */
  const drainQueue = () => {
    const { queue, queuePaused, running, syncing } = store.state;
    if (running || syncing || delivering || settling > 0 || queuePaused || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    // A prompt that did not go keeps its place at the head and holds the queue: the screen says why (`error`) and the owner decides.
    void deliver(next!.text).then((sent) => {
      if (!sent) setQueue([next!, ...store.state.queue], true);
    });
  };

  /** Reads the newest page of the stored session; `replace` drops what was loaded, otherwise the page is merged into it. */
  const readLatest = async (replace: boolean, stats?: ReplyStats) => {
    const storedId = store.state.storedId!;
    const body = (await readHistory(latestUrl(storedId, options.profile))) as HistoryBody;
    publish(replace || !loaded ? fromLatest(body) : mergeLatest(loaded, body), true, stats);
  };
  /** A turn finished: Hermes's transcript now holds it, so the newest page is read again (unless the reader is in the middle of the session, where it is not shown). */
  const refetchHistory = async (stats?: ReplyStats) => {
    if (!loaded?.hasNewer) await readLatest(false, stats);
  };
  const now = options.now ?? (() => Date.now());
  /** When the turn in progress started, on the page's clock. */
  let turnStartedAt = now();
  /** What a `message.complete` carries is the turn's end; a turn that began before the page opened has no start here, and its speed is Hermes's to say. */
  const tallyOf = (usage: Usage | null | undefined) => statsOf(usage, now() - turnStartedAt);

  /** Where the cards of approvals and questions come from. A request is Hermes's: it stays until Hermes ends it, and a resume hands it over again. */
  const arrivals = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  /** Requests answered here or closed since: Hermes's snapshot of open requests may still list one that was read before the answer landed. */
  const closed = new Set<string>();
  const MAX_SETTLED = 3;
  const patchRequest = (id: string, patch: Partial<Pick<OpenRequest, 'status' | 'error'>>) =>
    store.set((state) => ({ requests: state.requests.map((entry) => (entry.id === id ? ({ ...entry, ...patch } as OpenRequest) : entry)) }));
  /** Takes a request off the cards. `reason` is why Hermes ended it (the owner is told); none means the owner answered it here. */
  const closeRequest = (id: string, reason?: string) => {
    const request = store.state.requests.find((entry) => entry.id === id);
    if (!request) return;
    closed.add(id);
    store.set((state) => ({
      requests: state.requests.filter((entry) => entry.id !== id),
      ...(reason === undefined ? {} : { settled: [...state.settled, settledOf(request, reason)].slice(-MAX_SETTLED) }),
    }));
  };
  const stopRequests = client.onRequest((request) => {
    // Every approval and question reaches a card, whichever session of the page it is about: one the page declined would be refused for the owner, and the agent would go on without them.
    if (request.method !== 'approval' && request.method !== 'clarify') return false;
    if (closed.has(request.id) || store.state.requests.some((entry) => entry.id === request.id)) return true;
    const seenAt = firstSeen.get(request.id) ?? now();
    firstSeen.set(request.id, seenAt);
    const card = requestOf(request.id, request.method, request.params, seenAt);
    if (!card) return false;
    arrivals.set(card.id, arrivals.size);
    store.set((state) => ({ requests: [...state.requests, card] }));
    return true;
  });
  /** The reasoning effort the owner picked in this chat: Hermes's `session.info` says what the agent has now, which after a rebuild is not it. */
  let pickedReasoning: string | undefined;
  /** Takes what Hermes says about the session (`session.info`, and the answers that carry it) into the state. A field a partial view leaves out stays as it was. */
  const adoptInfo = (info: SessionLiveInfo) => {
    store.set({
      ...(typeof info.cwd === 'string' && info.cwd ? { cwd: info.cwd } : {}),
      ...(typeof info.yolo === 'boolean' ? { yolo: info.yolo } : {}),
      ...(typeof info.model === 'string' && info.model ? { model: info.model } : {}),
      ...(typeof info.provider === 'string' && info.provider ? { provider: info.provider } : {}),
      ...(typeof info.reasoning_effort === 'string' ? { reasoning: info.reasoning_effort } : {}),
    });
    if (info.usage) store.set((state) => ({ usage: mergeUsage(state.usage, info.usage!) }));
  };
  /** Sends a call that needs a passkey; when the server asks for one, asks the owner (the page's step-up dialog) and sends it again. */
  const withStepUp = async <T>(send: () => Promise<T>): Promise<T> => {
    try {
      return await send();
    } catch (error) {
      if (!options.stepUp || !needsStepUp(error) || !(await options.stepUp())) throw error;
      return send();
    }
  };
  /** Asks Caduceus how long Hermes waits for a clarify answer (its config says). The default stands when that cannot be read. */
  const readClarifyTimeout = () =>
    readHistory(`/_caduceus/api/chat/limits${options.profile === undefined ? '' : `?profile=${encodeURIComponent(options.profile)}`}`).then(
      (limits) => store.set({ clarifyTimeoutS: (limits as ChatLimits).clarifyTimeoutS }),
      () => undefined,
    );

  /** Events that arrive while the chat is catching up: replayed after the gap, so that none is applied ahead of one it follows. */
  let held: GatewayEvent[] | undefined;
  /** What Hermes said the replay epoch was at the last catch-up: a different one means Hermes restarted and its event numbers mean nothing now. */
  let epoch: string | undefined;

  const apply = (event: GatewayEvent) => {
    if (event.session_id !== runtimeId) return;
    if (held) held.push(event);
    else take(event);
  };

  /** A clarify tool call finished while its card is still open: someone answered it on another device (Hermes does not withdraw a question that was answered). */
  const closeAnsweredQuestion = (args: unknown) => {
    const { questions } = (args ?? {}) as { questions?: unknown };
    const asked = new Set((Array.isArray(questions) ? questions : []).map((entry) => (entry as { question?: unknown } | null)?.question).filter((entry): entry is string => typeof entry === 'string'));
    const card = store.state.requests.find((entry) => entry.kind === 'clarify' && entry.status === 'open' && entry.questions.some((q) => asked.has(q.question)));
    if (card) closeRequest(card.id, 'resolved');
  };

  /** Takes in one event of this session, unless the page already has it. A replayed event (one the page missed and Hermes sent again) changes the state, but is not news: it raises no toast. */
  const take = (event: GatewayEvent, replay = false) => {
    if (typeof event.seq === 'number') {
      if (event.seq <= lastSeq) return;
      lastSeq = event.seq;
    }
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const notice = replay ? undefined : noticeOf(event);
    if (notice) options.notify?.(notice);
    if (event.type === 'tool.complete' && payload.name === 'clarify') closeAnsweredQuestion(payload.args);
    switch (event.type) {
      case 'message.start':
        turnStartedAt = now();
        store.set((state) => ({ running: true, turn: { user: state.turn?.user, segments: [], status: 'streaming' } }));
        break;
      case 'message.delta':
      case 'reasoning.delta':
      case 'thinking.delta':
      case 'reasoning.available':
      case 'tool.generating':
      case 'tool.start':
      case 'tool.complete':
      case 'tool.output_risk':
        // The activity of a turn is the turn's: with no turn showing (it ended, or Hermes has not started one) there is nothing for it to join.
        store.set((state) => (state.turn ? { turn: { ...state.turn, status: 'streaming', segments: foldTurn(state.turn.segments, event) } } : {}));
        break;
      case 'todo.updated':
        store.set({ todos: todosOf(payload.todos) });
        break;
      case 'subagent.spawn_requested':
      case 'subagent.start':
      case 'subagent.thinking':
      case 'subagent.tool':
      case 'subagent.progress':
      case 'subagent.complete':
        store.set((state) => ({
          subagents: foldSubagents(state.subagents, event) as SubagentActivity[],
          ...(state.turn ? { turn: { ...state.turn, segments: foldTurn(state.turn.segments, event) } } : {}),
        }));
        break;
      case 'session.usage':
        if (payload.usage && typeof payload.usage === 'object') store.set((state) => ({ usage: mergeUsage(state.usage, payload.usage as Usage) }));
        break;
      case 'message.complete': {
        const { status, text, error, error_surface: surface, usage } = payload as { status?: string; text?: unknown; error?: unknown; error_surface?: unknown; usage?: Usage | null };
        if (status === 'interrupted' && typeof text === 'string') stopPending = text;
        if (usage) store.set((state) => ({ usage: mergeUsage(state.usage, usage) }));
        if (status === 'error' || error || surface) {
          // A turn that failed: the page shows the prompt and what the agent did, and says what Hermes said. Hermes closes the turn with a note of its own, which is read in its place.
          const detail = String(error ?? text ?? 'The turn failed.');
          failurePending = detail;
          store.set((state) => ({ running: false, steers: [], turn: { user: state.turn?.user, segments: endTurn(state.turn?.segments.filter((segment) => segment.kind === 'activity') ?? []), status: 'failed', error: detail } }));
          holdQueue();
          const failedTurn = store.state.turn;
          settling += 1;
          void refetchHistory()
            .then(() => {
              // Hermes kept no note for it: the failed turn stays as the page heard it.
              if (failurePending !== undefined && failedTurn) store.set({ turn: failedTurn });
            })
            .catch(() => undefined)
            .finally(() => {
              failurePending = undefined;
              settling -= 1;
              drainQueue();
            });
          break;
        }
        const stats = tallyOf(usage);
        store.set((state) => ({ running: false, steers: [], ...(state.turn ? { turn: { ...state.turn, segments: endTurn(state.turn.segments), ...(stats ? { stats } : {}) } } : {}) }));
        // A stopped turn holds the queue. A turn that completed starts the next message, but only once Hermes's transcript holds this one: reading it clears the turn on show, which must not take the next turn's text with it.
        if (status === 'interrupted') holdQueue();
        settling += 1;
        void refetchHistory(stats)
          .catch(fail)
          .finally(() => {
            settling -= 1;
            stopPending = undefined;
            drainQueue();
          });
        break;
      }
      case 'session.info': {
        const info = (event.payload ?? {}) as SessionLiveInfo;
        if (builtFrom(info.tools)) agent.resolve();
        adoptInfo(info);
        break;
      }
      case 'request.cancel': {
        const { id, reason } = payload as { id?: unknown; reason?: unknown };
        if (typeof id !== 'string') break;
        // Hermes ends a request the owner answered here too (`resolved`): that card is already going, and says nothing.
        const ours = store.state.requests.find((entry) => entry.id === id)?.status === 'sending';
        closeRequest(id, ours && reason === 'resolved' ? undefined : typeof reason === 'string' ? reason : '');
        break;
      }
      case 'error': {
        const message = String((event.payload as { message?: unknown } | undefined)?.message ?? 'Hermes reported an error.');
        store.set({ error: message });
        agent.reject(new Error(message));
        break;
      }
      case 'session.control.update': {
        // Hermes's payload for this event type.
        const update = payload as Partial<SessionControlUpdatePayload>;
        store.set({ goal: update.control?.goal ?? undefined });
        break;
      }
      case 'btw.complete':
      case 'background.complete': {
        // Hermes's payload for these event types.
        const done = payload as Partial<SideAgentCompletePayload>;
        const id = done.task_id;
        if (typeof id !== 'string') break;
        const said = typeof done.text === 'string' ? done.text : '';
        const failed = said.startsWith('error: ');
        const over = { status: failed ? ('failed' as const) : ('done' as const), answer: failed ? said.slice('error: '.length) : said, unseen: true };
        const kind = event.type === 'btw.complete' ? ('btw' as const) : ('background' as const);
        store.set((state) => ({
          // A task this page did not start (it was reloaded since) is shown with what it answered; a quick one can finish before Hermes has even replied to the request that started it.
          sideTasks: state.sideTasks.some((task) => task.id === id) ? state.sideTasks.map((task) => (task.id === id ? { ...task, ...over } : task)) : [...state.sideTasks, { id, kind, prompt: done.question ?? '', ...over }],
        }));
        break;
      }
      case 'session.title':
        store.set({ title: String((event.payload as { title?: unknown } | undefined)?.title ?? '') || undefined });
        break;
    }
  };
  /** Whether the chat this one was forked from has been looked up (once per engine: a fork is made once and never changes). */
  let originRead = false;
  const profileQuery = options.profile === undefined ? '' : `?profile=${encodeURIComponent(options.profile)}`;
  /** Reads where the session came from: Hermes records a branch's source in the session's `model_config` (`_branched_from`). Silent when it cannot be read; the chat is a chat all the same. */
  const readOrigin = async (storedId: string) => {
    originRead = true;
    try {
      const row = (await readHistory(`/api/sessions/${encodeURIComponent(storedId)}${profileQuery}`)) as { model_config?: unknown };
      const config = typeof row.model_config === 'string' ? (JSON.parse(row.model_config) as Record<string, unknown>) : (row.model_config as Record<string, unknown> | null | undefined);
      const from = config?._branched_from;
      if (typeof from !== 'string' || from === '') return;
      const parent = (await readHistory(`/api/sessions/${encodeURIComponent(from)}${profileQuery}`).catch(() => undefined)) as { title?: unknown } | undefined;
      store.set({ forkedFrom: { id: from, title: typeof parent?.title === 'string' && parent.title !== '' ? parent.title : undefined } });
    } catch {
      originRead = false;
    }
  };
  /** A read-only chat has no runtime session: it reads Hermes's history of the stored session, as opened and again after every change Hermes announces. */
  const readOnlyCatchUp = async (storedId: string) => {
    store.set({ syncing: true });
    try {
      if (!originRead) void readOrigin(storedId);
      const row = (await readHistory(`/api/sessions/${encodeURIComponent(storedId)}${profileQuery}`).catch(() => undefined)) as { title?: unknown } | undefined;
      if (typeof row?.title === 'string' && row.title !== '') store.set({ title: row.title });
      if (!loaded && options.around !== undefined) {
        await openAround(options.around).catch(async () => {
          fail(new Error('That message could not be found; showing the newest messages.'));
          store.set({ focusId: undefined });
          await readLatest(true);
        });
      } else if (!loaded?.hasNewer) await readLatest(!loaded);
    } catch (error) {
      fail(error);
    } finally {
      store.set({ syncing: false });
    }
  };
  /** Brings the chat back in step with Hermes after the page opened it or the connection came back: re-attach, replay what was missed, or take the snapshot when the replay cannot be trusted. */
  const catchUp = async () => {
    const { storedId } = store.state;
    if (storedId === undefined) return;
    if (options.readOnly) return readOnlyCatchUp(storedId);
    const hint = runtimeId;
    held = [];
    store.set({ syncing: true });
    const slow = timers.setTimeout(() => store.set({ catchingUp: true }), CATCH_UP_DELAY_MS);
    try {
      let attached: SessionActivateResult | SessionResumeResult | undefined;
      if (hint !== undefined) attached = await client.request<SessionActivateResult>('session.activate', { session_id: hint, omit_messages: true, ...profile }).catch(() => undefined);
      attached ??= await client.request<SessionResumeResult>('session.resume', { session_id: storedId, omit_messages: true, source: CADUCEUS_SESSION_SOURCE, ...profile });
      runtimeId = attached.session_id;
      if (runtimeId !== hint) {
        agent = Promise.withResolvers<void>();
        agent.promise.catch(() => undefined);
        // A restarted Hermes has none of the requests of the session it had before.
        store.set((state) => ({ requests: state.requests.filter((entry) => entry.sessionId !== hint) }));
      }
      adoptInfo(attached.info);
      void readClarifyTimeout();
      if (!originRead) void readOrigin(storedId);
      if (builtFrom(attached.info.tools)) agent.resolve();
      store.set({ title: attached.info.title || undefined, todos: todosOf(attached.todo_state?.todos) });
      // The children Hermes is running for this session now (a page that opens mid-turn missed their events).
      const listed = await client.request<SubagentListResult>('subagent.list', { session_id: runtimeId, ...profile }).catch(() => undefined);
      if (listed?.subagents?.length) store.set((state) => ({ subagents: withSnapshots(state.subagents, listed.subagents!) }));
      const control = await client.request<SessionControlReadResult>('session.control.read', { session_id: runtimeId, ...profile }).catch(() => undefined);
      if (control) store.set({ goal: control.control.goal ?? undefined });
      if (runtimeId !== hint && options.activityMode !== undefined) await applyMode(options.activityMode).catch(fail);
      // A new runtime id is a new numbering of events: Hermes restarted, or this page never had one.
      if (runtimeId !== hint) lastSeq = 0;
      const asked = arrivals.size;
      const since = await client.request<SessionEventsSinceResult>('session.events.since', { session_id: runtimeId, last_seen: lastSeq });
      // What Hermes still waits for is the truth: a card for a request it no longer lists was answered, or lapsed, while the page was away.
      const open = new Set((since.open_requests ?? []).map((entry) => entry.id));
      for (const card of store.state.requests) {
        if (card.sessionId === runtimeId && card.status === 'open' && !open.has(card.id) && (arrivals.get(card.id) ?? asked) < asked) closeRequest(card.id, 'gone');
      }
      const untrusted = since.truncated || (epoch !== undefined && since.epoch !== epoch);
      epoch = since.epoch;
      const fresh = lastSeq === 0;
      const { inflight } = attached;
      if (untrusted || fresh) {
        // The snapshot Hermes just gave is the truth: its transcript, and the turn it is running, if it is. A window the reader opened in the middle of the session stays as it is.
        lastSeq = untrusted ? since.latest_seq : 0;
        if (!loaded && options.around !== undefined) {
          await openAround(options.around).catch(async () => {
            fail(new Error('That message could not be found; showing the newest messages.'));
            store.set({ focusId: undefined });
            await readLatest(true);
          });
        } else if (!loaded?.hasNewer) {
          // Hermes keeps no rows of a session until it has a message, and says 404 for its messages: a session that only ran commands is an empty chat, and is not asked for them.
          if (attached.message_count === 0 && !attached.hydrating) publish(fromLatest({ messages: [], pagination: {} }), true);
          else await readLatest(true);
        }
        store.set({
          running: Boolean(attached.running),
          turn: inflight ? { user: inflight.user || undefined, segments: inflight.assistant ? [{ kind: 'text', text: inflight.assistant }] : [], status: inflight.streaming ? 'streaming' : 'waiting' } : undefined,
        });
      }
      if (!untrusted) {
        // The events after the watermark; for a page with none, those of the turn running now (the ring also holds earlier turns').
        const events = [...since.events].sort((a, b) => Number(a.seq) - Number(b.seq));
        const start = events.findLastIndex((event) => event.type === 'message.start');
        const from = fresh ? (attached.running && start >= 0 ? start : events.length) : 0;
        for (const event of events.slice(from)) take({ ...event, session_id: runtimeId } as GatewayEvent, true);
        lastSeq = Math.max(lastSeq, since.latest_seq);
      }
    } catch (error) {
      fail(error);
    } finally {
      timers.clearTimeout(slow);
      const later = held ?? [];
      held = undefined;
      for (const event of later) take(event);
      store.set({ syncing: false, catchingUp: false });
      drainQueue();
    }
  };
  /** Opens the window at prompt `rowId`. */
  const openAround = async (rowId: number) => {
    const body = (await readHistory(aroundUrl(store.state.storedId!, options.profile, rowId))) as HistoryBody;
    publish(fromAround(body), true);
    store.set({ focusId: options.focus ?? rowId });
  };
  /** The catch-up in progress, if any: a prompt waits for it, since the runtime id it would send to may be the one before a restart. */
  let inProgress: Promise<void> | undefined;
  const sync = () => (inProgress ??= catchUp().finally(() => (inProgress = undefined)));
  /** Waits until a chat that opens a stored session is attached to it: what goes to Hermes then is for that session and never for a new one. Rejects when it cannot attach. */
  const attach = async () => {
    await inProgress;
    if (store.state.storedId !== undefined && runtimeId === undefined) await sync();
    if (store.state.storedId !== undefined && runtimeId === undefined) throw new Error('This chat is not connected to Hermes yet.');
  };
  /**
   * Sends a prompt to the chat's session (the first one of a new chat creates it); `shown` is what the transcript says the owner wrote when that is not the prompt itself (a skill's invocation, not its body). False when it did not go: the screen says why.
   * `cutBefore` is a message of Hermes's transcript (its row id): Hermes removes it and everything after it as the prompt goes (edit and resend, regenerate), and the page shows the transcript so at once.
   */
  const deliver = async (text: string, shown = text, sending: SendOptions = {}, cutBefore?: number): Promise<boolean> => {
    if (options.readOnly) {
      fail(new Error('This session is read-only here: another process owns it. Branch it to continue in a new session.'));
      return false;
    }
    const uncut = cutBefore === undefined ? undefined : loaded;
    delivering = true;
    try {
      await attach();
      await chat.start();
      await inProgress;
      // Attachments are Hermes's before the prompt goes: it queues the images for the next prompt and stages the files, whose references go in the text.
      const uploaded = await uploadAttachments((method, params) => client.request(method, { ...params, ...profile }), runtimeId!, sending.attachments ?? [], sending.onProgress);
      if (uploaded.fileRefs.length > 0) {
        text = [text, ...uploaded.fileRefs].filter((part) => part !== '').join('\n');
        shown = [shown, ...uploaded.fileRefs].filter((part) => part !== '').join('\n');
      }
      // Hermes keeps the images in the message as `@image:` lines after its text, and the page shows the same until the history is read again.
      shown = [shown, ...uploaded.imagePaths.map((path) => `@image:${referenceValue(path)}`)].filter((part) => part !== '').join('\n');
      turnStartedAt = now();
      if (cutBefore !== undefined && loaded) publish({ ...loaded, rows: loaded.rows.filter((row) => row.id < cutBefore) });
      store.set({ running: true, error: undefined, steers: [], turn: { user: shown, segments: [], status: 'waiting' } });
      const cut = cutBefore === undefined ? {} : { truncate_before_row_id: cutBefore, confirm_truncate: true };
      const submit = () => client.request('prompt.submit', { session_id: runtimeId, text, ...cut, ...profile });
      // A runtime id Hermes no longer knows (it restarted, or reaped the session): attach to the stored session again and send once more.
      await submit().catch(async (error: unknown) => {
        if (!/session not found/i.test(error instanceof Error ? error.message : '')) throw error;
        await sync();
        await submit();
      });
      return true;
    } catch (error) {
      // Refused (read-only mode, a step-up, Hermes down): the prompt did not go, and the screen says why. A transcript that was cut for it is Hermes's again, whole.
      if (uncut) publish(uncut);
      store.set({ running: false, turn: undefined });
      fail(error);
      return false;
    } finally {
      delivering = false;
    }
  };

  /** What Hermes asked for after a goal command: a `send` is the turn that works on the goal (the TUI sends it as the next prompt), so it goes as one, behind a running turn. */
  const goalKickoff = ({ type, message }: { type?: string | null; message?: string | null }) => {
    if (type === 'send' && message) chat.enqueue(message);
  };
  /** Runs a goal action in the session (`session.control`) and shows the goal it left. */
  const controlGoal = async (action: 'goal.clear' | 'goal.pause' | 'goal.resume') => {
    await attach();
    await chat.start();
    const { control, dispatch } = await client.request<SessionControlResult>('session.control', { session_id: runtimeId, action, ...profile });
    store.set({ goal: control.goal ?? undefined });
    goalKickoff(dispatch);
  };
  /** Starts a side agent in Hermes and follows it: it is `running` until its `*.complete` event arrives. */
  const startSideTask = async (method: 'prompt.btw' | 'prompt.background', kind: SideTask['kind'], text: string) => {
    try {
      await attach();
      await chat.start();
      const { task_id: id } = await client.request<TaskIdResult>(method, { session_id: runtimeId, text, ...profile });
      store.set((state) =>
        // A quick task can finish before Hermes has replied to the request that started it: its event made the entry, which only lacks what was asked.
        state.sideTasks.some((task) => task.id === id) ? { sideTasks: state.sideTasks.map((task) => (task.id === id ? { ...task, prompt: text } : task)) } : { sideTasks: [...state.sideTasks, { id, kind, prompt: text, status: 'running', answer: undefined, unseen: false }] },
      );
    } catch (error) {
      fail(error);
    }
  };
  /** Sends the settings that go with an activity mode to Hermes: its config, and the session that is running (a session keeps the tool progress it started with). */
  const applyMode = async (mode: ActivityMode) => {
    const { details_mode: details, tool_progress: progress } = hermesSettingsFor(mode);
    const scope = { ...(runtimeId === undefined ? {} : { session_id: runtimeId }), ...profile };
    await client.request('config.set', { key: 'details_mode', value: details, ...scope });
    await client.request('config.set', { key: 'verbose', value: progress, ...scope });
  };

  const stopListening = [client.onEvent(apply), connection.onReady(() => void sync())];
  // Hermes broadcasts `approval.cancelled` with no session on the frame (it names the session in its payload), so it is not among the events `apply` takes. It ends a card the
  // way a withdrawal does, and reaches a page that reconnected after the withdrawal and so has no `request.cancel` to hear.
  stopListening.push(client.on('approval.cancelled', (event) => cancelledApprovals(store.state.requests, event.payload ?? {}).forEach(({ id, reason }) => closeRequest(id, reason))));
  // Another process writes to the session: Hermes says the sessions changed, and the page reads the newest messages again (one read at a time; a change that arrives during one asks for another).
  if (options.readOnly) {
    let reading = false;
    let again = false;
    const follow = async () => {
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      try {
        do {
          again = false;
          if (!loaded?.hasNewer && store.state.storedId !== undefined) await readLatest(false).catch(fail);
        } while (again);
      } finally {
        reading = false;
      }
    };
    stopListening.push(client.on('sessions.changed', () => void follow()));
  }
  if (options.storedId !== undefined && connection.status.state === 'connected') void sync();

  const MAX_NOTES = 20;
  /** Changes the notes of this chat, wherever they are kept: with the page's, once the chat has a session (so that its next engine sees them too), else here. */
  const changeNotes = (change: (notes: readonly CommandNote[]) => readonly CommandNote[]) => {
    const key = notesKey(options.profile, store.state.storedId);
    if (key === undefined) store.set((state) => ({ notes: [...change(state.notes)] }));
    else keptNotes.set((state) => ({ byChat: { ...state.byChat, [key]: change(state.byChat[key] ?? store.state.notes) } }));
  };
  /** An engine that is still being listened to (a command answers after its chat was opened afresh) shows what the page keeps for its chat. */
  const stopNotes = keptNotes.subscribe(() => {
    const key = notesKey(options.profile, store.state.storedId);
    const mine = key === undefined ? undefined : keptNotes.state.byChat[key];
    if (mine && mine !== store.state.notes) store.set({ notes: [...mine] });
  });
  const MAX_ALIAS_DEPTH = 3;
  let noteCount = 0;
  const note = (command: string, text: string, tone: CommandNote['tone'] = 'info'): SlashOutcome => {
    changeNotes((notes) => [...notes, { id: `n${Date.now().toString(36)}-${++noteCount}`, command, text, tone }].slice(-MAX_NOTES));
    return { kind: tone === 'danger' ? 'failed' : 'noted' };
  };
  /** The words of a call that did not go: the policy's reason for a refusal, else Hermes's. */
  const failureWords = (error: unknown) => (error instanceof Error ? error.message : String(error));
  /** The proxy refused the call (denied, read-only, no confirmation): Hermes was never asked, and asking again another way would be refused too. */
  const refusedByProxy = (error: unknown) => ((error ?? {}) as { code?: unknown }).code === -32001;

  /** Acts on what Hermes answered to a command: text for the transcript, a prompt for a turn, a message to put back in the composer, or another command (an alias). */
  const follow = async (dispatch: CommandDispatchResponse, name: string, arg: string, depth: number): Promise<SlashOutcome> => {
    const label = `/${name}`;
    if (dispatch.type === 'exec' || dispatch.type === 'plugin') return note(label, dispatch.output || '(no output)');
    if (dispatch.type === 'alias') {
      if (depth >= MAX_ALIAS_DEPTH) return note(label, 'This command is an alias of an alias of an alias: Hermes would never get to the end of it.', 'danger');
      const target = parseSlashCommand(dispatch.target);
      return slash(target.name, [target.arg, arg].filter(Boolean).join(' '), depth + 1);
    }
    if ((dispatch.type === 'send' || dispatch.type === 'prefill') && dispatch.notice?.trim()) note(label, dispatch.notice.trim());
    const message = ('message' in dispatch ? dispatch.message : undefined)?.trim() ?? '';
    // `/retry` and `/undo` took messages out of Hermes's history: what the page shows is read again.
    if ((name === 'retry' || name === 'undo') && store.state.storedId !== undefined) await readLatest(true).catch(fail);
    if (message === '') return note(label, `${label}: Hermes sent nothing to ${dispatch.type === 'prefill' ? 'edit' : 'send'}.`, 'danger');
    if (dispatch.type === 'prefill') return { kind: 'prefill', text: message };
    if (store.state.running) chat.enqueue(message);
    else void deliver(message, 'display' in dispatch ? dispatch.display?.trim() || undefined : undefined);
    return { kind: 'sent' };
  };
  /** Whether `/name` is one of the owner's quick commands (`quick_commands` in the profile's config), which Hermes's catalogue lists under "User commands". A catalogue that cannot be read says no: the command then goes the way every command goes. */
  const isQuickCommand = async (name: string): Promise<boolean> => {
    const { categories } = await chat.commandCatalog().catch((): CommandsCatalogResult => ({}));
    return (categories ?? []).some((category) => category.name === 'User commands' && (category.pairs ?? []).some(([key]) => key === `/${name}`));
  };
  /** Runs `/name arg` in the chat's session (which exists by now). */
  const slash = async (name: string, arg: string, depth: number): Promise<SlashOutcome> => {
    const label = `/${name}`;
    const scope = { session_id: runtimeId, ...profile };
    try {
      // Hermes's own clients set a title through `session.title`, not the slash worker, whose database write can fail without saying so.
      if (name === 'title' && arg !== '') {
        const { title } = await client.request<SessionTitleResult>('session.title', { ...scope, title: arg });
        store.set({ title: title || undefined });
        return note(label, title ? `Session title set: ${title}` : 'Session title cleared.');
      }
      // The owner's quick commands are resolved here, not in the slash worker: it runs an alias itself, and what it runs (`/title`) fails there. `command.dispatch` answers the alias, and the page then runs its target as it runs any command.
      if (await isQuickCommand(name)) {
        const dispatch = parseCommandDispatch(await withStepUp(() => client.request<CommandDispatchResult>('command.dispatch', { ...scope, name, arg })));
        if (!dispatch) return note(label, `${label}: Hermes gave an answer this page does not know.`, 'danger');
        return await follow(dispatch, name, arg, depth);
      }
      let execError: unknown;
      try {
        const done = await withStepUp(() => client.request<SlashExecResult>('slash.exec', { ...scope, command: arg === '' ? name : `${name} ${arg}` }));
        const dispatch = parseCommandDispatch(done);
        if (dispatch) return await follow(dispatch, name, arg, depth);
        return note(label, done.warning ? `${done.warning}\n${done.output || ''}`.trim() : done.output || '(no output)', done.warning ? 'warning' : 'info');
      } catch (error) {
        if (refusedByProxy(error)) throw error;
        execError = error;
      }
      // The worker leaves quick commands, skills and the commands that queue a prompt to `command.dispatch`: what it says is an error only when that has nothing for the name either.
      try {
        const dispatch = parseCommandDispatch(await withStepUp(() => client.request<CommandDispatchResult>('command.dispatch', { ...scope, name, arg })));
        if (!dispatch) return note(label, `${label}: Hermes gave an answer this page does not know.`, 'danger');
        return await follow(dispatch, name, arg, depth);
      } catch (error) {
        const routing = /not a quick\/plugin\/(?:bundle\/)?skill command/i.test(failureWords(error));
        throw routing && execError !== undefined ? execError : error;
      }
    } catch (error) {
      return note(label, failureWords(error), 'danger');
    }
  };
  let catalog: { key: string; promise: Promise<CommandsCatalogResult> } | undefined;

  const chat: Chat = {
    get state() {
      return store.state;
    },
    subscribe: store.subscribe,
    until: store.until,
    async start() {
      if (runtimeId !== undefined) return;
      agent = Promise.withResolvers<void>();
      agent.promise.catch(() => undefined);
      const { model, provider, reasoning, cwd } = store.state;
      const created = await client.request<SessionCreateResult>('session.create', { source: CADUCEUS_SESSION_SOURCE, ...(cwd ? { cwd } : {}), ...(model && provider ? { model, provider } : {}), ...(reasoning ? { reasoning_effort: reasoning } : {}), ...profile });
      runtimeId = created.session_id;
      store.set({ storedId: created.stored_session_id });
      writeQueue(storage, options.profile, created.stored_session_id, { queue: store.state.queue, paused: store.state.queuePaused });
      if (builtFrom(created.info.tools)) agent.resolve();
      adoptInfo(created.info);
      void readClarifyTimeout();
      if (options.activityMode !== undefined) await applyMode(options.activityMode).catch(fail);
    },
    async tools() {
      await agent.promise;
      return client.request<ToolsShowResult>('tools.show', { session_id: runtimeId, ...profile });
    },
    send: (text, options) => deliver(text, text, options),
    async editAndResend(id, edited) {
      const message = store.state.messages.find((entry) => entry.id === id);
      if (message?.role !== 'user' || edited.trim() === '') {
        fail(new Error(message?.role === 'user' ? 'The edited message is empty.' : 'Only your own messages can be edited.'));
        return false;
      }
      // A window opened in the middle of the session ends before the messages that would be cut: it is moved to the newest, so that the page shows what Hermes will hold.
      if (loaded?.hasNewer) await readLatest(true).catch(fail);
      const text = editedText(message.text, edited);
      return deliver(text, text, {}, id);
    },
    async regenerate() {
      if (loaded?.hasNewer) await readLatest(true).catch(fail);
      const last = store.state.messages.findLast((entry) => entry.role === 'user' && entry.id !== undefined);
      if (!last) {
        fail(new Error('There is no message of yours to answer again.'));
        return false;
      }
      return deliver(last.text, last.text, {}, last.id);
    },
    async undo() {
      await attach();
      await chat.start();
      const last = store.state.messages.findLast((entry) => entry.role === 'user');
      const { removed } = await client.request<SessionUndoResult>('session.undo', { session_id: runtimeId, ...profile });
      // What Hermes holds changed: the page shows what it holds now.
      if (store.state.storedId !== undefined && !loaded?.hasNewer) await readLatest(true).catch(fail);
      return { removed, message: removed > 0 ? last?.text : undefined };
    },
    async refreshTitle() {
      await attach();
      if (runtimeId === undefined) return;
      const { title } = await client.request<SessionTitleResult>('session.title', { session_id: runtimeId, ...profile });
      store.set({ title: title || undefined });
    },
    liveSession: () => runtimeId,
    async retry() {
      return (await chat.runSlash('/retry')).kind === 'sent';
    },
    continueTurn: () => deliver(CONTINUE_PROMPT),
    async fork(from) {
      await attach();
      await chat.start();
      if (store.state.running) throw new Error('Hermes is still writing a reply. Stop it, or wait for it to finish, before forking this chat.');
      const branch = await client.request<SessionBranchResult>('session.branch', { session_id: runtimeId, ...profile });
      if (from === undefined) return { storedId: branch.stored_session_id, prefill: undefined };
      // From here on the branch exists: whatever goes wrong, the owner is handed the branch with the reason, never an error and a copy nobody opened.
      const source = store.state.messages.find((message) => message.id === from);
      const plan = source && forkPlan(branch.messages, source);
      const whole = (why: string) => ({ storedId: branch.stored_session_id, prefill: undefined, notCut: `${why} The new chat is open anyway, but it may hold more than you wanted: use Undo last exchange in it to take off the rest.` });
      if (!plan) return whole('Hermes’s history of this chat does not hold that message, so it could not cut the new chat there.');
      try {
        // The branch has the whole chat: each undo takes off its last exchange, until it ends at the message.
        for (let undone = 0; undone < plan.undo; undone++) await client.request<SessionUndoResult>('session.undo', { session_id: branch.session_id, ...profile });
        // Hermes's own history of the branch says where it ended.
        const held = await client.request<SessionHistoryResult>('session.history', { session_id: branch.session_id, ...profile });
        if (!forkWasCut(plan, held.messages)) return whole('Hermes cut the new chat somewhere other than at that message.');
      } catch (error) {
        return whole(forkFailureWords(failureWords(error)));
      }
      return { storedId: branch.stored_session_id, prefill: plan.prefill };
    },
    async branch() {
      const storedId = store.state.storedId;
      if (storedId === undefined) throw new Error('This chat has no session to branch yet.');
      if (!options.readOnly) {
        await attach();
        await chat.start();
        if (store.state.running) throw new Error('Hermes is still writing a reply. Stop it, or wait for it to finish, before branching this chat.');
        const branch = await client.request<SessionBranchResult>('session.branch', { session_id: runtimeId, ...profile });
        return { storedId: branch.stored_session_id };
      }
      // A read-only session has no runtime session of this page's: it is attached for the branch alone, and closed again.
      const { storedId: branched } = await branchStored(client, { storedId, profile: options.profile });
      return { storedId: branched };
    },
    setActivityMode: applyMode,
    async steer(text) {
      try {
        await attach();
        const { status } = await client.request<SessionCorrectionResult>('session.steer', { session_id: runtimeId, text, ...profile });
        if (status === 'rejected') throw new Error('Hermes could not steer this turn.');
        store.set((state) => ({ steers: [...state.steers, text] }));
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    enqueue(text) {
      const trimmed = text.trim();
      if (trimmed === '') return;
      setQueue([...store.state.queue, { id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed }]);
      drainQueue();
    },
    editQueued(id, text) {
      const trimmed = text.trim();
      if (trimmed === '') return;
      setQueue(store.state.queue.map((item) => (item.id === id ? { ...item, text: trimmed } : item)));
    },
    cancelQueued(id) {
      const item = store.state.queue.find((entry) => entry.id === id);
      if (item) setQueue(store.state.queue.filter((entry) => entry.id !== id));
      return item?.text;
    },
    runQueue() {
      setQueue(store.state.queue, false);
      drainQueue();
    },
    async btw(text) {
      await startSideTask('prompt.btw', 'btw', text);
    },
    async background(text) {
      await startSideTask('prompt.background', 'background', text);
    },
    readSideTask: (id) => store.set((state) => ({ sideTasks: state.sideTasks.map((task) => (task.id === id ? { ...task, unseen: false } : task)) })),
    async setGoal(text) {
      const goal = text.trim();
      if (goal === '') return;
      await attach();
      await chat.start();
      goalKickoff(await client.request<CommandDispatchResult>('command.dispatch', { session_id: runtimeId, name: 'goal', arg: goal, ...profile }));
    },
    async learn(topic) {
      const subject = topic.trim();
      if (subject === '') throw new Error('Say what to learn: a folder, a link, some notes, or what this chat did.');
      await attach();
      await chat.start();
      const { type, message } = await withStepUp(() => client.request<CommandDispatchResult>('command.dispatch', { session_id: runtimeId, name: 'learn', arg: subject, ...profile }));
      if (type !== 'send' || !message) throw new Error('Hermes did not answer /learn with a prompt to work from.');
      if (store.state.running) chat.enqueue(message);
      else await deliver(message);
    },
    async runSlash(typed) {
      const { name, arg } = parseSlashCommand(typed.trim());
      if (name === '') return note('/', 'Write the command after the slash.', 'warning');
      try {
        await attach();
        await chat.start();
      } catch (error) {
        return note(`/${name}`, failureWords(error), 'danger');
      }
      return slash(name, arg, 0);
    },
    commandCatalog() {
      const key = runtimeId ?? '';
      if (catalog?.key !== key) {
        const promise = client.request<CommandsCatalogResult>('commands.catalog', { ...(runtimeId === undefined ? {} : { session_id: runtimeId }), ...profile });
        promise.catch(() => catalog?.promise === promise && (catalog = undefined));
        catalog = { key, promise };
      }
      return catalog.promise;
    },
    async completeSlash(text) {
      const { items } = await client.request<CompleteSlashResult>('complete.slash', { text, ...(runtimeId === undefined ? {} : { session_id: runtimeId }) });
      return items ?? [];
    },
    async listFolder(folder) {
      const body = (await readHistory(`/api/fs/list?path=${encodeURIComponent(folder)}`)) as { entries?: FolderEntry[] };
      return body.entries ?? [];
    },
    dismissNote: (id) => changeNotes((notes) => notes.filter((entry) => entry.id !== id)),
    async clearGoal() {
      await controlGoal('goal.clear');
    },
    async pauseGoal(paused) {
      await controlGoal(paused ? 'goal.pause' : 'goal.resume');
    },
    dismissSideTask: (id) => store.set((state) => ({ sideTasks: state.sideTasks.filter((task) => task.id !== id) })),
    async stop() {
      // Stopping is the owner saying "not this": what they queued waits for them.
      holdQueue();
      if (runtimeId !== undefined) await client.request('session.interrupt', { session_id: runtimeId, ...profile });
    },
    async answerApproval(id, decision) {
      const request = store.state.requests.find((entry) => entry.id === id);
      if (request?.kind !== 'approval' || request.status === 'sending') return;
      patchRequest(id, { status: 'sending', error: undefined });
      try {
        // Hermes's approval has no field for a reason: the agent hears it as a note beside the refusal.
        if (decision.choice === 'deny' && decision.reason?.trim()) await client.request('session.steer', { session_id: request.sessionId, text: denyNote(decision.reason), ...profile });
        const { resolved } = await withStepUp(() => client.request<ApprovalRespondResult>('approval.respond', approvalParams(request, decision, profile)));
        closeRequest(id, resolved === 0 ? 'resolved' : undefined);
      } catch (error) {
        patchRequest(id, { status: 'open', error: error instanceof Error ? error.message : String(error) });
      }
    },
    async answerClarify(id, answers) {
      const request = store.state.requests.find((entry) => entry.id === id);
      if (request?.kind !== 'clarify' || request.status === 'sending') return;
      patchRequest(id, { status: 'sending', error: undefined });
      try {
        const { status } = await client.request<RequestAnswerResult>('request.answer', { id, result: clarifyResult(request, answers), ...profile });
        closeRequest(id, status === 'expired' ? 'timeout' : undefined);
      } catch (error) {
        patchRequest(id, { status: 'open', error: error instanceof Error ? error.message : String(error) });
      }
    },
    async setYolo(on) {
      // A chat that is still attaching to its stored session has no runtime id yet: wait for it, so that the switch is for that session and not for a new one.
      await attach();
      await this.start();
      await withStepUp(() => client.request('config.set', { key: 'yolo', value: on ? 'on' : 'off', session_id: runtimeId, ...profile }));
    },
    async setModel(choice, { confirmExpensive = false } = {}) {
      await attach();
      // A chat with no session yet takes the pick with its `session.create`; nothing is asked of Hermes until then.
      if (runtimeId === undefined) {
        store.set({ model: choice.model, provider: choice.provider });
        return { kind: 'set' };
      }
      // `--session` keeps the pick to this chat: without it Hermes may write the profile's config.
      const answer = await client.request<ConfigSetResult>('config.set', { key: 'model', value: `${choice.model} --provider ${choice.provider} --session`, session_id: runtimeId, ...(confirmExpensive ? { confirm_expensive_model: true } : {}), ...profile });
      if (answer.confirm_required) return { kind: 'confirm', message: answer.confirm_message || 'Hermes asks you to confirm this model.' };
      store.set({ model: choice.model, provider: choice.provider });
      return { kind: 'set', ...(answer.warning ? { warning: answer.warning } : {}) };
    },
    async setReasoning(effort) {
      await attach();
      if (runtimeId !== undefined) await client.request('config.set', { key: 'reasoning', value: effort, session_id: runtimeId, scope: 'session', ...profile });
      pickedReasoning = effort;
      store.set({ reasoning: effort });
    },
    async setWorkspace(cwd) {
      await attach();
      if (runtimeId !== undefined) adoptInfo(await client.request<SessionCwdSetResult>('session.cwd.set', { session_id: runtimeId, cwd, ...profile }));
      else store.set({ cwd });
    },
    async defaultWorkspace() {
      const { cwd } = await client.request<ConfigGetResult>('config.get', { key: 'project', ...profile });
      return cwd ?? undefined;
    },
    async toolsets() {
      // The profile's toolsets, from Hermes's REST API: the gateway's `toolsets.list` takes no profile, and for a session whose agent has no explicit list it says every toolset is on.
      const rows = (await readHistory(`/api/tools/toolsets${options.profile === undefined ? '' : `?profile=${encodeURIComponent(options.profile)}`}`)) as { name: string; label?: string; enabled: boolean; tools?: string[] }[];
      return rows.map((row) => ({ name: row.name, description: row.label ?? '', tool_count: row.tools?.length ?? 0, enabled: row.enabled }));
    },
    async configureToolsets(action, names) {
      await attach();
      const done = await client.request<ToolsConfigureResult>('tools.configure', { action, names, ...(runtimeId === undefined ? {} : { session_id: runtimeId }), ...profile });
      // Hermes builds the session's agent again for the new tools, and the new agent has forgotten a reasoning effort that was only this session's: it is sent again.
      if (done.info) adoptInfo(done.info);
      if (runtimeId !== undefined && pickedReasoning) await client.request('config.set', { key: 'reasoning', value: pickedReasoning, session_id: runtimeId, scope: 'session', ...profile });
      return done;
    },
    async contextBreakdown() {
      await attach();
      await chat.start();
      return client.request<SessionContextBreakdownResult>('session.context_breakdown', { session_id: runtimeId, ...profile });
    },
    async compress(focusTopic) {
      await attach();
      await chat.start();
      const done = await client.request<SessionCompressResult>('session.compress', { session_id: runtimeId, ...(focusTopic ? { focus_topic: focusTopic } : {}), ...profile });
      store.set({ usage: afterCompression(store.state.usage, done) });
      if (done.info) adoptInfo(done.info);
      // Compressing replaces what Hermes holds of the conversation: the page shows what it holds now.
      if (store.state.storedId !== undefined && !loaded?.hasNewer) await readLatest(true).catch(fail);
      return done;
    },
    async refreshUsage() {
      await attach();
      if (runtimeId === undefined) return;
      const usage = await client.request<SessionUsageResult>('session.usage', { session_id: runtimeId, ...profile });
      store.set((state) => ({ usage: mergeUsage(state.usage, usage) }));
    },
    dismissSettled: (id) => store.set((state) => ({ settled: state.settled.filter((entry) => entry.id !== id) })),
    async loadOlder() {
      const window = loaded;
      if (!window?.hasOlder || store.state.loadingMore) return;
      store.set({ loadingMore: true });
      try {
        const body = (await readHistory(olderUrl(store.state.storedId!, options.profile, window))) as HistoryBody;
        publish(withOlder(loaded ?? window, body));
      } catch (error) {
        fail(error);
      } finally {
        store.set({ loadingMore: false });
      }
    },
    async loadNewer() {
      const window = loaded;
      if (!window?.hasNewer || store.state.loadingMore) return;
      store.set({ loadingMore: true });
      try {
        const body = (await readHistory(newerUrl(store.state.storedId!, options.profile, window))) as HistoryBody;
        publish(withNewer(loaded ?? window, body));
      } catch (error) {
        fail(error);
      } finally {
        store.set({ loadingMore: false });
      }
    },
    async loadAll() {
      for (const direction of ['older', 'newer'] as const) {
        for (;;) {
          await store.until((state) => !state.loadingMore);
          const window = loaded;
          if (!window || !(direction === 'older' ? window.hasOlder : window.hasNewer)) break;
          await (direction === 'older' ? chat.loadOlder() : chat.loadNewer());
          // A page that did not come (Hermes refused it: the error is on the screen) ends the loading.
          if ((loaded?.rows.length ?? 0) === window.rows.length) break;
        }
      }
    },
    async showLatest() {
      try {
        store.set({ focusId: undefined });
        await readLatest(true);
      } catch (error) {
        fail(error);
      }
    },
    dispose: () => [...stopListening, stopRequests, stopNotes].forEach((stop) => stop()),
  };
  return chat;
}
