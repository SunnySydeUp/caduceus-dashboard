import { describe, expect, test } from 'vitest';
import type { ProfileCard } from '../src/modules/profiles/profiles-model.ts';
import { configuredChannels, gatewayProcesses, gatewayRows, isUnconfigured, migrationView, plainDuration, type GatewayInputs } from '../src/modules/gateway/gateway-model.ts';
import { restartBanner } from '../src/restart-to-apply.ts';

const card = (name: string, extra: Partial<ProfileCard> = {}): ProfileCard => ({
  name,
  displayName: '',
  description: '',
  descriptionAuto: false,
  model: null,
  provider: null,
  skillCount: 0,
  gatewayRunning: false,
  isRoot: name === 'default',
  isDefault: name === 'default',
  path: '',
  ...extra,
});

const inputs = (extra: Partial<GatewayInputs> = {}): GatewayInputs => ({
  cards: [card('default'), card('coder'), card('writer')],
  statuses: {},
  topology: undefined,
  startedAt: {},
  ...extra,
});

describe('a gateway row', () => {
  test('takes its dot from the same ladder the profile cards use, and offers Start to a stopped gateway, Stop, Restart and Drain to a running one', () => {
    const rows = gatewayRows(
      inputs({
        statuses: {
          default: { gateway_running: true, gateway_state: 'running', gateway_pid: 4100, gateway_drainable: true, active_agents: 2 },
          coder: { gateway_running: false, gateway_state: 'stopped' },
          writer: { gateway_running: false, gateway_state: 'startup_failed', gateway_exit_reason: 'No bot token' },
        },
        startedAt: { default: '2026-10-07T08:00:00.000Z' },
      }),
    );

    expect(rows.map((row) => [row.profile, row.badge, row.statusLabel])).toEqual([
      ['default', 'online', 'Running'],
      ['coder', 'offline', 'Stopped'],
      ['writer', 'failed', 'Failed to start'],
    ]);
    expect(rows.map((row) => row.actions.map((action) => `${action.id}:${action.tier}`))).toEqual([
      ['restart:T2', 'stop:T2', 'drain:T2'],
      ['start:T1'],
      ['start:T1'],
    ]);
    expect(rows[0]).toMatchObject({ running: true, pid: 4100, startedAt: '2026-10-07T08:00:00.000Z', activeAgents: 2 });
    expect(rows[2].notes).toEqual(['Stopped with: No bot token']);
  });
});

describe('a multiplexed gateway', () => {
  const multiplexed = inputs({
    statuses: {
      default: { gateway_running: true, gateway_state: 'running', gateway_pid: 4100, gateway_shared_with: ['default', 'coder', 'writer'], gateway_drainable: true, gateway_platforms: { telegram: { state: 'connected' }, discord: { state: 'fatal' } } },
      coder: { gateway_running: true, gateway_state: 'running', gateway_pid: 4100, gateway_shared_with: ['default', 'coder', 'writer'] },
      writer: { gateway_running: true, gateway_state: 'running', gateway_pid: 4100, gateway_shared_with: ['default', 'coder', 'writer'] },
    },
    topology: { gateway_mode: 'multiplex', gateways: [{ profile: 'default', ports: { webhook: 8644 }, served_profiles: ['default', 'coder', 'writer'] }] },
    startedAt: { default: '2026-10-07T08:00:00.000Z', coder: '2026-10-07T08:00:00.000Z', writer: '2026-10-07T08:00:00.000Z' },
  });

  test('names the profile that serves a profile with none of its own, and the profiles that share the process; a served profile can be restarted, which restarts them all, but not started or stopped', () => {
    const [host, coder] = gatewayRows(multiplexed);

    expect(host).toMatchObject({ servedBy: undefined, alsoServes: ['coder', 'writer'] });
    expect(host.actions.map((action) => action.id)).toEqual(['restart', 'stop', 'drain']);
    expect(coder).toMatchObject({ servedBy: 'default', alsoServes: ['default', 'writer'] });
    expect(coder.actions.map((action) => action.id)).toEqual(['restart']);
    expect(coder.notes).toEqual(['Served by the gateway of default, which it shares with default and writer. Restarting it restarts them all.']);
    expect(host.platforms).toEqual([
      { name: 'telegram', state: 'connected' },
      { name: 'discord', state: 'fatal' },
    ]);
  });

  test('lists the running gateway processes with their pid, start time, ports and the profiles each serves', () => {
    expect(gatewayProcesses(multiplexed)).toEqual([{ owner: 'default', pid: 4100, startedAt: '2026-10-07T08:00:00.000Z', ports: [{ platform: 'webhook', port: 8644 }], serves: ['default', 'coder', 'writer'] }]);
    // One gateway for each profile: each is its own process, serving only itself.
    const separate = inputs({
      statuses: { default: { gateway_running: true, gateway_pid: 1 }, coder: { gateway_running: true, gateway_pid: 2 } },
      topology: { gateway_mode: 'multiple', gateways: [{ profile: 'default', ports: {} }, { profile: 'coder', ports: { api_server: 8642 } }] },
      startedAt: { default: '2026-10-07T07:00:00.000Z' },
    });
    expect(gatewayProcesses(separate)).toEqual([
      { owner: 'default', pid: 1, startedAt: '2026-10-07T07:00:00.000Z', ports: [], serves: ['default'] },
      { owner: 'coder', pid: 2, startedAt: undefined, ports: [{ platform: 'api_server', port: 8642 }], serves: ['coder'] },
    ]);
  });
});

