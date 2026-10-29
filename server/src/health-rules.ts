// Health rules: what Caduceus knows and what Hermes's own status endpoints answered, turned into the subsystems Health shows
// and the Repairs they add up to. Pure: no clock, no network, no Hermes; `health.ts` gathers the inputs.
import type { BackendStatus, CompatibilityReport, Repair, Subsystem, SubsystemId } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { pressureClause, readPressure, type GaugePressure, type PressureLevel } from '@caduceus/contracts/pressure';
import { SCHEDULER_STALE_AFTER_S } from '@caduceus/contracts/scheduler';
import { contractDrift } from './contract-diff.ts';

/**
 * What each of Hermes's status endpoints answered, as parsed JSON; `undefined` where Hermes was not asked (it is not
 * running) or did not answer. Hermes declares no response schemas (contract pin, M0 #02), so every field is read defensively.
 */
export interface HermesAnswers {
  /** `GET /api/status`. */
  status?: unknown;
  /** `GET /api/cron/jobs?profile=all`: every job of every profile, each with its profile's ticker heartbeat age. */
  cronJobs?: unknown;
  /** `GET /api/plugins/kanban/stats`: tasks per status, and how long the oldest `ready` one has waited. */
  kanbanStats?: unknown;
  /** `GET /api/plugins/kanban/diagnostics`: the distress signals Hermes finds among Kanban tasks. */
  kanbanDiagnostics?: unknown;
  /** `GET /api/credentials/pool`: the credentials Hermes pools per provider, and how each last fared. */
  credentialPool?: unknown;
  /** `GET /api/model/options?include_unconfigured=true`: the providers Hermes can use, with whether each has credentials, and which one the default chat model uses. */
  modelOptions?: unknown;
  /** `GET /api/system/stats`: the host's CPU, memory and disk. */
  systemStats?: unknown;
  /** `GET /api/health`: Hermes's own liveness check (`ok`, its version). */
  health?: unknown;
  /** `GET /api/host/identity`: who holds the port (process id, `role`, whether it serves the web app). */
  identity?: unknown;
  /** `GET /api/egress/status`: the egress proxy's status as Hermes's plain text (`{ text }`). */
  egress?: unknown;
  /** `GET /api/health/idle`: whether Hermes can prove it has no work in flight (`idle`: true, false or null for “cannot tell”, with a `reason`). */
  idle?: unknown;
}

export interface HealthInputs {
  /** Milliseconds since the epoch: when Caduceus asked. */
  now: number;
  backend: BackendStatus;
  /** When the private backend stopped on its own and was started again (milliseconds since the epoch), oldest first. Deliberate restarts are not in it. */
  restarts: readonly number[];
  /** Whether the running Hermes matches the contracts Caduceus was built for. */
  compatibility: CompatibilityReport;
  readOnly: { enabled: boolean };
  hermes: HermesAnswers;
}

export interface HealthEvaluation {
  subsystems: Subsystem[];
  repairs: Repair[];
}

/** What one rule finds out about its subsystem. */
interface Finding extends Pick<Subsystem, 'state' | 'reason' | 'suggestion'> {
  facts?: Subsystem['facts'];
  meters?: Subsystem['meters'];
  repairs?: Repair[];
}

const SEVERITY_ORDER: Repair['severity'][] = ['critical', 'warning', 'info'];

const NAMES: Record<SubsystemId, string> = {
  caduceus: 'Caduceus server',
  backend: 'Hermes backend',
  gateway: 'Messaging gateway',
  scheduler: 'Cron scheduler',
  dispatcher: 'Kanban dispatcher',
  providers: 'Providers',
  activity: 'Work in progress',
  egress: 'Egress proxy',
  host: 'Host resources',
};

/** What a subsystem says when the answer it reads from Hermes is missing: Hermes is down, or did not answer. */
function noAnswer(backend: BackendStatus): Finding {
  return backend.state === 'ready'
    ? { state: 'unknown', reason: 'Hermes did not answer this check.', suggestion: 'Check again in a moment. If Hermes stays silent, restart the Hermes backend.' }
    : { state: 'unknown', reason: 'The Hermes backend is not running, so this cannot be checked.', suggestion: 'Nothing to do here: this is checked again once the Hermes backend is running.' };
}

/** A span of seconds as a person says it: "14 s", "5 min", "3 h", "2 d". */
function plainDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}

/** A ready Kanban task that has waited longer than this has been passed over by more than a dispatch tick or two (Hermes's own overdue grace). */
const DISPATCH_PATIENCE_S = 15 * 60;

/** How far back a restart counts as recent. */
const RESTART_WINDOW_MS = 60 * 60_000;
/** This many restarts within the window are a pattern, not bad luck. */
const REPEATED_RESTARTS = 3;

/** How many contract differences a Repair lists before it says how many more there are. */
const DRIFT_LISTED = 5;

/** A problem a rule finds with its subsystem: what is wrong in a sentence that reads after “but”, and what to do. */
interface Problem {
  text: string;
  suggestion: string;
}

const RESTART_FIX = { id: 'restart-backend', label: 'Restart Hermes backend', tier: 'T2' } as const;

