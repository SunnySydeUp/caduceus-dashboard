// What a template is to the Brief editor, free of the DOM and of React (M3 #08; work model §2.3): the fields a one-stage playbook starts a
// task with once its inputs are answered, and the definition a task's fields are saved as. A template is only ever a way to fill the Brief:
// nothing here talks to Hermes, and what the editor then sends is what it sends for any task.
import { BRIEF_KEYS, fillPlaceholders, MAX_NAME, placeholdersIn, type BriefKey, type Playbook, type PlaybookInput, type PlaybookStage, type PlaybookWorkspace, type TemplateCategory, type TemplateLibrary } from '@caduceus/contracts/playbooks';
import { emptySections, type BriefText } from './brief.ts';
import { newBriefFields, type BriefFields } from './brief-task.ts';
import type { TaskWorkspace } from './create-task-script.ts';

/** The definition a template is saved as: what the server stores, before it gives it an id and a version. */
export type TemplateDraft = Omit<Playbook, 'id' | 'version' | 'edges'>;

/** Answers by input key. */
export type Answers = Record<string, string>;

/** What each answer is when the owner has not typed one: the input's default, or nothing. */
export function initialAnswers(inputs: readonly PlaybookInput[]): Answers {
  return Object.fromEntries(inputs.map((input) => [input.key, input.default ?? '']));
}

/** The required inputs with no answer, by key. */
export function answerProblems(playbook: Pick<Playbook, 'inputs'>, answers: Answers): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const input of playbook.inputs) if (input.required && (answers[input.key] ?? input.default ?? '').trim() === '') problems[input.key] = `Answer “${input.label}”.`;
  return problems;
}

/**
 * A section with its answers in. A line whose placeholder has no answer is left out, so an input the owner skips does not leave
 * “Seen in:” hanging; the rest of the text is as written.
 */
function fillSection(text: string, answers: Answers): string {
  const lines = text.split('\n').filter((line) => placeholdersIn(line).every((key) => (answers[key] ?? '').trim() !== ''));
  return fillPlaceholders(lines.join('\n'), answers).trim();
}

const workspaceOf = (workspace: PlaybookWorkspace | undefined): TaskWorkspace => {
  if (workspace === undefined || workspace.kind === 'scratch') return { kind: 'scratch' };
  if (workspace.kind === 'dir') return { kind: 'dir', path: workspace.path };
  return { kind: 'worktree', ...(workspace.path === undefined ? {} : { path: workspace.path }), ...(workspace.branch === undefined ? {} : { branch: workspace.branch }) };
};

/**
 * The Brief editor's fields for a template's stage. With `answers` the placeholders are filled in, and an input that is not in them has its
 * default (an answer of `''` is "skipped"); without, the text is as the template holds it, placeholders and all, for editing the template.
 */
export function stageFields(playbook: Playbook, answers?: Answers): BriefFields {
  const stage = playbook.stages[0];
  const given = answers === undefined ? undefined : { ...initialAnswers(playbook.inputs), ...answers };
  const text = (value: string) => (given === undefined ? value : fillSection(value, given));
  const sections = emptySections();
  for (const key of BRIEF_KEYS) sections[key] = text(stage.brief[key] ?? '');
  const brief: BriefText = { kind: 'sections', sections };
  return {
    ...newBriefFields(),
    title: given === undefined ? stage.title : fillPlaceholders(stage.title, given).replace(/\s+/g, ' ').trim(),
    brief,
    assignee: stage.assignee ?? '',
    model: stage.model ?? '',
    provider: stage.provider ?? '',
    reasoningEffort: stage.reasoning_effort ?? '',
    skills: [...(stage.skills ?? [])],
    workspace: workspaceOf(stage.workspace),
    project: stage.project ?? '',
    ...(stage.priority === undefined ? {} : { priority: stage.priority }),
    maxRuntime: stage.max_runtime ?? '',
    ...(stage.max_retries === undefined ? {} : { maxRetries: stage.max_retries }),
    goalMode: stage.goal_mode === true,
    ...(stage.goal_max_turns === undefined ? {} : { goalMaxTurns: stage.goal_max_turns }),
    completionContract: stage.completion_contract ?? '',
    parents: [],
  };
}

/** The fields a task starts with when the owner has answered a template's inputs. Nothing has been sent to Hermes. */
export function startFields(playbook: Playbook, answers: Answers): BriefFields {
  return stageFields(playbook, answers);
}

/** The brief's sections as a definition holds them: the filled ones only. A free section is the Goal, whole, so nothing of it is lost. */
function briefOf(brief: BriefText): PlaybookStage['brief'] {
  const result: PlaybookStage['brief'] = {};
  if (brief.kind === 'free') {
    if (brief.text.trim() !== '') result.goal = brief.text;
    return result;
  }
  for (const key of BRIEF_KEYS) if (brief.sections[key].trim() !== '') result[key as BriefKey] = brief.sections[key];
  return result;
}

