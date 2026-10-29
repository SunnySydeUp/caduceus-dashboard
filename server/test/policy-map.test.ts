import { describe, expect, test } from 'vitest';
import {
  classifyRest,
  classifyWebSocketRoute,
  profileOf,
  REST_OPERATIONS,
  resolveTier,
  type RequestFacts,
} from '@caduceus/contracts/policy/rest';
import { classifyGatewayMethod, GATEWAY_EVENTS, GATEWAY_METHODS, SERVER_REQUESTS } from '@caduceus/contracts/policy/gateway';
import { loadPinnedContracts } from '../src/hermes-contract.ts';

// The policy map is the one place that says how risky each thing Caduceus forwards to Hermes is. These tests keep it
// complete: they read the pinned contracts, so a new operation or method after `npm run contracts:regenerate` fails
// here until somebody decides its tier.

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

describe('the REST policy map', () => {
  test('classifies every pinned REST operation, and nothing that is not pinned', async () => {
    const { rest } = await loadPinnedContracts();
    const pinned = Object.entries(rest.paths).flatMap(([route, item]) =>
      Object.keys(item as object)
        .filter((key) => HTTP_METHODS.includes(key))
        .map((method) => `${method.toUpperCase()} ${route}`),
    );

    const classified = Object.keys(REST_OPERATIONS);

    expect(pinned.filter((operation) => !classified.includes(operation))).toEqual([]);
    expect(classified.filter((operation) => !pinned.includes(operation))).toEqual([]);
  });

  test('gives the same tier to operations whose paths can overlap, so a path cannot be argued into a lower one', () => {
    const overlapping: string[] = [];
    const operations = Object.keys(REST_OPERATIONS).map((operation) => {
      const [method, path] = operation.split(' ');
      return { operation, method, segments: path.split('/').slice(1) };
    });
    for (const [index, a] of operations.entries()) {
      for (const b of operations.slice(index + 1)) {
        if (a.method !== b.method || a.segments.length !== b.segments.length) continue;
        const param = (segment: string) => segment.startsWith('{');
        const canOverlap = a.segments.every((segment, i) => param(segment) || param(b.segments[i]) || segment === b.segments[i]);
        if (!canOverlap) continue;
        const [first, second] = [REST_OPERATIONS[a.operation], REST_OPERATIONS[b.operation]];
        if (first.tier !== second.tier || first.read !== second.read) overlapping.push(`${a.operation} / ${b.operation}`);
      }
    }

    expect(overlapping).toEqual([]);
  });
});

/** The tier Caduceus gives a request, from what it says (method, path, query and JSON body). */
function tierOf(method: string, target: string, body?: Record<string, unknown>): string {
  const url = new URL(target, 'http://caduceus.test');
  const match = classifyRest(method, url.pathname);
  if (!match.ok) return 'denied';
  return resolveTier(match, { query: url.searchParams, body }).tier;
}

describe('the gateway policy map', () => {
  test('classifies every pinned gateway method, server request and event, and nothing that is not pinned', async () => {
    const { gateway } = await loadPinnedContracts();
    const names = (entries: { name: string }[] | undefined) => (entries ?? []).map((entry) => entry.name);

    const missing = (kind: string, pinned: string[], classified: object) => pinned.filter((name) => !(name in classified)).map((name) => `${kind} ${name}`);
    const stale = (kind: string, pinned: string[], classified: object) => Object.keys(classified).filter((name) => !pinned.includes(name)).map((name) => `${kind} ${name}`);
    const pinned = {
      method: names(gateway.methods),
      'server request': names(gateway['x-server-requests']),
      event: names(gateway['x-notifications']),
    };

    // The contract pins 257 methods, 16 server requests and 79 events (architecture §3).
    expect(Object.values(pinned).map((list) => list.length)).toEqual([257, 16, 79]);
    expect([
      ...missing('method', pinned.method, GATEWAY_METHODS),
      ...missing('server request', pinned['server request'], SERVER_REQUESTS),
      ...missing('event', pinned.event, GATEWAY_EVENTS),
    ]).toEqual([]);
    expect([
      ...stale('method', pinned.method, GATEWAY_METHODS),
      ...stale('server request', pinned['server request'], SERVER_REQUESTS),
      ...stale('event', pinned.event, GATEWAY_EVENTS),
    ]).toEqual([]);
  });
});

