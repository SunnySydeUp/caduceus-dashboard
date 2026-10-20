// Approvals and clarify questions (M1 #06): pure. Hermes asks the owner two kinds of thing while a turn runs: whether a tool may
// go ahead (an `approval` server request) and a question the agent needs answered (`clarify`). This module reads those requests
// into cards, and builds the answers Hermes takes; the chat engine (`chat-session.ts`) holds the cards. No DOM and no React.
import type { TurnSegment } from './activity.ts';

/** What Hermes lets the owner answer to an approval. */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

const CHOICES: readonly ApprovalChoice[] = ['once', 'session', 'always', 'deny'];

/** An answer to an approval: allow it this once, for the rest of the session, always; or deny it, with a reason for the agent if there is one. */
export type ApprovalDecision = { choice: 'once' | 'session' | 'always' } | { choice: 'deny'; reason?: string };

/** Whether a card is waiting for the owner, or its answer is on the way to Hermes. */
export type RequestStatus = 'open' | 'sending';

interface RequestBase {
  /** Hermes's id for the server request (`srq-…`). */
  id: string;
  /** The runtime id of the session the request belongs to. */
  sessionId: string;
  status: RequestStatus;
  /** Why the last answer did not go, in words. */
  error?: string;
}

export interface ApprovalRequest extends RequestBase {
  kind: 'approval';
  /** Hermes's id for the held tool call (`approval.respond` names it). */
  requestId: string | undefined;
  /** The tool the model called, when Hermes names it. */
  tool: string | undefined;
  /** The command, as Hermes shows it (with credentials left out). */
  command: string;
  /** Why Hermes holds it back. */
  description: string;
  /** The decisions Hermes offers, in the order the card shows them. */
  choices: ApprovalChoice[];
}

export interface ClarifyQuestion {
  /** Names the question in the request (`q0`, `q1`, …); the answers are keyed by it. */
  qid: string;
  question: string;
  /** What the agent offers to pick from; none for an open question. */
  choices: string[];
  /** More than one choice may be picked. */
  multiSelect: boolean;
}

export interface ClarifyRequest extends RequestBase {
  kind: 'clarify';
  /** One to five questions, answered together. A single question is a list of one. */
  questions: ClarifyQuestion[];
  /** When the page first saw the question (ms since the epoch): Hermes's deadline counts from the question being asked, and it does not say when that was. */
  receivedAt: number;
}

export type OpenRequest = ApprovalRequest | ClarifyRequest;

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const words = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : []);

/** How long Hermes waits for a clarify answer when its config says nothing (`agent.clarify_timeout`). */
export const DEFAULT_CLARIFY_TIMEOUT_S = 3600;

/** A server request as a card, or `undefined` for one this module does not answer. `now` is the page's clock (ms): when the request reached it. */
export function requestOf(id: string, method: string, rawParams: unknown, now: number): OpenRequest | undefined {
  const params = record(rawParams);
  const sessionId = words(params.session_id);
  if (method === 'approval') {
    const offered = strings(params.choices).filter((choice): choice is ApprovalChoice => CHOICES.includes(choice as ApprovalChoice));
    return {
      kind: 'approval',
      id,
      sessionId,
      status: 'open',
      requestId: words(params.request_id) || undefined,
      tool: words(params.tool_name) || undefined,
      command: words(params.command),
      description: words(params.description),
      choices: CHOICES.filter((choice) => choice === 'deny' || (offered.length === 0 ? choice === 'once' : offered.includes(choice))),
    };
  }
  if (method === 'clarify') {
    const questions = (Array.isArray(params.questions) ? params.questions : []).flatMap((entry): ClarifyQuestion[] => {
      const row = record(entry);
      const question = words(row.question).trim();
      const choices = strings(row.choices);
      return question === '' ? [] : [{ qid: words(row.qid), question, choices, multiSelect: row.multi_select === true && choices.length > 0 }];
    });
    return questions.length === 0 ? undefined : { kind: 'clarify', id, sessionId, status: 'open', questions, receivedAt: now };
  }
  return undefined;
}

/** The `approval.respond` call that carries `decision` for `request`: the session it belongs to, and the held call it names. */
export function approvalParams(request: ApprovalRequest, decision: ApprovalDecision, profile: { profile?: string } = {}): Record<string, unknown> {
  return { session_id: request.sessionId, choice: decision.choice, ...(request.requestId === undefined ? {} : { request_id: request.requestId }), ...profile };
}

/** A card that closed without the owner answering it here, and what happened to the request. */
export interface SettledRequest {
  id: string;
  kind: 'approval' | 'clarify';
  outcome: 'answered-elsewhere' | 'expired' | 'withdrawn';
  /** What the owner is told, in Hermes's terms: what it did about the request. */
  text: string;
}

const WITHDRAWN_BECAUSE: Record<string, string> = {
  interrupted: 'the turn was stopped',
  session_closed: 'the session ended',
  shutdown: 'Hermes is shutting down',
  gone: 'Hermes is no longer waiting for it',
};

