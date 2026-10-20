import { isRecord } from './policy/guards.ts';

// The playbook definition (work model §2.3): a Template is a one-stage playbook, and a Playbook has stages joined by edges. Caduceus keeps
// definitions as YAML files under `<Hermes root home>/caduceus/playbooks/<id>.yaml`; this is the shape their parsed form must have. The server
// checks a definition with `readPlaybook` before it writes one and when it reads one, and the web app reads what the server answers with the
// same function, so the two never disagree about what a definition may hold. A one-stage definition without edges reads exactly as it did
// before stages and edges existed (M3 #08); M6 #01 added the edges, the gates and the checks on the graph.
//
// A definition never holds a Hermes field that is not a task field: there is no `tenant` (a category is Caduceus's own grouping, D1) and
// anything the format does not name is refused, so a typo cannot silently become data.

/** The Brief's sections, by the key a definition uses; the same six as `brief.ts`. */
export const BRIEF_KEYS = ['goal', 'context', 'references', 'constraints', 'expected', 'scope'] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];

/** One question a template asks before it makes a brief: its answer replaces `{{key}}` wherever the key is written. */
export interface PlaybookInput {
  key: string;
  label: string;
  /** A long answer: the form gives it a text area. */
  multiline?: true;
  required?: true;
  default?: string;
}

export type PlaybookWorkspace = { kind: 'scratch' } | { kind: 'dir'; path: string } | { kind: 'worktree'; path?: string; branch?: string };

/** What one stage makes: a task. `title` and the brief sections may hold `{{input}}` placeholders. */
export interface PlaybookStage {
  key: string;
  /** The task's title. */
  title: string;
  brief: Partial<Record<BriefKey, string>>;
  assignee?: string;
  skills?: string[];
  model?: string;
  provider?: string;
  reasoning_effort?: string;
  priority?: number;
  /** `300`, `90s`, `30m`, `2h` or `1d`. */
  max_runtime?: string;
  max_retries?: number;
  project?: string;
  workspace?: PlaybookWorkspace;
  goal_mode?: true;
  goal_max_turns?: number;
  completion_contract?: string;
  /** How many tasks this stage may make in one run (the first try and every rework); a stage that is the way back in a loop must say. */
  max_attempts?: number;
  /** `approval`: the stage's task waits in Kanban's `review` for the owner. `clarify`: it is blocked with `needs_input` until the owner answers. */
  gate?: GateType;
  /** The stage's task ends with a file the owner wants kept: its attachments are captured into Artifacts when the task is done (M6 #05), and its brief says to attach the work. */
  deliverable?: true;
}

export const EDGE_CONDITIONS = ['on_done', 'on_fail', 'on_approve', 'on_reject', 'always'] as const;
export type EdgeCondition = (typeof EDGE_CONDITIONS)[number];

export const GATE_TYPES = ['approval', 'clarify'] as const;
export type GateType = (typeof GATE_TYPES)[number];

/** Where a stage leads: to `to`, when the task of `from` ends the way `when` says. */
export interface PlaybookEdge {
  from: string;
  to: string;
  when: EdgeCondition;
}

/** A playbook; with one stage and no edges it is a template. The first stage is where a run starts. */
export interface Playbook {
  id: string;
  version: number;
  name: string;
  description?: string;
  /** The id of one of the owner's template categories. */
  category: string;
  inputs: PlaybookInput[];
  stages: PlaybookStage[];
  edges: PlaybookEdge[];
}

/** A definition that is one stage with no edges: what the task templates are. */
export const isTemplate = (playbook: Pick<Playbook, 'stages' | 'edges'>): boolean => playbook.stages.length === 1 && playbook.edges.length === 0;

/** The `<id>@<version>` a run is tagged with. */
export const playbookRef = (playbook: Pick<Playbook, 'id' | 'version'>): string => `${playbook.id}@${playbook.version}`;

/**
 * What `GET /_caduceus/api/work/playbooks` answers: the categories in the owner's order, the owner's definitions (templates and playbooks), the
 * seeded playbooks that ship with Caduceus (read-only: duplicate one to change it), and the files that could not be read.
 */
export interface TemplateLibrary {
  categories: TemplateCategory[];
  templates: Playbook[];
  seeds: Playbook[];
  /** One line for each file under `playbooks/` that is not a valid definition (the file is left alone). */
  problems: string[];
}