/** The contract check's verdict, as a Repair and as what the backend's subsystem says about it. */
function contractFinding(report: CompatibilityReport, readOnlyOn: boolean): { problem?: Problem; value: string; repairs: Repair[] } {
  if (report.state === 'checking') return { value: 'Being checked', repairs: [] };
  if (report.state === 'compatible') return { value: 'Match those Caduceus was built for', repairs: [] };
  const drift = contractDrift(report);
  if (drift.length === 0) {
    return {
      problem: { text: 'Caduceus could not check Hermes against the contracts it was built for.', suggestion: 'Restart the Hermes backend: Caduceus checks the contracts again whenever Hermes starts.' },
      value: 'Could not be checked',
      repairs: [
        {
          id: 'contract-unreadable',
          severity: 'warning',
          subsystem: 'backend',
          title: 'Caduceus cannot check Hermes’s contracts',
          cause:
            'Caduceus could not read part of what it compares Hermes with, so it cannot tell whether Hermes still matches the contracts it was built for: ' +
            `${report.reasons.join('; ')}. Caduceus checks again whenever Hermes starts.`,
        },
      ],
    };
  }
  const listed = drift.slice(0, DRIFT_LISTED).join('; ') + (drift.length > DRIFT_LISTED ? `; and ${drift.length - DRIFT_LISTED} more` : '');
  const consequence = readOnlyOn
    ? 'Caduceus is in read-only mode until this is dealt with.'
    : 'Read-only mode is off, so Caduceus may change things in Hermes in ways that no longer work as it expects.';
  return {
    problem: {
      text: 'Hermes no longer matches the contracts Caduceus was built for.',
      suggestion: 'Update Caduceus to a version built for this Hermes, or put back the Hermes it was built for.',
    },
    value: drift.length === 1 ? '1 difference' : `${drift.length} differences`,
    repairs: [
      {
        id: 'contract-mismatch',
        severity: 'critical',
        subsystem: 'backend',
        title: 'Hermes no longer matches what Caduceus was built for',
        cause:
          `The running Hermes (version ${report.hermesVersion ?? 'unknown'}) differs from the contracts Caduceus was pinned to (version ${report.pinnedVersion}): ${listed}. ` +
          `${consequence} Update Caduceus to a version built for this Hermes, or put back the Hermes it was built for.`,
      },
    ],
  };
}

/** What Hermes says about itself, in its health check, its identity and its own component rollup: each thing that is wrong, and the Repair it makes. */
function hermesProblems({ health, identity, status }: Pick<HermesAnswers, 'health' | 'identity' | 'status'>): { problem: Problem; repair?: Repair }[] {
  const found: { problem: Problem; repair?: Repair }[] = [];
  if (isRecord(health) && health.ok !== true) {
    found.push({
      problem: { text: 'Hermes’s own health check did not report it as well.', suggestion: 'Check again in a moment. If it stays this way, restart the Hermes backend.' },
      repair: {
        id: 'backend-unwell',
        severity: 'warning',
        subsystem: 'backend',
        title: 'Hermes says it is not well',
        cause: 'The private Hermes backend answers, but its own health check does not report “ok”. Restarting it starts it afresh.',
        fix: RESTART_FIX,
      },
    });
  }
  if (isRecord(identity)) {
    const role = typeof identity.role === 'string' ? identity.role : 'unknown';
    // `servesSpa` is false for the headless `hermes serve` Caduceus starts; true is a `hermes dashboard`.
    const text = role !== 'serve' ? `Hermes answers on its port as “${role}”, not as the headless server Caduceus started.` : identity.servesSpa === true ? 'Hermes answers on its port as a full dashboard (it serves a web app), not as the headless server Caduceus started.' : undefined;
    if (text) {
      found.push({
        problem: { text, suggestion: 'Restart the Hermes backend so Caduceus starts and checks its own. If another program holds the port, stop that program.' },
        repair: {
          id: 'backend-identity',
          severity: 'critical',
          subsystem: 'backend',
          title: 'The program answering as Hermes is not what Caduceus started',
          cause: `${text} Caduceus may be reading and changing something other than its own Hermes. Restarting the backend starts a Hermes of its own on a new port.`,
          fix: RESTART_FIX,
        },
      });
    }
  }
  const components = isRecord(status) && isRecord(status.components) ? status.components : {};
  if (isRecord(components.storage) && components.storage.status === 'degraded') {
    found.push({
      problem: { text: 'Hermes reports that its check of the session database failed.', suggestion: 'Check the disk Hermes keeps its data on (Host resources), then restart the Hermes backend.' },
      repair: {
        id: 'backend-storage',
        severity: 'warning',
        subsystem: 'backend',
        title: 'Hermes cannot read its session database',
        cause: 'Hermes’s own check of its session database (state.db) failed, so chats and history may not load or save. Check that the disk is not full or read-only (Host resources), then restart the backend.',
        fix: RESTART_FIX,
      },
    });
  }
  const web = isRecord(components.dashboard) ? components.dashboard : {};
  const errors = typeof web.recent_unhandled_errors === 'number' ? web.recent_unhandled_errors : 0;
  const logAdvice = 'Look at Hermes’s log under Observe › Logs, and restart the Hermes backend if it keeps happening.';
  if (errors > 0) found.push({ problem: { text: `Hermes reports ${errors === 1 ? '1 unhandled server error' : `${errors} unhandled server errors`} lately.`, suggestion: logAdvice } });
  if (web.selftest === 'failing') found.push({ problem: { text: 'Hermes’s own self-test of its web server is failing.', suggestion: logAdvice } });
  return found;
}

