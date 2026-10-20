// What the playbook engine decides (M6 #02, #03; work model §2.3), as pure functions of the tasks Kanban holds. The engine keeps no run state of its
// own: a stage's task, its tag (`idempotency_key`), its status, its result and its links to its children are the whole of a run, so every sweep, every
// event and every restart ends in the same decision. Ending the same way twice is safe because a stage task's key says which stage and attempt it is, and
// Hermes returns the task that has the key instead of making another.
//
// How a stage attempt ends (`verdictOf`): a task that is done passes, unless its result says `VERDICT: FAIL` (a worker's own verdict, or the engine's record
// of a stage Hermes gave up on) or `VERDICT: REJECTED` (the owner turned an approval gate down). A gate is approved when its task is done. Some endings are
// not done yet and the engine settles them first (`Plan.settle`): a gate the Inbox sent back to ready, a question the Inbox answered, and a stage task that
// Hermes blocked after its goal judge or completion contract gave up. Settling writes the ending into the task as a done task with a result that says so.
import { isRootNonce, RUN_FAILED_STAGE, VERDICT_ANSWERED, VERDICT_FAIL, VERDICT_REJECTED, stageTag, type RunState, type RunTask, type StageTag, type Verdict } from '@caduceus/contracts/playbook-runs';
import type { EdgeCondition, Playbook, PlaybookStage } from '@caduceus/contracts/playbooks';

/** A stage task the engine should make: which stage and attempt, what it follows, and the key that names it. */
export interface StageDraft {
  stage: PlaybookStage;
  attempt: number;
  /** The tasks it is linked to as their child: it waits for them, and its worker is handed what they produced. */
  parents: string[];
  tag: StageTag;
  /** Why this is another attempt, written into its brief: the owner's note on a rejection, or why the attempt before it failed. */
  feedback?: { heading: string; text: string };
}

/** A task that has ended in a way Kanban does not yet say; the engine records it as a done task. */
export interface Settlement {
  taskId: string;
  kind: 'rejected' | 'answered' | 'failed';
}

/** A gate task that is made but not yet where the owner can see it (`review` for an approval, blocked with `needs_input` for a question). */
export interface Preparation {
  taskId: string;
  gate: 'approval' | 'clarify';
}

export interface Plan {
  drafts: StageDraft[];
  settle: Settlement[];
  prepare: Preparation[];
  /** The run cannot go on: the stage and why. The engine makes one task for it that the Inbox shows. */
  failure?: { stage: string; text: string };
}

/** Even a stage with no `max_attempts` cannot be made this many times in one run: nothing loops for ever. */
export const ATTEMPT_CEILING = 100;

/** The run a task belongs to: its root task's id. The root's own task carries a nonce, and is the root. */
export const runOf = (task: Pick<RunTask, 'id' | 'tag'>): string => (isRootNonce(task.tag.run) ? task.id : task.tag.run);

/** The tasks of every run on a board, by the root task that names the run. */
export function groupRuns(tasks: readonly RunTask[]): Map<string, RunTask[]> {
  const runs = new Map<string, RunTask[]>();
  for (const task of tasks) {
    const root = runOf(task);
    runs.set(root, [...(runs.get(root) ?? []), task]);
  }
  return runs;
}

/** What follows the first line of a result that starts with a verdict marker: the reason or the note. */
export function verdictText(result: string | null): string {
  const lines = (result ?? '').split('\n');
  return lines.slice(1).join('\n').trim();
}

/** How an attempt ended, or `undefined` while it has not. */
export function verdictOf(stage: PlaybookStage | undefined, task: RunTask): Verdict | undefined {
  if (task.status !== 'done') return undefined;
  const result = task.result ?? '';
  if (result.startsWith(VERDICT_FAIL) || /^VERDICT:\s*FAIL\b/im.test(result)) return 'failed';
  if (result.startsWith(VERDICT_REJECTED)) return 'rejected';
  if (result.startsWith(VERDICT_ANSWERED)) return 'answered';
  return stage?.gate === 'approval' ? 'approved' : 'passed';
}