export interface TemplateCategory {
  id: string;
  name: string;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_NAME = 80;
const MAX_DESCRIPTION = 400;
const MAX_LABEL = 80;
const MAX_TEXT = 20_000;
const MAX_INPUTS = 12;
const MAX_LIST = 20;
export const MAX_STAGES = 40;
const MAX_EDGES = 200;
const WORKSPACE_PATH = /^[/~]/;

/** `{{key}}` or `{{ key }}`: the placeholder of an input. Anything else in double braces is plain text. */
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,31})\s*\}\}/g;

/** The input keys a text asks for, in the order they first appear. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/** `text` with each placeholder replaced by its answer (nothing when it has none). One pass: an answer that looks like a placeholder is left as typed. */
export function fillPlaceholders(text: string, answers: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_, key: string) => answers[key] ?? '');
}

/** The placeholders every text of a stage uses. */
export function stagePlaceholders(stage: Pick<PlaybookStage, 'title' | 'brief'>): string[] {
  return [...new Set([stage.title, ...Object.values(stage.brief)].flatMap((text) => placeholdersIn(text ?? '')))];
}

/** Where in a definition something is: `['stages', 2, 'brief', 'goal']`. */
export type PlaybookPath = readonly (string | number)[];

export type PlaybookReading = { playbook: Playbook; problems?: undefined; where?: undefined } | { playbook?: undefined; problems: string[]; where: PlaybookPath[] };

/** The problems found so far, one sentence each, and where each one is (the YAML view puts a problem on its line). */
class Found {
  readonly problems: string[] = [];
  readonly where: PlaybookPath[] = [];
  add(path: PlaybookPath, message: string): void {
    this.problems.push(message);
    this.where.push(path);
  }
  get any(): boolean {
    return this.problems.length > 0;
  }
}

const TOP_KEYS = ['id', 'version', 'name', 'description', 'category', 'inputs', 'stages', 'edges'];
const INPUT_KEYS = ['key', 'label', 'multiline', 'required', 'default'];
const STAGE_KEYS = ['key', 'title', 'brief', 'assignee', 'skills', 'model', 'provider', 'reasoning_effort', 'priority', 'max_runtime', 'max_retries', 'project', 'workspace', 'goal_mode', 'goal_max_turns', 'completion_contract', 'max_attempts', 'gate', 'deliverable'];
const EDGE_KEYS = ['from', 'to', 'when'];

/** `stages[1].brief.goal` for `['stages', 1, 'brief', 'goal']`. */
const name = (path: PlaybookPath): string => path.map((part, index) => (typeof part === 'number' ? `[${part}]` : index === 0 ? part : `.${part}`)).join('');

function unknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: PlaybookPath, found: Found): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) found.add([...path, key], `${path.length === 0 ? 'playbook' : name(path)}: “${key}” is not part of a playbook definition.`);
}

function text(value: unknown, path: PlaybookPath, max: number, found: Found, { empty = false } = {}): string | undefined {
  if (typeof value !== 'string' || (!empty && value.trim() === '') || value.length > max) {
    found.add(path, `${name(path)} must be ${empty ? 'text' : 'some text'} of at most ${max} characters.`);
    return undefined;
  }
  return value;
}

function whole(value: unknown, path: PlaybookPath, found: Found, min = 1): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    found.add(path, `${name(path)} must be a whole number from ${min}.`);
    return undefined;
  }
  return value;
}

function readInputs(value: unknown, found: Found): PlaybookInput[] {
  if (!Array.isArray(value) || value.length > MAX_INPUTS) {
    found.add(['inputs'], `inputs must be a list of at most ${MAX_INPUTS}.`);
    return [];
  }
  const inputs: PlaybookInput[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const at = ['inputs', index] as const;
    if (!isRecord(entry)) return void found.add(at, `${name(at)} must be an object.`);
    unknownKeys(entry, INPUT_KEYS, at, found);
    const key = typeof entry.key === 'string' && KEY_PATTERN.test(entry.key) ? entry.key : undefined;
    if (key === undefined) found.add([...at, 'key'], `${name(at)}.key must be lower-case letters, digits and _, starting with a letter.`);
    else if (seen.has(key)) found.add([...at, 'key'], `${name(at)}.key: “${key}” is used twice.`);
    else seen.add(key);
    const label = text(entry.label, [...at, 'label'], MAX_LABEL, found);
    const input: PlaybookInput = { key: key ?? '', label: label ?? '' };
    if (entry.multiline !== undefined) entry.multiline === true ? (input.multiline = true) : found.add([...at, 'multiline'], `${name(at)}.multiline must be true when it is there.`);
    if (entry.required !== undefined) entry.required === true ? (input.required = true) : found.add([...at, 'required'], `${name(at)}.required must be true when it is there.`);
    if (entry.default !== undefined) {
      const fallback = text(entry.default, [...at, 'default'], 2000, found, { empty: true });
      if (fallback !== undefined && fallback !== '') input.default = fallback;
    }
    inputs.push(input);
  });
  return inputs;
}

