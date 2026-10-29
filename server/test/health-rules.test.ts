import { describe, expect, test } from 'vitest';
import type { Subsystem, SubsystemId } from '@caduceus/contracts/caduceus-api';
import { evaluateHealth, type HealthInputs } from '../src/health-rules.ts';

// The boundaries of Health's rules, where a number decides: pure, with no Hermes and no clock. That a condition reaches the
// owner as a Repair, with a fix and read-only mode where there are any, is shown through the API in health.test.ts.
const NOW = Date.parse('2026-10-07T09:00:00.000Z');

/** A Hermes that is up, matches its contracts, and is idle: what every rule must call healthy. */
function healthy(over: Partial<HealthInputs> & { hermes?: HealthInputs['hermes'] } = {}): HealthInputs {
  return {
    now: NOW,
    backend: { state: 'ready' },
    restarts: [],
    compatibility: { state: 'checking' },
    readOnly: { enabled: false },
    ...over,
    hermes: {
      status: { gateway_running: true, gateway_state: 'running', gateway_platforms: {}, gateway_heartbeat_stale_s: null },
      cronJobs: [],
      kanbanStats: { by_status: {}, oldest_ready_age_seconds: null },
      kanbanDiagnostics: { diagnostics: [], count: 0 },
      credentialPool: { providers: [] },
      systemStats: { cpu_percent: 10, memory: { total: 16e9, used: 8e9, percent: 50 }, disk: { total: 500e9, used: 250e9, percent: 50 } },
      health: { ok: true, version: '0.21.4', auth_required: false },
      identity: { ok: true, protocolVersion: 1, pid: 5019, role: 'serve', servesSpa: false },
      egress: { text: 'Egress proxy status\n\nEnabled: no\nBinary: (missing)\nBinary version: (unknown)\nConfig: (not generated)\nCA cert: (not generated)\nTunnel port: 9090\nProcess: (stopped)\nListening: no\nCredential src: env\nDocker enforce: yes\nScope: Docker backend only in this release' },
      idle: { ok: true, idle: true, reason: null },
      ...over.hermes,
    },
  };
}

const subsystem = (inputs: HealthInputs, id: SubsystemId): Subsystem => evaluateHealth(inputs).subsystems.find((s) => s.id === id)!;

describe('the messaging gateway', () => {
  const gateway = (over: Record<string, unknown>) => healthy({ hermes: { status: { gateway_running: true, gateway_state: 'running', gateway_platforms: {}, gateway_heartbeat_stale_s: null, ...over } } });

  test('is fine, and says how many chat platforms are connected, ignoring those Hermes has disabled', () => {
    const platforms = { telegram: { state: 'connected' }, discord: { status: 'ok' }, slack: { state: 'disabled' } };

    expect(subsystem(gateway({ gateway_platforms: platforms }), 'gateway')).toMatchObject({ state: 'ok', reason: 'The messaging gateway is running, with 2 chat platforms connected.' });
  });

  test('is degraded, with a Repair that names them, while a chat platform is not connected', () => {
    const inputs = gateway({ gateway_platforms: { telegram: { state: 'connected' }, discord: { state: 'fatal' }, matrix: { state: 'retrying' } } });

    expect(subsystem(inputs, 'gateway')).toMatchObject({ state: 'degraded', reason: 'The messaging gateway is running, but 2 of 3 chat platforms are not connected: discord, matrix.' });
    expect(evaluateHealth(inputs).repairs).toEqual([
      {
        id: 'gateway-platforms-down',
        severity: 'warning',
        subsystem: 'gateway',
        title: 'Some chat platforms are not connected',
        cause:
          'discord, matrix are not connected, so Hermes cannot receive or send messages there. ' +
          'Check the channel in Hermes, or restart the gateway on the Mac that runs Hermes with “hermes gateway restart”.',
        link: { label: 'Open Gateway', to: '/connect/gateway' },
      },
    ]);
  });

  test('is degraded, with a Repair, when its process is alive but has stopped reporting in', () => {
    const inputs = gateway({ gateway_heartbeat_stale_s: 300 });

    expect(subsystem(inputs, 'gateway')).toMatchObject({ state: 'degraded', reason: 'The messaging gateway is running, but it has not reported in for 5 min: it may be stuck.' });
    expect(evaluateHealth(inputs).repairs).toEqual([
      {
        id: 'gateway-unresponsive',
        severity: 'warning',
        subsystem: 'gateway',
        title: 'The messaging gateway has stopped responding',
        cause:
          'The gateway’s process is alive, but it has not updated its status for 5 min, so its loop may be stuck. ' +
          'Messages, scheduled jobs and Kanban dispatch may not be handled. Restart it on the Mac that runs Hermes with “hermes gateway restart”.',
        link: { label: 'Open Gateway', to: '/connect/gateway' },
      },
    ]);
  });
});