describe('a gateway that is running but not well', () => {
  test('says when it has not reported in, and offers Cancel drain, not Drain, while it drains; its dot is degraded for both', () => {
    const [stuck, draining] = gatewayRows(
      inputs({
        cards: [card('default'), card('coder', { isRoot: false })],
        statuses: {
          default: { gateway_running: true, gateway_state: 'running', gateway_heartbeat_stale_s: 310, gateway_drainable: true },
          coder: { gateway_running: true, gateway_state: 'draining', gateway_drainable: false },
        },
      }),
    );

    expect(stuck.notes).toEqual(['It is running, but has not reported in for 5 min: it may be stuck.']);
    expect(stuck.actions.map((action) => action.id)).toEqual(['restart', 'stop', 'drain']);
    expect(draining).toMatchObject({ badge: 'degraded', statusLabel: 'Draining' });
    expect(draining.actions.map((action) => action.id)).toEqual(['restart', 'stop', 'cancel-drain']);
  });

  test('plainDuration says seconds, minutes, hours and days', () => {
    expect([14.9, 59, 60, 310, 3600, 7300, 86_400, 200_000].map(plainDuration)).toEqual(['14 s', '59 s', '1 min', '5 min', '1 h', '2 h', '1 d', '2 d']);
  });
});

/** The shape of Hermes 0.21.4's `GET /api/gateway/migrate/plan` (`MigrationPlan.to_dict`). */
const plan = (extra: Record<string, unknown> = {}) => ({
  default_home: '/Users/x/.hermes',
  profiles: [
    { profile: 'default', home: '/Users/x/.hermes', pid: 4100, service: { kind: 'launchd', system: false }, services: [{ kind: 'launchd', system: false }] },
    { profile: 'coder', home: '/Users/x/.hermes/profiles/coder', pid: 4200, service: null, services: [] },
  ],
  multiplex_flag_on: false,
  live_served: null,
  already_multiplexed: false,
  interrupted: false,
  blockers: [],
  notices: ['Profiles created after the migration are served by the running multiplexer as soon as they exist.'],
  eligible: true,
  command: 'hermes gateway migrate --multiplex',
  ...extra,
});

describe('the migration plan', () => {
  test('can be run when nothing blocks it, and says which gateways it replaces', () => {
    const view = migrationView(plan());

    expect(view).toMatchObject({ state: 'ready', canRun: true, blockers: [], command: 'hermes gateway migrate --multiplex' });
    expect(view.gateways).toEqual([
      { profile: 'default', pid: 4100, service: 'launchd' },
      { profile: 'coder', pid: 4200, service: undefined },
    ]);
    expect(view.notices).toHaveLength(1);
  });

  test('cannot be run while any blocker remains, and lists every blocker', () => {
    const view = migrationView(plan({ blockers: ['Profile coder uses a different Unix user than default.', 'Port 8644 is claimed by both default and writer.'], eligible: false }));

    expect(view).toMatchObject({ state: 'blocked', canRun: false });
    expect(view.blockers).toEqual(['Profile coder uses a different Unix user than default.', 'Port 8644 is claimed by both default and writer.']);
  });

  test('has nothing to do for one profile or a host that already runs one gateway, and resumes a migration that was interrupted; a plan that cannot be read cannot be run', () => {
    expect(migrationView(plan({ profiles: [plan().profiles[0]], notices: ['Only one profile exists: nothing to multiplex.'] }))).toMatchObject({ state: 'nothing', canRun: false });
    expect(migrationView(plan({ already_multiplexed: true, multiplex_flag_on: true }))).toMatchObject({ state: 'done', canRun: false });
    expect(migrationView(plan({ interrupted: true, multiplex_flag_on: true }))).toMatchObject({ state: 'resume', canRun: true });
    expect(migrationView(undefined)).toMatchObject({ state: 'unknown', canRun: false });
    expect(migrationView({ detail: 'nope' })).toMatchObject({ state: 'unknown', canRun: false });
  });
});

describe('the restart-to-apply banner', () => {
  const pending = { profile: 'coder', reasons: ['Channel settings saved', 'Config saved'], raisedAt: '2026-10-07T09:00:00.000Z' };

  test('names the profile and what changed, and offers the restart in place', () => {
    expect(restartBanner(pending, { running: true })).toEqual({
      id: 'gateway-restart:coder',
      title: 'Restart the gateway of coder to apply your changes',
      body: 'Channel settings saved · Config saved',
      action: 'restart',
    });
  });

  test('offers Start instead when that profile’s gateway is stopped', () => {
    expect(restartBanner(pending, { running: false })).toMatchObject({ title: 'Start the gateway of coder to apply your changes', action: 'start' });
  });
});

describe('a host with no gateway configured', () => {
  const stopped = gatewayRows(inputs({ statuses: { default: { gateway_running: false }, coder: { gateway_running: false }, writer: { gateway_running: false } } }));
  const running = gatewayRows(inputs({ statuses: { default: { gateway_running: true } } }));

  test('is no gateway running and no channel set up; any running gateway, or a channel that is set up, is something to show', () => {
    expect(isUnconfigured(stopped, 0)).toBe(true);
    expect(isUnconfigured(stopped, 2)).toBe(false);
    expect(isUnconfigured(running, 0)).toBe(false);
    // Hermes did not say how many channels there are: nothing is assumed.
    expect(isUnconfigured(stopped, undefined)).toBe(false);
  });

  test('counts the channels Hermes says are set up, from its platform list', () => {
    const platforms = { platforms: [{ id: 'telegram', configured: true }, { id: 'discord', configured: false }, { id: 'slack', configured: true }] };

    expect(configuredChannels(platforms)).toBe(2);
    expect(configuredChannels({ platforms: [] })).toBe(0);
    expect(configuredChannels({ detail: 'x' })).toBeUndefined();
    expect(configuredChannels(undefined)).toBeUndefined();
  });
});
