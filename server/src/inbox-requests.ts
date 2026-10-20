// The Inbox's first source (M2 #01): the approvals and clarify questions Hermes is waiting on, in every live session of every
// profile. Nothing here is stored: the list is what Hermes says it is waiting on, asked again every `pollMs`.
//
// How the observer learns (the spike of M2 #01, recorded in the ticket): Hermes sends a server request only to the sockets
// attached to its session, and the observer attaches to none, so no `approval`, `clarify` or `request.cancel` frame ever reaches
// it. It does not need one. `session.active_list` is read only and reports a session blocked on the owner as `waiting`, and
// `session.events.since` is read only too and returns the session's `open_requests`: exactly the requests Hermes would re-deliver
// to a socket that reconnects. A request that was answered anywhere, withdrawn or timed out is no longer in that list.
import type { LiveRun, InboxApproval, InboxApprovalChoice, InboxClarify, InboxDecision, InboxDecisionResult, InboxItem, InboxQuestion } from '@caduceus/contracts/inbox';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { clarifyTimeoutOf } from './chat-limits.ts';
import type { GatewayObserver } from './gateway-observer.ts';
import type { HermesBackend } from './hermes-backend.ts';
import type { InboxSource } from './inbox-source.ts';

export interface LiveRequests extends InboxSource {
  /** The chat runs Hermes is working on, as of the last look. */
  runs(): LiveRun[];
  /** Gives the owner's decision on an item to Hermes. `already-answered` when Hermes is no longer waiting for it (or never was). */
  decide(id: string, decision: InboxDecision): Promise<InboxDecisionResult>;
  /** Looks at Hermes again now rather than at the next tick. */
  refresh(): Promise<void>;
}

/** A live session as `session.active_list` reports it. */
export interface LiveSession {
  /** The runtime id. */
  id: string;
  /** The stored id (`/chat/:id`). */
  key: string;
  title: string;
  preview: string;
  status: string;
  /** Seconds since the epoch of the turn's start while it runs (Hermes's `last_active`, which it leaves alone during a turn). */
  lastActive: number;
}

export interface LiveRequestsDeps {
  backend: HermesBackend;
  observer: GatewayObserver;
  now: () => number;
  pollMs: number;
  /** Told every live session each time they are listed, with a way to find the profile each belongs to: the run tracker reads who finished. */
  onSessions?(sessions: readonly LiveSession[], profileOf: (storedId: string) => Promise<string | undefined>): Promise<void> | void;
  /** Told when a background run that was going is over: it left the live sessions' list, so the run tracker never sees it finish. */
  onBackgroundDone?(run: LiveRun): void;
}

/** Hermes lists a session's open requests whatever it was told it had seen; asking from a seq nothing has reached returns just those. */
const NOTHING_SEEN = Number.MAX_SAFE_INTEGER;
const CHOICES: readonly InboxApprovalChoice[] = ['once', 'session', 'always', 'deny'];
/** Hermes's own name for the runs a side agent makes (`bg_<id>`, kept in the profile's session store while it works); it lists them nowhere else. */
const BACKGROUND_ID = /^bg_/;
/** How many looks go by before the background runs are read again (they are asked of each profile's store, which is more than one cheap call); an event that says the sessions changed asks at once. */
const BACKGROUND_EVERY = 4;
/** How many of a profile's newest sessions are read for background runs: a run that works is the newest by activity. */
const BACKGROUND_READ = 50;

const words = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : []);