describe('the Kanban dispatcher', () => {
  const stats = (readyTasks: number, oldestReadyAge: number | null) => ({ by_status: { ready: readyTasks, running: 1, done: 4 }, oldest_ready_age_seconds: oldestReadyAge });

  test.each([
    ['no task waits', stats(0, null), undefined, 'ok', 'No Kanban tasks are waiting for a worker.'],
    ['a task has only just been ready', stats(1, 90), undefined, 'ok', '1 Kanban task is waiting for a worker, for 1 min.'],
    ['tasks wait, but not for long', stats(3, 15 * 60), undefined, 'ok', '3 Kanban tasks are waiting for a worker; the oldest for 15 min.'],
    [
      'a task has waited more than 15 minutes',
      stats(3, 15 * 60 + 1),
      undefined,
      'degraded',
      'The oldest of the 3 ready Kanban tasks has waited 15 min for a worker. Workers may all be busy, or the dispatcher may be stuck.',
    ],
    ['Hermes lists tasks in distress', stats(0, null), { diagnostics: [{}, {}], count: 3 }, 'degraded', '3 Kanban task problems are listed in Hermes’s Kanban diagnostics (stalled workers, repeated failures).'],
  ])('is %s', (_when, kanbanStats, kanbanDiagnostics, state, reason) => {
    const inputs = healthy({ hermes: { kanbanStats, ...(kanbanDiagnostics ? { kanbanDiagnostics } : {}) } });

    expect(subsystem(inputs, 'dispatcher')).toMatchObject({ name: 'Kanban dispatcher', state, reason });
  });

  test('is down while tasks wait and the gateway, which hosts the dispatcher, is not running', () => {
    const inputs = healthy({ hermes: { kanbanStats: stats(2, 3600), status: { gateway_running: false } } });

    expect(subsystem(inputs, 'dispatcher')).toMatchObject({
      state: 'down',
      reason: '2 Kanban tasks are waiting, but the dispatcher runs inside the messaging gateway, which is not running.',
    });
  });

  test('a Repair explains each degraded state, so Health and Repairs agree', () => {
    const overdue = healthy({ hermes: { kanbanStats: stats(3, 15 * 60 + 1) } });
    expect(evaluateHealth(overdue).repairs).toEqual([
      expect.objectContaining({ id: 'kanban-tasks-waiting', severity: 'warning', subsystem: 'dispatcher', title: 'Kanban tasks are waiting for a worker', link: { label: 'Open Board', to: '/work/board' } }),
    ]);

    const distress = healthy({ hermes: { kanbanStats: stats(0, null), kanbanDiagnostics: { diagnostics: [{}, {}], count: 3 } } });
    expect(evaluateHealth(distress).repairs).toEqual([
      expect.objectContaining({ id: 'kanban-task-problems', severity: 'warning', subsystem: 'dispatcher', title: 'Kanban tasks have problems', link: { label: 'Open the failed tasks', to: '/work/tasks?filter=failed' } }),
    ]);

    expect(evaluateHealth(healthy({ hermes: { kanbanStats: stats(3, 60) } })).repairs).toEqual([]);
  });
});

describe('the providers', () => {
  const entry = (last_status: string | null) => ({ index: 1, id: 'abc123', label: 'key #1', auth_type: 'api_key', last_status, request_count: 3 });
  const pool = (providers: Record<string, (string | null)[]>) => ({ providers: Object.entries(providers).map(([provider, statuses]) => ({ provider, entries: statuses.map(entry) })) });

  test('are unknown when Hermes pools no credentials: nothing here can say how its other keys fare', () => {
    expect(subsystem(healthy(), 'providers')).toMatchObject({
      name: 'Providers',
      state: 'unknown',
      reason: 'Hermes pools no provider credentials, so there is nothing to check here. Keys it reads from its own environment are not looked at.',
    });
  });

  test('are fine while each provider has a credential that works', () => {
    const inputs = healthy({ hermes: { credentialPool: pool({ anthropic: ['ok', null], openai: ['ok'] }) } });

    expect(subsystem(inputs, 'providers')).toMatchObject({ state: 'ok', reason: '2 providers have credentials that work: anthropic, openai.' });
    expect(evaluateHealth(inputs).repairs).toEqual([]);
  });

  test('are degraded while a credential is cooling down or dead but another of its provider works', () => {
    const inputs = healthy({ hermes: { credentialPool: pool({ anthropic: ['ok', 'exhausted'], openai: ['ok', 'dead'] }) } });

    expect(subsystem(inputs, 'providers')).toMatchObject({ state: 'degraded', reason: 'Some credentials are cooling down after errors or were rejected: anthropic (1 of 2), openai (1 of 2).' });
    expect(evaluateHealth(inputs).repairs).toEqual([]);
  });

  test('are degraded, with a Repair, when a provider has no credential left that works', () => {
    const inputs = healthy({ hermes: { credentialPool: pool({ anthropic: ['ok'], openai: ['exhausted', 'dead'], zai: ['dead'] }) } });

    expect(subsystem(inputs, 'providers')).toMatchObject({ state: 'degraded', reason: 'No credential works for openai, zai.' });
    expect(evaluateHealth(inputs).repairs).toEqual([
      {
        id: 'providers-unusable',
        severity: 'warning',
        subsystem: 'providers',
        title: 'Hermes cannot use openai, zai',
        cause:
          'Every credential Hermes has for openai, zai was rejected or is cooling down after errors, so chats and jobs that use it fail. ' +
          'Add the key again or sign in again in Hermes (“hermes auth add <provider>”).',
        link: { label: 'Open Keys', to: '/system/keys' },
      },
    ]);
  });
});

