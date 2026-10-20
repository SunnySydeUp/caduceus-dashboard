// How a playbook run is written into Hermes Kanban and read back (M6 #02; work model §2.3). There is no run table: a run is the Kanban tasks that
// carry its tag. Hermes 0.21.4 reads `workflow_template_id` and `current_step_key` but cannot set them, so the tag goes in `idempotency_key`
// (which Hermes sets and also uses to return the same task for the same key: stage creation is exactly-once). The key names the playbook and its
// version, the run, the stage and the attempt. The run is named by its root task: every task after the first carries the root task's id; the
// first stage's task is the root, and cannot carry its own id before it exists, so it carries a one-off `root-<hex>` nonce instead.
import type { Playbook } from './playbooks.ts';

const PREFIX = 'caduceus-playbook';
const TAG = new RegExp(`^${PREFIX}:([a-z0-9][a-z0-9-]{0,63})@([1-9][0-9]{0,8}):(root-[0-9a-f]{12,32}|[A-Za-z0-9][A-Za-z0-9_.-]{0,63}):([a-z][a-z0-9_]{0,31}):([1-9][0-9]{0,5})$`);

/** What a stage task's key says. */
export interface StageTag {
  playbook: string;
  version: number;
  /** The root task's id, or the `root-<hex>` nonce when this task is the root. */
  run: string;
  stage: string;
  attempt: number;
}

export const stageTag = ({ playbook, version, run, stage, attempt }: StageTag): string => `${PREFIX}:${playbook}@${version}:${run}:${stage}:${attempt}`;

/** The tag in a task's `idempotency_key`, or `undefined` when the key is anything else (a task nobody's playbook made). */
export function parseStageTag(key: unknown): StageTag | undefined {
  const match = typeof key === 'string' ? TAG.exec(key) : null;
  return match ? { playbook: match[1], version: Number(match[2]), run: match[3], stage: match[4], attempt: Number(match[5]) } : undefined;
}

/** `root-` and twelve hex digits: the run part of the first task's key. */
export const isRootNonce = (run: string): boolean => run.startsWith('root-');

/** The `workflow_template_id` Hermes would hold for a tag, `<playbook>@<version>`. */
export const templateIdOf = (tag: Pick<StageTag, 'playbook' | 'version'>): string => `${tag.playbook}@${tag.version}`;

/** The stage key of the task the engine makes when a run stops on a failure; it is no stage of any playbook, so the planner ignores it and the Inbox shows it. */
export const RUN_FAILED_STAGE = 'run_failed';

/** What the engine writes into the `result` of a task it settles, so the verdict can be read from Kanban alone. */
export const VERDICT_FAIL = 'VERDICT: FAIL';
export const VERDICT_REJECTED = 'VERDICT: REJECTED';
export const VERDICT_ANSWERED = 'ANSWERED';

/** How a stage attempt ended, read from its Kanban task. */
export type Verdict = 'passed' | 'failed' | 'approved' | 'rejected' | 'answered';

/** The task as far as the engine reads it: the board's own fields, never a copy kept by Caduceus. */
export interface RunTask {
  id: string;
  status: string;
  title: string;
  assignee: string | null;
  tag: StageTag;
  /** Tasks this one is linked to as a parent: what it handed work to. */
  children: string[];
  createdAt: number | null;
  completedAt: number | null;
  /** What the worker wrote when it finished: the verdict is read from it. */
  result: string | null;
  /** Why a blocked task is blocked (`needs_input`, `capability`, …), and how many attempts of its worker failed. */
  blockKind: string | null;
  failures: number;
  lastFailure: string | null;
}

/** One stage attempt on a run's timeline. */
export interface TimelineEntry {
  stage: string;
  title: string;
  attempt: number;
  taskId: string;
  status: string;
  assignee: string | null;
  createdAt: number | null;
  completedAt: number | null;
  /** How the attempt ended, once it has; and the note or reason that went with it (the owner's note on a rejection, why it failed). */
  verdict?: Verdict;
  note?: string;
}

/** Where a run stands: `done` when its last stage is done, `running` while stages are being worked or made, `waiting` on the owner (a gate or a question), `failed` when it stopped on a failure. */
export type RunState = 'running' | 'waiting' | 'done' | 'failed';

/** A run as the list shows it. */
export interface RunSummary {
  /** The root task's id: how the run is named in the address. */
  root: string;
  board: string;
  playbook: { id: string; version: number; name: string };
  title: string;
  state: RunState;
  /** Stages with a task that is done, of the stages the playbook has. */
  stagesDone: number;
  stagesTotal: number;
  startedAt: number | null;
}

/** A run with its timeline and the definition it was started from. */
export interface RunDetail extends RunSummary {
  definition: Playbook;
  timeline: TimelineEntry[];
  inputs: Record<string, string>;
}
