// What the run screens show, free of the DOM and of React (M6 #02; work model §2.3): the server's runs read into the shapes of
// `contracts/playbook-runs.ts`, the runs grouped by playbook, a run's path (what has happened, then what has not started), and what tells the
// pages that a task changed. A run is never stored by Caduceus: everything here is read from the server each time.
import { fillPlaceholders, playbookRef, readPlaybook, type PlaybookStage } from '@caduceus/contracts/playbooks';
import { parseStageTag, type RunDetail, type RunState, type RunSummary, type TimelineEntry, type Verdict } from '@caduceus/contracts/playbook-runs';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { StatusState } from '../../shell/StatusBadge.tsx';
import { STATUS_META, type BoardData, type BoardTask } from './board-model.ts';
import { ageLabel } from './tasks-model.ts';

const STATES: readonly RunState[] = ['running', 'waiting', 'done', 'failed'];
const VERDICTS: readonly Verdict[] = ['passed', 'failed', 'approved', 'rejected', 'answered'];

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** One run of the server's list; `undefined` for anything that is not one (the page never trusts a shape it was not given). */
export function readSummary(value: unknown): RunSummary | undefined {
  if (!isRecord(value) || !text(value.root) || !text(value.board) || !text(value.title) || !isRecord(value.playbook)) return undefined;
  const { id, version, name } = value.playbook;
  if (!text(id) || !whole(version) || !text(name)) return undefined;
  const state = STATES.find((candidate) => candidate === value.state);
  if (state === undefined || !whole(value.stagesDone) || !whole(value.stagesTotal)) return undefined;
  return { root: value.root, board: value.board, playbook: { id, version, name }, title: value.title, state, stagesDone: value.stagesDone, stagesTotal: value.stagesTotal, startedAt: seconds(value.startedAt) };
}

/** `GET /_caduceus/api/work/playbook-runs`. */
export function readRuns(body: unknown): RunSummary[] {
  return (isRecord(body) && Array.isArray(body.runs) ? body.runs : []).flatMap((item) => readSummary(item) ?? []);
}

function readEntry(value: unknown): TimelineEntry | undefined {
  if (!isRecord(value) || !text(value.stage) || !text(value.title) || !text(value.taskId) || !text(value.status) || !whole(value.attempt)) return undefined;
  const verdict = VERDICTS.find((candidate) => candidate === value.verdict);
  return {
    stage: value.stage,
    title: value.title,
    attempt: value.attempt,
    taskId: value.taskId,
    status: value.status,
    assignee: text(value.assignee) ? value.assignee : null,
    createdAt: seconds(value.createdAt),
    completedAt: seconds(value.completedAt),
    ...(verdict === undefined ? {} : { verdict }),
    ...(text(value.note) ? { note: value.note } : {}),
  };
}