/** The stage a task's fields are saved as: every field the Brief edits, nothing of the task's run state, and not its links to other tasks. */
export function fieldsStage(fields: BriefFields): PlaybookStage {
  const workspace = fields.workspace;
  return {
    key: 'main',
    title: fields.title.trim(),
    brief: briefOf(fields.brief),
    ...(fields.assignee !== '' ? { assignee: fields.assignee } : {}),
    ...(fields.skills.length > 0 ? { skills: [...fields.skills] } : {}),
    ...(fields.model !== '' ? { model: fields.model } : {}),
    ...(fields.model !== '' && fields.provider !== '' ? { provider: fields.provider } : {}),
    ...(fields.reasoningEffort !== '' ? { reasoning_effort: fields.reasoningEffort } : {}),
    ...(fields.priority !== undefined && fields.priority !== 0 ? { priority: fields.priority } : {}),
    ...(fields.maxRuntime.trim() !== '' ? { max_runtime: fields.maxRuntime.trim() } : {}),
    ...(fields.maxRetries !== undefined ? { max_retries: fields.maxRetries } : {}),
    ...(fields.project !== '' ? { project: fields.project } : {}),
    ...(workspace.kind === 'scratch' ? {} : { workspace }),
    ...(fields.goalMode ? { goal_mode: true as const, ...(fields.goalMaxTurns !== undefined ? { goal_max_turns: fields.goalMaxTurns } : {}) } : {}),
    ...(fields.completionContract.trim() !== '' ? { completion_contract: fields.completionContract.trim() } : {}),
  };
}

/** The inputs a stage's placeholders ask for: each is required, labelled by its key, until the owner words it. */
export function inputsFor(stage: Pick<PlaybookStage, 'title' | 'brief'>, existing: readonly PlaybookInput[] = []): PlaybookInput[] {
  const keys = [...new Set([stage.title, ...BRIEF_KEYS.map((key) => stage.brief[key] ?? '')].flatMap(placeholdersIn))];
  return keys.map((key) => existing.find((input) => input.key === key) ?? { key, label: key, required: true });
}

/**
 * A task's fields as a new template. The placeholders its text already holds (`{{feature}}`) become inputs the template asks for; a
 * task without any makes a template without inputs, which the owner can then edit.
 */
export function templateDraft(fields: BriefFields, { name, category, description }: { name: string; category: string; description?: string }): TemplateDraft {
  const stage = fieldsStage(fields);
  return {
    name: name.trim(),
    ...(description !== undefined && description.trim() !== '' ? { description: description.trim() } : {}),
    category,
    inputs: inputsFor(stage),
    stages: [stage],
  };
}

export interface TemplateGroup {
  /** The category's id; empty for the templates whose category is gone. */
  id: string;
  name: string;
  templates: Playbook[];
}

/** The library as the screens list it: a group for each category in the owner's order (an empty one too, so it can be managed), then Other for any template whose category no longer exists. */
export function groupTemplates(library: Pick<TemplateLibrary, 'categories' | 'templates'>): TemplateGroup[] {
  const groups: TemplateGroup[] = library.categories.map(({ id, name }) => ({ id, name, templates: library.templates.filter((template) => template.category === id) }));
  const strays = library.templates.filter((template) => !library.categories.some((category) => category.id === template.category));
  return strays.length > 0 ? [...groups, { id: '', name: 'Other', templates: strays }] : groups;
}

/** `ids` with `id` one place earlier (`-1`) or later (`1`); at either end it stays. */
export function moveItem(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  return moveItemTo(ids, id, ids[to]);
}

/** `ids` with `id` taken out and put where `target` is (before it when moving up, after it when moving down). */
export function moveItemTo(ids: readonly string[], id: string, target: string): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const rest = ids.filter((entry) => entry !== id);
  rest.splice(to, 0, id);
  return rest;
}

/** The definition of a stored template or playbook without its id and version (the server gives a copy its own), named as a copy and in a category that exists. */
export function duplicateOf(playbook: Playbook, categories: readonly TemplateCategory[]): Omit<Playbook, 'id' | 'version'> {
  const { id: _id, version: _version, ...rest } = playbook;
  const category = categories.some((entry) => entry.id === playbook.category) ? playbook.category : (categories[0]?.id ?? playbook.category);
  return { ...rest, name: `${playbook.name} (copy)`.slice(0, MAX_NAME), category };
}

/**
 * The definitions a search matches: every word of `query` (any case) is in the name, the description, a question's label or a stage's title.
 * No words keeps every definition, in the order given.
 */
export function searchPlaybooks<Item extends Pick<Playbook, 'name' | 'description' | 'inputs' | 'stages'>>(items: readonly Item[], query: string): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const text = [item.name, item.description ?? '', ...item.inputs.map((input) => input.label), ...item.stages.map((stage) => stage.title)].join('\n').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