function readWorkspace(value: unknown, at: PlaybookPath, found: Found): PlaybookWorkspace | undefined {
  const where = name(at);
  if (!isRecord(value)) return void found.add(at, `${where} must be an object.`);
  const path = value.path === undefined ? undefined : text(value.path, [...at, 'path'], 1000, found);
  if (path !== undefined && !WORKSPACE_PATH.test(path)) found.add([...at, 'path'], `${where}.path must be a full path.`);
  if (value.kind === 'scratch') {
    unknownKeys(value, ['kind'], at, found);
    return { kind: 'scratch' };
  }
  if (value.kind === 'dir') {
    unknownKeys(value, ['kind', 'path'], at, found);
    if (path === undefined) found.add(at, `${where}.path is needed for a directory.`);
    return { kind: 'dir', path: path ?? '' };
  }
  if (value.kind === 'worktree') {
    unknownKeys(value, ['kind', 'path', 'branch'], at, found);
    const branch = value.branch === undefined ? undefined : text(value.branch, [...at, 'branch'], 200, found);
    return { kind: 'worktree', ...(path === undefined ? {} : { path }), ...(branch === undefined ? {} : { branch }) };
  }
  found.add([...at, 'kind'], `${where}.kind must be scratch, dir or worktree.`);
  return undefined;
}

function readStage(value: unknown, index: number, inputKeys: ReadonlySet<string>, found: Found): PlaybookStage {
  const at = ['stages', index] as const;
  const where = name(at);
  const stage: PlaybookStage = { key: 'main', title: '', brief: {} };
  if (!isRecord(value)) {
    found.add(at, `${where} must be an object.`);
    return stage;
  }
  unknownKeys(value, STAGE_KEYS, at, found);
  if (typeof value.key !== 'string' || !KEY_PATTERN.test(value.key)) found.add([...at, 'key'], `${where}.key must be lower-case letters, digits and _, starting with a letter.`);
  else stage.key = value.key;
  const title = text(value.title, [...at, 'title'], 200, found);
  if (title !== undefined) stage.title = title;
  if (value.brief !== undefined) {
    if (!isRecord(value.brief)) found.add([...at, 'brief'], `${where}.brief must be an object.`);
    else {
      unknownKeys(value.brief, BRIEF_KEYS, [...at, 'brief'], found);
      for (const key of BRIEF_KEYS) {
        if (value.brief[key] === undefined) continue;
        const section = text(value.brief[key], [...at, 'brief', key], MAX_TEXT, found, { empty: true });
        if (section !== undefined && section.trim() !== '') stage.brief[key] = section;
      }
    }
  }
  for (const key of ['assignee', 'model', 'provider', 'reasoning_effort', 'max_runtime', 'project', 'completion_contract'] as const) {
    if (value[key] === undefined) continue;
    const entry = text(value[key], [...at, key], 300, found);
    if (entry !== undefined) stage[key] = entry;
  }
  if (value.skills !== undefined) {
    if (!Array.isArray(value.skills) || value.skills.length > MAX_LIST || value.skills.some((skill) => typeof skill !== 'string' || skill.trim() === '' || skill.length > 128)) found.add([...at, 'skills'], `${where}.skills must be a list of at most ${MAX_LIST} skill names.`);
    else stage.skills = value.skills as string[];
  }
  if (value.priority !== undefined) {
    if (typeof value.priority === 'number' && Number.isInteger(value.priority)) stage.priority = value.priority;
    else found.add([...at, 'priority'], `${where}.priority must be a whole number.`);
  }
  for (const key of ['max_retries', 'goal_max_turns', 'max_attempts'] as const) {
    if (value[key] === undefined) continue;
    const entry = whole(value[key], [...at, key], found);
    if (entry !== undefined) stage[key] = entry;
  }
  if (value.goal_mode !== undefined) value.goal_mode === true ? (stage.goal_mode = true) : found.add([...at, 'goal_mode'], `${where}.goal_mode must be true when it is there.`);
  if (value.deliverable !== undefined) value.deliverable === true ? (stage.deliverable = true) : found.add([...at, 'deliverable'], `${where}.deliverable must be true when it is there.`);
  if (value.gate !== undefined) {
    const gate = GATE_TYPES.find((type) => type === value.gate);
    if (gate === undefined) found.add([...at, 'gate'], `${where}.gate must be ${GATE_TYPES.join(' or ')}.`);
    else stage.gate = gate;
  }
  if (value.workspace !== undefined) {
    const workspace = readWorkspace(value.workspace, [...at, 'workspace'], found);
    if (workspace !== undefined) stage.workspace = workspace;
  }
  for (const key of stagePlaceholders(stage)) if (!inputKeys.has(key)) found.add(at, `The stage “${stage.key}” uses {{${key}}}, but no input is called “${key}”.`);
  return stage;
}

