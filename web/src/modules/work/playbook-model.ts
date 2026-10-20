// What the playbook detail screen shows, free of the DOM and of React (M6 #01; work model §2.3): the kind of a definition, a stage's outgoing
// edges, what the server answers for one definition and for a YAML check, and when the YAML view may save. Nothing here talks to Hermes: the
// server holds the definitions and tells which profiles and skills Hermes does not have.
import { isTemplate, readPlaybook, type EdgeCondition, type Playbook, type TemplateLibrary } from '@caduceus/contracts/playbooks';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { PaletteHit } from '../../module-registry.ts';
import { searchPlaybooks } from './template-model.ts';

export type PlaybookKind = 'seed' | 'template' | 'playbook';

export const KIND_LABEL: Record<PlaybookKind, string> = { seed: 'Seed', template: 'Template', playbook: 'Playbook' };

/** A built-in playbook is a seed; otherwise one stage and no edges is a template, and anything with more is a playbook. */
export function kindOf(playbook: Pick<Playbook, 'stages' | 'edges'>, isSeed: boolean): PlaybookKind {
  if (isSeed) return 'seed';
  return isTemplate(playbook) ? 'template' : 'playbook';
}

/** What a condition says on the screen. */
export const WHEN_LABEL: Record<EdgeCondition, string> = {
  on_done: 'When it is done',
  on_fail: 'When it fails',
  on_approve: 'When it is approved',
  on_reject: 'When it is rejected',
  always: 'Always',
};

export interface OutgoingEdge {
  when: EdgeCondition;
  /** The key of the stage it leads to. */
  to: string;
  /** That stage's title (its key if no stage has it). */
  title: string;
}

/** The edges that leave a stage, in the order the definition writes them, each with the title of the stage it leads to. */
export function outgoingEdges(playbook: Pick<Playbook, 'stages' | 'edges'>, stageKey: string): OutgoingEdge[] {
  return playbook.edges.filter((edge) => edge.from === stageKey).map(({ when, to }) => ({ when, to, title: playbook.stages.find((stage) => stage.key === to)?.title ?? to }));
}

/** What a server answer for a stage says about it: Hermes does not have the profile or the skill it names. */
export interface PlaybookWarning {
  /** The key of the stage. */
  stage: string;
  message: string;
  line?: number;
}

/** What `GET /_caduceus/api/work/playbooks/:id` answers. */
export interface PlaybookDetailData {
  playbook: Playbook;
  yaml: string;
  seed: boolean;
  /** Every version there is, the newest last or first as the server lists them; the screen sorts them. */
  versions: number[];
  warnings: PlaybookWarning[];
}

/** One problem the YAML check found: on a line when it could say where. */
export interface YamlProblem {
  line?: number;
  message: string;
}

export interface YamlCheck {
  errors: YamlProblem[];
  warnings: PlaybookWarning[];
}

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

function warningsOf(value: unknown): PlaybookWarning[] {
  return (Array.isArray(value) ? value : []).flatMap((item): PlaybookWarning[] =>
    isRecord(item) && typeof item.stage === 'string' && typeof item.message === 'string' ? [{ stage: item.stage, message: item.message, ...(whole(item.line) ? { line: item.line } : {}) }] : [],
  );
}

/** The server's answer for one definition, or `undefined` when it is not one (the page never trusts a shape it was not given). */
export function readDetail(body: unknown): PlaybookDetailData | undefined {
  if (!isRecord(body) || typeof body.yaml !== 'string') return undefined;
  const playbook = readPlaybook(body.playbook).playbook;
  if (playbook === undefined) return undefined;
  const versions = (Array.isArray(body.versions) ? body.versions : []).filter(whole);
  return { playbook, yaml: body.yaml, seed: body.seed === true, versions: versions.length > 0 ? versions : [playbook.version], warnings: warningsOf(body.warnings) };
}

/** The server's answer to a YAML check. */
export function readCheck(body: unknown): YamlCheck | undefined {
  if (!isRecord(body) || !Array.isArray(body.errors)) return undefined;
  const errors = body.errors.flatMap((item): YamlProblem[] => (isRecord(item) && typeof item.message === 'string' ? [{ message: item.message, ...(whole(item.line) ? { line: item.line } : {}) }] : []));
  return { errors, warnings: warningsOf(body.warnings) };
}

export interface YamlNote {
  tone: 'danger' | 'warning';
  line?: number;
  message: string;
}

const byLine = (a: { line?: number }, b: { line?: number }) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);

