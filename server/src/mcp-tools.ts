// The tools of the Caduceus MCP server (M4 #11): what an agent may ask of Hermes's projects and sessions through Caduceus. The stdio
// server (`mcp-main.ts`) lists them and `mcp-routes.ts` runs them; the list is the whole of what a registered server can do, so a token
// that leaks reaches these seven calls and nothing else. Each tool is a short sequence of Hermes calls made through the policy, which the
// caller supplies (`HermesCalls`): nothing here talks to Hermes or decides who may. Caduceus keeps nothing of what they return.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** Where Caduceus serves a tool call (`POST <route>/<tool>`), and the header that names the MCP client the call is audited under. */
export const MCP_TOOL_ROUTE = '/_caduceus/mcp/tools';
export const MCP_CLIENT_HEADER = 'x-caduceus-mcp-client';

/** What Hermes or the policy answered a call with: its result, or why there is none. `error` is machine-readable (`error` is its kind). */
export type CallOutcome = { ok: true; result: unknown } | { ok: false; status: number; error: Record<string, unknown> };

/** The two ways a tool reaches Hermes, both through the policy: a gateway method, and a REST route. */
export interface HermesCalls {
  rpc(method: string, params: Record<string, unknown>): Promise<CallOutcome>;
  rest(method: 'GET' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<CallOutcome>;
}

interface Property {
  type: 'string' | 'integer';
  description: string;
  minimum?: number;
  maximum?: number;
}

/** What `tools/list` says about a tool. */
export interface McpToolInfo {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, Property>; required: string[]; additionalProperties: false };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };
}

export interface McpTool extends McpToolInfo {
  run(args: Record<string, unknown>, hermes: HermesCalls): Promise<CallOutcome>;
}

const DEFAULT_PROFILE = 'default';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const PROFILE: Property = { type: 'string', description: `The Hermes profile whose projects and sessions to use. Defaults to "${DEFAULT_PROFILE}".` };
const PROJECT_ID: Property = { type: 'string', description: 'The id of a project, as list_projects gives it.' };
const SESSION_ID: Property = { type: 'string', description: 'The id of a session, as list_sessions gives it.' };

const profileOf = (args: Record<string, unknown>): string => (typeof args.profile === 'string' && args.profile !== '' ? args.profile : DEFAULT_PROFILE);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const failure = (status: number, error: string, message: string): CallOutcome => ({ ok: false, status, error: { error, message } });

/** A project as an agent needs it: the fields it can act on, not the whole record. */
function projectOf(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const folders = Array.isArray(value.folders) ? value.folders.flatMap((folder) => (isRecord(folder) && typeof folder.path === 'string' ? [folder.path] : [])) : [];
  return { id: value.id, name: text(value.name) ?? value.id, folder: text(value.primary_path) ?? null, folders, color: text(value.color) ?? null, archived: value.archived === true };
}

/** The rows of a list `one` can read; an item it cannot read is left out. */
function rows(value: unknown, one: (item: unknown) => Record<string, unknown> | undefined): Record<string, unknown>[] {
  const read: Record<string, unknown>[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const row = one(item);
    if (row) read.push(row);
  }
  return read;
}

const projectsOf = (value: unknown): Record<string, unknown>[] => rows(value, projectOf);

/** A session as an agent needs it. */
function sessionOf(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  return {
    id: value.id,
    title: text(value.title) ?? null,
    source: text(value.source) ?? null,
    started_at: typeof value.started_at === 'number' ? value.started_at : null,
    message_count: typeof value.message_count === 'number' ? value.message_count : null,
    folder: text(value.cwd) ?? null,
  };
}

const sessionsOf = (value: unknown): Record<string, unknown>[] => rows(value, sessionOf);

