// The risk tier of every method, server→client request and event of Hermes's JSON-RPC gateway (`/api/ws`), from the
// pinned OpenRPC contract (`contracts/vendor/hermes-shared/src/gateway-contract.openrpc.json`).
//
// Like the REST table, this one is kept complete by a test against the pin, and anything not in it is denied. Where a
// method's tier depends on its params (`approval.respond` with "always", `config.set`'s key, `cron.manage`'s action…),
// `refine` decides from the params; the base tier is what a caller who names nothing riskier gets.
//
// Tiers follow architecture §5 and `hermes-protocol.md` §10. Denied: shell and CLI execution, the vault, billing and
// subscriptions, peer groups, bot relay and the Nous diagnostics upload, plus what only makes sense on the Mac that
// runs Hermes (its microphone, speaker and clipboard).
import { isRecord } from './guards.ts';
import { DENIED_MESSAGES, stricter, type DeniedReason, type Policy, type Tier } from './tiers.ts';

const denied = (reason: DeniedReason): Policy => ({ tier: 'denied', read: false, reason });
const READ: Policy = { tier: 'T0', read: true };
const T0: Policy = { tier: 'T0', read: false };
const T1: Policy = { tier: 'T1', read: false };
const T1_READ: Policy = { tier: 'T1', read: true };
const T2: Policy = { tier: 'T2', read: false };
const T3: Policy = { tier: 'T3', read: false };

/** The params of a request, as far as the policy reads them. */
export type Params = Record<string, unknown>;

/** What `refine` can answer: a tier at least the base (stricter wins), or a whole new tier and read-ness. */
type Refined = Tier | { tier: Tier; read: boolean };

