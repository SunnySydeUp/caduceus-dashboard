// What the schedule builder knows, free of the DOM and of React: a job as the form holds it, what is wrong with it, the requests that make
// or change it in Hermes (so the policy can be asked about them and a test can send them), and Hermes's blueprints. Nothing here is stored.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { SCRIPT_FILE_NAME } from '@caduceus/contracts/script-files';
import { createTaskScript, scriptFileName, type TaskFields, type TaskWorkspace } from './create-task-script.ts';
import type { JobRequest } from './job-actions.ts';
import { scheduleDraftOf, scheduleProblem, scheduleSpec, type ScheduleDraft } from './schedule-spec.ts';
import type { Job } from './schedules-model.ts';

export type FormJobType = 'agent' | 'script' | 'task' | 'blueprint';

/** The job types the builder makes, as it names them. */
export const FORM_TYPES: Record<FormJobType, { label: string; detail: string }> = {
  agent: { label: 'Agent prompt', detail: 'An agent answers a prompt on schedule, with the model and skills you choose.' },
  script: { label: 'Script', detail: 'Runs a script you write on schedule. Its output is the result, or it goes to an agent as context for a prompt.' },
  task: { label: 'Create task', detail: 'Puts a new task on the board on schedule, for a profile to work.' },
  blueprint: { label: 'Blueprint', detail: 'Starts from one of Hermes’s ready-made automations and asks only what it needs.' },
};

/** The script of a Script job: a file in the profile's `scripts/` folder, and what runs it. */
export interface ScriptDraft {
  /** The file's name: a plain file name; `.sh` and `.bash` run in bash, anything else in Python. */
  file: string;
  content: string;
  /** `output`: the script runs without an agent and what it prints is delivered as it is. `context`: what it prints goes to an agent as context for the prompt. */
  mode: 'output' | 'context';
}

/** A cheap check that runs before the agent: when its output has not changed since last time, the agent does not run. */
export interface MonitorDraft {
  kind: 'none' | 'script' | 'url';
  /** The address, for `url`; for a script the name and code are `file` and `content` (`value` repeats the name when the job comes from Hermes). */
  value: string;
  file: string;
  content: string;
}

/** The options of a job that no other dashboard shows in full. Each is Hermes's own cron field; its default is that Hermes's own. */
export interface AdvancedDraft {
  monitor: MonitorDraft;
  /** Jobs whose latest output is given to the agent as context: ids, and `self` for the job's own last output. */
  contextFrom: string[];
  /** Where the result goes: Hermes's delivery targets. None is `local`, which saves it and sends it nowhere. */
  deliver: string[];
  /** Where a failure goes, when it is not where the result goes. None is the same as `deliver`. */
  failureDeliver: string[];
  /** Whether the run is attached to the session the job was made in; `default` leaves it to Hermes's own setting. */
  attachToSession: 'default' | 'attach' | 'detach';
  /** The folder the job's tools and scripts run in; empty is Hermes's own choice. */
  workdir: string;
}

/** A job as the form holds it. Each type uses its own part; a part that is not the type’s is kept, so switching type does not lose typing. */
export interface JobDraft {
  type: FormJobType;
  name: string;
  profile: string;
  schedule: ScheduleDraft;
  prompt: string;
  model: string;
  skills: string[];
  script: ScriptDraft;
  advanced: AdvancedDraft;
  task: TaskFields;
  blueprint: { key: string; values: Record<string, string> };
}

export const NO_MONITOR: MonitorDraft = { kind: 'none', value: '', file: '', content: '' };

export function newDraft(type: FormJobType, profile: string): JobDraft {
  return {
    type,
    name: '',
    profile,
    schedule: { mode: 'daily', time: '09:00' },
    prompt: '',
    model: '',
    skills: [],
    script: { file: '', content: '', mode: 'output' },
    advanced: { monitor: NO_MONITOR, contextFrom: [], deliver: [], failureDeliver: [], attachToSession: 'default', workdir: '' },
    task: { title: '', brief: '', assignee: '', triage: false, skills: [], model: '', workspace: { kind: 'scratch' } },
    blueprint: { key: '', values: {} },
  };
}