function backendFinding(status: BackendStatus, allRestarts: readonly number[], now: number, compatibility: CompatibilityReport, readOnlyOn: boolean, hermes: HermesAnswers): Finding {
  const restarts = allRestarts.filter((at) => now - at < RESTART_WINDOW_MS);
  const recent = restarts.length === 0 ? '' : ` It restarted ${restarts.length === 1 ? '1 time' : `${restarts.length} times`} in the last hour.`;
  const contract = contractFinding(compatibility, readOnlyOn);
  const own = hermesProblems(hermes);
  const repairs: Repair[] = [
    ...(restarts.length < REPEATED_RESTARTS
      ? []
      : [
          {
            id: 'backend-restarting',
            severity: status.state === 'ready' ? 'warning' : 'critical',
            subsystem: 'backend',
            title: 'Hermes keeps restarting',
            cause:
              `The private Hermes backend stopped and was started again ${restarts.length} times in the last hour; the last time was ${plainDuration((now - restarts[restarts.length - 1]) / 1000)} ago. ` +
              'Restarting it by hand starts it afresh. If it keeps stopping, the Hermes install or its configuration is at fault: Hermes’s log, which Caduceus passes on to its own output, says why.',
            fix: RESTART_FIX,
          } satisfies Repair,
        ]),
    ...contract.repairs,
    ...own.flatMap((found) => found.repair ?? []),
  ];
  const facts: Subsystem['facts'] = [
    { label: 'Restarts in the last hour', value: String(restarts.length) },
    ...(restarts.length === 0 ? [] : [{ label: 'Last restart', value: `${plainDuration((now - restarts[restarts.length - 1]) / 1000)} ago` }]),
    ...(compatibility.state !== 'checking' && compatibility.hermesVersion ? [{ label: 'Hermes version', value: compatibility.hermesVersion }] : []),
    { label: 'Contracts', value: contract.value },
  ];
  switch (status.state) {
    case 'ready': {
      const problems = [...(contract.problem ? [contract.problem] : []), ...own.map((found) => found.problem)];
      if (problems.length === 0) return { state: 'ok', reason: `The private Hermes backend is running and answering.${recent}`, facts, repairs };
      return {
        state: 'degraded',
        reason: `The private Hermes backend is running, but ${problems.map((problem) => problem.text).join(' ')}${recent}`,
        suggestion: [...new Set(problems.map((problem) => problem.suggestion))].join(' '),
        facts,
        repairs,
      };
    }
    case 'starting':
      return { state: 'degraded', reason: `The private Hermes backend is starting up.${recent}`, suggestion: 'Wait a few seconds: this clears by itself once Hermes is ready.', facts, repairs };
    case 'restarting':
      return {
        state: 'down',
        reason: `The private Hermes backend stopped. Caduceus is starting it again (attempt ${status.attempt}).${recent}`,
        suggestion: 'Wait: Caduceus keeps trying. If it never comes back, Hermes’s log, which Caduceus passes on to its own output, says why.',
        facts,
        repairs,
      };
    case 'stopped':
      return { state: 'down', reason: 'The private Hermes backend is stopped: Caduceus is shutting down.', suggestion: 'Start Caduceus again.', facts, repairs };
  }
}

/** Where the owner starts or restarts a gateway: Connect › Gateway. */
const GATEWAY_LINK = { label: 'Open Gateway', to: '/connect/gateway' } as const;

function gatewayFinding(backend: BackendStatus, status: unknown): Finding {
  if (!isRecord(status)) return noAnswer(backend);
  if (status.gateway_running !== true) {
    const exit = typeof status.gateway_exit_reason === 'string' && status.gateway_exit_reason !== '' ? ` Hermes gave this reason for the stop: ${status.gateway_exit_reason.slice(0, 200)}.` : '';
    return {
      state: 'down',
      reason: 'The messaging gateway is not running.',
      suggestion: 'Start it from Gateway, or run “hermes gateway start” on the Mac that runs Hermes.',
      repairs: [
        {
          id: 'gateway-not-running',
          severity: 'warning',
          subsystem: 'gateway',
          title: 'The messaging gateway is not running',
          cause:
            'Hermes is not receiving messages from chat platforms, and scheduled jobs and Kanban tasks do not start, because all three run inside the gateway. ' +
            `Start it on the Mac that runs Hermes with “hermes gateway start”.${exit}`,
          link: GATEWAY_LINK,
        },
      ],
    };
  }
  const stuckFor = typeof status.gateway_heartbeat_stale_s === 'number' ? status.gateway_heartbeat_stale_s : undefined;
  if (stuckFor !== undefined) {
    return {
      state: 'degraded',
      reason: `The messaging gateway is running, but it has not reported in for ${plainDuration(stuckFor)}: it may be stuck.`,
      suggestion: 'Restart it from Gateway, or run “hermes gateway restart” on the Mac that runs Hermes.',
      repairs: [
        {
          id: 'gateway-unresponsive',
          severity: 'warning',
          subsystem: 'gateway',
          title: 'The messaging gateway has stopped responding',
          cause:
            `The gateway’s process is alive, but it has not updated its status for ${plainDuration(stuckFor)}, so its loop may be stuck. ` +
            'Messages, scheduled jobs and Kanban dispatch may not be handled. Restart it on the Mac that runs Hermes with “hermes gateway restart”.',
          link: GATEWAY_LINK,
        },
      ],
    };
  }
  // A platform Hermes has disabled on purpose is neither connected nor a problem.
  const platforms = isRecord(status.gateway_platforms)
    ? Object.entries(status.gateway_platforms)
        .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
        .map(([name, platform]) => ({ name, state: String(platform.state ?? platform.status ?? '').toLowerCase() }))
        .filter((platform) => platform.state !== 'disabled')
    : [];
  const down = platforms.filter((platform) => !['connected', 'running', 'ok'].includes(platform.state));
  if (down.length > 0) {
    const names = down.map((platform) => platform.name).join(', ');
    return {
      state: 'degraded',
      reason: `The messaging gateway is running, but ${down.length} of ${platforms.length} chat platforms are not connected: ${names}.`,
      suggestion: 'Check that channel in Channels, or restart the gateway from Gateway.',
      repairs: [
        {
          id: 'gateway-platforms-down',
          severity: 'warning',
          subsystem: 'gateway',
          title: 'Some chat platforms are not connected',
          cause:
            `${names} ${down.length === 1 ? 'is' : 'are'} not connected, so Hermes cannot receive or send messages there. ` +
            'Check the channel in Hermes, or restart the gateway on the Mac that runs Hermes with “hermes gateway restart”.',
          link: GATEWAY_LINK,
        },
      ],
    };
  }
  return {
    state: 'ok',
    reason: platforms.length === 0 ? 'The messaging gateway is running.' : `The messaging gateway is running, with ${platforms.length === 1 ? '1 chat platform' : `${platforms.length} chat platforms`} connected.`,
  };
}

