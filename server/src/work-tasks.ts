// Creating a Kanban task with the fields Hermes's REST API cannot set (M3 #07): `POST /_caduceus/api/work/tasks` runs `hermes kanban create`
// on the Mac that runs Hermes, because only the CLI takes a worktree's branch name, a retry limit and a completion contract. It is the
// Brief editor's second way to create a task (the first is the Kanban plugin's `POST /tasks`) and takes the same body, plus those three.
//
// The command line is built here from a body that is checked field by field, as a fixed list of arguments: there is no shell, every value
// is written as `--flag=value` (so a value that starts with a dash is still a value), and the title follows `--`. The brief goes in on
// standard input. The profile and the board come from the query, are names (never paths), and scope the command the way the REST routes'
// `?board=` does. Nothing is kept: Hermes writes the task, and the answer is what Hermes printed.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { AuditLog } from './audit-log.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import { KANBAN_AUTHOR } from './kanban-author.ts';
import type { RestPolicy } from './policy.ts';

/** What the browser may send, with each field's check. A key not listed here is refused, never passed on. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BRANCH = /^(?![-/])(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![/.])$/;
const CONTRACT_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CONTRACT_PR = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const MAX_BODY = 60_000;
const MAX_LIST = 50;

type Check = (value: unknown) => boolean;
const text = (max: number): Check => (value) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const named = (pattern: RegExp): Check => (value) => typeof value === 'string' && pattern.test(value);
const whole = (min: number, max: number): Check => (value) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const list = (item: Check): Check => (value) => Array.isArray(value) && value.length <= MAX_LIST && value.every(item);

const FIELDS: Record<string, Check> = {
  title: (value) => text(500)(value) && (value as string).trim() !== '' && !/[\r\n]/.test(value as string),
  body: text(MAX_BODY),
  assignee: named(NAME),
  priority: whole(-1000, 1000),
  workspace_kind: (value) => value === 'scratch' || value === 'dir' || value === 'worktree',
  workspace_path: (value) => text(1024)(value) && (value as string).trim() !== '',
  branch_name: named(BRANCH),
  parents: list(named(NAME)),
  triage: (value) => typeof value === 'boolean',
  max_runtime_seconds: whole(1, 30 * 86_400),
  skills: list(named(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/)),
  max_retries: whole(1, 100),
  goal_mode: (value) => typeof value === 'boolean',
  goal_max_turns: whole(1, 1000),
  model_override: (value) => text(200)(value) && (value as string).trim() !== '',
  provider_override: (value) => text(200)(value) && (value as string).trim() !== '',
  project_id: named(NAME),
  completion_contract: (value) => value === 'local-only' || named(CONTRACT_REPO)(value) || named(CONTRACT_PR)(value),
};

type Fields = Record<string, unknown>;

/** The body, when every key is known and valid; otherwise the name of the first that is not. */
export function checked(body: unknown): { ok: true; fields: Fields } | { ok: false; field: string } {
  if (!isRecord(body)) return { ok: false, field: '(body)' };
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(FIELDS, key) || !FIELDS[key](value)) return { ok: false, field: key };
  }
  if (typeof body.title !== 'string') return { ok: false, field: 'title' };
  const kind = body.workspace_kind ?? 'scratch';
  // Hermes refuses these too; saying so here keeps the answer about the field, not about a command line.
  if (body.branch_name !== undefined && kind !== 'worktree') return { ok: false, field: 'branch_name' };
  if (body.workspace_path !== undefined && kind === 'scratch') return { ok: false, field: 'workspace_path' };
  if (body.provider_override !== undefined && body.model_override === undefined) return { ok: false, field: 'provider_override' };
  return { ok: true, fields: body };
}

/** The workspace argument `hermes kanban create --workspace` takes: `scratch`, `worktree`, `worktree:<path>` or `dir:<path>`. */
function workspaceArgument(fields: Fields): string | undefined {
  const kind = fields.workspace_kind;
  if (kind === undefined) return undefined;
  return typeof fields.workspace_path === 'string' ? `${kind}:${fields.workspace_path}` : String(kind);
}