describe('the key of the chat model', () => {
  /** Hermes's model list with unconfigured providers (`GET /api/model/options?include_unconfigured=true`), one of them the current one. */
  const options = (current: Record<string, unknown>) => ({ provider: current.slug, model: 'some-model', providers: [{ slug: 'nous', name: 'Nous Portal', is_current: false, authenticated: false, auth_type: 'oauth_device_code' }, { is_current: true, ...current }] });
  const fireworks = { slug: 'fireworks', name: 'Fireworks AI', authenticated: false, auth_type: 'api_key', key_env: 'FIREWORKS_API_KEY' };
  const MISSING = {
    id: 'model-key-missing',
    severity: 'warning',
    subsystem: 'providers',
    title: 'Hermes has no key for Fireworks AI, the provider of the chat model',
    cause: 'The default chat model uses Fireworks AI, and Hermes has no credentials for it, so chats and jobs that use the default model fail. Add FIREWORKS_API_KEY in Keys.',
    link: { label: 'Open Keys', to: '/system/keys' },
  };

  test('is a Repair that links to Keys when Hermes has no usable credentials for the provider of the chat model', () => {
    const inputs = healthy({ hermes: { modelOptions: options(fireworks) } });

    expect(subsystem(inputs, 'providers')).toMatchObject({ state: 'degraded', reason: 'Hermes has no credentials for Fireworks AI, the provider of the chat model.' });
    expect(evaluateHealth(inputs).repairs).toEqual([MISSING]);
  });

  test('asks for a sign-in, not a key, when the provider signs in with an account', () => {
    const inputs = healthy({ hermes: { modelOptions: options({ slug: 'nous', name: 'Nous Portal', authenticated: false, auth_type: 'oauth_device_code', key_env: '' }) } });

    expect(evaluateHealth(inputs).repairs).toEqual([expect.objectContaining({ id: 'model-key-missing', cause: expect.stringContaining('Sign in to Nous Portal in Keys.') })]);
  });

  test('says nothing while the provider has credentials, no provider is chosen, or Hermes did not answer', () => {
    for (const hermes of [{ modelOptions: options({ ...fireworks, authenticated: true }) }, { modelOptions: { provider: '', model: '', providers: [{ slug: 'nous', is_current: false, authenticated: false }] } }, { modelOptions: undefined }]) {
      expect(evaluateHealth(healthy({ hermes })).repairs).toEqual([]);
    }
  });

  test('comes with the Repair for a provider whose pooled credentials all failed', () => {
    const pooled = { providers: [{ provider: 'zai', entries: [{ index: 1, id: 'a', label: 'x', auth_type: 'api_key', last_status: 'dead', request_count: 1 }] }] };
    const inputs = healthy({ hermes: { modelOptions: options(fireworks), credentialPool: pooled } });

    expect(evaluateHealth(inputs).repairs.map((repair) => repair.id)).toEqual(['model-key-missing', 'providers-unusable']);
    expect(subsystem(inputs, 'providers')).toMatchObject({ state: 'degraded', reason: 'Hermes has no credentials for Fireworks AI, the provider of the chat model. No credential works for zai.' });
  });
});

describe('the host resources', () => {
  const GB = 1e9;
  const stats = (memory: number, disk: number) => ({
    cpu_percent: 13.4,
    load_avg: [3.9, 4.2, 4.6],
    memory: { total: 64 * GB, used: (64 * GB * memory) / 100, percent: memory },
    disk: { total: 1000 * GB, used: (1000 * GB * disk) / 100, percent: disk },
    uptime_seconds: 3 * 86_400 + 5,
    psutil: true,
  });

  test('are fine, with their readings, while memory and disk have room', () => {
    const host = subsystem(healthy({ hermes: { systemStats: stats(64, 61.9) } }), 'host');

    expect(host).toMatchObject({ name: 'Host resources', state: 'ok', reason: 'Memory is 64% used and the disk 62% (CPU 13%).' });
    expect(host.meters).toEqual([
      { label: 'CPU', percent: 13 },
      { label: 'Memory', percent: 64 },
      { label: 'Disk', percent: 62 },
    ]);
    expect(host.facts).toEqual([
      { label: 'Memory', value: '41.0 of 64.0 GB' },
      { label: 'Disk', value: '619.0 of 1000.0 GB' },
      { label: 'Load average', value: '3.9 4.2 4.6' },
      { label: 'Uptime', value: '3 d' },
    ]);
  });

  test.each([
    ['memory is 85% used', stats(85, 40), 'degraded', 'warning', 'host-memory', 'The Mac that runs Hermes is low on memory', 'Memory is 85% in use on the Mac that runs Hermes, so it may start swapping and slow every agent. Close what is not needed.'],
    ['the disk is 85% full', stats(40, 85), 'degraded', 'warning', 'host-disk', 'The Mac that runs Hermes is low on disk space', 'The disk Hermes uses is 85% full. When it fills, Hermes cannot save sessions or logs. Free some space, for instance old backups and checkpoints.'],
    ['the disk is 95% full', stats(40, 95), 'down', 'critical', 'host-disk', 'The Mac that runs Hermes is low on disk space', 'The disk Hermes uses is 95% full. When it fills, Hermes cannot save sessions or logs. Free some space, for instance old backups and checkpoints.'],
  ])('are short of room when %s', (_when, systemStats, state, severity, id, title, cause) => {
    const inputs = healthy({ hermes: { systemStats } });

    expect(subsystem(inputs, 'host').state).toBe(state);
    expect(evaluateHealth(inputs).repairs).toEqual([{ id, severity, subsystem: 'host', title, cause }]);
  });

  test('are fine just under the limit, and unknown when Hermes has no figures to give', () => {
    // The figures are shown to the percent, and what is shown is what is judged.
    expect(subsystem(healthy({ hermes: { systemStats: stats(84.4, 84.4) } }), 'host').state).toBe('ok');
    expect(subsystem(healthy({ hermes: { systemStats: stats(84.5, 40) } }), 'host').state).toBe('degraded');
    expect(subsystem(healthy({ hermes: { systemStats: { psutil: false } } }), 'host')).toMatchObject({
      state: 'unknown',
      reason: 'Hermes gave no memory or disk figures (it reads them with psutil, which is not installed there).',
    });
  });
});