function schedulerFinding(backend: BackendStatus, jobs: unknown, status: unknown): Finding {
  if (!Array.isArray(jobs)) return noAnswer(backend);
  // A paused, disabled or finished job needs no scheduler, so only the others say whether it is ticking.
  const waiting = jobs.filter(isRecord).filter((job) => job.enabled !== false && job.state !== 'paused' && job.state !== 'completed');
  if (waiting.length === 0) return { state: 'ok', reason: 'No scheduled jobs are waiting to run, so there is no tick to check.' };
  // Each profile has its own ticker: the oldest heartbeat is the one that is wrong.
  const ages = waiting.map((job) => job.scheduler_heartbeat_age_s).filter((age): age is number => typeof age === 'number');
  if (ages.length === 0) {
    return {
      state: 'unknown',
      reason: `Hermes has recorded no scheduler tick yet, so it cannot say whether the ${waiting.length} scheduled jobs will run.`,
      suggestion: 'Nothing to do yet: the first tick is recorded once the gateway has run for a minute. If it never comes, restart the gateway from Gateway.',
    };
  }
  const age = Math.max(...ages);
  if (age <= SCHEDULER_STALE_AFTER_S) {
    return { state: 'ok', reason: `The scheduler ticked ${plainDuration(age)} ago, and ${waiting.length === 1 ? '1 scheduled job is' : `${waiting.length} scheduled jobs are`} waiting to run.` };
  }
  const gatewayDown = isRecord(status) && status.gateway_running !== true;
  return {
    state: 'down',
    reason: `The scheduler last ticked ${plainDuration(age)} ago, though it ticks every minute: scheduled jobs are not running.`,
    suggestion: gatewayDown ? 'Start the gateway from Gateway: the scheduler runs inside it.' : 'Restart the gateway from Gateway: the scheduler runs inside it.',
    repairs: [
      {
        id: 'scheduler-stale',
        severity: 'warning',
        subsystem: 'scheduler',
        title: 'Scheduled jobs are not running',
        cause: gatewayDown
          ? `The scheduler runs inside the messaging gateway, which is not running. Its last tick was ${plainDuration(age)} ago, and it ticks every minute.`
          : `The scheduler last ticked ${plainDuration(age)} ago, and it ticks every minute. Restart the gateway on the Mac that runs Hermes with “hermes gateway restart”.`,
      },
    ],
  };
}

function dispatcherFinding(backend: BackendStatus, stats: unknown, diagnostics: unknown, status: unknown): Finding {
  if (!isRecord(stats)) return noAnswer(backend);
  const ready = isRecord(stats.by_status) && typeof stats.by_status.ready === 'number' ? stats.by_status.ready : 0;
  const oldest = typeof stats.oldest_ready_age_seconds === 'number' ? stats.oldest_ready_age_seconds : undefined;
  const noun = ready === 1 ? '1 Kanban task' : `${ready} Kanban tasks`;
  if (ready > 0 && isRecord(status) && status.gateway_running !== true) {
    return {
      state: 'down',
      reason: `${noun} ${ready === 1 ? 'is' : 'are'} waiting, but the dispatcher runs inside the messaging gateway, which is not running.`,
      suggestion: 'Start the gateway from Gateway: the dispatcher runs inside it.',
    };
  }
  const board = { label: 'Open Board', to: '/work/board' } as const;
  if (ready > 0 && oldest !== undefined && oldest > DISPATCH_PATIENCE_S) {
    const waiting = ready === 1 ? '1 ready Kanban task' : `${ready} ready Kanban tasks`;
    return {
      state: 'degraded',
      reason: `The oldest of the ${waiting} has waited ${plainDuration(oldest)} for a worker. Workers may all be busy, or the dispatcher may be stuck.`,
      suggestion: 'Look at the Kanban board: workers may all be busy. If none is running, restart the gateway from Gateway.',
      repairs: [
        {
          id: 'kanban-tasks-waiting',
          severity: 'warning',
          subsystem: 'dispatcher',
          title: 'Kanban tasks are waiting for a worker',
          cause: `The oldest of the ${waiting} has waited ${plainDuration(oldest)} for a worker. Workers may all be busy. If none is running, restart the gateway on the Mac that runs Hermes with “hermes gateway restart”: the dispatcher runs inside it.`,
          link: board,
        },
      ],
    };
  }
  const problems = isRecord(diagnostics) && typeof diagnostics.count === 'number' ? diagnostics.count : 0;
  if (problems > 0) {
    const listed = problems === 1 ? '1 Kanban task problem is' : `${problems} Kanban task problems are`;
    return {
      state: 'degraded',
      reason: `${listed} listed in Hermes’s Kanban diagnostics (stalled workers, repeated failures).`,
      suggestion: 'Open the failed tasks and retry or block them.',
      repairs: [
        {
          id: 'kanban-task-problems',
          severity: 'warning',
          subsystem: 'dispatcher',
          title: 'Kanban tasks have problems',
          cause: `${listed} listed in Hermes’s Kanban diagnostics (stalled workers, repeated failures). Open the failed tasks and retry or block them.`,
          link: { label: 'Open the failed tasks', to: '/work/tasks?filter=failed' },
        },
      ],
    };
  }
  if (ready === 0) return { state: 'ok', reason: 'No Kanban tasks are waiting for a worker.' };
  const waited = oldest === undefined ? '' : ready === 1 ? `, for ${plainDuration(oldest)}` : `; the oldest for ${plainDuration(oldest)}`;
  return { state: 'ok', reason: `${noun} ${ready === 1 ? 'is' : 'are'} waiting for a worker${waited}.` };
}