/** The arguments of the command, in a fixed order; `profile` and `board` are `undefined` or already checked names. */
export function createArguments(fields: Fields, scope: { profile?: string; board?: string }): string[] {
  const flag = (name: string, value: unknown) => (value === undefined ? [] : [`--${name}=${String(value)}`]);
  const workspace = workspaceArgument(fields);
  return [
    ...(scope.profile && scope.profile !== 'default' ? ['-p', scope.profile] : []),
    'kanban',
    ...(scope.board ? ['--board', scope.board] : []),
    'create',
    '--json',
    // The REST route records `dashboard`; a task made from here reads the same whichever way it was made.
    '--created-by=dashboard',
    ...(typeof fields.body === 'string' && fields.body !== '' ? ['--body-file', '-'] : []),
    ...flag('assignee', fields.assignee),
    ...(Array.isArray(fields.parents) ? fields.parents.map((parent) => `--parent=${String(parent)}`) : []),
    ...flag('workspace', workspace),
    ...flag('branch', fields.branch_name),
    ...flag('project', fields.project_id),
    ...flag('priority', fields.priority),
    ...(fields.triage === true ? ['--triage'] : []),
    ...flag('max-runtime', fields.max_runtime_seconds),
    ...(Array.isArray(fields.skills) ? fields.skills.map((skill) => `--skill=${String(skill)}`) : []),
    ...flag('max-retries', fields.max_retries),
    ...flag('model', fields.model_override),
    ...flag('provider', fields.provider_override),
    ...flag('completion-contract', fields.completion_contract),
    ...flag('idempotency-key', fields.idempotency_key),
    ...(fields.goal_mode === true ? ['--goal', ...flag('goal-max-turns', fields.goal_max_turns)] : []),
    '--',
    String(fields.title),
  ];
}

/** The last line Hermes wrote to say why it refused, or a plain sentence when it wrote none. */
function reasonOf(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? 'Hermes refused to create the task.';
}

export interface WorkTasksDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  /** Told when a task was made, so the pages watching a board load it again. */
  onWrite(): void;
}