describe('the cron scheduler', () => {
  const ticking = (age: number | null, over: Record<string, unknown> = {}) => healthy({ hermes: { cronJobs: [{ id: 'j', enabled: true, state: 'scheduled', scheduler_heartbeat_age_s: age, ...over }] } });

  test('is stale after three missed ticks and some slack, as Hermes’s own dashboard counts it', () => {
    expect(subsystem(ticking(200), 'scheduler').state).toBe('ok');
    expect(subsystem(ticking(201), 'scheduler').state).toBe('down');
  });

  test('is unknown while Hermes has recorded no tick, and a finished job needs none', () => {
    expect(subsystem(ticking(null), 'scheduler')).toMatchObject({ state: 'unknown', reason: 'Hermes has recorded no scheduler tick yet, so it cannot say whether the 1 scheduled jobs will run.' });
    expect(subsystem(ticking(9_999, { state: 'completed' }), 'scheduler').state).toBe('ok');
  });
});

describe('the Hermes backend', () => {
  const minute = 60_000;
  const crashed = (...agoMinutes: number[]) => healthy({ restarts: agoMinutes.map((ago) => NOW - ago * minute) });
  const repairs = (inputs: HealthInputs) => evaluateHealth(inputs).repairs.map((repair) => repair.id);

  test('has restarted "repeatedly" at the third restart within the hour, and a restart is recent for just under an hour', () => {
    expect(repairs(crashed(10, 5))).toEqual([]);
    expect(repairs(crashed(10, 5, 1))).toEqual(['backend-restarting']);
    // 60 minutes ago is no longer in the last hour; 59 is.
    expect(repairs(crashed(60, 5, 1))).toEqual([]);
    expect(repairs(crashed(59, 5, 1))).toEqual(['backend-restarting']);
    expect(subsystem(crashed(59), 'backend').reason).toBe('The private Hermes backend is running and answering. It restarted 1 time in the last hour.');
  });

  test('is critical while it is down and the restarts keep coming, and says what it is doing', () => {
    const inputs = healthy({ backend: { state: 'restarting', attempt: 4, retryInMs: 5_000 }, restarts: [NOW - 3 * minute, NOW - 2 * minute, NOW - minute] });

    expect(evaluateHealth(inputs).repairs[0]).toMatchObject({ id: 'backend-restarting', severity: 'critical' });
    expect(subsystem(inputs, 'backend')).toMatchObject({ state: 'down', reason: 'The private Hermes backend stopped. Caduceus is starting it again (attempt 4). It restarted 3 times in the last hour.' });
  });
});

describe('what Hermes did not answer', () => {
  test('is unknown, and says whether Hermes is down or merely silent', () => {
    const silent = healthy({ hermes: { status: undefined, cronJobs: undefined, kanbanStats: undefined, credentialPool: undefined, systemStats: undefined, health: undefined, identity: undefined, egress: undefined, idle: undefined } });
    const down = { ...silent, backend: { state: 'restarting', attempt: 1, retryInMs: 250 } } as const;

    expect(subsystem(silent, 'gateway')).toMatchObject({ state: 'unknown', reason: 'Hermes did not answer this check.' });
    expect(subsystem(down, 'gateway')).toMatchObject({ state: 'unknown', reason: 'The Hermes backend is not running, so this cannot be checked.' });
    for (const id of ['scheduler', 'dispatcher', 'activity', 'providers', 'egress', 'host'] as const) expect(subsystem(silent, id).state).toBe('unknown');
    // Nothing is known, so nothing is claimed: no Repair for what could not be asked.
    expect(evaluateHealth(silent).repairs).toEqual([]);
  });
});

describe('a Hermes that no longer matches the pinned contracts', () => {
  const changes = (removed: string[]) => ({ added: [], removed, changed: [] });
  const markers = { replayEpoch: true, heartbeat: true, changeEvents: true, capabilities: {}, desktopContract: 7 };
  const incompatible = (removed: string[]) =>
    healthy({
      compatibility: {
        state: 'incompatible',
        pinnedVersion: '0.21.4',
        hermesVersion: '0.22.0',
        reasons: removed.map((name) => `REST removed: ${name}`),
        rest: changes(removed),
        gateway: changes([]),
        markers: { pinned: markers, live: markers },
      },
    });

  test('lists the first five differences and counts the rest, and says what read-only mode does or does not do', () => {
    const operations = Array.from({ length: 7 }, (_, n) => `GET /api/op${n}`);

    const [mismatch] = evaluateHealth(incompatible(operations)).repairs;
    const [lifted] = evaluateHealth({ ...incompatible(['GET /api/op0']), readOnly: { enabled: true } }).repairs;
    const [off] = evaluateHealth(incompatible(['GET /api/op0'])).repairs;

    expect(mismatch.cause).toContain(
      'The running Hermes (version 0.22.0) differs from the contracts Caduceus was pinned to (version 0.21.4): REST removed: GET /api/op0; REST removed: GET /api/op1; REST removed: GET /api/op2; REST removed: GET /api/op3; REST removed: GET /api/op4; and 2 more.',
    );
    expect(lifted.cause).toContain('Caduceus is in read-only mode until this is dealt with.');
    expect(off.cause).toContain('Read-only mode is off, so Caduceus may change things in Hermes in ways that no longer work as it expects.');
  });
});