interface OpenRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export function createLiveRequests({ backend, observer, now, pollMs, onSessions, onBackgroundDone }: LiveRequestsDeps): LiveRequests {
  const listeners = new Set<() => void>();
  let items: InboxItem[] = [];
  let runs: LiveRun[] = [];
  /** When each request was first seen, so an item keeps its place while it is open. */
  const firstSeen = new Map<string, number>();
  /** Hermes's id for the tool call each approval holds, which `approval.respond` names (the item itself carries only the request's own id). */
  const heldCalls = new Map<string, string>();
  /** Requests the owner answered through the Inbox that Hermes still lists for a moment: its waiting agent has to wake and withdraw them. They stay out of the list meanwhile. */
  const answered = new Set<string>();
  /** The profile a stored session belongs to; a session never changes profile. */
  const profiles = new Map<string, string>();
  const unplaced = new Map<string, number>();
  const clarifyTimeouts = new Map<string, { seconds: number; at: number }>();
  /** The background runs Hermes has going, as of the last time they were read. */
  let background: LiveRun[] = [];
  let looks = 0;
  let backgroundStale = true;
  let backgroundBusy = false;
  /** The live chats' runs as of the last look, so a background read that finishes between looks can publish the whole list. */
  let liveWorking: LiveRun[] = [];
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const profileNames = async (): Promise<string[]> => {
    const res = await backend.fetch('/api/profiles');
    const body: unknown = await res.json().catch(() => undefined);
    const listed = isRecord(body) && Array.isArray(body.profiles) ? body.profiles : [];
    return listed.flatMap((profile) => (isRecord(profile) && typeof profile.name === 'string' ? [profile.name] : []));
  };

  /** Which profile's store holds a session: Hermes lists live sessions of every profile together and says nothing of where each belongs. */
  const profileOf = async (storedId: string): Promise<string | undefined> => {
    const known = profiles.get(storedId);
    if (known !== undefined) return known;
    // A session whose row is not written yet is asked about again in a few seconds, not on every tick.
    if (now() - (unplaced.get(storedId) ?? -Infinity) < 3_000) return undefined;
    for (const name of await profileNames().catch(() => [])) {
      const res = await backend.fetch(`/api/sessions/${encodeURIComponent(storedId)}?profile=${encodeURIComponent(name)}`).catch(() => undefined);
      await res?.body?.cancel();
      if (res?.ok) {
        profiles.set(storedId, name);
        unplaced.delete(storedId);
        return name;
      }
    }
    unplaced.set(storedId, now());
    return undefined;
  };

  /** How long Hermes waits for an answer to a question in a profile; read from the profile's config (a minute's cache). */
  const clarifyTimeoutS = async (profile: string | undefined): Promise<number> => {
    const key = profile ?? '';
    const cached = clarifyTimeouts.get(key);
    if (cached && now() - cached.at < 60_000) return cached.seconds;
    const res = await backend.fetch(`/api/config${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`).catch(() => undefined);
    const seconds = res?.ok ? clarifyTimeoutOf(await res.json().catch(() => undefined)) : 3600;
    clarifyTimeouts.set(key, { seconds, at: now() });
    return seconds;
  };

  /** The questions of a clarify request: Hermes sends every one as a list, a single question as a list of one. */
  const questionsOf = (params: Record<string, unknown>): InboxQuestion[] =>
    (Array.isArray(params.questions) ? params.questions : []).flatMap((entry) => {
      const row = isRecord(entry) ? entry : {};
      const question = words(row.question).trim();
      const choices = strings(row.choices);
      return question === '' ? [] : [{ qid: words(row.qid), question, choices, multiSelect: row.multi_select === true && choices.length > 0 }];
    });

  const itemOf = async (request: OpenRequest, session: LiveSession): Promise<InboxItem | undefined> => {
    const at = firstSeen.get(request.id) ?? now();
    firstSeen.set(request.id, at);
    const profile = await profileOf(session.key);
    const base = { id: request.id, ref: request.id, stamp: '', profile, sessionId: session.id, storedSessionId: session.key || undefined, sessionTitle: session.title || session.preview || 'Untitled chat', at };
    if (request.method === 'approval') {
      const heldCall = words(request.params.request_id);
      if (heldCall !== '') heldCalls.set(request.id, heldCall);
      const offered = strings(request.params.choices).filter((choice): choice is InboxApprovalChoice => CHOICES.includes(choice as InboxApprovalChoice));
      return {
        ...base,
        kind: 'approval',
        group: 'decision',
        category: 'approvals',
        tool: words(request.params.tool_name) || undefined,
        command: words(request.params.command),
        description: words(request.params.description),
        choices: CHOICES.filter((choice) => choice === 'deny' || (offered.length === 0 ? choice === 'once' : offered.includes(choice))),
      } satisfies InboxApproval;
    }
    if (request.method === 'clarify') {
      const questions = questionsOf(request.params);
      if (questions.length === 0) return undefined;
      const seconds = await clarifyTimeoutS(profile);
      return { ...base, kind: 'clarify', group: 'decision', category: 'questions', questions, expiresAt: seconds > 0 ? at + seconds * 1000 : undefined } satisfies InboxClarify;
    }
    // A secret or a sudo password is not something the Inbox takes: those are answered in the chat that asked.
    return undefined;
  };

