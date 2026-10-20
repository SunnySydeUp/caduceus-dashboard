// The playbook engine (M6 #02; work model §2.3, architecture §1): the Caduceus worker that makes a playbook's stage tasks in Hermes Kanban and
// advances a run when a stage ends. It keeps no run state: every pass reads the board, rebuilds each run from its tagged tasks (`playbook-plan.ts`)
// and makes what is missing, so a missed event, a restart and a second pass all end in the same place. What makes that safe is the stage's
// `idempotency_key`: Hermes returns the task that has the key, so making a stage twice makes it once. What makes two Caduceus processes safe is the
// lease (`playbook-lease.ts`): an engine that does not hold it reads but writes nothing.
//
// A pass is started by the Kanban events stream of each board (a change to a task) and by a sweep at a set interval, which catches what the
// stream missed. When the installed Hermes routes workflows natively on the same fields (`capabilities().nativeRouting`), the engine stops advancing
// runs and hands them to Hermes: the definitions stay as they are.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { parseStageTag, RUN_FAILED_STAGE, stageTag, VERDICT_ANSWERED, VERDICT_FAIL, VERDICT_REJECTED, type RunDetail, type RunSummary, type RunTask, type StageTag, type TimelineEntry } from '@caduceus/contracts/playbook-runs';
import type { Playbook } from '@caduceus/contracts/playbooks';
import type { BoardTask, KanbanPort } from './playbook-kanban.ts';
import type { Lease } from './playbook-lease.ts';
import { KANBAN_AUTHOR } from './kanban-author.ts';
import { groupRuns, planRun, rerunDraft, runState, verdictOf, verdictText, type Plan, type Settlement, type StageDraft } from './playbook-plan.ts';
import { inputsOf, profileOf, stageTaskFields, withDefaults } from './playbook-stage-task.ts';

export interface PlaybookSource {
  /** The definition of one version of a playbook, or `undefined` when there is none. */
  get(id: string, version: number): Playbook | undefined;
}

/** What the installed Hermes can do with the workflow fields, read from its pinned contract and its markers. */
export interface WorkflowCapabilities {
  /** Hermes accepts `workflow_template_id` and `current_step_key` when a task is created: the engine writes them too. */
  nativeTags: boolean;
  /** Hermes routes workflows itself on these fields: the engine stops advancing runs. */
  nativeRouting: boolean;
}

export interface EngineOptions {
  kanban: KanbanPort;
  source: PlaybookSource;
  lease: Lease;
  capabilities(): WorkflowCapabilities;
  /** How often every board is read whether or not an event came. 0 turns the engine's own timer off (a test calls `sweep`). */
  sweepMs: number;
  /** Whether the live event streams are watched. */
  watch: boolean;
  /** How long a burst of events waits before the board is read once. */
  settleMs?: number;
  now?(): number;
}

export interface StartedRun {
  root: string;
  board: string;
}

/** Why a run could not be started, in words the owner can act on. */
export class StartRefused extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(' '));
    this.problems = problems;
  }
}

interface EngineEvents {
  /** A pass over a board finished. */
  reconciled: [board: string];
  /** Something went wrong in a pass; the next one tries again. */
  failure: [error: Error];
}

export interface PlaybookEngine extends EventEmitter<EngineEvents> {
  /** Makes the first stage's task of a new run. Throws `StartRefused` for inputs the playbook does not accept. */
  start(playbook: Playbook, inputs: Readonly<Record<string, string>>, options?: { board?: string; profile?: string }): Promise<StartedRun>;
  /** One pass over every board now. */
  sweep(): Promise<void>;
  /** Starts the timer and the event streams. */
  begin(): void;
  /** Stops them, lets a pass under way finish, and gives the lease up. */
  stop(): Promise<void>;
  /** Makes a new attempt of one stage of a run (the owner re-runs from it); completed stages are not touched. Throws `StartRefused` when the run or stage is unknown. */
  rerun(board: string, root: string, stage: string): Promise<StartedRun & { stage: string; attempt: number }>;
  runs(): Promise<RunSummary[]>;
  run(board: string, root: string): Promise<RunDetail | undefined>;
}

const MAX_INPUT_LENGTH = 20_000;