describe('the order of Repairs', () => {
  test('puts the worst first and otherwise keeps the order of the subsystems', () => {
    // A stopped gateway (warning, and the scheduler's too), a full disk (critical) and three restarts (warning, critical when down).
    const inputs = healthy({
      backend: { state: 'restarting', attempt: 3, retryInMs: 1000 },
      restarts: [NOW - 3000, NOW - 2000, NOW - 1000],
      hermes: { status: { gateway_running: false }, systemStats: { memory: { percent: 50 }, disk: { percent: 96 } }, cronJobs: [{ enabled: true, state: 'scheduled', scheduler_heartbeat_age_s: 9999 }] },
    });

    expect(evaluateHealth(inputs).repairs.map((repair) => [repair.severity, repair.id])).toEqual([
      ['critical', 'backend-restarting'],
      ['critical', 'host-disk'],
      ['warning', 'gateway-not-running'],
      ['warning', 'scheduler-stale'],
    ]);
  });
});

describe('what Hermes says of itself: its health check, its identity and its own component rollup', () => {
  const backend = (hermes: HealthInputs['hermes']) => subsystem(healthy({ hermes }), 'backend');
  const repairIds = (hermes: HealthInputs['hermes']) => evaluateHealth(healthy({ hermes })).repairs.map((repair) => repair.id);

  test('are fine while Hermes answers its health check, names itself as the headless server and reports no component trouble', () => {
    expect(backend({})).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering.' });
    expect(backend({}).suggestion).toBeUndefined();
  });

  test('a health check that does not say "ok" makes the backend degraded, with a Repair and what to do', () => {
    const hermes = { health: { ok: false, version: '0.21.4' } };

    expect(backend(hermes)).toMatchObject({
      state: 'degraded',
      reason: 'The private Hermes backend is running, but Hermes’s own health check did not report it as well.',
      suggestion: 'Check again in a moment. If it stays this way, restart the Hermes backend.',
    });
    expect(evaluateHealth(healthy({ hermes })).repairs).toEqual([
      {
        id: 'backend-unwell',
        severity: 'warning',
        subsystem: 'backend',
        title: 'Hermes says it is not well',
        cause: 'The private Hermes backend answers, but its own health check does not report “ok”. Restarting it starts it afresh.',
        fix: { id: 'restart-backend', label: 'Restart Hermes backend', tier: 'T2' },
      },
    ]);
  });

  test.each([
    [{ role: 'gateway', servesSpa: false }, 'Hermes answers on its port as “gateway”, not as the headless server Caduceus started.'],
    [{ role: 'serve', servesSpa: true }, 'Hermes answers on its port as a full dashboard (it serves a web app), not as the headless server Caduceus started.'],
  ])('an identity that is not the headless server (%j) is critical: Caduceus may be talking to something else', (identity, problem) => {
    const hermes = { identity: { ok: true, protocolVersion: 1, pid: 5019, ...identity } };

    expect(backend(hermes)).toMatchObject({ state: 'degraded', reason: `The private Hermes backend is running, but ${problem}` });
    expect(backend(hermes).suggestion).toBe('Restart the Hermes backend so Caduceus starts and checks its own. If another program holds the port, stop that program.');
    expect(evaluateHealth(healthy({ hermes })).repairs).toMatchObject([{ id: 'backend-identity', severity: 'critical', subsystem: 'backend', title: 'The program answering as Hermes is not what Caduceus started' }]);
  });

  test('a failed storage check is a Repair, and the web server’s unhandled errors or failing self-test only degrade the backend', () => {
    const status = (components: Record<string, unknown>) => ({ gateway_running: true, gateway_state: 'running', gateway_platforms: {}, components });

    expect(backend({ status: status({ storage: { status: 'degraded' } }) })).toMatchObject({
      state: 'degraded',
      reason: 'The private Hermes backend is running, but Hermes reports that its check of the session database failed.',
      suggestion: 'Check the disk Hermes keeps its data on (Host resources), then restart the Hermes backend.',
    });
    expect(repairIds({ status: status({ storage: { status: 'degraded' } }) })).toEqual(['backend-storage']);
    expect(backend({ status: status({ dashboard: { status: 'degraded', recent_unhandled_errors: 2, selftest: 'ok' } }) }).reason).toBe('The private Hermes backend is running, but Hermes reports 2 unhandled server errors lately.');
    expect(backend({ status: status({ dashboard: { status: 'degraded', recent_unhandled_errors: 0, selftest: 'failing' } }) }).reason).toBe('The private Hermes backend is running, but Hermes’s own self-test of its web server is failing.');
    expect(repairIds({ status: status({ dashboard: { status: 'degraded', recent_unhandled_errors: 1, selftest: 'ok' } }) })).toEqual([]);
  });

  test('says each problem in turn when there are several, and says nothing when Hermes did not answer the check', () => {
    const hermes = { health: { ok: false }, identity: { role: 'dashboard', servesSpa: false } };

    expect(backend(hermes).reason).toBe(
      'The private Hermes backend is running, but Hermes’s own health check did not report it as well. Hermes answers on its port as “dashboard”, not as the headless server Caduceus started.',
    );
    // A check that got no answer is not a problem found.
    expect(backend({ health: undefined, identity: undefined })).toMatchObject({ state: 'ok' });
  });
});