/** How a pooled credential last fared, as Hermes records it: `ok`, `exhausted` (cooling down after errors), `dead` (rejected for good), or not yet used. */
const isUsable = (entry: unknown) => !isRecord(entry) || (entry.last_status !== 'exhausted' && entry.last_status !== 'dead');

/** Where the owner adds a key, signs in to a provider or fixes a credential: System › Keys. */
const KEYS_LINK = { label: 'Open Keys', to: '/system/keys' } as const;

/**
 * Whether Hermes has credentials for the provider of the default chat model, from its model list with unconfigured providers
 * (`GET /api/model/options?include_unconfigured=true`). Hermes decides what counts as credentials (a key in its environment, a pooled
 * credential, a login), so this reads its verdict and does not repeat the check. Nothing is said when Hermes did not answer or no provider is chosen.
 */
function chatModelKey(options: unknown): { reason: string; suggestion: string; repair: Repair } | undefined {
  if (!isRecord(options) || !Array.isArray(options.providers)) return undefined;
  const current = options.providers.filter(isRecord).find((provider) => provider.is_current === true);
  if (!current || current.authenticated !== false) return undefined;
  const name = typeof current.name === 'string' && current.name !== '' ? current.name : String(current.slug);
  const signIn = typeof current.auth_type === 'string' && current.auth_type.startsWith('oauth');
  const key = typeof current.key_env === 'string' && current.key_env !== '' ? current.key_env : undefined;
  const advice = signIn ? `Sign in to ${name} in Keys.` : key ? `Add ${key} in Keys.` : `Add a key for ${name} in Keys.`;
  return {
    reason: `Hermes has no credentials for ${name}, the provider of the chat model.`,
    suggestion: advice,
    repair: {
      id: 'model-key-missing',
      severity: 'warning',
      subsystem: 'providers',
      title: `Hermes has no key for ${name}, the provider of the chat model`,
      cause: `The default chat model uses ${name}, and Hermes has no credentials for it, so chats and jobs that use the default model fail. ${advice}`,
      link: KEYS_LINK,
    },
  };
}

function providersFinding(backend: BackendStatus, pool: unknown, modelOptions: unknown): Finding {
  const finding = poolFinding(backend, pool);
  const missing = chatModelKey(modelOptions);
  if (!missing) return finding;
  return {
    ...finding,
    state: 'degraded',
    reason: finding.state === 'degraded' ? `${missing.reason} ${finding.reason}` : missing.reason,
    suggestion: finding.state === 'degraded' && finding.suggestion ? `${missing.suggestion} ${finding.suggestion}` : missing.suggestion,
    repairs: [missing.repair, ...(finding.repairs ?? [])],
  };
}

function poolFinding(backend: BackendStatus, pool: unknown): Finding {
  if (!isRecord(pool) || !Array.isArray(pool.providers)) return noAnswer(backend);
  const providers = pool.providers
    .filter(isRecord)
    .map((provider) => ({ name: String(provider.provider), entries: Array.isArray(provider.entries) ? provider.entries : [] }))
    .filter((provider) => provider.entries.length > 0);
  if (providers.length === 0) {
    return {
      state: 'unknown',
      reason: 'Hermes pools no provider credentials, so there is nothing to check here. Keys it reads from its own environment are not looked at.',
      suggestion: 'Nothing to do unless you expected pooled credentials: add them in Keys.',
    };
  }
  const unusable = providers.filter((provider) => !provider.entries.some(isUsable));
  if (unusable.length > 0) {
    const names = unusable.map((provider) => provider.name).join(', ');
    return {
      state: 'degraded',
      reason: `No credential works for ${names}.`,
      suggestion: 'Add the key again or sign in again in Keys.',
      repairs: [
        {
          id: 'providers-unusable',
          severity: 'warning',
          subsystem: 'providers',
          title: `Hermes cannot use ${names}`,
          cause:
            `Every credential Hermes has for ${names} was rejected or is cooling down after errors, so chats and jobs that use it fail. ` +
            'Add the key again or sign in again in Hermes (“hermes auth add <provider>”).',
          link: KEYS_LINK,
        },
      ],
    };
  }
  const struggling = providers.filter((provider) => provider.entries.some((entry) => !isUsable(entry)));
  if (struggling.length > 0) {
    const list = struggling.map((provider) => `${provider.name} (${provider.entries.filter((entry) => !isUsable(entry)).length} of ${provider.entries.length})`).join(', ');
    return { state: 'degraded', reason: `Some credentials are cooling down after errors or were rejected: ${list}.`, suggestion: 'These recover by themselves after a pause. If it lasts, check that key in Keys.' };
  }
  return { state: 'ok', reason: `${providers.length === 1 ? '1 provider has credentials that work' : `${providers.length} providers have credentials that work`}: ${providers.map((provider) => provider.name).join(', ')}.` };
}