/** The sessions of a project's tree node: they sit in its repositories' branch groups, so the node is walked, each session once, newest first. */
function treeSessions(node: unknown): Record<string, unknown>[] {
  const found = new Map<string, Record<string, unknown>>();
  const repos = isRecord(node) && Array.isArray(node.repos) ? node.repos : [];
  for (const repo of repos) {
    for (const group of isRecord(repo) && Array.isArray(repo.groups) ? repo.groups : []) {
      for (const session of sessionsOf(isRecord(group) ? group.sessions : undefined)) found.set(String(session.id), session);
    }
  }
  return [...found.values()].sort((a, b) => Number(b.started_at ?? 0) - Number(a.started_at ?? 0));
}

/** Runs `outcome`'s result through `shape`: a failure stays as it is. */
const shaped = (outcome: CallOutcome, shape: (result: Record<string, unknown>) => unknown): CallOutcome => {
  if (!outcome.ok) return outcome;
  return { ok: true, result: shape(isRecord(outcome.result) ? outcome.result : {}) };
};

const projectList = (result: Record<string, unknown>) => ({ projects: projectsOf(result.projects), active_id: text(result.active_id) ?? null });

const info = (name: string, title: string, description: string, properties: Record<string, Property>, required: string[], hint: { read: boolean; destructive?: boolean; idempotent?: boolean }): McpToolInfo => ({
  name,
  title,
  description,
  inputSchema: { type: 'object', properties: { ...properties, profile: PROFILE }, required, additionalProperties: false },
  annotations: { readOnlyHint: hint.read, destructiveHint: hint.destructive ?? false, idempotentHint: hint.idempotent ?? hint.read, openWorldHint: false },
});