describe('what to do about a subsystem that is not healthy', () => {
  const GATEWAY_DOWN = { gateway_running: false };
  const heartbeat = (age: number | null) => [{ id: 'j', enabled: true, state: 'scheduled', scheduler_heartbeat_age_s: age }];

  test.each([
    ['gateway', 'gateway stopped', { status: GATEWAY_DOWN }, 'Start it from Gateway, or run “hermes gateway start” on the Mac that runs Hermes.'],
    ['gateway', 'gateway silent', { status: { gateway_running: true, gateway_heartbeat_stale_s: 300 } }, 'Restart it from Gateway, or run “hermes gateway restart” on the Mac that runs Hermes.'],
    ['gateway', 'a platform down', { status: { gateway_running: true, gateway_platforms: { telegram: { state: 'fatal' } } } }, 'Check that channel in Channels, or restart the gateway from Gateway.'],
    ['scheduler', 'scheduler stale, gateway up', { cronJobs: heartbeat(9_999) }, 'Restart the gateway from Gateway: the scheduler runs inside it.'],
    ['scheduler', 'scheduler stale, gateway down', { cronJobs: heartbeat(9_999), status: GATEWAY_DOWN }, 'Start the gateway from Gateway: the scheduler runs inside it.'],
    ['scheduler', 'no tick yet', { cronJobs: heartbeat(null) }, 'Nothing to do yet: the first tick is recorded once the gateway has run for a minute. If it never comes, restart the gateway from Gateway.'],
    ['dispatcher', 'dispatcher with gateway down', { status: GATEWAY_DOWN, kanbanStats: { by_status: { ready: 2 } } }, 'Start the gateway from Gateway: the dispatcher runs inside it.'],
    ['dispatcher', 'ready tasks overdue', { kanbanStats: { by_status: { ready: 1 }, oldest_ready_age_seconds: 3_600 } }, 'Look at the Kanban board: workers may all be busy. If none is running, restart the gateway from Gateway.'],
    ['dispatcher', 'diagnostics', { kanbanDiagnostics: { count: 2 } }, 'Open the failed tasks and retry or block them.'],
    ['providers', 'no credential works', { credentialPool: { providers: [{ provider: 'openai', entries: [{ last_status: 'dead' }] }] } }, 'Add the key again or sign in again in Keys.'],
    ['providers', 'some cooling down', { credentialPool: { providers: [{ provider: 'openai', entries: [{ last_status: 'ok' }, { last_status: 'exhausted' }] }] } }, 'These recover by themselves after a pause. If it lasts, check that key in Keys.'],
    ['host', 'disk filling', { systemStats: { memory: { percent: 40 }, disk: { percent: 90 } } }, 'Free some disk space on the Mac that runs Hermes: old backups and checkpoints are the usual cause.'],
    ['host', 'memory filling', { systemStats: { memory: { percent: 90 }, disk: { percent: 40 } } }, 'Close what is not needed on the Mac that runs Hermes.'],
    ['host', 'no figures', { systemStats: { psutil: false } }, 'Install psutil where Hermes runs (“pip install psutil”) to see memory and disk.'],
  ] as const)('%s, %s: says what to do', (id, _case, hermes, suggestion) => {
    expect(subsystem(healthy({ hermes }), id).suggestion).toBe(suggestion);
  });

  test('a subsystem that is healthy has nothing to suggest, and every one that is not has something', () => {
    expect(evaluateHealth(healthy()).subsystems.filter((s) => s.state === 'ok').every((s) => s.suggestion === undefined)).toBe(true);
    const sick = healthy({ backend: { state: 'restarting', attempt: 1, retryInMs: 100 }, hermes: { status: undefined, cronJobs: undefined, kanbanStats: undefined, credentialPool: undefined, systemStats: undefined } });
    const notOk = evaluateHealth(sick).subsystems.filter((s) => s.state !== 'ok');
    expect(notOk.length).toBeGreaterThan(4);
    expect(notOk.filter((s) => !s.suggestion)).toEqual([]);
  });
});