/** The edges that follow an ending. */
const EDGES: Record<Verdict, readonly EdgeCondition[]> = {
  passed: ['on_done', 'always'],
  answered: ['on_done', 'always'],
  approved: ['on_approve', 'always'],
  failed: ['on_fail', 'always'],
  rejected: ['on_reject', 'always'],
};

/** What a task that is not done is waiting to have settled, if anything: see the header. */
function settlementOf(stage: PlaybookStage, task: RunTask): Settlement['kind'] | undefined {
  if (stage.gate === 'approval') return ['review', 'done', 'triage', 'blocked', 'archived'].includes(task.status) ? undefined : 'rejected';
  if (stage.gate === 'clarify') return task.status === 'ready' || task.status === 'todo' ? 'answered' : undefined;
  // Hermes blocked it after its goal judge or its completion contract gave up (a question or a wait on a parent is not a failure).
  return task.status === 'blocked' && (task.blockKind === null || task.blockKind === 'capability') ? 'failed' : undefined;
}

const feedbackOf = (verdict: Verdict, task: RunTask): StageDraft['feedback'] => {
  if (verdict === 'rejected') return { heading: 'Review note', text: verdictText(task.result) || 'The owner rejected the earlier attempt.' };
  if (verdict === 'failed') return { heading: 'Why the earlier attempt failed', text: verdictText(task.result) || (task.result ?? '').trim() || 'The earlier attempt failed.' };
  return undefined;
};

/** The ways in that wait for each other: for a stage that several stages lead to on a passing ending, the stages (a join waits for all of them). */
function joinSources(playbook: Playbook, target: string): string[] {
  const passing: readonly EdgeCondition[] = ['on_done', 'on_approve', 'always'];
  const sources = new Set(playbook.edges.filter((edge) => edge.to === target && passing.includes(edge.when) && !reachesBack(playbook, edge)).map((edge) => edge.from));
  return sources.size > 1 ? [...sources] : [];
}

/** Whether an edge goes back to where it came from (a loop), which a join never waits for. */
function reachesBack(playbook: Playbook, edge: Playbook['edges'][number]): boolean {
  const seen = new Set<string>();
  const queue = [edge.to];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (key === edge.from) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const next of playbook.edges) if (next.from === key) queue.push(next.to);
  }
  return false;
}

/**
 * What to do next in the run named by `root`: the stage tasks to make for each attempt that has ended (the stage each edge leads to, unless a task of
 * that stage is already linked as its child), the endings to settle first, and the gates to prepare. The attempt is the next number for the stage in
 * this run, and a stage that has used its `max_attempts` stops the run. A task in `settled` is one whose successors the engine already knows are all
 * made (it did not ask Hermes for its children again), so it leads to nothing new. A stage that several stages lead to is a join: it is made once, when
 * every one of them has a passing attempt, with all of them as its parents.
 */
