// How the playbook engine reaches Hermes Kanban (M6 #02): the Kanban plugin's REST routes of the private backend, and `hermes kanban create` for
// the fields REST cannot set, behind one small interface so the engine's decisions can be tested without a socket. The engine is Caduceus's own
// worker acting for the owner after the owner started the run, so it calls the backend directly and not through the browser's policy.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { WebSocket } from 'ws';
import type { HermesBackend } from './hermes-backend.ts';
import { checked, createArguments } from './work-tasks.ts';

const KANBAN = '/api/plugins/kanban';

/** A task as the board lists it, as far as the engine reads it. */
export interface BoardTask {
  id: string;
  status: string;
  title: string;
  assignee: string | null;
  idempotencyKey: string | null;
  body: string | null;
  result: string | null;
  blockKind: string | null;
  failures: number;
  lastFailure: string | null;
  createdAt: number | null;
  completedAt: number | null;
}

/** A file attached to a task, as Hermes lists it. */
export interface KanbanAttachment {
  id: number;
  filename: string;
  contentType: string | null;
  size: number;
}

export interface KanbanPort {
  /** The slugs of every board. */
  boards(): Promise<string[]>;
  /** Every task of a board, archived ones too (an archived attempt still counts as an attempt), and the id of the board's latest event (where a live watch starts). */
  tasks(board: string): Promise<{ tasks: BoardTask[]; latestEvent: number }>;
  /** The tasks a task is a parent of and its comments, oldest first; `undefined` when the task is gone. */
  detail(board: string, id: string): Promise<{ children: string[]; comments: { author: string; body: string }[] } | undefined>;
  /** A task's title, or `undefined` when the task is gone. */
  task(board: string, id: string): Promise<{ title: string } | undefined>;
  /** The files attached to a task, oldest first. */
  attachments(board: string, id: string): Promise<KanbanAttachment[]>;
  /** The bytes of an attachment, or `undefined` when Hermes no longer has the file. */
  download(board: string, attachmentId: number): Promise<Uint8Array | undefined>;
  /** Puts a gate task that was made in Triage where the owner sees it: `review` for an approval, blocked with `needs_input` for a question. */
  prepare(board: string, id: string, gate: 'approval' | 'clarify', reason: string): Promise<void>;
  /** Ends a task as done with `result` as what it says (the engine's record of how an attempt ended). */
  settle(board: string, id: string, result: string): Promise<void>;
  /** Makes a task (or returns the one that has the same `idempotency_key`) and answers its id. `fields` are the Kanban plugin's create fields. */
  create(board: string, fields: Record<string, unknown>, options: { cli: boolean; reasoningEffort?: string }): Promise<string>;
  /** Opens the board's live event stream from after `since`; `onEvent` runs for each batch of events, `onClose` when the stream ends. Returns how to close it. */
  watch(board: string, since: number, onEvent: () => void, onClose: () => void): () => void;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

export function hermesKanban(backend: HermesBackend): KanbanPort {
  const board = (slug: string) => `?board=${encodeURIComponent(slug)}`;

  async function json(route: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
    const response = await backend.fetch(`${KANBAN}${route}`, init);
    return { status: response.status, body: await response.json().catch(() => undefined) };
  }

  return {
    async boards() {
      const { body } = await json('/boards');
      return isRecord(body) && Array.isArray(body.boards) ? body.boards.flatMap((entry) => (isRecord(entry) && typeof entry.slug === 'string' ? [entry.slug] : [])) : [];
    },
    async tasks(slug) {
      const { status, body } = await json(`/board${board(slug)}&include_archived=true`);
      if (status !== 200 || !isRecord(body) || !Array.isArray(body.columns)) throw new Error(`Hermes did not list the board “${slug}” (HTTP ${status}).`);
      const tasks = body.columns.flatMap((column) => (isRecord(column) && Array.isArray(column.tasks) ? column.tasks : [])).flatMap((task): BoardTask[] =>
        isRecord(task) && typeof task.id === 'string' && typeof task.status === 'string'
          ? [{ id: task.id, status: task.status, title: text(task.title) ?? '', assignee: text(task.assignee), idempotencyKey: text(task.idempotency_key), body: text(task.body), result: text(task.result), blockKind: text(task.block_kind), failures: typeof task.consecutive_failures === 'number' ? task.consecutive_failures : 0, lastFailure: text(task.last_failure_error), createdAt: num(task.created_at), completedAt: num(task.completed_at) }]
          : [],
      );
      return { tasks, latestEvent: typeof body.latest_event_id === 'number' ? body.latest_event_id : 0 };
    },
    async detail(slug, id) {
      const { status, body } = await json(`/tasks/${encodeURIComponent(id)}${board(slug)}`);
      if (status === 404) return undefined;
      if (status !== 200 || !isRecord(body) || !isRecord(body.links) || !Array.isArray(body.links.children)) throw new Error(`Hermes did not show the task ${id} (HTTP ${status}).`);
      const comments = (Array.isArray(body.comments) ? body.comments : []).flatMap((entry) => (isRecord(entry) && typeof entry.body === 'string' ? [{ author: text(entry.author) ?? '', body: entry.body }] : []));
      return { children: body.links.children.filter((child): child is string => typeof child === 'string'), comments };
    },
    async task(slug, id) {
      const { status, body } = await json(`/tasks/${encodeURIComponent(id)}${board(slug)}`);
      if (status === 404) return undefined;
      if (status !== 200 || !isRecord(body) || !isRecord(body.task)) throw new Error(`Hermes did not show the task ${id} (HTTP ${status}).`);
      return { title: text(body.task.title) ?? id };
    },
    async attachments(slug, id) {
      const { status, body } = await json(`/tasks/${encodeURIComponent(id)}/attachments${board(slug)}`);
      if (status === 404) return [];
      if (status !== 200 || !isRecord(body) || !Array.isArray(body.attachments)) throw new Error(`Hermes did not list the files of task ${id} (HTTP ${status}).`);
      return body.attachments.flatMap((entry): KanbanAttachment[] => (isRecord(entry) && typeof entry.id === 'number' && typeof entry.filename === 'string' ? [{ id: entry.id, filename: entry.filename, contentType: text(entry.content_type), size: num(entry.size) ?? 0 }] : []));
    },
    async download(slug, attachmentId) {
      const response = await backend.fetch(`${KANBAN}/attachments/${attachmentId}${board(slug)}`);
      if (response.status === 404) return undefined;
      if (response.status !== 200) throw new Error(`Hermes did not give the attachment ${attachmentId} (HTTP ${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async prepare(slug, id, gate, reason) {
      // Hermes moves a task to review or blocks it from ready, not from Triage (where it was made so that no worker can claim it). It has nobody assigned, so nothing claims it on the way.
      await json(`/tasks/${encodeURIComponent(id)}${board(slug)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ready' }) });
      if (gate === 'approval') {
        const { status } = await json(`/tasks/${encodeURIComponent(id)}${board(slug)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'review', summary: reason }) });
        if (status !== 200) throw new Error(`Hermes did not move the gate ${id} to review (HTTP ${status}).`);
        return;
      }
      const result = await backend.runCli(['kanban', '--board', slug, 'block', '--kind', 'needs_input', id, `Waiting for your answer: ${reason}`]);
      if (result.code !== 0) throw new Error(result.stderr.trim().split('\n').at(-1) || `Hermes did not block the question ${id}.`);
    },
    async settle(slug, id, result) {
      const { status, body } = await json(`/tasks/${encodeURIComponent(id)}${board(slug)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', result, summary: result }) });
      if (status !== 200) throw new Error(`Hermes did not end the task ${id} (HTTP ${status}${isRecord(body) && typeof body.detail === 'string' ? `: ${body.detail}` : ''}).`);
    },
    async create(slug, fields, { cli, reasoningEffort }) {
      let id: string | undefined;
      if (cli) {
        // The command line takes the fields `checked` knows; the tag and the title are the engine's own and plain.
        const { idempotency_key: key, ...plain } = fields;
        const arguments_ = checked(plain);
        if (!arguments_.ok) throw new Error(`Hermes cannot make this stage: “${arguments_.field}” is not acceptable.`);
        const input = typeof plain.body === 'string' ? plain.body : undefined;
        const result = await backend.runCli(createArguments({ ...arguments_.fields, idempotency_key: key }, { board: slug }), { input });
        if (result.code !== 0) throw new Error(result.stderr.trim().split('\n').at(-1) || 'Hermes refused to make the task.');
        const made: unknown = JSON.parse(result.stdout);
        id = isRecord(made) && typeof made.id === 'string' ? made.id : undefined;
        if (id !== undefined && reasoningEffort !== undefined) await json(`/tasks/${encodeURIComponent(id)}${board(slug)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reasoning_effort: reasoningEffort }) });
      } else {
        const { status, body } = await json(`/tasks${board(slug)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) });
        if (status !== 200 && status !== 201) throw new Error(`Hermes refused to make the task (HTTP ${status}${isRecord(body) && typeof body.detail === 'string' ? `: ${body.detail}` : ''}).`);
        id = isRecord(body) && isRecord(body.task) && typeof body.task.id === 'string' ? body.task.id : undefined;
      }
      if (id === undefined) throw new Error('Hermes did not say which task it made.');
      return id;
    },
    watch(slug, since, onEvent, onClose) {
      let closed = false;
      let socket: WebSocket | undefined;
      const finish = () => {
        if (closed) return;
        closed = true;
        onClose();
      };
      void backend.openKanbanEvents({ board: slug, since }).then(
        (opened) => {
          if (closed) return void opened.close();
          socket = opened;
          opened.on('message', onEvent);
          opened.on('close', finish);
        },
        finish,
      );
      return () => {
        closed = true;
        socket?.close();
      };
    },
  };
}