/** What shows under the YAML editor: the errors, then the warnings, each group by line (what has no line last). `Array.prototype.sort` is stable. */
export function yamlNotes(check: YamlCheck): YamlNote[] {
  return [
    ...[...check.errors].sort(byLine).map((error): YamlNote => ({ tone: 'danger', ...error })),
    ...[...check.warnings].sort(byLine).map((warning): YamlNote => ({ tone: 'warning', message: warning.message, ...(warning.line === undefined ? {} : { line: warning.line }) })),
  ];
}

export interface SaveState {
  seed: boolean;
  /** The version on screen is not the newest. */
  older: boolean;
  /** The text is not what the version holds. */
  changed: boolean;
  /** The check the server made of the text on screen; `undefined` while it has not answered for this text. */
  check: YamlCheck | undefined;
}

/** Why the YAML view cannot save now, in words, or `undefined` when it can. */
export function saveBlock({ seed, older, changed, check }: SaveState): string | undefined {
  if (seed) return 'This is a built-in playbook, which cannot be changed. Duplicate it to make one you can edit.';
  if (older) return 'This is an older version. Open the newest version to edit it.';
  if (!changed) return 'Nothing has changed yet.';
  if (check === undefined) return 'Checking the YAML…';
  if (check.errors.length > 0) return check.errors.length === 1 ? 'Fix the problem under the editor first.' : `Fix the ${check.errors.length} problems under the editor first.`;
  return undefined;
}

/** The text a line number starts at in `text` (0-based offset), for putting the cursor on a problem; the end of the text for a line it does not have. */
export function offsetOfLine(text: string, line: number): number {
  let offset = 0;
  for (let at = 1; at < line; at++) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

/** The most playbooks the palette lists for one query. */
const PALETTE_HITS = 8;

/** The palette's hits for what was typed: the library's definitions (seeds too) whose name or description has every word, each opening its detail page. */
export function playbookHits(library: Pick<TemplateLibrary, 'templates' | 'seeds'>, query: string): PaletteHit[] {
  const named = (playbook: Playbook) => ({ playbook, name: playbook.name, description: playbook.description, inputs: [], stages: [] });
  const seeds = new Set(library.seeds.map((playbook) => playbook.id));
  return searchPlaybooks([...library.templates, ...library.seeds].map(named), query)
    .slice(0, PALETTE_HITS)
    .map(({ playbook }): PaletteHit => {
      const kind = kindOf(playbook, seeds.has(playbook.id));
      const stages = playbook.stages.length === 1 ? '1 stage' : `${playbook.stages.length} stages`;
      return { id: playbook.id, label: playbook.name, sub: `${KIND_LABEL[kind]} · ${stages}${playbook.description ? ` · ${playbook.description}` : ''}`, icon: 'playbook', group: 'Playbooks', path: playbookPath(playbook.id) };
    });
}

/** The address of a definition's detail (`tail` is `/edit` for a template's editor). */
export const playbookPath = (id: string, tail = ''): string => `/work/playbooks/${encodeURIComponent(id)}${tail}`;

/** The address of a run's page; the board is named when it is not the default one, so the page reads the right board. */
export const runPath = (playbookId: string, root: string, board?: string): string => `${playbookPath(playbookId, `/runs/${encodeURIComponent(root)}`)}${board && board !== 'default' ? `?board=${encodeURIComponent(board)}` : ''}`;

/** What a stage with no profile of its own is given: nobody. Hermes's dispatcher leaves an unassigned task for the owner to assign. */
export const DEFAULT_PROFILE_WORDS = 'nobody (left unassigned)';

/** The profiles a run of `playbook` assigns tasks to, in the order the stages first name them: distinct, with “nobody (left unassigned)” for stages that name none. */
export function stageProfiles(playbook: Pick<Playbook, 'stages'>, runAs?: string): string[] {
  const profiles: string[] = [];
  for (const stage of playbook.stages) {
    const profile = stage.assignee ?? runAs ?? DEFAULT_PROFILE_WORDS;
    if (!profiles.includes(profile)) profiles.push(profile);
  }
  return profiles;
}

const listed = (items: readonly string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What the Tier 1 dialog for starting a run says: it names the playbook with its version and the profiles its stages will assign. */
export function runConfirmation(playbook: Pick<Playbook, 'name' | 'version' | 'stages'>, runAs?: string): { title: string; text: string; object: string; confirmLabel: string } {
  const stages = playbook.stages.length === 1 ? '1 stage' : `${playbook.stages.length} stages`;
  const profiles = stageProfiles(playbook, runAs);
  return {
    title: `Run “${playbook.name}”?`,
    text: `This starts a run of “${playbook.name}” version ${playbook.version}: ${stages}, each made as a Kanban task when the one before it ends. The tasks are assigned to ${listed(profiles)}.`,
    object: playbook.name,
    confirmLabel: 'Run',
  };
}