describe('the host resources follow the pressure Hermes reports', () => {
  /** `GET /api/status`'s `memory` and `disk` blocks, as Hermes gives them (MB; `pressure` is its own verdict). */
  const status = (memory: Record<string, unknown>, disk: Record<string, unknown> = { pressure: 'ok' }) => ({ gateway_running: true, gateway_state: 'running', gateway_platforms: {}, memory, disk });
  const stats = (memory: number, disk: number) => ({ cpu_percent: 10, memory: { total: 16e9, used: (16e9 * memory) / 100, percent: memory }, disk: { total: 500e9, used: (500e9 * disk) / 100, percent: disk } });
  const host = (hermes: HealthInputs['hermes']) => subsystem(healthy({ hermes }), 'host');

  test('critical memory pressure is Down, with a critical Repair that gives Hermes’s own numbers', () => {
    const hermes = { status: status({ pressure: 'critical', system_total_mb: 16_384, system_available_mb: 40 }), systemStats: stats(50, 50) };

    expect(host(hermes)).toMatchObject({
      state: 'down',
      reason: 'Hermes reports critical memory pressure: 40 MB of 16.0 GB is available.',
      suggestion: 'Close what is not needed on the Mac that runs Hermes.',
    });
    expect(evaluateHealth(healthy({ hermes })).repairs).toEqual([
      {
        id: 'host-memory',
        severity: 'critical',
        subsystem: 'host',
        title: 'The Mac that runs Hermes is low on memory',
        cause: 'Hermes reports critical memory pressure: 40 MB of 16.0 GB is available, so it may start swapping heavily or be stopped by the system. Close what is not needed.',
      },
    ]);
  });

  test('elevated disk pressure is Degraded, with a warning that says how much room is left', () => {
    const hermes = { status: status({ pressure: 'ok' }, { pressure: 'elevated', total_mb: 512_000, free_mb: 2_048, used_percent: 99.6 }), systemStats: stats(50, 50) };

    expect(host(hermes)).toMatchObject({ state: 'degraded', reason: 'Hermes reports elevated disk pressure: 2.0 GB of 500.0 GB is free.' });
    expect(evaluateHealth(healthy({ hermes })).repairs).toEqual([
      {
        id: 'host-disk',
        severity: 'warning',
        subsystem: 'host',
        title: 'The Mac that runs Hermes is low on disk space',
        cause: 'Hermes reports elevated disk pressure: 2.0 GB of 500.0 GB is free on the disk it uses. When it fills, Hermes cannot save sessions or logs. Free some space, for instance old backups and checkpoints.',
      },
    ]);
  });

  test('Hermes’s “ok” outranks a high percentage (a big disk 90% full still has room), while “unknown” falls back to the percentage', () => {
    expect(host({ status: status({ pressure: 'ok' }, { pressure: 'ok' }), systemStats: stats(92, 92) }).state).toBe('ok');
    expect(host({ status: status({ pressure: 'unknown' }, { pressure: 'unknown' }), systemStats: stats(92, 40) }).state).toBe('degraded');
    expect(host({ status: undefined, systemStats: stats(40, 92) }).state).toBe('degraded');
  });

  test('says when Hermes’s last start followed an out-of-memory kill, and still reads fine when pressure is gone', () => {
    const hermes = { status: status({ pressure: 'ok', last_boot_unclean: true, last_boot_suspected_oom: true }), systemStats: stats(50, 50) };

    expect(host(hermes).state).toBe('ok');
    expect(host(hermes).facts).toContainEqual({ label: 'Hermes’s last start', value: 'followed a suspected out-of-memory kill' });
  });
});

describe('the egress proxy', () => {
  /** What `GET /api/egress/status` answers: Hermes's own plain-text status of the proxy that keeps real credentials out of Docker sandboxes. */
  const egressText = (rows: Record<string, string>, tail: string[] = []) => ({
    text: ['Egress proxy status', '', ...Object.entries({ Enabled: 'no', Binary: '(missing)', 'Binary version': '(unknown)', Config: '(not generated)', 'Tunnel port': '9090', Process: '(stopped)', Listening: 'no', 'Credential src': 'env', 'Docker enforce': 'yes', ...rows }).map(([label, value]) => `${label}: ${value}`), 'Scope: Docker backend only in this release', ...tail].join('\n'),
  });
  const running = { Enabled: 'yes', 'Binary version': '1.4.2', Config: '/Users/me/.hermes/proxy.yaml', Process: 'pid 4242', Listening: 'yes' };
  const egress = (answer: unknown) => subsystem(healthy({ hermes: { egress: answer } }), 'egress');

  test('is fine and says so when it is off, because it is optional', () => {
    expect(egress(egressText({}))).toMatchObject({
      name: 'Egress proxy',
      state: 'ok',
      reason: 'The egress proxy is off. It is optional: it only matters if you want Hermes’s Docker sandboxes kept away from real credentials.',
    });
    expect(egress(egressText({})).suggestion).toBeUndefined();
  });

  test('is fine while it is on, running and listening, and shows its readings without any path', () => {
    const proxy = egress(egressText(running));

    expect(proxy).toMatchObject({ state: 'ok', reason: 'The egress proxy is running and listening, so Docker sandboxes reach providers through it.' });
    expect(proxy.facts).toEqual([
      { label: 'Enabled', value: 'yes' },
      { label: 'Running', value: 'yes' },
      { label: 'Listening', value: 'yes' },
      { label: 'Version', value: '1.4.2' },
      { label: 'Tunnel port', value: '9090' },
      { label: 'Credential source', value: 'env' },
      { label: 'Applies to Docker', value: 'yes' },
    ]);
    expect(JSON.stringify(proxy)).not.toContain('/Users/me');
  });

  test('is degraded, with a Repair, when it is turned on but was never set up', () => {
    const inputs = healthy({ hermes: { egress: egressText({ Enabled: 'yes' }, ['', 'Next: run `hermes egress setup` to mint tokens and write proxy.yaml.']) } });

    expect(subsystem(inputs, 'egress')).toMatchObject({
      state: 'degraded',
      reason: 'The egress proxy is turned on, but it has not been set up.',
      suggestion: 'Run “hermes egress setup” on the Mac that runs Hermes.',
    });
    expect(evaluateHealth(inputs).repairs).toEqual([
      {
        id: 'egress-not-set-up',
        severity: 'warning',
        subsystem: 'egress',
        title: 'The egress proxy is on but not set up',
        cause: 'Hermes is told to send Docker sandbox traffic through the egress proxy, but the proxy has no tokens or configuration yet. Run “hermes egress setup” on the Mac that runs Hermes.',
      },
    ]);
  });

  test('is degraded, with a Repair, when it is set up but not running', () => {
    const inputs = healthy({ hermes: { egress: egressText({ ...running, Process: '(stopped)', Listening: 'no' }) } });

    expect(subsystem(inputs, 'egress')).toMatchObject({
      state: 'degraded',
      reason: 'The egress proxy is turned on and set up, but it is not running.',
      suggestion: 'Run “hermes egress start” on the Mac that runs Hermes before launching Docker sandboxes.',
    });
    expect(evaluateHealth(inputs).repairs.map((repair) => repair.id)).toEqual(['egress-not-running']);
  });

  test('is degraded when it runs but a process holds it without listening', () => {
    expect(egress(egressText({ ...running, Listening: 'no' }))).toMatchObject({ state: 'degraded', reason: 'The egress proxy is running (pid 4242) but not listening, so Docker sandboxes cannot reach providers.' });
  });

  test('names the providers whose real credentials are still visible inside a sandbox', () => {
    const proxy = egress(egressText(running, ['', 'Uncovered providers (real credentials still visible inside the sandbox):', '  - openai', '  - anthropic']));

    expect(proxy).toMatchObject({
      state: 'degraded',
      reason: 'The egress proxy is running, but it does not cover openai, anthropic: their real credentials are still visible inside Docker sandboxes.',
      suggestion: 'Run “hermes egress setup” again to cover them, or accept it if those providers are not used in sandboxes.',
    });
  });

  test('is unknown when Hermes did not answer, or answered with something that is not its status text', () => {
    expect(egress(undefined)).toMatchObject({ state: 'unknown', reason: 'Hermes did not answer this check.' });
    expect(egress({ text: 'Something else entirely' })).toMatchObject({
      state: 'unknown',
      reason: 'Hermes answered, but not in a form Caduceus can read the egress proxy’s state from.',
      suggestion: 'Check “hermes egress status” on the Mac that runs Hermes. Caduceus may need an update for this Hermes.',
    });
  });
});