/** Where Hermes gives no verdict (memory on a Mac, say), a share of memory or disk in use from this is short of room, and from the second the shortage is critical. */
const HOST_SHORT_AT_PERCENT = 85;
const HOST_CRITICAL_AT_PERCENT = 95;

const gigabytes = (bytes: unknown) => (typeof bytes === 'number' ? (bytes / 1e9).toFixed(1) : undefined);

/** What each gauge says and does when it is short of room, in Hermes's words and, where Hermes gave no verdict, from the share in use. */
const GAUGES: Record<'memory' | 'disk', { id: 'host-memory' | 'host-disk'; title: string; suggestion: string; byPercent(percent: number): { reading: string; cause: string }; byHermes(gauge: GaugePressure): string }> = {
  memory: {
    id: 'host-memory',
    title: 'The Mac that runs Hermes is low on memory',
    suggestion: 'Close what is not needed on the Mac that runs Hermes.',
    byPercent: (percent) => ({
      reading: `Memory is ${percent}% used.`,
      cause: `Memory is ${percent}% in use on the Mac that runs Hermes, so it may start swapping and slow every agent. Close what is not needed.`,
    }),
    byHermes: (gauge) => `${pressureClause('memory', gauge)}, so it may start swapping heavily or be stopped by the system. Close what is not needed.`,
  },
  disk: {
    id: 'host-disk',
    title: 'The Mac that runs Hermes is low on disk space',
    suggestion: 'Free some disk space on the Mac that runs Hermes: old backups and checkpoints are the usual cause.',
    byPercent: (percent) => ({
      reading: `The disk is ${percent}% full.`,
      cause: `The disk Hermes uses is ${percent}% full. When it fills, Hermes cannot save sessions or logs. Free some space, for instance old backups and checkpoints.`,
    }),
    byHermes: (gauge) => `${pressureClause('disk', gauge, ' on the disk it uses')}. When it fills, Hermes cannot save sessions or logs. Free some space, for instance old backups and checkpoints.`,
  },
};

/** How short of room a gauge is: Hermes's own verdict where it gave one (it weighs headroom, not only the share in use), else the share in use. */
function levelOf(gauge: GaugePressure, percent: number | undefined): PressureLevel {
  if (gauge.reading !== 'unknown') return gauge.reading;
  if (percent === undefined) return 'ok';
  return percent >= HOST_CRITICAL_AT_PERCENT ? 'critical' : percent >= HOST_SHORT_AT_PERCENT ? 'elevated' : 'ok';
}