/** The inputs a run is started with, as the playbook's questions: what is missing, unknown or too long. */
function inputProblems(playbook: Playbook, given: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(given)) if (!playbook.inputs.some((input) => input.key === key)) problems.push(`“${key}” is not one of this playbook’s questions.`);
  for (const input of playbook.inputs) {
    const value = given[input.key];
    if (value !== undefined && (typeof value !== 'string' || value.length > MAX_INPUT_LENGTH)) problems.push(`“${input.label}” must be text of at most ${MAX_INPUT_LENGTH} characters.`);
    else if (input.required === true && (value ?? input.default ?? '').trim() === '') problems.push(`Answer “${input.label}”.`);
  }
  return problems;
}

export function createPlaybookEngine(options: EngineOptions): PlaybookEngine {
  const { kanban, source, lease, capabilities, sweepMs, watch, settleMs = 150 } = options;
  const emitter = new EventEmitter<EngineEvents>();
  /** Done tasks whose successors are all made. Memory only, and rebuilt by reading: it saves asking Hermes the same question every sweep. */
  const settled = new Set<string>();
  const watchers = new Map<string, () => void>();
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let settling: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  /** Passes run one after another, so two never make the same stage at once. */
  let tail: Promise<void> = Promise.resolve();

  const toRunTask = (task: BoardTask, tag: StageTag, children: string[]): RunTask => ({ id: task.id, status: task.status, title: task.title, assignee: task.assignee, tag, children, createdAt: task.createdAt, completedAt: task.completedAt, result: task.result, blockKind: task.blockKind, failures: task.failures, lastFailure: task.lastFailure });

  /** The tagged tasks of a board, each with the tasks it is a parent of (asked only for a done task whose successors are not known to be made). */
  async function playbookTasks(board: string, withChildren: (task: BoardTask, tag: StageTag) => boolean): Promise<{ tasks: RunTask[]; bodies: Map<string, string | null>; latestEvent: number }> {
    const { tasks: listed, latestEvent } = await kanban.tasks(board);
    const bodies = new Map<string, string | null>();
    const tasks: RunTask[] = [];
    for (const task of listed) {
      const tag = parseStageTag(task.idempotencyKey);
      if (tag === undefined) continue;
      bodies.set(task.id, task.body);
      tasks.push(toRunTask(task, tag, withChildren(task, tag) ? ((await kanban.detail(board, task.id))?.children ?? []) : []));
    }
    return { tasks, bodies, latestEvent };
  }

  /** Makes each task of a plan. A task that Hermes refuses fails the pass of its run only; the next sweep tries again. */
  async function make(board: string, playbook: Playbook, drafts: readonly StageDraft[], answers: Readonly<Record<string, string>>, profile: string | undefined): Promise<void> {
    const { nativeTags } = capabilities();
    for (const draft of drafts) {
      const made = stageTaskFields(playbook, draft.stage, answers, { tag: draft.tag, parents: draft.parents, nativeTags, profile, feedback: draft.feedback });
      const id = await kanban.create(board, made.fields, { cli: made.cli, reasoningEffort: made.reasoningEffort });
      if (draft.stage.gate !== undefined) await kanban.prepare(board, id, draft.stage.gate, draft.stage.title);
    }
  }

  /** Writes how an attempt ended into its task, from what Kanban says: the owner's note or answer is the latest comment they made. */
  async function settleTask(board: string, task: RunTask, kind: Settlement['kind']): Promise<void> {
    const comments = (await kanban.detail(board, task.id))?.comments ?? [];
    const latest = (own: boolean) => [...comments].reverse().find((comment) => !own || comment.author === KANBAN_AUTHOR)?.body.trim();
    if (kind === 'rejected') return kanban.settle(board, task.id, `${VERDICT_REJECTED}\n\n${latest(true) ?? 'The owner rejected it without a note.'}`);
    if (kind === 'answered') return kanban.settle(board, task.id, `${VERDICT_ANSWERED}\n\n${latest(true) ?? ''}`.trim());
    return kanban.settle(board, task.id, `${VERDICT_FAIL}\n\n${latest(false) ?? task.lastFailure ?? 'Hermes gave up on the stage.'}`);
  }

  /** Makes the task that says a run stopped, where the Inbox shows it. Made once: its key is the run's. */
  async function stop(board: string, playbook: Playbook, root: string, first: RunTask, failure: NonNullable<Plan['failure']>): Promise<void> {
    const tag: StageTag = { playbook: playbook.id, version: first.tag.version, run: root, stage: RUN_FAILED_STAGE, attempt: 1 };
    const rootTitle = first.title;
    await kanban.create(board, { title: `Playbook run stopped: ${rootTitle}`.slice(0, 500), body: `## Goal\n\nThe run of “${playbook.name}” (root task ${root}) cannot go on.\n\n${failure.text}\n\nRe-run a stage from its run page, or acknowledge this to clear it.\n`, idempotency_key: stageTag(tag) }, { cli: false });
  }

  async function reconcile(board: string): Promise<void> {
    if (!lease.acquire() || capabilities().nativeRouting) return;
    // A second round reads again what the first settled, so the rework it leads to is made in the same pass.
    for (let round = 0; round < 2; round += 1) {
      const { tasks, bodies, latestEvent } = await playbookTasks(board, (task, tag) => task.status === 'done' && !settled.has(task.id) && source.get(tag.playbook, tag.version) !== undefined);
      ensureWatching(board, latestEvent);
      let changed = false;
      for (const [root, members] of groupRuns(tasks)) {
        const first = members[0];
        const playbook = source.get(first.tag.playbook, first.tag.version);
        if (playbook === undefined) continue;
        const answers = inputsOf(bodies.get(first.id)) ?? withDefaults(playbook, {});
        try {
          const plan = planRun(playbook, members, root, settled);
          for (const preparation of plan.prepare) {
            const task = members.find((member) => member.id === preparation.taskId)!;
            await kanban.prepare(board, task.id, preparation.gate, task.title);
            changed = true;
          }
          for (const settlement of plan.settle) {
            await settleTask(board, members.find((member) => member.id === settlement.taskId)!, settlement.kind);
            changed = true;
          }
          await make(board, playbook, plan.drafts, answers, profileOf(bodies.get(first.id)));
          if (plan.failure !== undefined) await stop(board, playbook, root, members.find((member) => member.id === root) ?? first, plan.failure);
          if (plan.drafts.length === 0 && plan.failure === undefined && plan.settle.length === 0 && plan.prepare.length === 0) for (const member of members) if (member.status === 'done') settled.add(member.id);
        } catch (error) {
          emitter.emit('failure', error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (!changed) return;
    }
  }

  function ensureWatching(board: string, since: number): void {
    if (!watch || stopped || watchers.has(board)) return;
    const close = kanban.watch(board, since, () => request(board), () => watchers.delete(board));
    watchers.set(board, close);
  }

  /** Reads a board once soon, however many events came. */
  function request(board: string): void {
    dirty.add(board);
    if (settling !== undefined || stopped) return;
    settling = setTimeout(() => {
      settling = undefined;
      const boards = [...dirty];
      dirty.clear();
      for (const slug of boards) void pass(slug);
    }, settleMs);
  }

  function pass(board: string): Promise<void> {
    tail = tail.then(async () => {
      try {
        await reconcile(board);
        emitter.emit('reconciled', board);
      } catch (error) {
        emitter.emit('failure', error instanceof Error ? error : new Error(String(error)));
      }
    });
    return tail;
  }

  async function sweep(): Promise<void> {
    let boards: string[];
    try {
      boards = await kanban.boards();
    } catch (error) {
      emitter.emit('failure', error instanceof Error ? error : new Error(String(error)));
      return;
    }
    for (const board of boards) await pass(board);
  }

  /** Every run on every board, newest first: its summary, the definition it started from, its tasks (oldest first) and the bodies of those. */
  async function readRuns(): Promise<{ summary: RunSummary; definition: Playbook; members: RunTask[]; bodies: Map<string, string | null> }[]> {
    const found: { summary: RunSummary; definition: Playbook; members: RunTask[]; bodies: Map<string, string | null> }[] = [];
    for (const board of await kanban.boards()) {
      const { tasks, bodies } = await playbookTasks(board, () => false);
      for (const [root, group] of groupRuns(tasks)) {
        const definition = source.get(group[0].tag.playbook, group[0].tag.version);
        if (definition === undefined) continue;
        // Oldest first. Hermes stamps a task to the second, so tasks made in the same second go in the order of the attempts and then of the stages.
        const place = (task: RunTask) => definition.stages.findIndex((stage) => stage.key === task.tag.stage);
        const members = [...group].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.tag.attempt - b.tag.attempt || place(a) - place(b));
        const rootTask = members.find((task) => task.id === root) ?? members[0];
        const summary: RunSummary = {
          root,
          board,
          playbook: { id: definition.id, version: definition.version, name: definition.name },
          title: rootTask.title,
          state: runState(definition, members),
          stagesDone: new Set(members.filter((task) => task.status === 'done').map((task) => task.tag.stage)).size,
          stagesTotal: definition.stages.length,
          startedAt: rootTask.createdAt,
        };
        found.push({ summary, definition, members, bodies });
      }
    }
    return found.sort((a, b) => (b.summary.startedAt ?? 0) - (a.summary.startedAt ?? 0));
  }

  const engine: PlaybookEngine = Object.assign(emitter, {
    async start(playbook: Playbook, given: Readonly<Record<string, string>>, { board, profile }: { board?: string; profile?: string } = {}): Promise<StartedRun> {
      const problems = inputProblems(playbook, given);
      if (problems.length > 0) throw new StartRefused(problems);
      const answers = withDefaults(playbook, given);
      const slug = board ?? (await kanban.boards())[0] ?? 'default';
      const tag: StageTag = { playbook: playbook.id, version: playbook.version, run: `root-${randomBytes(8).toString('hex')}`, stage: playbook.stages[0].key, attempt: 1 };
      const made = stageTaskFields(playbook, playbook.stages[0], answers, { tag, parents: [], nativeTags: capabilities().nativeTags, profile });
      try {
        const root = await kanban.create(slug, made.fields, { cli: made.cli, reasoningEffort: made.reasoningEffort });
        if (playbook.stages[0].gate !== undefined) await kanban.prepare(slug, root, playbook.stages[0].gate, playbook.stages[0].title);
        if (!stopped) request(slug);
        return { root, board: slug };
      } catch (error) {
        throw new StartRefused([error instanceof Error ? error.message : 'Hermes did not make the first task.']);
      }
    },
    async rerun(board: string, root: string, stage: string) {
      const { tasks, bodies } = await playbookTasks(board, () => false);
      const members = groupRuns(tasks).get(root) ?? [];
      const playbook = members[0] === undefined ? undefined : source.get(members[0].tag.playbook, members[0].tag.version);
      const draft = playbook === undefined ? undefined : rerunDraft(playbook, members, root, stage);
      if (playbook === undefined || draft === undefined) throw new StartRefused([members.length === 0 ? 'There is no such run.' : `The playbook has no stage called “${stage}”.`]);
      const answers = inputsOf(bodies.get(members[0].id)) ?? withDefaults(playbook, {});
      await make(board, playbook, [draft], answers, profileOf(bodies.get(members[0].id)));
      request(board);
      return { root, board, stage, attempt: draft.attempt };
    },
    sweep,
    begin() {
      if (!stopped) return;
      stopped = false;
      void sweep();
      if (sweepMs > 0) timer = setInterval(() => void sweep(), sweepMs);
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(settling);
      timer = settling = undefined;
      dirty.clear();
      for (const close of watchers.values()) close();
      watchers.clear();
      await tail;
      lease.release();
    },
    async runs() {
      return (await readRuns()).map(({ summary }) => summary);
    },
    async run(board: string, root: string) {
      const found = (await readRuns()).find(({ summary }) => summary.board === board && summary.root === root);
      if (found === undefined) return undefined;
      const timeline: TimelineEntry[] = found.members.map((task) => {
        const verdict = verdictOf(found.definition.stages.find((stage) => stage.key === task.tag.stage), task);
        const note = verdict === 'failed' || verdict === 'rejected' || verdict === 'answered' ? verdictText(task.result) : '';
        return { stage: task.tag.stage, title: task.title, attempt: task.tag.attempt, taskId: task.id, status: task.status, assignee: task.assignee, createdAt: task.createdAt, completedAt: task.completedAt, ...(verdict === undefined ? {} : { verdict }), ...(note === '' ? {} : { note }) };
      });
      return { ...found.summary, definition: found.definition, timeline, inputs: inputsOf(found.bodies.get(found.members[0].id)) ?? {} };
    },
  });
  return engine;
}