  const listSessions = async (): Promise<LiveSession[]> => {
    const { sessions } = await observer.request<{ sessions?: unknown }>('session.active_list');
    return (Array.isArray(sessions) ? sessions : []).flatMap((row) =>
      isRecord(row) && typeof row.id === 'string'
        ? [{ id: row.id, key: words(row.session_key), title: words(row.title).trim(), preview: words(row.preview).trim(), status: words(row.status), lastActive: typeof row.last_active === 'number' ? row.last_active : 0 }]
        : [],
    );
  };

  /** The background runs Hermes has going now, in every profile: a session of its own that Hermes has not ended (`is_active`), with the message as its title. */
  const readBackground = async (): Promise<LiveRun[]> => {
    const found: LiveRun[] = [];
    for (const profile of await profileNames()) {
      const res = await backend.fetch(`/api/sessions?profile=${encodeURIComponent(profile)}&limit=${BACKGROUND_READ}&order=recent`);
      const body: unknown = res.ok ? await res.json().catch(() => undefined) : undefined;
      for (const row of isRecord(body) && Array.isArray(body.sessions) ? body.sessions : []) {
        if (!isRecord(row) || typeof row.id !== 'string' || !BACKGROUND_ID.test(row.id) || row.is_active !== true) continue;
        found.push({
          sessionId: row.id,
          storedSessionId: row.id,
          title: words(row.title).trim() || words(row.preview).trim() || 'Background task',
          profile,
          status: 'running',
          since: Math.round((typeof row.started_at === 'number' ? row.started_at : now() / 1000) * 1000),
          background: true,
        });
      }
    }
    return found.sort((a, b) => a.since - b.since);
  };

  /**
   * Reads the background runs when they are due, and tells of the ones that ended since the last reading. A read that fails keeps what was known.
   * Says whether the runs that are going changed. It runs after the live sessions are looked at, never before: a look that waits on the extra reads
   * can miss a live run that is still working, and a run nobody saw working never reaches the activity feed.
   */
  const lookAtBackground = async (): Promise<boolean> => {
    looks += 1;
    if (!backgroundStale && looks % BACKGROUND_EVERY !== 0) return false;
    backgroundStale = false;
    const read = await readBackground().catch(() => undefined);
    if (!read) return false;
    const changed = JSON.stringify(read) !== JSON.stringify(background);
    const ended = background.filter((run) => !read.some((current) => current.sessionId === run.sessionId));
    background = read;
    for (const run of ended) onBackgroundDone?.(run);
    return changed;
  };

  /**
   * The background runs are read on a task of their own, never inside a look: Hermes says its sessions changed many times while a chat runs, and a look that
   * waited on those reads came round too late to see a short run working (the activity feed then never heard it finish).
   */
  const refreshBackground = async (): Promise<void> => {
    if (backgroundBusy || stopped) return;
    backgroundBusy = true;
    try {
      const changed = await lookAtBackground();
      if (!changed || stopped) return;
      runs = [...liveWorking, ...background];
      for (const listener of listeners) listener();
    } finally {
      backgroundBusy = false;
    }
  };