/** What each kind of stage may lead on: an approval gate decides, any other stage ends well or badly. */
const EDGES_OF_GATE: readonly EdgeCondition[] = ['on_approve', 'on_reject', 'always'];
const EDGES_OF_WORK: readonly EdgeCondition[] = ['on_done', 'on_fail', 'always'];

function readEdges(value: unknown, stages: readonly PlaybookStage[], found: Found): PlaybookEdge[] {
  if (!Array.isArray(value) || value.length > MAX_EDGES) {
    found.add(['edges'], `edges must be a list of at most ${MAX_EDGES}.`);
    return [];
  }
  const edges: PlaybookEdge[] = [];
  const seen = new Set<string>();
  const stageOf = (key: string) => stages.find((stage) => stage.key === key);
  value.forEach((entry, index) => {
    const at = ['edges', index] as const;
    if (!isRecord(entry)) return void found.add(at, `${name(at)} must be an object.`);
    unknownKeys(entry, EDGE_KEYS, at, found);
    const ends = (['from', 'to'] as const).map((side) => {
      const key = entry[side];
      if (typeof key !== 'string') return void found.add([...at, side], `${name(at)}.${side} must name a stage.`);
      if (stageOf(key) === undefined) return void found.add([...at, side], `${name(at)}.${side}: there is no stage “${key}”.`);
      return key;
    });
    const when = entry.when === undefined ? 'on_done' : EDGE_CONDITIONS.find((condition) => condition === entry.when);
    if (when === undefined) found.add([...at, 'when'], `${name(at)}.when must be one of ${EDGE_CONDITIONS.join(', ')}.`);
    const [from, to] = ends;
    if (from === undefined || to === undefined || when === undefined) return;
    const gate = stageOf(from)?.gate === 'approval';
    if (!(gate ? EDGES_OF_GATE : EDGES_OF_WORK).includes(when)) {
      found.add([...at, 'when'], gate ? `${name(at)}: “${from}” is an approval gate, so it leads on on_approve, on_reject or always, not ${when}.` : `${name(at)}: “${from}” is not an approval gate, so it leads on on_done, on_fail or always, not ${when}.`);
      return;
    }
    const id = `${from}\u0000${to}\u0000${when}`;
    if (seen.has(id)) return void found.add(at, `${name(at)}: “${from}” already leads to “${to}” on ${when}.`);
    seen.add(id);
    edges.push({ from, to, when });
  });
  return edges;
}

