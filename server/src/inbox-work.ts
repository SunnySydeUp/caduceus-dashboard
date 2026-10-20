// The Inbox's Work source (M3 #09): Kanban tasks that need the owner (in review, or blocked asking a question) and tasks that gave up. They are read from
// every Hermes board, again when a board's event stream says a task moved (a change made by the CLI, Telegram or another device included) and now and then.
// A task that is approved, unblocked or retried anywhere stops being in the answer, and so stops being an item. Nothing about it is kept.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { InboxAction } from '@caduceus/contracts/inbox';
import { parseStageTag, RUN_FAILED_STAGE } from '@caduceus/contracts/playbook-runs';
import type { HermesBackend } from './hermes-backend.ts';
import type { WebSocket } from 'ws';
import { createPolledSource, type InboxSource, type NoticeDraft } from './inbox-source.ts';

/** One board as Hermes answers `GET /board`: its slug and its tasks, each with the column's name as `status`. */
export interface BoardTasks {
  slug: string;
  tasks: unknown[];
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** What the owner can do about the tasks of the boards Hermes holds, as notices. Pure. */
export function workNotices(boards: readonly BoardTasks[]): NoticeDraft[] {
  return boards.flatMap(({ slug, tasks }) =>
    tasks.flatMap((task): NoticeDraft[] => {
      if (!isRecord(task)) return [];
      const id = text(task.id);
      const title = text(task.title);
      if (id === undefined || title === undefined) return [];
      const status = text(task.status);
      const kind = text(task.block_kind);
      const failures = typeof task.consecutive_failures === 'number' ? task.consecutive_failures : 0;
      const profile = text(task.assignee);
      const query = `?board=${encodeURIComponent(slug)}`;
      const base = `/_caduceus/api/work/tasks/${encodeURIComponent(id)}`;
      const common = { id: `task:${slug}:${id}`, ref: `task:${slug}:${id}`, category: 'work', profile, link: { label: 'Open task', to: `/work/tasks/${encodeURIComponent(id)}${query}` } } as const;
      const stampOf = (state: string) => `${state}:${String(task.started_at ?? '')}:${failures}`;
      const object = { object: title };
      // A playbook run that stopped (a stage used all its attempts, or failed with nowhere to go) leaves one task for the owner to see and acknowledge.
      if (parseStageTag(task.idempotency_key)?.stage === RUN_FAILED_STAGE) {
        if (status === 'done' || status === 'archived') return [];
        const acknowledge: InboxAction = { id: 'acknowledge', label: 'Acknowledge', request: { method: 'POST', path: `${base}/approve${query}` }, confirm: { title: `Acknowledge “${title}”?`, text: 'The task is marked done. The run stays stopped until you re-run a stage from its run page.', ...object, confirmLabel: 'Acknowledge' }, primary: true };
        return [{ ...common, stamp: stampOf('run-stopped'), group: 'failed', title, detail: text(task.body)?.replace(/^## Goal\s+/, '').slice(0, 400), actions: [acknowledge] }];
      }
      if (status === 'review') {
        const approve: InboxAction = { id: 'approve', label: 'Approve', request: { method: 'POST', path: `${base}/approve${query}` }, confirm: { title: `Approve “${title}”?`, text: 'The task is marked done with your approval as its result.', ...object, confirmLabel: 'Approve' }, primary: true };
        const reject: InboxAction = { id: 'reject', label: 'Reject + note', request: { method: 'POST', path: `${base}/reject${query}` }, input: { field: 'note', label: 'What needs to change?', required: true } };
        return [{ ...common, stamp: stampOf('review'), group: 'decision', title: `Review: ${title}`, detail: text(task.latest_summary) === title ? undefined : text(task.latest_summary)?.slice(0, 400), actions: [approve, reject] }];
      }
      if (status !== 'blocked') return [];
      if (kind === 'needs_input') {
        const answer: InboxAction = { id: 'answer', label: 'Answer', request: { method: 'POST', path: `${base}/answer${query}` }, input: { field: 'answer', label: 'Your answer', required: true }, confirm: { title: `Answer “${title}”?`, text: 'Your answer is posted as a comment and the task goes back to work.', ...object, confirmLabel: 'Answer' }, primary: true };
        return [{ ...common, stamp: stampOf('needs-input'), group: 'decision', title: `Needs input: ${title}`, detail: text(task.latest_summary)?.slice(0, 400) ?? text(task.block_reason)?.slice(0, 400), actions: [answer] }];
      }
      // Blocked for another reason after attempts that failed: Hermes stopped trying.
      if (kind === 'dependency' || failures === 0) return [];
      const retry: InboxAction = { id: 'retry', label: 'Retry', request: { method: 'POST', path: `${base}/retry${query}` }, confirm: { title: `Retry “${title}”?`, text: 'The task goes back to Ready and a worker picks it up again.', ...object, confirmLabel: 'Retry' }, primary: true };
      const reassign: InboxAction = { id: 'reassign', label: 'Reassign', request: { method: 'POST', path: `/api/plugins/kanban/tasks/${encodeURIComponent(id)}/reassign${query}`, body: { reclaim_first: false } }, input: { field: 'profile', label: 'Profile to give it to', required: true }, confirm: { title: `Reassign “${title}”?`, text: 'Another profile takes the task.', ...object, confirmLabel: 'Reassign' } };
      return [{ ...common, stamp: stampOf('gave-up'), group: 'failed', title: `Gave up: ${title}`, detail: text(task.last_failure_error)?.slice(0, 400) ?? 'Its attempts failed.', actions: [retry, reassign] }];
    }),
  );
}

export interface WorkSourceDeps {
  backend: HermesBackend;
  now: () => number;
  pollMs: number;
}

/** A board's answer, as the tasks of its columns with each column's name as the task's status. */
export function boardTasks(body: unknown): { tasks: unknown[]; cursor: number } {
  if (!isRecord(body) || !Array.isArray(body.columns)) return { tasks: [], cursor: 0 };
  const tasks = body.columns.flatMap((column) => (isRecord(column) && Array.isArray(column.tasks) ? column.tasks.flatMap((task) => (isRecord(task) ? [{ ...task, status: column.name }] : [])) : []));
  return { tasks, cursor: typeof body.latest_event_id === 'number' ? body.latest_event_id : 0 };
}

export function createWorkSource({ backend, now, pollMs }: WorkSourceDeps): InboxSource {
  /** One standing events socket per board: any frame means a task moved, and the source reads again. */
  const watches = new Map<string, { socket: WebSocket; closed: boolean }>();
  let wake: (() => void) | undefined;
  let stopped = false;

  const watch = async (slug: string, cursor: number) => {
    if (stopped || watches.get(slug) && !watches.get(slug)!.closed) return;
    try {
      const socket = await backend.openKanbanEvents({ board: slug, since: cursor, handshakeTimeoutMs: 5_000 });
      const entry = { socket, closed: false };
      watches.set(slug, entry);
      socket.on('message', () => wake?.());
      socket.on('close', () => {
        entry.closed = true;
      });
      if (stopped) socket.close();
    } catch {
      // The next read tries again.
    }
  };

  const source = createPolledSource({
    now,
    pollMs,
    async read() {
      const listed = await backend.fetch('/api/plugins/kanban/boards');
      if (!listed.ok) throw new Error(`Hermes answered HTTP ${listed.status}`);
      const body: unknown = await listed.json();
      const slugs = isRecord(body) && Array.isArray(body.boards) ? body.boards.flatMap((board) => (isRecord(board) && typeof board.slug === 'string' ? [board.slug] : [])) : [];
      const boards: BoardTasks[] = [];
      for (const slug of slugs) {
        const res = await backend.fetch(`/api/plugins/kanban/board?board=${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(`Hermes answered HTTP ${res.status}`);
        const { tasks, cursor } = boardTasks(await res.json());
        boards.push({ slug, tasks });
        void watch(slug, cursor);
      }
      for (const [slug, entry] of watches) {
        if (slugs.includes(slug)) continue;
        entry.socket.close();
        watches.delete(slug);
      }
      return workNotices(boards);
    },
    wake(refresh) {
      wake = refresh;
      return () => {
        wake = undefined;
      };
    },
  });
  return {
    ...source,
    close() {
      stopped = true;
      for (const { socket } of watches.values()) socket.close();
      watches.clear();
      source.close();
    },
  };
}