/** The tier a gateway call gets (`denied` when it is not allowed at all) and whether it changes nothing. */
function gatewayTier(method: string, params?: Record<string, unknown>): string {
  const call = classifyGatewayMethod(method, params);
  return call.ok ? `${call.policy.tier}${call.policy.read ? ' read' : ''}` : `denied (${call.reason})`;
}

describe('classifying a gateway call', () => {
  test('denies what architecture §5 says is not reachable in v1, with the reason', () => {
    expect(
      [
        'shell.exec',
        'cli.exec',
        'vault.unlock',
        'vault.add',
        'vault.list',
        'billing.charge',
        'billing.state',
        'subscription.upgrade',
        'subscription.state',
        'groups.peer.invite',
        'groups.peer.register',
        'groups.peer.revoke',
        'bot_relay.deliver',
        'bot_relay.reply',
        'diagnostics.share_nous',
      ].map((method) => gatewayTier(method)),
    ).toEqual([
      'denied (shell-exec)',
      'denied (cli-exec)',
      'denied (vault)',
      'denied (vault)',
      'denied (vault)',
      'denied (billing)',
      'denied (billing)',
      'denied (billing)',
      'denied (billing)',
      'denied (peer-groups)',
      'denied (peer-groups)',
      'denied (peer-groups)',
      'denied (bot-relay)',
      'denied (bot-relay)',
      'denied (debug-upload)',
    ]);
    // Anything Hermes adds that nobody has classified is denied, not forwarded.
    expect(gatewayTier('shiny.new_method')).toBe('denied (unclassified)');
    expect(gatewayTier('__proto__')).toBe('denied (unclassified)');
    expect(gatewayTier('toString')).toBe('denied (unclassified)');
  });

  test('tiers the rest by what it does, lifting a call that names something riskier in its params', () => {
    expect([
      gatewayTier('session.list'),
      gatewayTier('prompt.submit'),
      gatewayTier('session.delete'),
      gatewayTier('rollback.restore'),
      gatewayTier('model.save_key'),
      gatewayTier('process.stop'),
      gatewayTier('delegation.pause'),
      // "Allow always" needs a step-up, a one-off approval does not.
      gatewayTier('approval.respond', { choice: 'once' }),
      gatewayTier('approval.respond', { choice: 'always' }),
      // config.set by key: display settings, then where the agent works, then what it may do unasked, then unknown keys.
      gatewayTier('config.set', { key: 'skin', value: 'ares' }),
      gatewayTier('config.set', { key: 'cwd', value: '/work' }),
      gatewayTier('config.set', { key: 'yolo', value: 'on' }),
      gatewayTier('config.set', { key: 'approvals.mode', value: 'off' }),
      gatewayTier('config.set', { key: 'some.new.key', value: 1 }),
      gatewayTier('config.set', {}),
      // Actions of the manage methods.
      gatewayTier('cron.manage', { action: 'list' }),
      gatewayTier('cron.manage', { action: 'add', schedule: '1h', prompt: 'hi' }),
      gatewayTier('plugins.manage', { action: 'list' }),
      gatewayTier('plugins.manage', { action: 'toggle', name: 'x' }),
      gatewayTier('plugins.manage', { action: 'install', repo: 'git://x' }),
      gatewayTier('skills.manage', { action: 'search', query: 'x' }),
      gatewayTier('skills.manage', { action: 'install' }),
      gatewayTier('skills.manage', {}),
      gatewayTier('mcp.servers.add', { name: 'a', config: { url: 'https://x' } }),
      gatewayTier('mcp.servers.add', { name: 'a', config: { command: 'npx' } }),
      gatewayTier('mcp.servers.add', { name: 'a', preset: 'github' }),
      gatewayTier('session.title', {}),
      gatewayTier('session.title', { title: 'New' }),
    ]).toEqual([
      'T0 read',
      'T0',
      'T1',
      'T3',
      'T2',
      'T2',
      'T2',
      'T0',
      'T2',
      'T0',
      'T1',
      'T2',
      'T2',
      'T3',
      'T3',
      'T0 read',
      'T1',
      'T0 read',
      'T1',
      'T3',
      'T0 read',
      'T3',
      'T3',
      'T2',
      'T3',
      'T3',
      'T0 read',
      'T0',
    ]);
  });

  test('runs slash commands by name: session commands as turns, Hermes-changing ones denied, standing permissions behind a step-up', () => {
    const dispatch = (name: string, arg = '') => gatewayTier('command.dispatch', { name, arg, session_id: 's1' });
    const exec = (command: string) => gatewayTier('slash.exec', { command, session_id: 's1' });

    expect([
      dispatch('retry'),
      dispatch('/Compress'),
      dispatch('my-skill'),
      dispatch('model', 'gpt-5'),
      dispatch('model', '--global gpt-5'),
      dispatch('yolo'),
      dispatch('stop'),
      dispatch('update'),
      dispatch('/skills', 'install x'),
      dispatch('cron', 'add'),
      exec('/retry'),
      exec('  /YOLO on'),
      exec('/model gpt-5 --global'),
      exec('/update'),
      exec(''),
    ]).toEqual([
      'T0',
      'T0',
      'T0',
      'T0',
      'T1',
      'T2',
      'T2',
      'denied (slash-admin)',
      'denied (slash-admin)',
      'denied (slash-admin)',
      'T0',
      'T2',
      'T1',
      'denied (slash-admin)',
      'T0',
    ]);
  });

  test('sets and manages a /goal as a turn, but refuses a goal gate: Hermes would run its command every turn with nobody asked', () => {
    const dispatch = (arg: string) => gatewayTier('command.dispatch', { name: 'goal', arg, session_id: 's1' });
    const exec = (command: string) => gatewayTier('slash.exec', { command, session_id: 's1' });

    expect([dispatch('ship the release'), dispatch('pause'), dispatch('gather the gates'), dispatch('gate npm test'), dispatch('  GATE   make check'), dispatch('wait 10m'), exec('/goal ship it'), exec('/goal gate rm -rf x')]).toEqual([
      'T0',
      'T0',
      'T0',
      'denied (slash-admin)',
      'denied (slash-admin)',
      'T0',
      'T0',
      'denied (slash-admin)',
    ]);
  });

  test('judges a slash command the way Hermes reads it: every leading slash dropped, any case, Python whitespace, aliases by their real name', () => {
    const dispatch = (name: string, arg = '') => gatewayTier('command.dispatch', { name, arg, session_id: 's1' });
    const exec = (command: string) => gatewayTier('slash.exec', { command, session_id: 's1' });
    const denied = 'denied (slash-admin)';

    expect([
      // Hermes: `name.lstrip('/')` and `cmd.lstrip('/')`, not one slash.
      dispatch('//update'),
      dispatch('///SKILLS', 'install x'),
      dispatch('//goal', 'gate add rm -rf x'),
      dispatch('//goal', '\u2003gate\u3000add rm -rf x'),
      dispatch('goal', '\u001cgate add x'),
      dispatch('goal', '\u0085gate add x'),
      exec('//goal gate add rm -rf x'),
      exec('///update'),
      exec('\u00a0//update'),
      exec('/goal\tgate add x'),
      exec('/goal\u2028gate add x'),
      exec('//yolo'),
      dispatch('//yolo'),
      dispatch('//model', '--global\u00a0x'),
      // An alias is the command it names.
      dispatch('exit'),
      dispatch('//Exit'),
      dispatch('//reload_mcp'),
      dispatch('//upgrade'),
      dispatch('//generate-pet'),
      dispatch('//bp'),
      // A name that still holds a slash, whitespace or a control character is not one Hermes would resolve the way this reads it.
      dispatch('/ /update'),
      dispatch('up date'),
      dispatch('goal\tgate'),
      dispatch('update\u0000'),
      exec('/ /goal gate add x'),
      // Ordinary use is untouched.
      dispatch('//retry'),
      dispatch('/my-skill'),
      exec('//retry'),
      exec('/goal ship it'),
      exec('/goal gather the gates'),
    ]).toEqual([
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      'T2',
      'T2',
      'T1',
      denied,
      denied,
      'T2',
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      'T0',
      'T0',
      'T0',
      'T0',
      'T0',
    ]);
  });

  test('delivers events and server requests, except those of the vault, billing, bot relay and of the Desktop app and Bot Screen that Caduceus has no screen for, and asks a step-up for secret answers', () => {
    const delivered = (table: Record<string, { deliver: boolean }>) => Object.keys(table).filter((name) => !table[name].deliver);

    expect(delivered(GATEWAY_EVENTS)).toEqual([
      'billing.step_up.verification',
      'bot_relay.outbox.pending',
      'display.install.done',
      'display.install.log',
      'display.lease',
      'display.status',
      'free_tier.challenge',
      'onboarding.ended',
    ]);
    expect(delivered(SERVER_REQUESTS)).toEqual(['vault.code', 'vault.save_login', 'vault.unlock_prompt', 'setup_beat', 'theme.apply', 'theme.pick', 'display.install.sudo']);
    expect([SERVER_REQUESTS.approval.tier, SERVER_REQUESTS.clarify.tier, SERVER_REQUESTS.secret.tier, SERVER_REQUESTS.sudo.tier]).toEqual(['T0', 'T0', 'T2', 'T2']);
    expect([SERVER_REQUESTS.approval.answer?.({ choice: 'once' }), SERVER_REQUESTS.approval.answer?.({ choice: 'always' })]).toEqual(['T0', 'T2']);
  });
});