export const MCP_TOOLS: readonly McpTool[] = [
  {
    ...info('list_projects', 'List projects', 'Lists the Hermes projects of a profile: id, name, folder, colour and whether it is archived, with the id of the active one.', {}, [], { read: true }),
    async run(args, hermes) {
      return shaped(await hermes.rpc('projects.list', { profile: profileOf(args) }), projectList);
    },
  },
  {
    ...info(
      'create_project',
      'Create a project',
      'Creates a Hermes project that works in a folder on this computer. Caduceus audits the call under the name of the agent that made it.',
      { name: { type: 'string', description: 'The name of the project.' }, folder: { type: 'string', description: 'The absolute path of the folder the project works in.' }, color: { type: 'string', description: 'A colour name or value for the project (optional).' } },
      ['name', 'folder'],
      { read: false },
    ),
    async run(args, hermes) {
      const folder = String(args.folder);
      const colour = text(args.color);
      const outcome = await hermes.rpc('projects.create', { profile: profileOf(args), name: String(args.name), folders: [folder], primary_path: folder, ...(colour ? { color: colour } : {}) });
      return shaped(outcome, (result) => ({ project: projectOf(result.project) ?? null }));
    },
  },
  {
    ...info('rename_project', 'Rename a project', 'Gives a Hermes project a new name.', { project_id: PROJECT_ID, name: { type: 'string', description: 'The new name.' } }, ['project_id', 'name'], { read: false, idempotent: true }),
    async run(args, hermes) {
      const outcome = await hermes.rpc('projects.update', { profile: profileOf(args), id: String(args.project_id), name: String(args.name) });
      return shaped(outcome, (result) => ({ project: projectOf(result.project) ?? null }));
    },
  },
  {
    ...info(
      'delete_project',
      'Delete a project',
      'Deletes a Hermes project (its sessions and folders stay). Deleting needs the owner’s passkey confirmation, which an MCP server cannot give: the call is refused with the reason `step-up-required` and the owner deletes it in Caduceus.',
      { project_id: PROJECT_ID },
      ['project_id'],
      { read: false, destructive: true, idempotent: true },
    ),
    async run(args, hermes) {
      return shaped(await hermes.rpc('projects.delete', { profile: profileOf(args), id: String(args.project_id) }), projectList);
    },
  },
  {
    ...info(
      'list_sessions',
      'List sessions',
      `Lists the newest sessions of a profile (up to ${MAX_LIMIT}), or the sessions of one project: id, title, source, start time and message count.`,
      {
        project_id: { ...PROJECT_ID, description: 'Only the sessions of this project (optional).' },
        limit: { type: 'integer', description: `How many sessions (default ${DEFAULT_LIMIT}).`, minimum: 1, maximum: MAX_LIMIT },
      },
      [],
      { read: true },
    ),
    async run(args, hermes) {
      const profile = profileOf(args);
      const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;
      const project = text(args.project_id);
      if (project) {
        const outcome = await hermes.rpc('projects.project_sessions', { profile, project_id: project, session_limit: limit });
        return shaped(outcome, (result) => ({ sessions: treeSessions(result.project).slice(0, limit) }));
      }
      const outcome = await hermes.rest('GET', `/api/sessions?${new URLSearchParams({ profile, limit: String(limit) })}`);
      return shaped(outcome, (result) => ({ sessions: sessionsOf(result.sessions) }));
    },
  },
  {
    ...info('rename_session', 'Rename a session', 'Gives a Hermes session a new title.', { session_id: SESSION_ID, title: { type: 'string', description: 'The new title.' } }, ['session_id', 'title'], { read: false, idempotent: true }),
    async run(args, hermes) {
      const outcome = await hermes.rest('PATCH', `/api/sessions/${encodeURIComponent(String(args.session_id))}`, { title: String(args.title), profile: profileOf(args) });
      return shaped(outcome, (result) => ({ title: text(result.title) ?? String(args.title) }));
    },
  },
  {
    ...info(
      'move_session',
      'Move a session to a project',
      'Moves a session into a project: from its next message on, Hermes works in the project’s folder.',
      { session_id: SESSION_ID, project_id: PROJECT_ID },
      ['session_id', 'project_id'],
      { read: false, idempotent: true },
    ),
    async run(args, hermes) {
      const profile = profileOf(args);
      const projects = await hermes.rpc('projects.list', { profile });
      if (!projects.ok) return projects;
      const project = projectsOf(isRecord(projects.result) ? projects.result.projects : undefined).find((candidate) => candidate.id === args.project_id);
      if (!project) return failure(404, 'project-not-found', `The profile ${profile} has no project ${String(args.project_id)}.`);
      if (typeof project.folder !== 'string') return failure(422, 'project-has-no-folder', `The project ${String(project.name)} has no folder, so there is nowhere to move a session to.`);
      const moved = await hermes.rpc('session.workspace.move', { profile, session_key: String(args.session_id), cwd: project.folder });
      return shaped(moved, (result) => ({ session_id: String(args.session_id), project_id: project.id, folder: text(result.cwd) ?? project.folder }));
    },
  },
];

/** Why `args` is not what the tool's schema asks for, or `undefined` when it is. The schema `tools/list` shows is the one checked. */
export function argumentProblem(tool: McpToolInfo, args: unknown): string | undefined {
  if (!isRecord(args)) return 'The arguments must be an object.';
  const { properties, required } = tool.inputSchema;
  for (const name of Object.keys(args)) if (!Object.hasOwn(properties, name)) return `${name} is not an argument of ${tool.name}.`;
  for (const name of required) if (args[name] === undefined) return `${name} is required.`;
  for (const [name, property] of Object.entries(properties)) {
    const value = args[name];
    if (value === undefined) continue;
    if (property.type === 'string') {
      if (typeof value !== 'string') return `${name} must be a string.`;
      if (value === '' && required.includes(name)) return `${name} is required.`;
    }
    if (property.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${name} must be an integer.`;
      if (value < (property.minimum ?? -Infinity) || value > (property.maximum ?? Infinity)) return `${name} must be between ${property.minimum} and ${property.maximum}.`;
    }
  }
  return undefined;
}

/** The tool of a name. */
export const toolNamed = (name: string): McpTool | undefined => MCP_TOOLS.find((tool) => tool.name === name);