/** `GET /_caduceus/api/work/playbook-runs/:root`: the run with its timeline, or `undefined` when the body is not one. */
export function readRun(body: unknown): RunDetail | undefined {
  const root = isRecord(body) ? body.run : undefined;
  const summary = readSummary(root);
  if (summary === undefined || !isRecord(root)) return undefined;
  const definition = readPlaybook(root.definition).playbook;
  if (definition === undefined || !Array.isArray(root.timeline)) return undefined;
  const inputs = isRecord(root.inputs) ? Object.fromEntries(Object.entries(root.inputs).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
  return { ...summary, definition, timeline: root.timeline.flatMap((item) => readEntry(item) ?? []), inputs };
}

/** What a run's state is called, and the badge that shows it. A run that `failed` stopped: the engine made a task for it, which Notices lists. */
export const RUN_STATE: Record<RunState, { label: string; badge: StatusState }> = {
  running: { label: 'Running', badge: 'running' },
  waiting: { label: 'Waiting for you', badge: 'waiting' },
  done: { label: 'Done', badge: 'done' },
  failed: { label: 'Stopped', badge: 'failed' },
};

/** The sentence under a run that stopped on a failure: it is no error of this page, a task for it waits in Notices, and a re-run of a stage goes on. */
export const STOPPED_TEXT = 'The run stopped, and a task for it is in Notices. Re-run a stage to continue.';

/** How a stage attempt ended, as its chip says it (the Kanban status stays beside it), and the label of the note that came with it. */
export const VERDICT_CHIP: Record<Verdict, { label: string; tone: 'success' | 'danger'; noteLabel: string }> = {
  passed: { label: 'Passed', tone: 'success', noteLabel: 'Note' },
  failed: { label: 'Failed', tone: 'danger', noteLabel: 'Why it failed' },
  approved: { label: 'Approved', tone: 'success', noteLabel: 'Note' },
  rejected: { label: 'Rejected', tone: 'danger', noteLabel: 'Owner’s note' },
  answered: { label: 'Answered', tone: 'success', noteLabel: 'Owner’s answer' },
};

/** A stage's attempt waits for the owner when its stage has a gate, no verdict was given yet, and its task sits in Review (approval) or is blocked (a question). */
export function waitingAtGate(entry: Pick<TimelineEntry, 'stage' | 'status' | 'verdict'>, definition: Pick<RunDetail['definition'], 'stages'>): boolean {
  const stage = definition.stages.find((candidate: PlaybookStage) => candidate.key === entry.stage);
  return stage?.gate !== undefined && entry.verdict === undefined && (entry.status === 'review' || entry.status === 'blocked');
}

/** The task ids of the latest attempt of each stage: the rows that offer “Re-run from this stage” (one button for a stage, not one for every try). */
export function latestAttemptIds(attempts: readonly TimelineEntry[]): Set<string> {
  const latest = new Map<string, TimelineEntry>();
  for (const entry of attempts) {
    const seen = latest.get(entry.stage);
    if (seen === undefined || entry.attempt >= seen.attempt) latest.set(entry.stage, entry);
  }
  return new Set([...latest.values()].map((entry) => entry.taskId));
}

/** What the Tier 1 dialog for a re-run says: which stage of which run gets a new attempt, and that stages that are done are not touched. */
export function rerunConfirmation(runTitle: string, stageTitle: string): { title: string; text: string; object: string; confirmLabel: string } {
  return {
    title: `Re-run from “${stageTitle}”?`,
    text: `This starts a new attempt of the stage “${stageTitle}” in the run “${runTitle}”. The stages that are already done are not touched, and the run goes on from the new attempt.`,
    object: stageTitle,
    confirmLabel: 'Re-run',
  };
}

/** `2 of 5 stages`. */
export const stagesText = (done: number, total: number): string => `${done} of ${total} ${total === 1 ? 'stage' : 'stages'}`;

/** The runs of one playbook version. */
export interface RunGroup {
  /** `<id>@<version>`. */
  ref: string;
  playbook: RunSummary['playbook'];
  runs: RunSummary[];
}

/** The runs grouped by playbook and version: the group of the newest run first, and in a group the newest run first. */
export function groupRuns(runs: readonly RunSummary[]): RunGroup[] {
  const newest = (run: RunSummary) => run.startedAt ?? 0;
  const groups = new Map<string, RunGroup>();
  for (const run of [...runs].sort((a, b) => newest(b) - newest(a) || a.root.localeCompare(b.root))) {
    const ref = playbookRef(run.playbook);
    const group = groups.get(ref);
    if (group) group.runs.push(run);
    else groups.set(ref, { ref, playbook: run.playbook, runs: [run] });
  }
  return [...groups.values()];
}

/** A stage that has no task yet, as the path shows it: its title with the run's answers filled in. */
export interface PendingStage {
  stage: string;
  title: string;
}

export interface RunPath {
  /** Every task of the run, oldest first. */
  attempts: TimelineEntry[];
  /** The definition's stages with no task, in the definition's order. */
  pending: PendingStage[];
}

/** A run's whole path: what has happened, oldest first, then the stages that have not started, so the owner sees where it is going. */
export function runPathOf({ definition, timeline, inputs }: Pick<RunDetail, 'definition' | 'timeline' | 'inputs'>): RunPath {
  const started = new Set(timeline.map((entry) => entry.stage));
  const pending = definition.stages.filter((stage: PlaybookStage) => !started.has(stage.key)).map((stage): PendingStage => ({ stage: stage.key, title: fillPlaceholders(stage.title, inputs) }));
  return { attempts: timeline, pending };
}

/** What a task's status is called and the tone of its chip: the Kanban board's own words. A status the board does not know shows as it is. */
export function taskStatusChip(status: string): { label: string; tone: 'running' | 'success' | 'blocked' | 'warning' | undefined } {
  const meta = (STATUS_META as Record<string, { label: string } | undefined>)[status];
  const tone = { running: 'running', done: 'success', blocked: 'blocked', review: 'warning' } as const;
  return { label: meta?.label ?? status, tone: tone[status as keyof typeof tone] };
}

/** The runs of one playbook definition, newest first. */
export const runsOf = (runs: readonly RunSummary[], playbookId: string): RunSummary[] => groupRuns(runs.filter((run) => run.playbook.id === playbookId)).flatMap((group) => group.runs);

/** The distinct boards runs live on, for the events sockets that tell a page to read again. */
export const boardsOf = (runs: readonly RunSummary[]): string[] => [...new Set(runs.map((run) => run.board))].sort();

/**
 * What changed on a board, as far as a run page cares: a task made, moved, assigned, finished or failed. Two loads with the same signature
 * changed nothing a run shows, so the page does not read its run again.
 */
export function boardSignature(board: Pick<BoardData, 'tasks'>): string {
  return board.tasks.map((task) => `${task.id}:${task.status}:${task.title}:${task.assignee ?? ''}:${task.completedAt ?? ''}:${task.failures}:${task.commentCount}`).join('|');
}

/** How long ago a run or a stage began, as the screens say it: “started 3h ago”. Empty when the time is not known. */
export function startedText(startedAt: number | null, now: number): string {
  if (startedAt === null) return '';
  const age = ageLabel(startedAt, now);
  return age === 'just now' ? 'started just now' : `started ${age} ago`;
}

/** One task of a run as the Raw view lists it: what Hermes holds in the fields the engine reads, and nothing Caduceus made up. */
export interface RawTaskRow {
  id: string;
  title: string;
  status: string;
  /** The run's tag (`caduceus-playbook:<id>@<version>:<run>:<stage>:<attempt>`). */
  idempotencyKey: string | null;
  workflowTemplateId: string | null;
  currentStepKey: string | null;
  /** The stage attempt this row is, when the run's timeline has it. */
  stage?: string;
  attempt?: number;
  /** False for a task of the timeline that the board no longer lists (archived or deleted): only what the timeline says is shown. */
  onBoard: boolean;
}

/**
 * The tasks that make up a run, oldest first as the timeline has them, from the board's own fields; then any other task on the board that carries the run's
 * tag (a task the engine made for the run that is not a stage attempt, such as the one a stopped run leaves for Notices), by when it was made.
 */
export function rawRowsOf(run: Pick<RunDetail, 'root' | 'timeline' | 'playbook'>, tasks: readonly Pick<BoardTask, 'id' | 'title' | 'status' | 'idempotencyKey' | 'workflowTemplateId' | 'currentStepKey' | 'createdAt'>[]): RawTaskRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const listed = new Set(run.timeline.map((entry) => entry.taskId));
  const fromTimeline = run.timeline.map((entry): RawTaskRow => {
    const task = byId.get(entry.taskId);
    return { id: entry.taskId, title: task?.title ?? entry.title, status: task?.status ?? entry.status, idempotencyKey: task?.idempotencyKey ?? null, workflowTemplateId: task?.workflowTemplateId ?? null, currentStepKey: task?.currentStepKey ?? null, stage: entry.stage, attempt: entry.attempt, onBoard: task !== undefined };
  });
  const others = tasks
    .filter((task) => {
      const tag = parseStageTag(task.idempotencyKey);
      return !listed.has(task.id) && tag !== undefined && tag.run === run.root && tag.playbook === run.playbook.id && tag.version === run.playbook.version;
    })
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((task): RawTaskRow => ({ id: task.id, title: task.title, status: task.status, idempotencyKey: task.idempotencyKey, workflowTemplateId: task.workflowTemplateId, currentStepKey: task.currentStepKey, onBoard: true }));
  return [...fromTimeline, ...others];
}