describe('work in progress: Hermes’s idle and retirement signals', () => {
  const idle = (answer: unknown) => subsystem(healthy({ hermes: { idle: answer } }), 'activity');
  const busy = (reason: string, detail?: string) => ({ ok: true, idle: false, reason, ...(detail === undefined ? {} : { detail }) });

  test('is fine and says Hermes is idle when it can prove nothing is running and nothing waits for the owner', () => {
    expect(idle({ ok: true, idle: true, reason: null })).toMatchObject({ name: 'Work in progress', state: 'ok', reason: 'Hermes is idle: nothing is running and nothing is waiting for you.' });
    expect(idle({ ok: true, idle: true, reason: null }).suggestion).toBeUndefined();
  });

  test.each([
    ['one chat session', busy('turn_in_flight', 'session:abc'), 'Hermes is busy: 1 chat session has a turn running.'],
    ['two chat sessions', busy('turn_in_flight', 'session:abc,def'), 'Hermes is busy: 2 chat sessions have a turn running.'],
    ['a delegated subagent', busy('turn_in_flight', 'delegation'), 'Hermes is busy: a subagent is working on delegated work.'],
    ['a scheduled job', busy('turn_in_flight', 'cron:nightly'), 'Hermes is busy: 1 scheduled job is running.'],
    ['two scheduled jobs', busy('turn_in_flight', 'cron:a,b'), 'Hermes is busy: 2 scheduled jobs are running.'],
    ['a retirement handshake', busy('turn_in_flight', 'retirement_admission'), 'Hermes is busy: work admitted while a client prepared to retire this backend is still running, so Hermes would refuse to retire until it ends.'],
    ['a turn that names nothing', busy('turn_in_flight'), 'Hermes is busy: a turn is in flight.'],
    ['a prompt for the owner', busy('awaiting_human_input'), 'Hermes is waiting for you: a question, an approval or a secret request is open. It is on Today.'],
  ])('is fine, and says what Hermes is busy with: %s', (_what, answer, reason) => {
    expect(idle(answer)).toMatchObject({ state: 'ok', reason });
  });

  test.each([
    ['turn_probe_unavailable', 'its record of running turns, scheduled jobs and subagents'],
    ['input_probe_unavailable', 'its record of what is waiting for you'],
  ])('is unknown when Hermes cannot tell (%s), and says to treat it as busy', (reason, record) => {
    expect(idle({ ok: true, idle: null, reason })).toMatchObject({
      state: 'unknown',
      reason: `Hermes cannot tell whether it is busy: ${record} could not be read.`,
      suggestion: 'Check again in a moment. Until Hermes can say it is idle, treat it as busy: a restart or update should wait for work to drain.',
    });
  });

  test('is unknown when Hermes did not answer, and says nothing about what it does not know', () => {
    expect(idle(undefined)).toMatchObject({ state: 'unknown', reason: 'Hermes did not answer this check.' });
    expect(evaluateHealth(healthy({ hermes: { idle: busy('turn_in_flight', 'session:a') } })).repairs).toEqual([]);
  });
});