describe('classifying a REST request', () => {
  test('gives the tiers architecture §5 and the hermes-api-coverage research name', () => {
    const cases: [string, string, Record<string, unknown> | undefined, string][] = [
      // T0: undo toast.
      ['PATCH', '/api/sessions/s1', undefined, 'T0'],
      ['PUT', '/api/skills/toggle', undefined, 'T0'],
      // T1: confirm.
      ['POST', '/api/ops/backup', undefined, 'T3'],
      ['POST', '/api/ops/doctor', undefined, 'T1'],
      ['POST', '/api/skills/hub/uninstall', undefined, 'T1'],
      ['POST', '/api/profiles/coder/describe-auto', undefined, 'T1'],
      ['POST', '/api/sessions/import', undefined, 'T1'],
      ['POST', '/api/providers/oauth/minimax-oauth/start', undefined, 'T1'],
      ['POST', '/_caduceus/api/keys/test', undefined, 'T1'],
      // T2: passkey step-up.
      ['POST', '/api/gateway/stop', undefined, 'T2'],
      ['POST', '/api/gateway/restart', undefined, 'T2'],
      ['POST', '/api/gateway/migrate', undefined, 'T2'],
      ['PUT', '/api/env', undefined, 'T2'],
      ['DELETE', '/api/env', undefined, 'T2'],
      ['POST', '/api/pairing/approve', undefined, 'T2'],
      ['POST', '/api/plugins/kanban/runs/r1/terminate', undefined, 'T1'],
      ['POST', '/api/plugins/kanban/tasks/bulk', undefined, 'T2'],
      ['POST', '/api/profiles/active', undefined, 'T2'],
      ['POST', '/api/credentials/pool', undefined, 'T2'],
      ['DELETE', '/api/credentials/pool/fireworks/1', undefined, 'T2'],
      ['POST', '/api/providers/custom-endpoints', undefined, 'T2'],
      ['DELETE', '/api/providers/custom-endpoints/local-vllm', undefined, 'T2'],
      ['DELETE', '/api/providers/oauth/openai', undefined, 'T2'],
      // T3: step-up and a typed confirmation.
      ['PUT', '/api/config', undefined, 'T3'],
      ['PUT', '/api/config/raw', undefined, 'T3'],
      ['POST', '/api/ops/hooks', undefined, 'T3'],
      ['POST', '/api/env/reveal', undefined, 'T3'],
      ['GET', '/api/ops/backup/download', undefined, 'T3'],
      ['POST', '/api/profiles/coder/export', undefined, 'T3'],
      ['POST', '/api/ops/import', undefined, 'T3'],
      ['POST', '/api/ops/import-upload', undefined, 'T3'],
      ['DELETE', '/api/profiles/coder', undefined, 'T3'],
      ['POST', '/api/sessions/bulk-delete', undefined, 'T3'],
      ['POST', '/api/sessions/prune', undefined, 'T3'],
      ['POST', '/api/memory/reset', undefined, 'T3'],
      ['POST', '/api/git/review/push', undefined, 'T3'],
      ['POST', '/api/git/review/revert', undefined, 'T3'],
      ['POST', '/api/dashboard/agent-plugins/install', undefined, 'T3'],
      ['POST', '/api/skills/hub/install', undefined, 'T3'],
      ['POST', '/api/mcp/catalog/install', undefined, 'T3'],
      ['PUT', '/api/tools/terminal/backend', undefined, 'T3'],
      // Denied.
      ['POST', '/api/profiles/coder/open-terminal', undefined, 'denied'],
      ['POST', '/api/pub', undefined, 'denied'],
      ['POST', '/api/auth/ws-ticket', undefined, 'denied'],
    ];

    expect(cases.map(([method, target, body]) => tierOf(method, target, body))).toEqual(cases.map(([, , , tier]) => tier));
  });

  test('lifts a request above its base tier when what it says is riskier: scripts, stdio servers, hard deletes', () => {
    const cases: [string, string, Record<string, unknown> | undefined, string][] = [
      ['POST', '/api/cron/jobs', { prompt: 'hi', schedule: '1h' }, 'T1'],
      ['POST', '/api/cron/jobs', { prompt: 'hi', schedule: '1h', script: 'backup.sh' }, 'T3'],
      ['POST', '/api/cron/jobs', { schedule: '1h', no_agent: true }, 'T3'],
      ['PUT', '/api/cron/jobs/j1', { updates: { name: 'x' } }, 'T1'],
      ['PUT', '/api/cron/jobs/j1', { updates: { script: 'x.sh' } }, 'T3'],
      // A monitor script is run by the scheduler every time, so choosing one is as much code as a job's own script; a monitor address is only fetched.
      ['PUT', '/api/cron/jobs/j1', { updates: { monitor_script: 'check.sh' } }, 'T3'],
      ['PUT', '/api/cron/jobs/j1', { updates: { monitor_url: 'https://example.com/feed' } }, 'T1'],
      ['POST', '/api/cron/jobs', { prompt: 'hi', schedule: '1h', monitor_script: 'check.sh' }, 'T3'],
      ['PUT', '/api/cron/jobs/j1', { updates: { failure_deliver: 'local', attach_to_session: true, context_from: ['a1'], workdir: '/tmp', deliver: 'local' } }, 'T1'],
      ['POST', '/api/mcp/servers', { name: 'remote', url: 'https://mcp.example' }, 'T2'],
      ['POST', '/api/mcp/servers', { name: 'local', command: 'npx', args: ['server'] }, 'T3'],
      // Replacing the server map is what an edit saves: HTTP and SSE servers only is T2, any stdio server (or an entry that is not a plain object) T3.
      ['PUT', '/api/mcp/servers', { servers: { remote: { url: 'https://mcp.example' } } }, 'T2'],
      ['PUT', '/api/mcp/servers', { servers: {} }, 'T2'],
      ['PUT', '/api/mcp/servers', { servers: { remote: { url: 'https://mcp.example' }, local: { command: 'npx' } } }, 'T3'],
      ['PUT', '/api/mcp/servers', { servers: { odd: 'npx server' } }, 'T3'],
      ['PUT', '/api/mcp/servers', { servers: 'x' }, 'T3'],
      ['POST', '/api/webhooks', { name: 'hook' }, 'T2'],
      ['POST', '/api/webhooks', { name: 'hook', script: 'run.sh' }, 'T3'],
      ['DELETE', '/api/plugins/kanban/boards/main', undefined, 'T1'],
      ['DELETE', '/api/plugins/kanban/boards/main?delete=true', undefined, 'T3'],
      ['POST', '/api/model/set', { provider: 'p', model: 'm' }, 'T1'],
      ['POST', '/api/model/set', { provider: 'p', model: 'm', api_key: 'k' }, 'T2'],
      ['POST', '/api/profiles', { name: 'new' }, 'T1'],
      ['POST', '/api/profiles', { name: 'new', mcp_servers: ['x'] }, 'T3'],
      ['POST', '/api/git/worktree/remove', { path: '/w' }, 'T1'],
      ['POST', '/api/git/worktree/remove', { path: '/w', force: true }, 'T3'],
      ['DELETE', '/api/files', { path: '/a/b' }, 'T3'],
      ['DELETE', '/api/files', { path: '/a/b', recursive: true }, 'T3'],
    ];

    expect(cases.map(([method, target, body]) => tierOf(method, target, body))).toEqual(cases.map(([, , , tier]) => tier));
  });

  test('saving the dispatcher’s limits through the config is a T2, and any other config write stays a T3', () => {
    const tier = (body: unknown, query = '') => {
      const match = classifyRest('PUT', '/api/config');
      if (!match.ok) throw new Error('unreachable');
      return resolveTier(match, { query: new URLSearchParams(query), body: body as Record<string, unknown> }).tier;
    };
    const kanban = (settings: Record<string, unknown>) => ({ config: { kanban: settings } });

    expect([
      tier(kanban({ max_in_progress: 3 })),
      tier(kanban({ max_in_progress: null, max_in_progress_per_profile: 1, dispatch_stale_timeout_seconds: 600, failure_limit: 2, dispatch_interval_seconds: 30 })),
      tier(kanban({ orchestrator_profile: 'coder', default_assignee: '', auto_decompose: false, auto_promote_children: true })),
      // The profile Hermes scopes the write to may be named: the same keys, another home.
      tier({ ...kanban({ max_in_progress: 2 }), profile: 'coder' }),
      // Anything else in the Kanban section can start a program or reroute a worker.
      tier(kanban({ max_in_progress: 3, dispatch_profiles: ['x'] })),
      tier(kanban({ dispatch_in_gateway: false })),
      // A number that is not a whole count, a nested object, or a word where a count belongs.
      tier(kanban({ max_in_progress: 1.5 })),
      tier(kanban({ max_in_progress: -1 })),
      tier(kanban({ max_in_progress: '3' })),
      tier(kanban({ max_in_progress: { x: 1 } })),
      tier(kanban({ auto_decompose: 'yes' })),
      tier(kanban({ orchestrator_profile: 5 })),
      // A limit below what the dispatcher can sensibly run on: zero workers at once, a tick every second.
      tier(kanban({ max_in_progress: 0 })),
      tier(kanban({ dispatch_interval_seconds: 1 })),
      // Other sections, or other top-level keys, are the full config write.
      tier({ config: { kanban: { max_in_progress: 3 }, model: 'x' } }),
      tier({ config: { kanban: { max_in_progress: 3 } }, other: 1 }),
      tier({ config: { kanban: {} } }),
      tier({ config: { agent: { max_turns: 3 } } }),
      tier({ config: { kanban: [] } }),
      tier(undefined),
      tier(kanban({ max_in_progress: 3 }), 'preserve_language=true'),
    ]).toEqual(['T2', 'T2', 'T2', 'T2', ...Array<string>(16).fill('T3'), 'T2']);
  });

  test('importing a board is a T3, except putting back the export Hermes itself just wrote for an archive (the undo), which is a T1', () => {
    const tier = (body: Record<string, unknown> | undefined) => {
      const match = classifyRest('POST', '/api/plugins/kanban/boards/import');
      if (!match.ok) throw new Error('unreachable');
      return resolveTier(match, { query: new URLSearchParams(), body }).tier;
    };
    const staged = '/Users/o/.hermes/kanban/board-exports/side-work-20261019-002528.tar.gz';

    expect([
      tier({ archive: staged, slug: 'side-work' }),
      tier({ archive: staged, slug: 'side-work', switch: false }),
      tier({ archive: staged }),
      tier({ archive: '/Users/o/Downloads/side-work.tar.gz', slug: 'side-work' }),
      // The shape alone is not enough: the folder must be the one Hermes writes, directly holding a file of the name it gives.
      tier({ archive: '/tmp/board-exports/side-work-20261019-002528.tar.gz', slug: 'x' }),
      tier({ archive: '/Users/o/.hermes/kanban/board-exports/../../evil-20261019-002528.tar.gz', slug: 'x' }),
      tier({ archive: '/Users/o/.hermes/kanban/board-exports/sub/side-work-20261019-002528.tar.gz', slug: 'x' }),
      tier({ archive: '/Users/o/.hermes/kanban/board-exports/side-work.tar.gz', slug: 'x' }),
      tier({ archive: 'kanban/board-exports/side-work-20261019-002528.tar.gz', slug: 'x' }),
      // It must also name the slug it restores, and ask for nothing else (activating it makes it the board workers use).
      tier({ archive: staged, slug: 'Side Work' }),
      // Restoring is putting back the board the file was made from, under the same address; a copy under another name is an import.
      tier({ archive: staged, slug: 'other' }),
      tier({ archive: staged, slug: 'side-work', switch: true }),
      tier({ archive: staged, slug: 'side-work', extra: 1 }),
      tier({ archive: [staged], slug: 'side-work' }),
      tier(undefined),
    ]).toEqual(['T1', 'T1', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3', 'T3']);
  });

  test('treats a dispatcher dry run as a read, and a nudge as a T1; only a lone, plain `dry_run=true` makes it a preview', () => {
    const tier = (query: string) => {
      const match = classifyRest('POST', '/api/plugins/kanban/dispatch');
      if (!match.ok) throw new Error('unreachable');
      const policy = resolveTier(match, { query: new URLSearchParams(query), body: undefined });
      return `${policy.tier}${policy.read ? ' read' : ''}`;
    };

    expect([
      tier(''),
      tier('board=default'),
      tier('dry_run=true'),
      tier('dry_run=true&board=side&max=2'),
      tier('dry_run=false'),
      // Hermes reads the last of a repeated parameter, so a preview must be the only one, or it could hide a real nudge.
      tier('dry_run=true&dry_run=false'),
      tier('dry_run=false&dry_run=true'),
      // Only the plain word counts; Hermes's other spellings of true lift nothing.
      tier('dry_run=1'),
      tier('dry_run=TRUE'),
      tier('dry_run='),
    ]).toEqual(['T1', 'T1', 'T0 read', 'T0 read', 'T1', 'T1', 'T1', 'T1', 'T1', 'T1']);
  });

  test('treats a dry-run prune as a read, and says which requests change nothing', () => {
    const facts = (body?: Record<string, unknown>): RequestFacts => ({ query: new URLSearchParams(), body });
    const read = (method: string, path: string, body?: Record<string, unknown>) => {
      const match = classifyRest(method, path);
      return match.ok ? resolveTier(match, facts(body)).read : undefined;
    };

    expect([
      read('GET', '/api/sessions'),
      read('POST', '/api/sessions/prune', { dry_run: true }),
      read('POST', '/api/sessions/prune', { dry_run: false }),
      read('PATCH', '/api/sessions/s1'),
      read('POST', '/api/audio/transcribe'),
      read('GET', '/api/dashboard/plugins/rescan'),
      // Testing a channel only reads its state, so it needs no confirmation and works in read-only mode.
      read('POST', '/api/messaging/platforms/telegram/test'),
      read('PUT', '/api/messaging/platforms/telegram'),
    ]).toEqual([true, true, false, false, true, false, true, false]);
  });

  test('matches path parameters and names the profile a request works on', () => {
    const match = classifyRest('DELETE', '/api/profiles/coder');
    const facts = (query: string, body?: Record<string, unknown>): RequestFacts => ({ query: new URLSearchParams(query), body });

    expect(match).toMatchObject({ ok: true, operation: 'DELETE /api/profiles/{name}', params: { name: 'coder' }, pathname: '/api/profiles/coder' });
    if (!match.ok) throw new Error('unreachable');
    const sessions = classifyRest('GET', '/api/sessions');
    if (!sessions.ok) throw new Error('unreachable');
    expect([
      profileOf(match, facts('')),
      profileOf(sessions, facts('profile=writer')),
      profileOf(sessions, facts('', { profile: 'researcher' })),
      profileOf(sessions, facts('')),
      // The query wins over a body that names another profile.
      profileOf(sessions, facts('profile=writer', { profile: 'researcher' })),
    ]).toEqual(['coder', 'writer', 'researcher', null, 'writer']);
  });

  test('classifies the path Hermes will route, and denies a path it cannot read exactly', () => {
    const answer = (path: string) => {
      const match = classifyRest('GET', path);
      return match.ok ? `${match.operation} → ${match.pathname}` : `${match.reason}`;
    };

    expect([
      // An escaped letter is the letter Hermes routes, so it is classified as that and forwarded plainly.
      answer('/api/%73tatus'),
      answer('/api/status/'),
      answer('/api/sessions/a%20b'),
      answer('/api/sessions/%2e%2e/config'),
      answer('/api/sessions/a%2Fb'),
      answer('/api/sessions/a%5Cb'),
      answer('/api//status'),
      answer('/api/sessions/x%00y'),
      answer('/api/status%'),
      answer('/api/does-not-exist'),
      answer('/api/__fake/echo'),
    ]).toEqual([
      'GET /api/status → /api/status',
      'GET /api/status → /api/status',
      'GET /api/sessions/{session_id} → /api/sessions/a%20b',
      'bad-path',
      'bad-path',
      'bad-path',
      'bad-path',
      'bad-path',
      'bad-path',
      'unclassified',
      'unclassified',
    ]);
  });

  test("denies Hermes's frame-injection endpoints and tiers its terminal sockets", () => {
    expect([
      classifyWebSocketRoute('/api/pub'),
      classifyWebSocketRoute('/api/events'),
      classifyWebSocketRoute('/api/pty'),
      classifyWebSocketRoute('/api/console'),
      classifyWebSocketRoute('/api/ws'),
      classifyWebSocketRoute('/api/status'),
    ]).toEqual([
      { tier: 'denied', read: false, reason: 'frame-injection' },
      { tier: 'denied', read: false, reason: 'frame-injection' },
      { tier: 'T2', read: false },
      { tier: 'T2', read: false },
      { tier: 'T0', read: false },
      undefined,
    ]);
    // Over plain HTTP, the injection endpoint says why it is denied.
    expect(classifyRest('POST', '/api/pub')).toMatchObject({ ok: false, reason: 'frame-injection' });
  });
});
