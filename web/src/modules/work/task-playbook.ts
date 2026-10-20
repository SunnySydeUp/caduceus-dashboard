// Which playbook a Kanban task came from, free of the DOM and of React (M6 #02). Hermes 0.21.4 reads `workflow_template_id` and `current_step_key`
// but cannot set them, so the playbook engine tags a stage task through its `idempotency_key` (`contracts/playbook-runs.ts`). A task that carries
// the native fields is read from them; otherwise from the tag. Both give the same answer, so a filter keeps working when Hermes starts to fill the
// native fields, and a filter saved against either keeps selecting the same tasks.
import { parseStageTag, templateIdOf } from '@caduceus/contracts/playbook-runs';

/** The task fields that say where a task came from; a `BoardTask` has all three. */
export interface PlaybookFields {
  workflowTemplateId: string | null;
  currentStepKey: string | null;
  idempotencyKey: string | null;
}

/** The playbook a task came from. */
export interface TaskPlaybook {
  /** The playbook's id; for a native `workflow_template_id` that is not `<id>@<version>`, the whole value. */
  id: string;
  version?: number;
  stage?: string;
  /** What a filter holds for this playbook: `<id>@<version>`, or the native value as Hermes wrote it. */
  key: string;
}

const NATIVE = /^(.+)@([1-9][0-9]{0,8})$/;

/** The playbook of a task, or `undefined` for a task no playbook made. */
export function playbookOfTask(task: PlaybookFields): TaskPlaybook | undefined {
  if (task.workflowTemplateId !== null) {
    const match = NATIVE.exec(task.workflowTemplateId);
    return { id: match ? match[1] : task.workflowTemplateId, ...(match ? { version: Number(match[2]) } : {}), ...(task.currentStepKey === null ? {} : { stage: task.currentStepKey }), key: task.workflowTemplateId };
  }
  const tag = parseStageTag(task.idempotencyKey);
  if (tag === undefined) return undefined;
  return { id: tag.playbook, version: tag.version, stage: task.currentStepKey ?? tag.stage, key: templateIdOf(tag) };
}

/** Whether a task came from the playbook a filter names (`key`, as `playbookOfTask` gives it). */
export const matchesPlaybook = (task: PlaybookFields, key: string): boolean => playbookOfTask(task)?.key === key;

/** The names of the playbooks, by id: the library's. A playbook the library no longer has is shown by its id. */
export type PlaybookNames = Readonly<Record<string, string>>;

/** A filter value in words: `<name or id> v<version>`. */
export function playbookLabel(key: string, names: PlaybookNames = {}): string {
  const match = NATIVE.exec(key);
  const id = match ? match[1] : key;
  return match ? `${names[id] ?? id} v${match[2]}` : (names[id] ?? id);
}

/** One value the Playbook filter offers, and how many tasks have it. */
export interface PlaybookOption {
  value: string;
  label: string;
  count: number;
}

/** The playbooks that have tasks among `tasks`, by name. */
export function playbookOptions(tasks: readonly PlaybookFields[], names: PlaybookNames = {}): PlaybookOption[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const playbook = playbookOfTask(task);
    if (playbook) counts.set(playbook.key, (counts.get(playbook.key) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count, label: playbookLabel(value, names) })).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

/** The small tag on a card or row of a playbook's task: “Playbook · <stage>”, or just “Playbook” when the stage is not known. */
export function playbookTagText(task: PlaybookFields): string | undefined {
  const playbook = playbookOfTask(task);
  if (playbook === undefined) return undefined;
  return playbook.stage === undefined ? 'Playbook' : `Playbook · ${playbook.stage}`;
}