// --- Blueprints ---

/** One input a blueprint asks for. `time` is HH:MM, `enum` and `weekdays` a choice (`strict`: only those; otherwise they are suggestions), `text` free text. */
export interface BlueprintField {
  name: string;
  type: 'time' | 'enum' | 'text' | 'weekdays';
  label: string;
  default: string;
  options: string[];
  optional: boolean;
  strict: boolean;
  help: string;
}

/** One of Hermes's Automation Blueprints (`GET /api/cron/blueprints`). */
export interface Blueprint {
  key: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  /** Hermes's cron template with `{input}` holes: `{minute} {hour} * * {dow}`. */
  scheduleTemplate: string;
  /** The default schedule in words: "daily at 08:00". */
  scheduleHuman: string;
  fields: BlueprintField[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const FIELD_TYPES = ['time', 'enum', 'text', 'weekdays'];

export function parseBlueprints(body: unknown): Blueprint[] {
  const listed = isRecord(body) && Array.isArray(body.blueprints) ? body.blueprints : [];
  return listed.flatMap((entry): Blueprint[] => {
    if (!isRecord(entry) || text(entry.key) === '' || text(entry.title) === '') return [];
    const fields = (Array.isArray(entry.fields) ? entry.fields : []).flatMap((field): BlueprintField[] => {
      if (!isRecord(field) || text(field.name) === '' || !FIELD_TYPES.includes(text(field.type))) return [];
      return [
        {
          name: field.name as string,
          type: field.type as BlueprintField['type'],
          label: text(field.label) || (field.name as string),
          default: field.default === null || field.default === undefined ? '' : String(field.default),
          options: Array.isArray(field.options) ? field.options.map(String) : [],
          optional: field.optional === true,
          strict: field.strict !== false,
          help: text(field.help),
        },
      ];
    });
    return [
      {
        key: entry.key as string,
        title: entry.title as string,
        description: text(entry.description),
        category: text(entry.category),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
        scheduleTemplate: text(entry.schedule),
        scheduleHuman: text(entry.scheduleHuman),
        fields,
      },
    ];
  });
}

/** The inputs of a blueprint as it starts: each one's default. */
export function blueprintDefaults(blueprint: Blueprint): Record<string, string> {
  return Object.fromEntries(blueprint.fields.map((field) => [field.name, field.default]));
}

/** The blueprints that match every word of the query in their title, description, category or tags. */
export function searchBlueprints(blueprints: readonly Blueprint[], query: string): Blueprint[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return blueprints.filter((blueprint) => {
    const haystack = `${blueprint.title} ${blueprint.description} ${blueprint.category} ${blueprint.tags.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const WEEKDAY_PRESETS: Record<string, string> = { everyday: '*', weekdays: '1-5', weekends: '0,6' };
const DAY_NAMES: Record<string, string> = { sunday: '0', monday: '1', tuesday: '2', wednesday: '3', thursday: '4', friday: '5', saturday: '6' };
const BLUEPRINT_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * When the blueprint fires with these inputs: Hermes's own rule (`cron.blueprint_catalog._resolve_schedule`) for filling the template. Undefined when
 * an input is missing or wrong, which the form says as a problem of that input.
 */
export function blueprintSchedule(blueprint: Blueprint, values: Record<string, string>): string | undefined {
  const given = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
  if (given.schedule) return given.schedule;
  const template = blueprint.scheduleTemplate;
  const fill: Record<string, string> = {};
  if (template.includes('{minute}') || template.includes('{hour}')) {
    const time = BLUEPRINT_TIME.exec((given.time ?? '').trim());
    if (!time) return undefined;
    fill.hour = String(Number(time[1]));
    fill.minute = String(Number(time[2]));
  }
  if (template.includes('{dow}')) {
    if ('recurrence' in given) {
      const preset = WEEKDAY_PRESETS[given.recurrence.toLowerCase()];
      if (preset === undefined) return undefined;
      fill.dow = preset;
    } else if ('day' in given) {
      const day = DAY_NAMES[given.day.toLowerCase()];
      if (day === undefined) return undefined;
      fill.dow = day;
    } else fill.dow = '*';
  }
  if (template.includes('{interval_min}')) {
    if (!/^\d+$/.test((given.interval_min ?? '').trim()) || Number(given.interval_min) <= 0) return undefined;
    fill.interval_min = given.interval_min.trim();
  }
  let missing = false;
  const filled = template.replace(/\{(\w+)\}/g, (hole, name: string) => {
    const value = fill[name] ?? given[name];
    if (value === undefined) missing = true;
    return value ?? hole;
  });
  return missing ? undefined : filled;
}

// --- What is wrong with the form ---

export interface FormContext {
  /** The names of Hermes's profiles. */
  profiles: readonly string[];
  blueprints: readonly Blueprint[];
  now: number;
  /** The owner's IANA time zone. */
  zone: string;
}

/** Problems by the field they belong to: `name`, `profile`, `schedule`, `prompt`, `title`, `assignee`, `priority`, `workspace`, `maxRuntime`, `maxRetries`, `blueprint`, and `value.<input>` for a blueprint's input. */
export type FieldErrors = Record<string, string>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RUNTIME = /^\d+([smhd])?$/;

const unknownProfile = (name: string) => `There is no profile called “${name}”.`;

function workspaceProblem(workspace: TaskWorkspace): string | undefined {
  const path = workspace.kind === 'scratch' ? undefined : workspace.path;
  if (workspace.kind === 'dir' && (path === undefined || path.trim() === '')) return 'Give the folder as a full path, such as /Users/you/project.';
  if (path !== undefined && path !== '' && !/^[/~]/.test(path)) return 'Give the folder as a full path, such as /Users/you/project.';
  return undefined;
}

function taskProblems(task: TaskFields, context: FormContext): FieldErrors {
  const problems: FieldErrors = {};
  if (task.title.trim() === '') problems.title = 'Give the task a title.';
  else if (/[\r\n]/.test(task.title)) problems.title = 'A title is one line.';
  if (task.assignee !== '' && !context.profiles.includes(task.assignee)) problems.assignee = unknownProfile(task.assignee);
  if (task.priority !== undefined && !Number.isInteger(task.priority)) problems.priority = 'Priority is a whole number.';
  if (task.maxRuntime !== undefined && task.maxRuntime !== '' && !RUNTIME.test(task.maxRuntime)) problems.maxRuntime = 'Use seconds (300) or a duration such as 90s, 30m, 2h or 1d.';
  if (task.maxRetries !== undefined && (!Number.isInteger(task.maxRetries) || task.maxRetries < 1)) problems.maxRetries = 'Retries is a whole number from 1.';
  const workspace = workspaceProblem(task.workspace);
  if (workspace) problems.workspace = workspace;
  return problems;
}

function blueprintProblems(draft: JobDraft, context: FormContext): FieldErrors {
  const blueprint = context.blueprints.find((candidate) => candidate.key === draft.blueprint.key);
  if (!blueprint) return { blueprint: `Hermes has no blueprint called “${draft.blueprint.key}”.` };
  const problems: FieldErrors = {};
  for (const field of blueprint.fields) {
    const value = (draft.blueprint.values[field.name] ?? '').trim();
    if (value === '') {
      if (!field.optional) problems[`value.${field.name}`] = `Fill in “${field.label.replace(/\?$/, '')}”.`;
    } else if (field.type === 'time' && !TIME.test(value)) problems[`value.${field.name}`] = 'Use a time such as 08:00.';
    else if ((field.type === 'enum' || field.type === 'weekdays') && field.strict && field.options.length > 0 && !field.options.includes(value)) problems[`value.${field.name}`] = `Choose one of ${field.options.join(', ')}.`;
  }
  return problems;
}

const SCRIPT_FILE_PROBLEM = 'A script file’s name is letters, digits, dots, dashes and underscores, such as report.sh.';

/** What is wrong with a Script job's script and how it runs. The rules are Hermes's: a script that runs without an agent needs a file, and a monitor cannot go with it. */
function scriptProblems(draft: JobDraft): FieldErrors {
  const { script } = draft;
  const problems: FieldErrors = {};
  const file = script.file.trim();
  if (file === '') problems.scriptFile = script.mode === 'output' ? 'A script that runs without an agent needs a script file.' : 'Name the script file, such as report.sh or check.py.';
  else if (!SCRIPT_FILE_NAME.test(file)) problems.scriptFile = SCRIPT_FILE_PROBLEM;
  if (script.content.trim() === '') problems.scriptContent = 'Write the script.';
  if (script.mode === 'context' && draft.prompt.trim() === '') problems.prompt = 'Write the prompt the agent answers with the script’s output.';
  return { ...problems, ...advancedProblems(draft.advanced, script.mode === 'output') };
}

/** What is wrong with the advanced options. `noAgent`: the job runs without an agent, which a monitor cannot go with. */
function advancedProblems(advanced: AdvancedDraft, noAgent: boolean): FieldErrors {
  const problems: FieldErrors = {};
  const { monitor } = advanced;
  if (monitor.kind !== 'none' && noAgent) problems.monitor = 'A monitor decides whether the agent runs, so it cannot go with a script that runs without one. Let the script’s output go to an agent, or take the monitor off.';
  if (monitor.kind === 'script') {
    const file = monitor.file.trim();
    if (file === '') problems.monitorFile = 'Name the monitor script, such as check.sh.';
    else if (!SCRIPT_FILE_NAME.test(file)) problems.monitorFile = SCRIPT_FILE_PROBLEM;
    if (monitor.content.trim() === '') problems.monitorContent = 'Write the monitor script.';
  }
  if (monitor.kind === 'url' && !/^https?:\/\/\S+$/i.test(monitor.value.trim())) problems.monitorUrl = 'Give an address that starts with http:// or https://.';
  if (advanced.workdir.trim() !== '' && !/^[/~]/.test(advanced.workdir.trim())) problems.workdir = 'Give the folder as a full path, such as /Users/you/project.';
  return problems;
}

/** What is wrong with the draft, by field. An empty answer means Hermes can be sent it. */
export function jobProblems(draft: JobDraft, context: FormContext): FieldErrors {
  const problems: FieldErrors = {};
  if (!context.profiles.includes(draft.profile)) problems.profile = unknownProfile(draft.profile);
  if (draft.type === 'blueprint') return { ...problems, ...blueprintProblems(draft, context) };
  if (draft.name.trim() === '') problems.name = 'Give the schedule a name.';
  const schedule = scheduleProblem(draft.schedule, context.now, context.zone);
  if (schedule) problems.schedule = schedule;
  if (draft.type === 'agent') {
    if (draft.prompt.trim() === '') problems.prompt = 'Write the prompt the agent answers.';
    return { ...problems, ...advancedProblems(draft.advanced, false) };
  }
  if (draft.type === 'script') return { ...problems, ...scriptProblems(draft) };
  return { ...problems, ...taskProblems(draft.task, context) };
}

/** The schedule text the draft sends, which the preview is worked out from; undefined while a blueprint's inputs do not make one. */
export function draftSpec(draft: JobDraft, context: Pick<FormContext, 'blueprints' | 'zone'>): string | undefined {
  if (draft.type !== 'blueprint') return scheduleSpec(draft.schedule, context.zone);
  const blueprint = context.blueprints.find((candidate) => candidate.key === draft.blueprint.key);
  return blueprint ? blueprintSchedule(blueprint, draft.blueprint.values) : undefined;
}

// --- Requests ---

/** The homes of Hermes's profiles, by name, from `GET /api/profiles`. Scripts live in a profile's own `scripts/` folder. */
export function parseProfileHomes(body: unknown): Record<string, string> {
  const listed = isRecord(body) && Array.isArray(body.profiles) ? body.profiles : [];
  return Object.fromEntries(listed.flatMap((entry) => (isRecord(entry) && typeof entry.name === 'string' && typeof entry.path === 'string' && entry.path !== '' ? [[entry.name, entry.path]] : [])));
}

/** A script of a Script job or a monitor, saved through the guarded route (`PUT /_caduceus/api/work/scripts`): the name the owner types to confirm, and the request. */
export interface ScriptSave {
  name: string;
  request: JobRequest;
}

/** What saving a job asks of Hermes: the scripts first, then the job, then the options Hermes's create route has no field for. */
export interface JobPlan {
  /** The scripts of a Script job, of a Create-task job and of a monitor. */
  scriptSaves?: ScriptSave[];
  job?: JobRequest;
  /** The updates to send once a new job exists: a monitor, a separate target for failures and attaching to a session cannot be set when Hermes creates a job. */
  after?: Record<string, unknown>;
}

export interface CreateContext {
  zone: string;
  /** A few random characters that keep two Create-task jobs of one name from sharing a script. */
  unique: string;
}

const profileQuery = (profile: string) => `?profile=${encodeURIComponent(profile)}`;

const SCRIPTS_ROUTE = '/_caduceus/api/work/scripts';

const deliverText = (targets: readonly string[]): string => (targets.length === 0 ? 'local' : targets.join(','));

const scriptSave = (profile: string, name: string, content: string): ScriptSave => ({ name, request: { method: 'PUT', path: SCRIPTS_ROUTE, body: { profile, name, content } } });

/** The options Hermes's create route takes, as its body has them; an option left at its default is left out. */
function creatableOptions(advanced: AdvancedDraft): Record<string, unknown> {
  return {
    ...(advanced.deliver.length > 0 ? { deliver: deliverText(advanced.deliver) } : {}),
    ...(advanced.contextFrom.length > 0 ? { context_from: advanced.contextFrom } : {}),
    ...(advanced.workdir.trim() !== '' ? { workdir: advanced.workdir.trim() } : {}),
  };
}

/** The options Hermes's create route ignores, which an update sets once the job exists. */
function laterOptions(advanced: AdvancedDraft): Record<string, unknown> {
  const { monitor } = advanced;
  return {
    ...(monitor.kind === 'script' ? { monitor_script: monitor.file.trim() } : monitor.kind === 'url' ? { monitor_url: monitor.value.trim() } : {}),
    ...(advanced.failureDeliver.length > 0 ? { failure_deliver: deliverText(advanced.failureDeliver) } : {}),
    ...(advanced.attachToSession === 'default' ? {} : { attach_to_session: advanced.attachToSession === 'attach' }),
  };
}

export function createPlan(draft: JobDraft, { zone, unique }: CreateContext): JobPlan & { job: JobRequest } {
  const query = profileQuery(draft.profile);
  if (draft.type === 'blueprint') return { job: { method: 'POST', path: `/api/cron/blueprints/instantiate${query}`, body: { blueprint: draft.blueprint.key, values: draft.blueprint.values } } };
  const name = draft.name.trim();
  const schedule = scheduleSpec(draft.schedule, zone);
  if (draft.type === 'agent' || draft.type === 'script') {
    const script = draft.type === 'script' ? draft.script : undefined;
    const body: Record<string, unknown> = { name, schedule };
    if (script) {
      body.script = script.file.trim();
      if (script.mode === 'output') body.no_agent = true;
    }
    if (!script || script.mode === 'context') {
      body.prompt = draft.prompt;
      if (draft.model.trim() !== '') body.model = draft.model.trim();
      if (draft.skills.length > 0) body.skills = draft.skills;
    }
    Object.assign(body, creatableOptions(draft.advanced));
    const later = laterOptions(draft.advanced);
    const saves = [...(script ? [scriptSave(draft.profile, script.file.trim(), script.content)] : []), ...(draft.advanced.monitor.kind === 'script' ? [scriptSave(draft.profile, draft.advanced.monitor.file.trim(), draft.advanced.monitor.content)] : [])];
    return {
      ...(saves.length > 0 ? { scriptSaves: saves } : {}),
      job: { method: 'POST', path: `/api/cron/jobs${query}`, body },
      ...(Object.keys(later).length > 0 ? { after: later } : {}),
    };
  }
  const file = scriptFileName(name, unique);
  return {
    scriptSaves: [scriptSave(draft.profile, file, createTaskScript(draft.task))],
    job: { method: 'POST', path: `/api/cron/jobs${query}`, body: { name, schedule, script: file, no_agent: true } },
  };
}

// --- Editing ---

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []);
/** Delivery targets as Hermes stores them (`telegram:home,local`); `local` alone is the default and no choice. */
const targetsOf = (value: unknown): string[] => {
  const targets = textOf(value).split(',').map((target) => target.trim()).filter(Boolean);
  return targets.length === 1 && targets[0] === 'local' ? [] : targets;
};

/** The advanced options a job holds, as the form has them. `monitorContent` is the code of its monitor script, when it has one and it was read. */
function advancedOf(config: Record<string, unknown>, monitorContent: string): AdvancedDraft {
  const script = textOf(config.monitor_script);
  const url = textOf(config.monitor_url);
  return {
    monitor: script !== '' ? { kind: 'script', value: script, file: script, content: monitorContent } : url !== '' ? { kind: 'url', value: url, file: '', content: '' } : NO_MONITOR,
    contextFrom: listOf(config.context_from),
    deliver: targetsOf(config.deliver),
    failureDeliver: targetsOf(config.failure_deliver),
    attachToSession: config.attach_to_session === true ? 'attach' : config.attach_to_session === false ? 'detach' : 'default',
    workdir: textOf(config.workdir),
  };
}

/**
 * The draft that edits `job`. A Create-task job needs the fields of its script (`fields`); a Script job needs the code of its script (`scriptContent`) and, when
 * it has a monitor script, that script's code (`monitorContent`).
 */
export function draftOfJob(job: Job, zone: string, fields?: TaskFields, scriptContent = '', monitorContent = ''): JobDraft | undefined {
  const config = job.config;
  const skills = Array.isArray(config.skills) ? config.skills.filter((skill): skill is string => typeof skill === 'string') : typeof config.skill === 'string' && config.skill !== '' ? [config.skill] : [];
  const type: FormJobType = job.type === 'task' ? 'task' : job.type === 'blueprint' ? 'blueprint' : job.type === 'script' ? 'script' : 'agent';
  return {
    ...newDraft(type, job.profile),
    name: job.name,
    schedule: scheduleDraftOf(config.schedule, zone),
    prompt: typeof config.prompt === 'string' ? config.prompt : '',
    model: typeof config.model === 'string' ? config.model : '',
    skills,
    ...(type === 'script' ? { script: { file: textOf(config.script).split('/').pop() ?? '', content: scriptContent, mode: config.no_agent === true ? ('output' as const) : ('context' as const) } } : {}),
    advanced: advancedOf(config, monitorContent),
    ...(fields ? { task: fields } : {}),
  };
}

export interface EditContext {
  zone: string;
  /** The fields the job's script was made from, to tell whether the script needs writing again. */
  original?: TaskFields;
  /** The code of a Script job's script, as it was read, to tell whether it changed. */
  scriptContent?: string;
  /** The code of the monitor script, as it was read. */
  monitorContent?: string;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/** The updates that take the options from `before` to `after`: only what differs, and a default is sent as the value that clears it. */
function advancedUpdates(before: AdvancedDraft, after: AdvancedDraft): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (deliverText(after.deliver) !== deliverText(before.deliver)) updates.deliver = deliverText(after.deliver);
  if (!sameList(after.contextFrom, before.contextFrom)) updates.context_from = after.contextFrom;
  if (deliverText(after.failureDeliver) !== deliverText(before.failureDeliver) || (after.failureDeliver.length === 0) !== (before.failureDeliver.length === 0)) updates.failure_deliver = after.failureDeliver.length === 0 ? '' : deliverText(after.failureDeliver);
  if (after.attachToSession !== before.attachToSession) updates.attach_to_session = after.attachToSession === 'default' ? null : after.attachToSession === 'attach';
  if (after.workdir.trim() !== before.workdir) updates.workdir = after.workdir.trim();
  const was = before.monitor.kind === 'script' ? before.monitor.file : before.monitor.kind === 'url' ? before.monitor.value : '';
  const now = after.monitor.kind === 'script' ? after.monitor.file.trim() : after.monitor.kind === 'url' ? after.monitor.value.trim() : '';
  if (after.monitor.kind !== before.monitor.kind || now !== was) {
    // Hermes holds one monitor source: the one the form no longer has is cleared in the same update.
    if (after.monitor.kind === 'script') updates.monitor_script = now;
    else if (before.monitor.kind === 'script') updates.monitor_script = '';
    if (after.monitor.kind === 'url') updates.monitor_url = now;
    else if (before.monitor.kind === 'url') updates.monitor_url = '';
  }
  return updates;
}

/** What saving the edited draft asks of Hermes, or undefined when nothing changed. Only what changed is sent: a schedule that is sent again starts over. */
export function editPlan(job: Job, draft: JobDraft, { zone, original, scriptContent, monitorContent }: EditContext): JobPlan | undefined {
  const before = draftOfJob(job, zone, original, scriptContent ?? '', monitorContent ?? '');
  if (before === undefined) return undefined;
  const updates: Record<string, unknown> = {};
  if (draft.type !== 'blueprint' && draft.name.trim() !== before.name) updates.name = draft.name.trim();
  if (scheduleSpec(draft.schedule, zone) !== scheduleSpec(before.schedule, zone)) updates.schedule = scheduleSpec(draft.schedule, zone);
  const plan: JobPlan = {};
  if (draft.type === 'task') {
    const script = typeof job.config.script === 'string' ? (job.config.script.split('/').pop() ?? '') : '';
    if (original !== undefined && script !== '' && JSON.stringify(draft.task) !== JSON.stringify(original)) {
      plan.scriptSaves = [scriptSave(job.profile, script, createTaskScript(draft.task))];
    }
  } else {
    if (draft.prompt !== before.prompt) updates.prompt = draft.prompt;
    if (draft.model.trim() !== before.model) updates.model = draft.model.trim();
    if (!sameList(draft.skills, before.skills)) updates.skills = draft.skills;
    if (draft.type === 'script') {
      if (draft.script.mode !== before.script.mode) updates.no_agent = draft.script.mode === 'output';
      if (draft.script.content !== before.script.content) plan.scriptSaves = [scriptSave(job.profile, before.script.file, draft.script.content)];
    }
    Object.assign(updates, advancedUpdates(before.advanced, draft.advanced));
    const { monitor } = draft.advanced;
    if (monitor.kind === 'script' && (monitor.file.trim() !== before.advanced.monitor.file || monitor.content !== before.advanced.monitor.content)) {
      plan.scriptSaves = [...(plan.scriptSaves ?? []), scriptSave(job.profile, monitor.file.trim(), monitor.content)];
    }
  }
  if (Object.keys(updates).length > 0) plan.job = { method: 'PUT', path: `/api/cron/jobs/${encodeURIComponent(job.id)}${profileQuery(job.profile)}`, body: { updates } };
  return plan.scriptSaves || plan.job ? plan : undefined;
}
