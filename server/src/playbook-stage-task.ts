// What a playbook stage becomes in Hermes Kanban (M6 #02; work model §2.1 and §2.3): the fields of the stage's task, as the Kanban plugin's
// `POST /tasks` names them. Pure. The title and the brief's sections are the stage's text with the run's inputs filled in; the stage's assignee,
// model, skills, goal mode and contract map onto Kanban's own fields; the tag goes in `idempotency_key`. Every task also carries the run's inputs
// in a trailing HTML comment (invisible when rendered), because the run keeps no state of its own: any task of it says what the owner asked.
import { stageTag, templateIdOf, type StageTag } from '@caduceus/contracts/playbook-runs';
import { BRIEF_HEADINGS, BRIEF_KEYS, fillPlaceholders, fillSection, runtimeSeconds, type Playbook, type PlaybookStage } from '@caduceus/contracts/playbooks';

const INPUTS = /<!-- caduceus-playbook-inputs: (\{.*?\}) -->/s;
const PROFILE = /<!-- caduceus-playbook-profile: ([A-Za-z0-9][A-Za-z0-9_.-]{0,63}) -->/;

/** The run's inputs as the comment a task body ends with; `<` and `>` are escaped so an answer can never close the comment. */
function inputsComment(inputs: Readonly<Record<string, string>>): string {
  return `<!-- caduceus-playbook-inputs: ${JSON.stringify(inputs).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`;
}

/** The inputs a task body carries, or `undefined` when it has none. */
export function inputsOf(body: string | null | undefined): Record<string, string> | undefined {
  const match = INPUTS.exec(body ?? '');
  if (!match) return undefined;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return undefined;
  }
}

/** The profile a run was started as, the assignee of every stage that names none; `undefined` when the run was started with none. */
export function profileOf(body: string | null | undefined): string | undefined {
  return PROFILE.exec(body ?? '')?.[1];
}

/** The answers a run starts with: each input's default, then what the owner gave. */
export function withDefaults(playbook: Pick<Playbook, 'inputs'>, given: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(playbook.inputs.map((input) => [input.key, (given[input.key] ?? '').trim() === '' ? (input.default ?? '') : given[input.key]]));
}

/** The task body: the filled sections under the Brief's headings, then the inputs. */
export function stageBody(stage: PlaybookStage, answers: Readonly<Record<string, string>>, profile?: string, feedback?: { heading: string; text: string }): string {
  const sections = BRIEF_KEYS.flatMap((key) => {
    const text = fillSection(stage.brief[key] ?? '', answers);
    return text === '' ? [] : [`## ${BRIEF_HEADINGS[key]}\n\n${text}`];
  });
  // A rework says why it is one, in a section of its own after the stage's: the owner's note on a rejection, or why the attempt before it failed.
  if (feedback !== undefined) sections.push(`## ${feedback.heading}\n\n${feedback.text.trim()}`);
  // A deliverable stage says where its work goes: Caduceus keeps what is attached to the task when it is done (the Artifacts store).
  if (stage.deliverable === true) sections.push('## Deliverable\n\nSave your finished work as a file and attach it to this task with `kanban_attach` before you complete the task. Caduceus keeps attached files in Artifacts.');
  return `${sections.join('\n\n')}${sections.length === 0 ? '' : '\n\n'}${inputsComment(answers)}\n${profile === undefined ? '' : `<!-- caduceus-playbook-profile: ${profile} -->\n`}`;
}

export interface StageTaskFields {
  /** The body of the Kanban plugin's `POST /tasks`, plus the fields only `hermes kanban create` takes. */
  fields: Record<string, unknown>;
  /** The stage sets something the REST create body cannot: a worktree branch, a retry limit or a completion contract. */
  cli: boolean;
  /** Set after the task exists, with a PATCH, because the command line cannot say it. */
  reasoningEffort?: string;
}

/** The task a stage attempt makes. `nativeTags` also writes Hermes's own workflow fields, once the installed Hermes accepts them on create. */
export function stageTaskFields(playbook: Pick<Playbook, 'name'>, stage: PlaybookStage, answers: Readonly<Record<string, string>>, { tag, parents, nativeTags, profile, feedback }: { tag: StageTag; parents: readonly string[]; nativeTags: boolean; feedback?: { heading: string; text: string }; /** The profile the run was started as: the assignee of a stage that names none. */ profile?: string }): StageTaskFields {
  const title = fillPlaceholders(stage.title, answers).replace(/\s+/g, ' ').trim().slice(0, 500) || `${playbook.name}: ${stage.key}`;
  const fields: Record<string, unknown> = { title, body: stageBody(stage, answers, profile, feedback), idempotency_key: stageTag(tag) };
  // A gate waits for the owner and is made unassigned in Triage, where Hermes's dispatcher cannot claim it; the engine then moves it to where the owner sees it.
  const assignee = stage.gate === undefined ? (stage.assignee ?? profile) : undefined;
  if (assignee !== undefined) fields.assignee = assignee;
  if (stage.gate !== undefined) fields.triage = true;
  if (stage.priority !== undefined && stage.priority !== 0) fields.priority = stage.priority;
  if (stage.workspace !== undefined) {
    fields.workspace_kind = stage.workspace.kind;
    if (stage.workspace.kind !== 'scratch' && stage.workspace.path !== undefined) fields.workspace_path = stage.workspace.path;
    if (stage.workspace.kind === 'worktree' && stage.workspace.branch !== undefined) fields.branch_name = stage.workspace.branch;
  }
  if (stage.project !== undefined) fields.project_id = stage.project;
  if (parents.length > 0) fields.parents = [...parents];
  const seconds = stage.max_runtime === undefined ? undefined : runtimeSeconds(stage.max_runtime);
  if (seconds !== undefined) fields.max_runtime_seconds = seconds;
  if (stage.skills !== undefined && stage.skills.length > 0) fields.skills = [...stage.skills];
  if (stage.max_retries !== undefined) fields.max_retries = stage.max_retries;
  if (stage.goal_mode === true) {
    fields.goal_mode = true;
    if (stage.goal_max_turns !== undefined) fields.goal_max_turns = stage.goal_max_turns;
  }
  if (stage.model !== undefined) {
    fields.model_override = stage.model;
    if (stage.provider !== undefined) fields.provider_override = stage.provider;
  }
  if (stage.completion_contract !== undefined) fields.completion_contract = stage.completion_contract;
  const cli = fields.branch_name !== undefined || fields.max_retries !== undefined || fields.completion_contract !== undefined;
  if (nativeTags && !cli) {
    fields.workflow_template_id = templateIdOf(tag);
    fields.current_step_key = tag.stage;
  }
  if (stage.reasoning_effort !== undefined && !cli) fields.reasoning_effort = stage.reasoning_effort;
  return { fields, cli, ...(cli && stage.reasoning_effort !== undefined ? { reasoningEffort: stage.reasoning_effort } : {}) };
}