/** The stages the first stage reaches by following edges. */
function reachableFromFirst(first: string, edges: readonly PlaybookEdge[]): Set<string> {
  const reached = new Set([first]);
  const queue = [first];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    for (const edge of edges) {
      if (edge.from !== key || reached.has(edge.to)) continue;
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  return reached;
}

/** The edges that lead back to a stage already on the way from the first stage (a depth-first walk in the order the edges are written), by index. */
function loopEdges(first: string, edges: readonly PlaybookEdge[]): number[] {
  const back: number[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>();
  const walk = (key: string): void => {
    onPath.add(key);
    edges.forEach((edge, index) => {
      if (edge.from !== key) return;
      if (onPath.has(edge.to)) back.push(index);
      else if (!done.has(edge.to)) walk(edge.to);
    });
    onPath.delete(key);
    done.add(key);
  };
  walk(first);
  return back;
}

/** The graph's own rules: every stage can be reached from the first, and a loop is bounded by `max_attempts` on the stage it comes back to. */
function checkGraph(stages: readonly PlaybookStage[], edges: readonly PlaybookEdge[], found: Found): void {
  if (stages.length === 0) return;
  const first = stages[0].key;
  const reached = reachableFromFirst(first, edges);
  stages.forEach((stage, index) => {
    if (!reached.has(stage.key)) found.add(['stages', index], `stages[${index}]: “${stage.key}” cannot be reached from the first stage “${first}”.`);
  });
  const reported = new Set<string>();
  for (const index of loopEdges(first, edges)) {
    const target = stages.findIndex((stage) => stage.key === edges[index].to);
    if (stages[target].max_attempts !== undefined || reported.has(edges[index].to)) continue;
    reported.add(edges[index].to);
    found.add(['stages', target], `stages[${target}]: “${edges[index].to}” is where edges[${index}] loops back to, so it needs max_attempts (how many tries the loop may make).`);
  }
}

/**
 * The playbook `value` holds, or the problems with it, one sentence each (and where each is, for the YAML view). One stage and no edges is a
 * template; more stages need edges that name them, can all be reached from the first, and bound every loop with `max_attempts`. Unknown keys,
 * wrong types, a placeholder with no input and a repeated input are all refused.
 */
export function readPlaybook(value: unknown): PlaybookReading {
  if (!isRecord(value)) return { problems: ['A playbook must be an object.'], where: [[]] };
  const found = new Found();
  unknownKeys(value, TOP_KEYS, [], found);
  const id = typeof value.id === 'string' && ID_PATTERN.test(value.id) ? value.id : undefined;
  if (id === undefined) found.add(['id'], 'id must be lower-case letters, digits and -.');
  const version = whole(value.version, ['version'], found);
  const title = text(value.name, ['name'], MAX_NAME, found);
  const description = value.description === undefined ? undefined : text(value.description, ['description'], MAX_DESCRIPTION, found, { empty: true });
  const category = typeof value.category === 'string' && ID_PATTERN.test(value.category) ? value.category : undefined;
  if (category === undefined) found.add(['category'], 'category must be the id of a category.');
  const inputs = readInputs(value.inputs ?? [], found);
  const inputKeys = new Set(inputs.map((input) => input.key));
  const stages: PlaybookStage[] = [];
  if (!Array.isArray(value.stages) || value.stages.length === 0 || value.stages.length > MAX_STAGES) found.add(['stages'], `stages must be a list of 1 to ${MAX_STAGES} stages.`);
  else {
    value.stages.forEach((entry, index) => stages.push(readStage(entry, index, inputKeys, found)));
    const seen = new Set<string>();
    stages.forEach((stage, index) => {
      if (seen.has(stage.key)) found.add(['stages', index, 'key'], `stages[${index}].key: “${stage.key}” is used twice.`);
      seen.add(stage.key);
    });
  }
  const edges = readEdges(value.edges ?? [], stages, found);
  if (!found.any) checkGraph(stages, edges, found);
  if (found.any || id === undefined || version === undefined || title === undefined || category === undefined) return { problems: found.problems, where: found.where };
  return { playbook: { id, version, name: title.trim(), ...(description === undefined || description.trim() === '' ? {} : { description: description.trim() }), category, inputs, stages, edges } };
}

/** The headings the Brief writes into a task body, by the key a definition uses (work model §2.1; the same as `brief.ts`). */
export const BRIEF_HEADINGS: Readonly<Record<BriefKey, string>> = {
  goal: 'Goal',
  context: 'Context',
  references: 'References',
  constraints: 'Constraints',
  expected: 'Expected output',
  scope: 'Scope and safety',
};

/**
 * A section with its answers in. A line whose placeholder has no answer is left out, so an input the owner skips does not leave
 * “Seen in:” hanging; the rest of the text is as written.
 */
export function fillSection(sectionText: string, answers: Readonly<Record<string, string>>): string {
  const lines = sectionText.split('\n').filter((line) => placeholdersIn(line).every((key) => (answers[key] ?? '').trim() !== ''));
  return fillPlaceholders(lines.join('\n'), answers).trim();
}

/** `300`, `90s`, `30m`, `2h` or `1d` as seconds; nothing for anything else. */
export function runtimeSeconds(text: string): number | undefined {
  const match = /^([1-9][0-9]{0,8})\s*([smhd]?)$/.exec(text.trim());
  if (!match) return undefined;
  return Number(match[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86_400 }[match[2]] ?? 1);
}