export function planRun(playbook: Playbook, tasks: readonly RunTask[], root: string, settled: ReadonlySet<string> = new Set()): Plan {
  const plan: Plan = { drafts: [], settle: [], prepare: [] };
  const inRun = tasks.filter((task) => runOf(task) === root);
  if (inRun.some((task) => task.tag.stage === RUN_FAILED_STAGE)) return plan;
  const mine = inRun.filter((task) => playbook.stages.some((stage) => stage.key === task.tag.stage));
  const stageOf = (key: string) => playbook.stages.find((stage) => stage.key === key);
  for (const task of mine) {
    const stage = stageOf(task.tag.stage);
    if (stage === undefined || task.status === 'done') continue;
    if (stage.gate !== undefined && task.status === 'triage') plan.prepare.push({ taskId: task.id, gate: stage.gate });
    const kind = settlementOf(stage, task);
    if (kind !== undefined) plan.settle.push({ taskId: task.id, kind });
  }
  for (const task of mine) {
    const stage = stageOf(task.tag.stage);
    const verdict = stage === undefined ? undefined : verdictOf(stage, task);
    if (stage === undefined || verdict === undefined || settled.has(task.id)) continue;
    const edges = playbook.edges.filter((edge) => edge.from === stage.key && EDGES[verdict].includes(edge.when));
    if (edges.length === 0) {
      if ((verdict === 'failed' || verdict === 'rejected') && plan.failure === undefined) plan.failure = { stage: stage.key, text: `“${stage.key}” ${verdict === 'failed' ? 'failed' : 'was rejected'}, and the playbook has no ${verdict === 'failed' ? 'on_fail' : 'on_reject'} edge from it.` };
      continue;
    }
    for (const edge of edges) {
      const target = stageOf(edge.to);
      if (target === undefined || mine.some((other) => other.tag.stage === target.key && task.children.includes(other.id))) continue;
      const attempt = 1 + mine.filter((other) => other.tag.stage === target.key).length + plan.drafts.filter((draft) => draft.stage.key === target.key).length;
      if (attempt > (target.max_attempts ?? ATTEMPT_CEILING)) {
        plan.failure ??= { stage: target.key, text: `“${target.key}” has used all ${target.max_attempts ?? ATTEMPT_CEILING} of its attempts without the run getting past it.` };
        continue;
      }
      const feedback = feedbackOf(verdict, task);
      const waits = EDGES[verdict].includes(edge.when) && (verdict === 'passed' || verdict === 'approved' || verdict === 'answered') ? joinSources(playbook, target.key) : [];
      let parents = [task.id];
      if (waits.length > 0) {
        const latest = waits.map((source) => mine.filter((other) => other.tag.stage === source && ['passed', 'approved', 'answered'].includes(verdictOf(stageOf(source), other) ?? '')).sort((a, b) => b.tag.attempt - a.tag.attempt)[0]);
        if (latest.some((other) => other === undefined) || plan.drafts.some((draft) => draft.stage.key === target.key)) continue;
        parents = latest.map((other) => other!.id);
      }
      plan.drafts.push({ stage: target, attempt, parents, tag: { playbook: task.tag.playbook, version: task.tag.version, run: root, stage: target.key, attempt }, ...(feedback === undefined ? {} : { feedback }) });
    }
  }
  return plan;
}

/** The attempt the owner asks for by re-running `stageKey`: the next number for it, following the latest ended attempt that leads to it, if any. */
export function rerunDraft(playbook: Playbook, tasks: readonly RunTask[], root: string, stageKey: string): StageDraft | undefined {
  const stage = playbook.stages.find((candidate) => candidate.key === stageKey);
  const first = tasks.find((task) => runOf(task) === root);
  if (stage === undefined || first === undefined) return undefined;
  const mine = tasks.filter((task) => runOf(task) === root);
  const attempt = 1 + mine.filter((task) => task.tag.stage === stageKey).length;
  const before = playbook.edges.filter((edge) => edge.to === stageKey).flatMap((edge) => mine.filter((task) => task.tag.stage === edge.from && task.status === 'done'));
  const parent = before.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  return { stage, attempt, parents: parent === undefined ? [] : [parent.id], tag: { playbook: first.tag.playbook, version: first.tag.version, run: root, stage: stageKey, attempt } };
}

/** Where a run stands. */
export function runState(playbook: Playbook, tasks: readonly RunTask[]): RunState {
  if (tasks.some((task) => task.tag.stage === RUN_FAILED_STAGE)) return 'failed';
  const mine = tasks.filter((task) => playbook.stages.some((stage) => stage.key === task.tag.stage));
  const waiting = mine.some((task) => {
    const gate = playbook.stages.find((stage) => stage.key === task.tag.stage)?.gate;
    return (gate === 'approval' && (task.status === 'review' || task.status === 'triage')) || (gate === 'clarify' && (task.status === 'blocked' || task.status === 'triage'));
  });
  if (waiting) return 'waiting';
  const ended = (task: RunTask) => ['passed', 'approved', 'answered'].includes(verdictOf(playbook.stages.find((stage) => stage.key === task.tag.stage), task) ?? '');
  const leadsNowhere = (task: RunTask) => !playbook.edges.some((edge) => edge.from === task.tag.stage);
  return mine.length > 0 && mine.every((task) => task.status === 'done') && mine.some((task) => leadsNowhere(task) && ended(task)) ? 'done' : 'running';
}

/** The key to give Hermes for a draft. */
export const keyOf = (draft: StageDraft): string => stageTag(draft.tag);