function hostFinding(backend: BackendStatus, stats: unknown, status: unknown): Finding {
  const pressure = readPressure(status);
  const figures = isRecord(stats) ? stats : undefined;
  const memory = figures && isRecord(figures.memory) && typeof figures.memory.percent === 'number' ? Math.round(figures.memory.percent) : undefined;
  const disk = figures && isRecord(figures.disk) && typeof figures.disk.percent === 'number' ? Math.round(figures.disk.percent) : undefined;
  if (!figures && pressure.level === 'unknown') return noAnswer(backend);
  if (memory === undefined && disk === undefined && pressure.level === 'unknown') {
    const noPsutil = figures?.psutil === false;
    return {
      state: 'unknown',
      reason: `Hermes gave no memory or disk figures${noPsutil ? ' (it reads them with psutil, which is not installed there)' : ''}.`,
      suggestion: noPsutil ? 'Install psutil where Hermes runs (“pip install psutil”) to see memory and disk.' : 'Check again in a moment. If Hermes keeps giving no figures, restart the Hermes backend.',
    };
  }
  const cpu = figures && typeof figures.cpu_percent === 'number' ? Math.round(figures.cpu_percent) : undefined;
  const meters = [
    ...(cpu === undefined ? [] : [{ label: 'CPU', percent: cpu }]),
    ...(memory === undefined ? [] : [{ label: 'Memory', percent: memory }]),
    ...(disk === undefined ? [] : [{ label: 'Disk', percent: disk }]),
  ];
  const facts: Subsystem['facts'] = [];
  const used = (gauge: unknown) => (isRecord(gauge) && gigabytes(gauge.used) && gigabytes(gauge.total) ? `${gigabytes(gauge.used)} of ${gigabytes(gauge.total)} GB` : undefined);
  if (figures && used(figures.memory)) facts.push({ label: 'Memory', value: used(figures.memory)! });
  if (figures && used(figures.disk)) facts.push({ label: 'Disk', value: used(figures.disk)! });
  if (figures && Array.isArray(figures.load_avg)) facts.push({ label: 'Load average', value: figures.load_avg.filter((n): n is number => typeof n === 'number').map((n) => n.toFixed(1)).join(' ') });
  if (figures && typeof figures.uptime_seconds === 'number') facts.push({ label: 'Uptime', value: plainDuration(figures.uptime_seconds) });
  if (pressure.lastStartSuspectedOom) facts.push({ label: 'Hermes’s last start', value: 'followed a suspected out-of-memory kill' });

  const short = (['memory', 'disk'] as const)
    .map((kind) => {
      const gauge = pressure[kind];
      const percent = kind === 'memory' ? memory : disk;
      const level = levelOf(gauge, percent);
      const hermesSaid = gauge.reading !== 'unknown';
      return { kind, level, hermesSaid, percent, gauge };
    })
    .filter((entry) => entry.level !== 'ok');
  const repairs: Repair[] = short.map(({ kind, level, hermesSaid, percent, gauge }) => ({
    id: GAUGES[kind].id,
    severity: level === 'critical' ? 'critical' : 'warning',
    subsystem: 'host',
    title: GAUGES[kind].title,
    cause: hermesSaid ? GAUGES[kind].byHermes(gauge) : GAUGES[kind].byPercent(percent!).cause,
  }));
  const state = short.some((entry) => entry.level === 'critical') ? 'down' : short.length > 0 ? 'degraded' : 'ok';
  if (short.length > 0) {
    const reason = short.map(({ kind, hermesSaid, percent, gauge }) => (hermesSaid ? `${pressureClause(kind, gauge)}.` : GAUGES[kind].byPercent(percent!).reading)).join(' ');
    return { state, reason, suggestion: short.map(({ kind }) => GAUGES[kind].suggestion).join(' '), facts, meters, repairs };
  }
  const reading = memory !== undefined && disk !== undefined ? `Memory is ${memory}% used and the disk ${disk}%` : memory !== undefined ? `Memory is ${memory}% used` : disk !== undefined ? `The disk is ${disk}% full` : 'Hermes reports no pressure on memory or disk';
  return { state, reason: `${reading}${cpu === undefined ? '' : ` (CPU ${cpu}%)`}.`, facts, meters, repairs };
}

/** The `Label: value` rows of Hermes's egress status text (`hermes_cli/proxy_cli.py` `format_status_text`); the free lines around them are skipped. */
function egressRows(text: string): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const row = /^([A-Za-z][A-Za-z ]*): (.*)$/.exec(line);
    if (row && !(row[1] in rows)) rows[row[1]] = row[2].trim();
  }
  return rows;
}

/** The providers Hermes lists under “Uncovered providers”: the ones whose real credentials a Docker sandbox can still see. */
function uncoveredProviders(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('Uncovered providers'));
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+- (\S+)/.exec(line);
    if (!item) break;
    names.push(item[1]);
  }
  return names;
}

/**
 * The egress proxy (`GET /api/egress/status`): Hermes's plain-text status of the proxy that keeps real credentials out of Docker sandboxes. It is
 * optional, so “off” is healthy; it only goes wrong when it is turned on and is not set up, running or covering the providers in use. The files
 * the text names (the binary, the config, the CA certificate) stay out of the report.
 */
function egressFinding(backend: BackendStatus, answer: unknown): Finding {
  if (!isRecord(answer)) return noAnswer(backend);
  const text = typeof answer.text === 'string' ? answer.text : '';
  const rows = egressRows(text);
  if (rows.Enabled !== 'yes' && rows.Enabled !== 'no') {
    return {
      state: 'unknown',
      reason: 'Hermes answered, but not in a form Caduceus can read the egress proxy’s state from.',
      suggestion: 'Check “hermes egress status” on the Mac that runs Hermes. Caduceus may need an update for this Hermes.',
    };
  }
  const enabled = rows.Enabled === 'yes';
  const pid = /^pid (\d+)/.exec(rows.Process ?? '')?.[1];
  const listening = rows.Listening === 'yes';
  const version = rows['Binary version'];
  const facts: Subsystem['facts'] = [
    { label: 'Enabled', value: rows.Enabled },
    { label: 'Running', value: pid ? 'yes' : 'no' },
    { label: 'Listening', value: listening ? 'yes' : 'no' },
    ...(version && !version.startsWith('(') ? [{ label: 'Version', value: version }] : []),
    ...(rows['Tunnel port'] ? [{ label: 'Tunnel port', value: rows['Tunnel port'] }] : []),
    ...(rows['Credential src'] ? [{ label: 'Credential source', value: rows['Credential src'] }] : []),
    ...(rows['Docker enforce'] ? [{ label: 'Applies to Docker', value: rows['Docker enforce'] }] : []),
  ];
  if (!enabled) {
    return { state: 'ok', reason: 'The egress proxy is off. It is optional: it only matters if you want Hermes’s Docker sandboxes kept away from real credentials.', facts };
  }
  const problem = (id: string, title: string, cause: string): Repair => ({ id, severity: 'warning', subsystem: 'egress', title, cause });
  if ((rows.Config ?? '').startsWith('(')) {
    const suggestion = 'Run “hermes egress setup” on the Mac that runs Hermes.';
    return {
      state: 'degraded',
      reason: 'The egress proxy is turned on, but it has not been set up.',
      suggestion,
      facts,
      repairs: [problem('egress-not-set-up', 'The egress proxy is on but not set up', `Hermes is told to send Docker sandbox traffic through the egress proxy, but the proxy has no tokens or configuration yet. ${suggestion}`)],
    };
  }
  if (!pid && !listening) {
    const suggestion = 'Run “hermes egress start” on the Mac that runs Hermes before launching Docker sandboxes.';
    return {
      state: 'degraded',
      reason: 'The egress proxy is turned on and set up, but it is not running.',
      suggestion,
      facts,
      repairs: [problem('egress-not-running', 'The egress proxy is not running', `Docker sandboxes are told to reach providers through the egress proxy, and it is stopped, so they cannot. ${suggestion}`)],
    };
  }
  if (!listening) {
    const suggestion = 'Restart it with “hermes egress start” on the Mac that runs Hermes.';
    return {
      state: 'degraded',
      reason: `The egress proxy is running (pid ${pid}) but not listening, so Docker sandboxes cannot reach providers.`,
      suggestion,
      facts,
      repairs: [problem('egress-not-listening', 'The egress proxy is not listening', `Its process is alive, but nothing answers on its port, so Docker sandboxes cannot reach providers through it. ${suggestion}`)],
    };
  }
  const uncovered = uncoveredProviders(text);
  if (uncovered.length > 0) {
    return {
      state: 'degraded',
      reason: `The egress proxy is running, but it does not cover ${uncovered.join(', ')}: their real credentials are still visible inside Docker sandboxes.`,
      suggestion: 'Run “hermes egress setup” again to cover them, or accept it if those providers are not used in sandboxes.',
      facts,
    };
  }
  return { state: 'ok', reason: 'The egress proxy is running and listening, so Docker sandboxes reach providers through it.', facts };
}