/**
 * How a request ended when Hermes withdrew it (`request.cancel`, with a reason) or the page saw it answered elsewhere. An approval Hermes
 * gives up on is refused, never run; a clarify it gives up on goes on without an answer.
 */
export function settledOf(request: OpenRequest, reason: string): SettledRequest {
  const subject = request.kind === 'approval' ? 'approval' : 'question';
  if (reason === 'resolved') return { id: request.id, kind: request.kind, outcome: 'answered-elsewhere', text: 'Answered elsewhere.' };
  if (reason === 'timeout') {
    return { id: request.id, kind: request.kind, outcome: 'expired', text: request.kind === 'approval' ? 'Time ran out: Hermes refused it and did not run the command.' : 'Time ran out: Hermes carried on without an answer.' };
  }
  const because = WITHDRAWN_BECAUSE[reason] ?? (reason === '' ? 'Hermes withdrew it' : `Hermes withdrew it (${reason})`);
  return { id: request.id, kind: request.kind, outcome: 'withdrawn', text: `This ${subject} is closed: ${because}.` };
}

/** The words of `approval.cancelled`'s reason (the interrupt's and the session's end reasons) in the words of `request.cancel`. */
const CANCELLED_AS: Record<string, string> = { interrupt: 'interrupted', tui_shutdown: 'shutdown' };

/**
 * The cards `approval.cancelled` closes. Hermes broadcasts it when an interrupt, a reap or a teardown drops the approvals a session holds (the wait ends as a
 * refusal), and a card left open would offer a button that does nothing. It names the held calls (`request_ids`); with none named, it is every approval of
 * that session. Questions are never closed by it, and nor are the cards of another session.
 */
export function cancelledApprovals(requests: readonly OpenRequest[], payload: { session_id?: unknown; reason?: unknown; request_ids?: unknown }): { id: string; reason: string }[] {
  const named = Array.isArray(payload.request_ids) ? payload.request_ids.filter((id): id is string => typeof id === 'string' && id !== '') : [];
  const given = typeof payload.reason === 'string' ? payload.reason : '';
  const reason = Object.hasOwn(CANCELLED_AS, given) ? CANCELLED_AS[given]! : given;
  return requests.flatMap((request) =>
    request.kind === 'approval' && request.sessionId === payload.session_id && (named.length === 0 || (request.requestId !== undefined && named.includes(request.requestId))) ? [{ id: request.id, reason }] : [],
  );
}

/** What the agent is told when the owner denies an approval and says why: Hermes's approval takes no reason, so it goes as a steering note. */
export const denyNote = (reason: string): string => `I denied that action. My reason: ${reason.trim()}`;

/** The answers to a clarify card, by question id: the text typed or picked, or the list of picks for a multiple-choice question. */
export type ClarifyAnswers = Record<string, string | readonly string[]>;

/**
 * The `result` Hermes takes for a clarify request: `{answers}` by question id, the whole set. Hermes reads a result without `answers` as cancel-all, so a single
 * question is answered this way too. A multiple-choice answer is a JSON list, as Hermes reads it; nothing given is `''`, a skip.
 */
export function clarifyResult(request: ClarifyRequest, answers: ClarifyAnswers): { answers: Record<string, string> } {
  const text = (qid: string): string => {
    const given = answers[qid];
    if (given === undefined) return '';
    return typeof given === 'string' ? given.trim() : given.length === 0 ? '' : JSON.stringify(given);
  };
  return { answers: Object.fromEntries(request.questions.map((question) => [question.qid, text(question.qid)])) };
}

/** Whether a call failed because the server wants a passkey first (the policy's `step-up-required` refusal). */
export function needsStepUp(error: unknown): boolean {
  const { data } = (error ?? {}) as { data?: unknown };
  return record(data).error === 'step-up-required';
}

/** When Hermes stops waiting for a clarify answer (ms since the epoch), or `undefined` when it waits for ever. */
export function clarifyDeadline(request: ClarifyRequest, timeoutS: number): number | undefined {
  return timeoutS > 0 ? request.receivedAt + timeoutS * 1000 : undefined;
}

/** The time left before `deadline` at `now` (both ms), as a clock (`4:59`, `1:02:03`) that counts whole seconds down and reaches `0:00` as the wait ends. */
export function countdownOf(deadline: number, now: number): { label: string; lapsed: boolean } {
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = String(left % 60).padStart(2, '0');
  return { label: hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`, lapsed: deadline <= now };
}

/** The tool call the turn is running now, which is the one Hermes holds for approval: its name and arguments, as the tool card has them. */
export function toolBehind(segments: readonly TurnSegment[] | undefined): { name: string; args: Record<string, unknown> | undefined } | undefined {
  for (const segment of (segments ?? []).toReversed()) {
    if (segment.kind !== 'activity') continue;
    const running = segment.items.findLast((item) => item.kind === 'tool' && item.status === 'running');
    if (running?.kind === 'tool') return { name: running.name, args: running.args };
  }
  return undefined;
}