export function mountWorkTasks(app: Hono<AuthEnv>, { backend, policy, onWrite }: WorkTasksDeps): void {
  app.post('/_caduceus/api/work/tasks', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('POST', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const profile = url.searchParams.get('profile') ?? undefined;
    const board = url.searchParams.get('board') ?? undefined;
    if ((profile !== undefined && !NAME.test(profile)) || (board !== undefined && !SLUG.test(board))) return c.json({ error: 'bad-request', field: profile !== undefined && !NAME.test(profile) ? 'profile' : 'board' }, 400);
    const raw = await readBody(c.req.raw, prepared.maxBodyBytes);
    if (raw === 'too-large') return c.json({ error: 'payload-too-large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      return c.json({ error: 'bad-request', field: '(body)' }, 400);
    }
    const body = checked(parsed);
    if (!body.ok) return c.json({ error: 'bad-request', field: body.field }, 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    const input = typeof body.fields.body === 'string' ? body.fields.body : undefined;
    let result;
    try {
      result = await backend.runCli(createArguments(body.fields, { profile, board }), { input });
    } catch {
      return c.json({ error: 'hermes-unavailable', message: 'Caduceus could not run the hermes command.' }, 502);
    }
    if (result.code !== 0) return c.json({ error: 'hermes-refused', message: reasonOf(result.stderr, result.stdout) }, 422);
    let task: unknown;
    try {
      task = JSON.parse(result.stdout);
    } catch {
      return c.json({ error: 'bad-upstream', message: 'Hermes did not say which task it made.' }, 502);
    }
    if (!isRecord(task) || typeof task.id !== 'string') return c.json({ error: 'bad-upstream', message: 'Hermes did not say which task it made.' }, 502);
    onWrite();
    return c.json({ id: task.id, task }, 201);
  });

  // The owner's decisions on a task (M3 #09): each is one or two Hermes writes that Caduceus judges and audits first. Hermes has no route that says
  // "retry", "approve" or "answer", only a status change (which the board makes as a T0 with an undo toast) and comments, so these name the intent.
  type Step = { method: 'PATCH' | 'POST'; path: string; body: Record<string, unknown> };
  const command = (name: string, plan: (taskId: string, body: Record<string, unknown>) => Step[] | { field: string }) => {
    app.post(`/_caduceus/api/work/tasks/:taskId/${name}`, async (c) => {
      const url = new URL(c.req.url);
      const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
      const prepared = policy.prepare('POST', url.pathname, requester);
      if (!prepared.allow) return c.json(prepared.body, prepared.status);
      const board = url.searchParams.get('board') ?? undefined;
      const taskId = c.req.param('taskId');
      if (!NAME.test(taskId) || (board !== undefined && !SLUG.test(board))) return c.json({ error: 'bad-request', field: board !== undefined && !SLUG.test(board) ? 'board' : 'taskId' }, 400);
      const raw = await readBody(c.req.raw, 20_000);
      if (raw === 'too-large') return c.json({ error: 'payload-too-large' }, 413);
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          const parsed: unknown = JSON.parse(Buffer.from(raw).toString('utf8'));
          if (isRecord(parsed)) body = parsed;
        } catch {
          return c.json({ error: 'bad-request', field: '(body)' }, 400);
        }
      }
      const steps = plan(taskId, body);
      if (!Array.isArray(steps)) return c.json({ error: 'bad-request', field: steps.field }, 400);
      const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
      if (!decision.allow) return c.json(decision.body, decision.status);
      const query = board ? `?board=${encodeURIComponent(board)}` : '';
      try {
        for (const step of steps) {
          const res = await backend.fetch(`${step.path}${query}`, { method: step.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(step.body) });
          if (res.ok) continue;
          const answer: unknown = await res.json().catch(() => undefined);
          onWrite();
          return c.json({ detail: isRecord(answer) && typeof answer.detail === 'string' ? answer.detail : `Hermes answered HTTP ${res.status}.` }, res.status === 404 ? 404 : res.status === 409 ? 409 : 502);
        }
      } catch {
        return c.json({ error: 'hermes-unavailable', message: 'Caduceus could not reach Hermes.' }, 502);
      }
      onWrite();
      return c.json({ ok: true, task_id: taskId });
    });
  };
  const task = (taskId: string) => `/api/plugins/kanban/tasks/${encodeURIComponent(taskId)}`;
  const status = (taskId: string, fields: Record<string, unknown>): Step => ({ method: 'PATCH', path: task(taskId), body: fields });
  /** A note the owner wrote; the server stamps the author, as it does for every comment that passes through it. */
  const words = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' && value.length <= 4000 ? value.trim() : undefined);
  const comment = (taskId: string, text: string): Step => ({ method: 'POST', path: `${task(taskId)}/comments`, body: { body: text, author: KANBAN_AUTHOR } });
  const APPROVED = 'Approved by the owner from Caduceus.';

  // Retry: the task goes back to Ready and the dispatcher gives it to a worker again.
  command('retry', (taskId) => [status(taskId, { status: 'ready' })]);
  // Approve: a task in review is done, with the approval as its evidence of completion (Hermes will not complete one with none).
  command('approve', (taskId) => [status(taskId, { status: 'done', result: APPROVED, summary: APPROVED })]);
  // Reject + note: the note is a comment by the owner, and the task goes back to Ready for its worker.
  command('reject', (taskId, body) => {
    const note = words(body.note);
    return note === undefined ? { field: 'note' } : [comment(taskId, note), status(taskId, { status: 'ready' })];
  });
  // Answer: the answer is a comment by the owner, and the blocked task is unblocked.
  command('answer', (taskId, body) => {
    const answer = words(body.answer);
    return answer === undefined ? { field: 'answer' } : [comment(taskId, answer), status(taskId, { status: 'ready' })];
  });
}