/** What the busy ledger of `GET /api/health/idle` names (`detail`), in words: “session:a,b” is two chat sessions, “cron:x” a scheduled job, and so on. */
function busyWith(detail: unknown): string {
  const text = typeof detail === 'string' ? detail : '';
  const count = text.includes(':') ? text.slice(text.indexOf(':') + 1).split(',').filter(Boolean).length : 0;
  if (text.startsWith('session:')) return `${count === 1 ? '1 chat session has' : `${count} chat sessions have`} a turn running`;
  if (text.startsWith('cron:')) return `${count === 1 ? '1 scheduled job is' : `${count} scheduled jobs are`} running`;
  if (text === 'delegation') return 'a subagent is working on delegated work';
  if (text === 'retirement_admission') return 'work admitted while a client prepared to retire this backend is still running, so Hermes would refuse to retire until it ends';
  return 'a turn is in flight';
}

/**
 * Whether Hermes is busy (`GET /api/health/idle`, its diagnostic snapshot: never a permit to retire the backend, which is a separate handshake Caduceus
 * does not use). Busy is no fault, so only a Hermes that cannot tell is anything but healthy: it counts as busy, and the owner is told so.
 */
function activityFinding(backend: BackendStatus, answer: unknown): Finding {
  if (!isRecord(answer)) return noAnswer(backend);
  if (answer.idle === true) return { state: 'ok', reason: 'Hermes is idle: nothing is running and nothing is waiting for you.' };
  if (answer.idle === false) {
    return answer.reason === 'awaiting_human_input'
      ? { state: 'ok', reason: 'Hermes is waiting for you: a question, an approval or a secret request is open. It is on Today.' }
      : { state: 'ok', reason: `Hermes is busy: ${busyWith(answer.detail)}.` };
  }
  const record = answer.reason === 'input_probe_unavailable' ? 'its record of what is waiting for you' : 'its record of running turns, scheduled jobs and subagents';
  return {
    state: 'unknown',
    reason: `Hermes cannot tell whether it is busy: ${record} could not be read.`,
    suggestion: 'Check again in a moment. Until Hermes can say it is idle, treat it as busy: a restart or update should wait for work to drain.',
  };
}

export function evaluateHealth(inputs: HealthInputs): HealthEvaluation {
  const { backend, hermes, restarts, now, compatibility, readOnly } = inputs;
  const checkedAt = new Date(now).toISOString();
  const findings: [SubsystemId, Finding][] = [
    ['caduceus', { state: 'ok', reason: 'Caduceus is running and answering.' }],
    ['backend', backendFinding(backend, restarts, now, compatibility, readOnly.enabled, hermes)],
    ['gateway', gatewayFinding(backend, hermes.status)],
    ['scheduler', schedulerFinding(backend, hermes.cronJobs, hermes.status)],
    ['dispatcher', dispatcherFinding(backend, hermes.kanbanStats, hermes.kanbanDiagnostics, hermes.status)],
    ['activity', activityFinding(backend, hermes.idle)],
    ['providers', providersFinding(backend, hermes.credentialPool, hermes.modelOptions)],
    ['egress', egressFinding(backend, hermes.egress)],
    ['host', hostFinding(backend, hermes.systemStats, hermes.status)],
  ];
  return {
    subsystems: findings.map(([id, { state, reason, suggestion, facts, meters }]) => ({ id, name: NAMES[id], state, reason, ...(suggestion ? { suggestion } : {}), checkedAt, facts: facts ?? [], ...(meters ? { meters } : {}) })),
    // The worst first. A sort is stable, so Repairs of one severity stay in the order of their subsystems.
    repairs: findings.flatMap(([, finding]) => finding.repairs ?? []).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
  };
}