  const look = async () => {
    if (!observer.up) return;
    const found: InboxItem[] = [];
    const listed = new Set<string>();
    const sessions = await listSessions();
    await onSessions?.(sessions, profileOf);
    for (const session of sessions.filter((row) => row.status === 'waiting')) {
      const { open_requests: open } = await observer.request<{ open_requests?: unknown }>('session.events.since', { session_id: session.id, last_seen: NOTHING_SEEN });
      for (const entry of Array.isArray(open) ? open : []) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.method !== 'string') continue;
        listed.add(entry.id);
        if (answered.has(entry.id)) continue;
        const item = await itemOf({ id: entry.id, method: entry.method, params: isRecord(entry.params) ? entry.params : {} }, session);
        if (item) found.push(item);
      }
    }
    for (const id of answered) if (!listed.has(id)) answered.delete(id);
    for (const id of firstSeen.keys()) {
      if (found.some((item) => item.id === id)) continue;
      firstSeen.delete(id);
      heldCalls.delete(id);
    }
    const working = await Promise.all(
      sessions
        .filter((row) => row.status === 'working' || row.status === 'streaming' || row.status === 'waiting')
        .map(async (row): Promise<LiveRun> => ({
          sessionId: row.id,
          storedSessionId: row.key || undefined,
          title: row.title || row.preview || 'Untitled chat',
          profile: await profileOf(row.key),
          status: row.status === 'waiting' ? 'waiting' : 'running',
          since: Math.round(row.lastActive * 1000),
        })),
    );
    liveWorking = working;
    const going = [...working, ...background];
    const changed = found.length !== items.length || found.some((item, index) => JSON.stringify(item) !== JSON.stringify(items[index])) || JSON.stringify(going) !== JSON.stringify(runs);
    items = found;
    runs = going;
    if (changed) for (const listener of listeners) listener();
    void refreshBackground();
  };

  /** One look at a time: a slow Hermes is not asked again before it answered. */
  const refresh = (): Promise<void> => {
    running ??= look()
      .catch(() => undefined)
      .finally(() => {
        running = undefined;
      });
    return running;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void refresh().then(schedule), pollMs);
    timer.unref();
  };
  schedule();
  // What was seen before the connection dropped may be gone by the time it is back: the first look after it says so.
  observer.onStatus((up) => {
    if (up) void refresh();
  });
  // Hermes says when its sessions change: a run that began or ended is read at the next look, not in a few seconds.
  observer.onEvent((type) => {
    if (type === 'sessions.changed') backgroundStale = true;
  });

  return {
    items: () => items,
    runs: () => runs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    async decide(id, decision) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return { status: 'already-answered' };
      try {
        if (item.kind === 'approval') {
          if (!('choice' in decision)) throw new TypeError('An approval is answered with a choice.');
          // Hermes's approval has no field for a reason: the agent hears it as a note beside the refusal.
          if (decision.choice === 'deny' && decision.reason?.trim()) await observer.request('session.steer', { session_id: item.sessionId, text: `I denied that action. My reason: ${decision.reason.trim()}` });
          const requestId = heldCalls.get(id);
          const { resolved } = await observer.request<{ resolved?: number }>('approval.respond', { session_id: item.sessionId, choice: decision.choice, ...(requestId === undefined ? {} : { request_id: requestId }) });
          if (resolved === 0) return settle(id, 'already-answered');
        } else {
          if (!('result' in decision)) throw new TypeError('A question is answered with its answer.');
          const { status } = await observer.request<{ status?: string }>('request.answer', { id, result: decision.result });
          if (status === 'expired') return settle(id, 'already-answered');
        }
      } finally {
        void refresh();
      }
      return settle(id, 'resolved');
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      listeners.clear();
    },
  };

  function settle(id: string, status: InboxDecisionResult['status']): InboxDecisionResult {
    // Gone from the list at once, so the owner does not see an answered item until the next tick.
    answered.add(id);
    const remaining = items.filter((item) => item.id !== id);
    if (remaining.length !== items.length) {
      items = remaining;
      for (const listener of listeners) listener();
    }
    return { status };
  }
}