export interface GatewayMethodPolicy extends Policy {
  /** Lifts (or, for a read variant, lowers) the policy from the params. */
  refine?: (params: Params) => Refined;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * What answering an approval with `choice` costs. Hermes reads a missing choice as a deny, and a deny only ever makes the agent
 * do less, so it is the one answer read-only mode lets through; "always" is a standing permission (T2).
 */
const approvalChoice = (choice: unknown): Refined => {
  const word = text(choice);
  if (word === 'always') return 'T2';
  return word === 'deny' || word === '' ? { tier: 'T0', read: true } : 'T0';
};

/** The words Hermes reads as "off" for a YOLO switch: setting it off only makes the agent ask more, so it needs no step-up. */
const YOLO_OFF = new Set(['0', 'off', 'false', 'no']);

const params = (value: unknown): Params => (isRecord(value) ? value : {});

/** Config keys `config.set` accepts (Hermes's own settable list), and the tier of changing each. Any other key is T3. */
const CONFIG_KEYS: Record<string, Tier> = {
  model: 'T0',
  fast: 'T0',
  busy: 'T0',
  verbose: 'T0',
  focus: 'T0',
  reasoning: 'T0',
  details_mode: 'T0',
  thinking_mode: 'T0',
  density: 'T0',
  battery: 'T0',
  theme: 'T0',
  statusbar: 'T0',
  mouse: 'T0',
  indicator: 'T0',
  'voice.voice_chat_mode': 'T0',
  personality: 'T0',
  skin: 'T0',
  // Where the agent works, and what it may do without asking.
  cwd: 'T1',
  'terminal.cwd': 'T1',
  workdir: 'T1',
  prompt: 'T1',
  approval_mode: 'T2',
  'approvals.mode': 'T2',
  yolo: 'T2',
};

/** The `skills.manage` actions that only look. */
/** The params of `prompt.submit` that cut Hermes's transcript before a message. */
const TRUNCATING = ['truncate_before_row_id', 'truncate_before_user_ordinal', 'truncate_before_message_id', 'confirm_truncate'] as const;

const SKILL_READS: Record<string, true> = { list: true, search: true, browse: true, inspect: true };

const GATEWAY_METHODS_TABLE: Record<string, GatewayMethodPolicy> = {
  // Connection and discovery.
  ping: READ,
  'client.capabilities': READ,
  'gateway.capabilities': READ,
  'commands.catalog': READ,
  'command.resolve': READ,
  'complete.path': READ,
  'complete.slash': READ,
  'system.battery': READ,
  'terminal.resize': READ,
  'setup.status': READ,
  'setup.runtime_check': READ,

  // Chat: sessions and turns.
  'session.create': T0,
  'session.resume': T0,
  'session.activate': T0,
  'session.close': T0,
  'session.branch': T0,
  'session.branch_stored': T0,
  'session.branch_whole': T0,
  // Soft-hide with the messages kept, the same change as renaming or archiving through `PATCH /api/sessions/{id}`.
  'session.archive': T0,
  // Compress replaces the older messages with a summary: it cannot be undone, so the owner confirms it (M1 #08).
  'session.compress': T1,
  'session.control': T0,
  'session.interrupt': T0,
  'session.redirect': T0,
  'session.steer': T0,
  'session.undo': T0,
  'session.save': T0,
  'session.set_hidden': T0,
  // Reads a title, or sets it when it is given one.
  'session.title': { ...READ, refine: (p) => (text(p.title) ? { tier: 'T0', read: false } : { tier: 'T0', read: true }) },
  'session.active_list': READ,
  'session.context_breakdown': READ,
  'session.control.read': READ,
  'session.events.since': READ,
  'session.events.stats': READ,
  'session.foreign.list': READ,
  'session.foreign.preview': READ,
  'session.history': READ,
  'session.list': READ,
  'session.most_recent': READ,
  'session.status': READ,
  'session.usage': READ,
  'session.cwd.set': T1,
  'session.workspace.move': T1,
  'session.foreign.import': T1,
  // Deleting a stored session is T1 (M1 #14), like the REST route.
  'session.delete': T1,
  // A prompt that names a message to cut the transcript before (edit and resend, regenerate; M1 #12) discards what follows it: T1.
  'prompt.submit': { ...T0, refine: (p) => (TRUNCATING.some((field) => p[field] !== undefined && p[field] !== null) ? 'T1' : 'T0') },
  'prompt.btw': T0,
  'prompt.background': T0,
  'message.react': T0,
  'approval.pending': READ,
  'approval.received': T0,
  // "Allow always" is a standing permission: it needs a step-up (architecture §5).
  'approval.respond': { ...T0, refine: (p) => approvalChoice(p.choice) },
  'clarify.lock': T0,
  'request.answer': T0,
  'agents.list': READ,
  'subagent.interrupt': T0,
  'subagent.steer': T0,
  'subagent.list': READ,
  'subagent.tail': READ,
  'spawn_tree.list': READ,
  'spawn_tree.load': READ,
  'spawn_tree.save': T0,
  'delegation.status': READ,
  'delegation.pause': T2,
  'process.list': READ,
  'process.kill': T1,
  'process.stop': T2,
  'insights.get': READ,
  'usage.bars': READ,
  'verification.status': READ,

  // Attachments.
  'file.attach': T0,
  'image.attach': T0,
  'image.attach_bytes': T0,
  'image.detach': T0,
  'paste.collapse': T0,
  'pdf.attach': T0,
  'image.generate': T1,
  'llm.oneshot': T1_READ,

  // Slash commands. By name: see `slashPolicy`.
  'command.dispatch': { ...T0, refine: (p) => slashPolicy(slashInvocation('command.dispatch', p)) },
  'slash.exec': { ...T0, refine: (p) => slashPolicy(slashInvocation('slash.exec', p)) },

  // Configuration and keys.
  'config.get': READ,
  'config.show': READ,
  // A key outside the settable list is T3.
  'config.set': { ...T0, refine: (p) => (text(p.key) === 'yolo' && YOLO_OFF.has(text(p.value).trim().toLowerCase()) ? 'T0' : (CONFIG_KEYS[text(p.key)] ?? 'T3')) },
  'model.options': READ,
  'model.save_key': T2,
  'model.disconnect': T2,
  'reload.env': T1,
  'reload.mcp': T1,
  'tools.list': READ,
  'tools.show': READ,
  'toolsets.list': READ,
  'tools.configure': T1,
  'skills.reload': READ,
  // Installing a skill runs its scripts (T3); the rest only looks.
  'skills.manage': { ...T3, refine: (p) => (SKILL_READS[text(p.action)] ? { tier: 'T0', read: true } : 'T3') },
  'plugins.list': READ,
  'plugins.catalog.lookup': READ,
  'i18n.languages': READ,
  'i18n.catalog': READ,
  // Installing or updating a plugin is git-installed Python (T3); toggling and removing is T1.
  'plugins.manage': {
    ...T1,
    refine: (p) => {
      const action = text(p.action);
      if (action === 'list') return { tier: 'T0', read: true };
      return action === 'install' || action === 'update' ? 'T3' : 'T1';
    },
  },
  'mcp.catalog': READ,
  'mcp.servers.list': READ,
  'mcp.servers.status': READ,
  // A stdio server (a command) or a catalogue preset runs code: T3.
  'mcp.servers.add': { ...T2, refine: (p) => (text(p.preset) || text(params(p.config).command) ? 'T3' : 'T2') },
  'mcp.servers.set_api_key': T2,
  'mcp.servers.remove': T1,
  'mcp.servers.test': T1_READ,
  'mcp.servers.oauth.start': T1,
  'mcp.servers.oauth.callback': T1,
  'mcp.servers.oauth.cancel': T0,
  'mcp.servers.oauth.poll': T0,
  'connectors.list': READ,
  'connectors.operation.status': READ,
  'connectors.operation.wake': T0,
  'connectors.connect': T2,
  'connectors.accounts': READ,
  'connectors.catalog': READ,
  'connectors.tools': READ,
  'connectors.policy.get': READ,
  'connectors.accounts.rename': T1,
  'connectors.accounts.remove': T2,
  'connectors.policy.set': T2,
  'connection.respond': T1,
  'cron.manage': { ...T1, refine: (p) => (text(p.action) === 'list' ? { tier: 'T0', read: true } : 'T1') },
  'learning.detail': READ,
  'learning.frames': READ,
  'learning.edit': T1,
  'learning.delete': T1,
  'free_tier.status': READ,
  'free_tier.ack_notice': T0,
  'free_tier.provision': T1,
  // The Desktop app's browser challenge window and sign-in nudge: there is no such window here.
  'free_tier.challenge_result': denied('not-used'),
  'free_tier.claim_nudge': denied('not-used'),
  'handoff.state': READ,
  'handoff.fail': T0,
  'handoff.request': T1,

  // Profiles and projects.
  'profiles.list': READ,
  'profiles.describe': READ,
  'profiles.get_asset': READ,
  'profiles.set_asset': T0,
  'profiles.create': T1,
  // The editor's Save: soul, model pin, skills, toolsets and MCP servers.
  'profiles.configure': T3,
  'project.facts': READ,
  'projects.list': READ,
  'projects.get': READ,
  'projects.tree': READ,
  'projects.for_cwd': READ,
  'projects.project_sessions': READ,
  'projects.discover_repos': READ,
  'projects.record_repos': T0,
  'projects.create': T1,
  'projects.update': T1,
  'projects.archive': T1,
  'projects.add_folder': T1,
  'projects.remove_folder': T1,
  'projects.set_active': T1,
  'projects.set_primary': T1,
  'projects.delete': T2,

  // Checkpoints and the browser tools.
  'rollback.list': READ,
  'rollback.diff': READ,
  'rollback.restore': T3,
  'browser.manage': T3,

  // Hosted rooms. Peer rooms are denied below.
  'groups.capabilities': READ,
  'groups.list': READ,
  'groups.log': READ,
  'groups.state': READ,
  'groups.replica_state': READ,
  'groups.send': T0,
  'groups.create': T1,
  'groups.rename': T1,
  'groups.stop': T1,
  'groups.retry': T1,
  'groups.approve': T2,
  'groups.disband': T3,

  // Pets: a desktop mascot. Harmless, so classified by what each call does.
  'pet.gallery': READ,
  'pet.generate.status': READ,
  'pet.info': READ,
  'pet.info.meta': READ,
  'pet.cells': READ,
  'pet.thumb': READ,
  'pet.export': READ,
  'pet.cancel': T0,
  'pet.disable': T0,
  'pet.rename': T0,
  'pet.scale': T0,
  'pet.select': T0,
  'pet.generate': T1,
  'pet.hatch': T1,
  'pet.remove': T1,

  // The microphone, speaker and clipboard of the Mac that runs Hermes are not the owner's device.
  'voice.record': denied('host-hardware'),
  'voice.toggle': denied('host-hardware'),
  'voice.tts': denied('host-hardware'),
  'wake.start': denied('host-hardware'),
  'wake.resume': denied('host-hardware'),
  'wake.feed': denied('host-hardware'),
  'wake.status': READ,
  'wake.stop': T0,
  'wake.pause': T0,
  'clipboard.paste': denied('host-hardware'),
  'input.detect_drop': denied('not-used'),
  'preview.restart': denied('not-used'),
  'browser.controller.register': denied('not-used'),
  'browser.controller.detach': denied('not-used'),
  'browser.controller.heartbeat': denied('not-used'),
  'browser.controller.result': denied('not-used'),

  // Denied in v1 (architecture §5).
  'shell.exec': denied('shell-exec'),
  'cli.exec': denied('cli-exec'),
  'diagnostics.share_nous': denied('debug-upload'),
  'vault.add': denied('vault'),
  'vault.list': denied('vault'),
  'vault.lock': denied('vault'),
  'vault.remove': denied('vault'),
  'vault.source.set': denied('vault'),
  'vault.sources': denied('vault'),
  'vault.unlock': denied('vault'),
  'billing.auto_reload': denied('billing'),
  'billing.charge': denied('billing'),
  'billing.charge_status': denied('billing'),
  'billing.state': denied('billing'),
  'billing.step_up': denied('billing'),
  'subscription.change': denied('billing'),
  'subscription.preview': denied('billing'),
  'subscription.resume': denied('billing'),
  'subscription.state': denied('billing'),
  'subscription.upgrade': denied('billing'),
  'groups.peer.invite': denied('peer-groups'),
  'groups.peer.register': denied('peer-groups'),
  'groups.peer.revoke': denied('peer-groups'),
  'groups.promote': denied('peer-groups'),
  'groups.demote': denied('peer-groups'),
  'groups.replicate': denied('peer-groups'),
  'bot_relay.deliver': denied('bot-relay'),
  'bot_relay.outbox.drain': denied('bot-relay'),
  'bot_relay.reply': denied('bot-relay'),
  'bot_relay.roster.sync': denied('bot-relay'),
  // The Desktop app's first-run chat and the facts it reads about the Mac it runs on. Caduceus has its own setup wizard (M5 #16).
  'onboarding.state': denied('not-used'),
  'onboarding.start': denied('not-used'),
  'onboarding.skip': denied('not-used'),
  'onboarding.set_run': denied('not-used'),
  'machine.facts': denied('not-used'),
  // The Bot Screen (a virtual desktop on the machine that runs Hermes, with package installs through sudo): Caduceus has no screen for it.
  'display.status': denied('not-used'),
  'display.thumbnail': denied('not-used'),
  'display.observe': denied('not-used'),
  'display.start': denied('not-used'),
  'display.stop': denied('not-used'),
  'display.install': denied('not-used'),
  'display.switchSandboxImage': denied('not-used'),
  'display.lease.acquire': denied('not-used'),
  'display.lease.release': denied('not-used'),
  // Usage metrics for Nous. What is on is read and changed (T2) only on a screen for it; the Desktop app's own counters are never sent from here.
  'shared_metrics.status': READ,
  'shared_metrics.set': T2,
  'shared_metrics.desktop_daily': denied('not-used'),
  'shared_metrics.desktop_dislike': denied('not-used'),
  'shared_metrics.desktop_feature_use': denied('not-used'),
  'shared_metrics.desktop_friction': denied('not-used'),
  'shared_metrics.desktop_onboarding': denied('not-used'),
  'shared_metrics.slash_command': denied('not-used'),
  'shared_metrics.startup_latency': denied('not-used'),
  'shared_metrics.update_run': denied('not-used'),
};

/**
 * Hermes's built-in slash commands (0.22.2) that change Hermes itself or reach outside the session. The same jobs have
 * screens with their own tiers; run as a slash command they would skip them, so they are denied here.
 */
const SLASH_DENIED: Record<string, true> = {
  update: true,
  debug: true,
  import: true,
  export: true,
  login: true,
  subscription: true,
  suggestions: true,
  quit: true,
  kanban: true,
  'codex-runtime': true,
  topup: true,
  restart: true,
  plugins: true,
  skills: true,
  cron: true,
  blueprint: true,
  snapshot: true,
  browser: true,
  curator: true,
  worktree: true,
  tools: true,
  hatch: true,
  pet: true,
  wake: true,
  voice: true,
  // Turns on the automatic deletion of old sessions (0.22): a setting of Hermes's own, changed on its screen.
  autoprune: true,
};

/** Slash commands that change what the agent may do or stop work: a step-up, like their screens. */
const SLASH_T2: Record<string, true> = {
  yolo: true,
  approvals: true,
  stop: true,
  pause: true,
  rollback: true,
  reload: true,
  'reload-mcp': true,
  memory: true,
  handoff: true,
  init: true,
  learn: true,
};

/**
 * The characters Python's `str.split()`, `str.strip()` and `str.isspace()` treat as white space: Hermes reads a command
 * with those, and JS's `\s` differs (it has U+FEFF but not U+001C–U+001F or U+0085).
 */
const PYTHON_SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PYTHON_SPACES = new RegExp(`[${PYTHON_SPACE}]+`);
const PYTHON_EDGE_SPACES = new RegExp(`^[${PYTHON_SPACE}]+|[${PYTHON_SPACE}]+$`, 'g');
/** A name Hermes could not have resolved the way this reads it: a slash, white space or a control character left inside. */
const NOT_A_NAME = new RegExp(`[/\\x00-\\x1f\\x7f${PYTHON_SPACE}]`);

/** Python's `str.strip()`. */
const pythonStrip = (value: string): string => value.replace(PYTHON_EDGE_SPACES, '');

/**
 * The names Hermes's command registry answers to besides the command's own (`hermes_cli/commands.py`, 0.22.2, `resolve_command`),
 * each to the command it is: an alias is judged as that command. A test compares this to the installed Hermes.
 */
export const SLASH_ALIASES: Readonly<Record<string, string>> = {
  reset: 'new',
  compose: 'prompt',
  fork: 'branch',
  compact: 'compress',
  snap: 'snapshot',
  tasks: 'agents',
  learning: 'journey',
  'memory-graph': 'journey',
  q: 'queue',
  hb: 'heartbeat',
  proactive: 'loop',
  ctx: 'context',
  'set-home': 'sethome',
  codex_runtime: 'codex-runtime',
  sb: 'statusbar',
  ts: 'timestamps',
  'generate-pet': 'hatch',
  suggest: 'suggestions',
  bp: 'blueprint',
  reload_mcp: 'reload-mcp',
  reload_skills: 'reload-skills',
  upgrade: 'subscription',
  gateway: 'platforms',
  v: 'version',
  exit: 'quit',
  s: 'steer',
};

/**
 * The slash command a `command.dispatch` or `slash.exec` request runs, read as Hermes reads it: `name.lstrip('/')` for a
 * dispatch, `command.strip().lstrip('/').split(maxsplit=1)` for an exec (Python white space, every leading slash),
 * then lower case. `name` is what was typed; `canonical` is the command it names when it is an alias of a built-in.
 */
export function slashInvocation(method: 'command.dispatch' | 'slash.exec', p: Params): { name: string; canonical: string; arg: string } {
  let typed: string;
  let arg: string;
  if (method === 'slash.exec') {
    const [head = '', ...rest] = pythonStrip(text(p.command)).replace(/^\/+/, '').replace(new RegExp(`^[${PYTHON_SPACE}]+`), '').split(PYTHON_SPACES);
    typed = head;
    arg = rest.join(' ');
  } else {
    typed = text(p.name).replace(/^\/+/, '');
    arg = text(p.arg);
  }
  const name = typed.toLowerCase();
  return { name, canonical: Object.hasOwn(SLASH_ALIASES, name) ? SLASH_ALIASES[name] : name, arg };
}

/**
 * The tier of running a slash command by its name and arguments. A name that is not a built-in (a skill, plugin or
 * bundle command, or a command a later Hermes adds) is an agent turn, so T0; it is not an allow-list because the owner's
 * skills are commands too. Whether it is an exec-type quick command is the server's question: only Hermes's config knows.
 */
export function slashPolicy({ name, arg }: { name: string; arg: string }): Tier {
  if (NOT_A_NAME.test(name)) return 'denied';
  const command = Object.hasOwn(SLASH_ALIASES, name) ? SLASH_ALIASES[name] : name;
  if (Object.hasOwn(SLASH_DENIED, command)) return 'denied';
  const words = pythonStrip(arg).split(PYTHON_SPACES);
  // `/goal gate <command>` makes Hermes run that command after every turn, and `command.dispatch` takes the gate as approved: a shell command nobody was asked about.
  if (command === 'goal' && words[0].toLowerCase() === 'gate') return 'denied';
  if (Object.hasOwn(SLASH_T2, command)) return 'T2';
  // `/model --global` writes the default model.
  return command === 'model' && words.includes('--global') ? 'T1' : 'T0';
}

/** Why a slash command is denied: it has no reason of its own, unlike a denied method. */
const SLASH_DENIED_REASON: DeniedReason = 'slash-admin';

/** Every pinned gateway method with its policy. */
export const GATEWAY_METHODS: Readonly<Record<string, GatewayMethodPolicy>> = GATEWAY_METHODS_TABLE;

/**
 * Frames the transport answers before it dispatches a method, so the contract does not list them. `gateway.ping` is the
 * client's heartbeat (`tui_gateway/ws.py` answers it on the read loop, even while agents are busy); without it every
 * connection would be dropped as dead after 45 s.
 */
const TRANSPORT_METHODS: Readonly<Record<string, Policy>> = { 'gateway.ping': READ };

/** A server→client request: what answering it costs, and whether it is passed on to the browser at all. */
export interface ServerRequestPolicy extends Policy {
  /** Whether Hermes's request reaches the browser. A denied one is answered with an error on the browser's behalf. */
  deliver: boolean;
  /** Lifts the tier of the browser's answer (the `result` it sends back), or makes it a read (a refusal). */
  answer?: (result: Params) => Refined;
}

const request = (policy: Policy, rest: Partial<ServerRequestPolicy> = {}): ServerRequestPolicy => ({ ...policy, deliver: policy.tier !== 'denied', ...rest });

/** The 16 server→client requests. The answers that hand the agent a secret, or a standing permission, are T2. */
export const SERVER_REQUESTS: Readonly<Record<string, ServerRequestPolicy>> = {
  approval: request(T0, { answer: (result) => approvalChoice(result.choice) }),
  clarify: request(T0),
  secret: request(T2),
  sudo: request(T2),
  // Desktop-only requests: a browser that does not handle them answers "method not found".
  'preview.act': request(T0),
  'preview.read': request(T0),
  'terminal.read': request(T0),
  tour: request(T0),
  'window.read': request(T0),
  'vault.code': request(denied('vault')),
  'vault.save_login': request(denied('vault')),
  'vault.unlock_prompt': request(denied('vault')),
  // The Desktop app's cards and windows, and the Bot Screen's package install: a browser here has none of them, so the agent is told so at once.
  setup_beat: request(denied('not-used')),
  'theme.apply': request(denied('not-used')),
  'theme.pick': request(denied('not-used')),
  'display.install.sudo': request(denied('not-used')),
};

/** An event Hermes sends to the browser, and whether the browser gets it. */
export interface EventPolicy extends Policy {
  deliver: boolean;
}

const EVENTS_DELIVERED = [
  'agent.terminal.output',
  'background.complete',
  'browser.controller.cancel',
  'browser.controller.command',
  'browser.progress',
  'btw.complete',
  'connection.request',
  'connection.update',
  'cron.changed',
  'error',
  'gateway.ready',
  'message.complete',
  'message.delta',
  'message.interim',
  'message.reaction',
  'message.start',
  'moa.aggregating',
  'moa.phase',
  'moa.progress',
  'moa.reference',
  'notice',
  'notification.clear',
  'notification.show',
  'pairing.changed',
  'pane.reveal',
  'pet.changed',
  'pet.generate.progress',
  'pet.hatch.progress',
  'platforms.changed',
  'preview.close',
  'preview.open',
  'preview.restart.complete',
  'preview.restart.progress',
  'reaction',
  'reasoning.available',
  'reasoning.delta',
  'request.cancel',
  'review.summary',
  'session.control.update',
  'session.info',
  'session.reclaimed',
  'session.resume_progress',
  'session.title',
  'session.usage',
  'sessions.changed',
  'setup.ready',
  'skin.changed',
  'status.update',
  'subagent.complete',
  'subagent.progress',
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.thinking',
  'subagent.tool',
  'terminal.close',
  'thinking.delta',
  'tip.show',
  'todo.updated',
  'tool.complete',
  'tool.generating',
  'tool.output_risk',
  'tool.start',
  'voice.interrupted',
  'voice.status',
  'voice.transcript',
  'agent.print',
  'approval.cancelled',
  'projects.changed',
  'skills.changed',
  'voice.partial',
  'wake.detected',
];

/** The 79 events. Reading one changes nothing; the events of denied families never reach the browser. */
export const GATEWAY_EVENTS: Readonly<Record<string, EventPolicy>> = {
  ...Object.fromEntries(EVENTS_DELIVERED.map((name): [string, EventPolicy] => [name, { ...READ, deliver: true }])),
  'billing.step_up.verification': { ...denied('billing'), deliver: false },
  'bot_relay.outbox.pending': { ...denied('bot-relay'), deliver: false },
  // Events of the Bot Screen and of the Desktop app's own windows and first run: none of them has a screen here, and the challenge one carries a URL
  // that only the Desktop app's hidden window is meant to load.
  'display.install.done': { ...denied('not-used'), deliver: false },
  'display.install.log': { ...denied('not-used'), deliver: false },
  'display.lease': { ...denied('not-used'), deliver: false },
  'display.status': { ...denied('not-used'), deliver: false },
  'free_tier.challenge': { ...denied('not-used'), deliver: false },
  'onboarding.ended': { ...denied('not-used'), deliver: false },
};

export type GatewayRequestClass =
  | { ok: true; method: string; policy: Policy }
  | { ok: false; method: string; reason: DeniedReason; message: string };

/** The policy of a method call with these params. An unknown method, or a denied one, is not `ok`. */
export function classifyGatewayMethod(method: string, rawParams: unknown): GatewayRequestClass {
  if (Object.hasOwn(TRANSPORT_METHODS, method)) return { ok: true, method, policy: TRANSPORT_METHODS[method] };
  const entry = Object.hasOwn(GATEWAY_METHODS, method) ? GATEWAY_METHODS[method] : undefined;
  if (!entry) return { ok: false, method, reason: 'unclassified', message: DENIED_MESSAGES.unclassified };
  let policy: Policy = entry;
  const refined = entry.refine?.(params(rawParams));
  if (typeof refined === 'string') policy = { ...entry, tier: stricter(entry.tier, refined) };
  else if (refined) policy = { tier: refined.tier, read: refined.read };
  if (policy.tier === 'denied') {
    // A denied slash command carries no reason of its own; a denied method does.
    const reason = entry.reason ?? SLASH_DENIED_REASON;
    return { ok: false, method, reason, message: DENIED_MESSAGES[reason] };
  }
  return { ok: true, method, policy: { tier: policy.tier, read: policy.read } };
}
