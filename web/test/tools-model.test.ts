import { describe, expect, test } from 'vitest';
import { computerUseGrant, filterToolsets, readToggleAnswer, parseComputerUse, parsePortal, parseToolsets, platformGrid, platformJson, platformToolsetsUpdate, parsePlatformJson, readPlatformToolsets, setCell, setupResult, type PlatformToolsets } from '../src/modules/tools/tools-model.ts';

const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: name.toUpperCase(), description: '', platform: 'cli', platform_label: 'CLI', enabled: true, available: true, configured: true, tools: [`${name}_tool`], ...extra });

const toolsets = parseToolsets([row('web'), row('terminal'), row('x_search', { enabled: false }), row('stt', { tools: [] }), row('discord', { platform: 'discord', platform_label: 'Discord', enabled: false })]);
const platforms = [
  { id: 'telegram', name: 'Telegram' },
  { id: 'discord', name: 'Discord' },
];
const noKnown = { knownBuiltin: {}, knownPlugin: {} };

describe('the grid of platforms and toolsets', () => {
  test('its columns are the toolsets that have tools of their own: one Hermes switches on elsewhere (speech-to-text) is not per platform', () => {
    const grid = platformGrid({}, toolsets, platforms);

    expect(grid.columns.map((column) => column.name)).toEqual(['web', 'terminal', 'x_search', 'discord']);
  });

  test('the CLI row is always there; with nothing saved it shows what Hermes reports as on, and it is not a saved list', () => {
    const grid = platformGrid({}, toolsets, platforms);

    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0]).toMatchObject({ platform: 'cli', label: 'CLI', saved: false, cells: { web: 'on', terminal: 'on', x_search: 'off', discord: 'unavailable' }, other: [] });
  });

  test('a platform with a saved list has a row after the CLI’s; an entry that is no column (a bundle, an MCP server) is kept apart and shown', () => {
    const grid = platformGrid({ telegram: ['web', 'hermes-cli', 'linear'], cli: ['terminal'] }, toolsets, platforms);

    expect(grid.rows.map((entry) => entry.platform)).toEqual(['cli', 'telegram']);
    expect(grid.rows[1]).toMatchObject({ label: 'Telegram', saved: true, cells: { web: 'on', terminal: 'off', x_search: 'off', discord: 'unavailable' }, other: ['hermes-cli', 'linear'] });
    expect(grid.rows[0].cells.terminal).toBe('on');
  });

  test('a toolset that belongs to one platform is a cell only on that platform’s row', () => {
    const grid = platformGrid({ discord: ['web', 'discord'] }, toolsets, platforms);

    expect(grid.rows.find((entry) => entry.platform === 'discord')!.cells.discord).toBe('on');
    expect(grid.rows[0].cells.discord).toBe('unavailable');
  });

  test('the first change to a row with nothing saved writes the list it showed, with that change; the entries it keeps are not touched', () => {
    const grid = platformGrid({}, toolsets, platforms);

    expect(setCell({}, grid.rows[0], 'x_search', true)).toEqual({ cli: ['terminal', 'web', 'x_search'] });
    const withOther = platformGrid({ telegram: ['web', 'linear'] }, toolsets, platforms);
    expect(setCell({ telegram: ['web', 'linear'] }, withOther.rows[1], 'web', false)).toEqual({ telegram: ['linear'] });
    expect(setCell({ telegram: ['web', 'linear'] }, withOther.rows[1], 'terminal', true)).toEqual({ telegram: ['linear', 'terminal', 'web'] });
  });

  test('a cell that cannot apply is not changed', () => {
    const grid = platformGrid({}, toolsets, platforms);

    expect(setCell({}, grid.rows[0], 'discord', true)).toEqual({});
  });
});

describe('reading the saved value', () => {
  test('is the platform_toolsets of Hermes’s config, nothing when none is saved, and an entry that is not a list is left out', () => {
    expect(readPlatformToolsets({ platform_toolsets: { cli: ['web'], telegram: 'web', discord: ['discord', 3] }, known_builtin_toolsets: { cli: ['web'] }, known_plugin_toolsets: { cli: ['a2a'] } })).toEqual({
      value: { cli: ['web'], discord: ['discord'] },
      knownBuiltin: { cli: ['web'] },
      knownPlugin: { cli: ['a2a'] },
    });
    expect(readPlatformToolsets({ model: '' }).value).toEqual({});
    expect(readPlatformToolsets(undefined).value).toEqual({});
  });
});

describe('the advanced JSON', () => {
  test('is the same value as the grid, written out', () => {
    const value: PlatformToolsets = { cli: ['terminal', 'web'], telegram: [] };

    expect(JSON.parse(platformJson(value))).toEqual(value);
    expect(parsePlatformJson(platformJson(value))).toEqual({ ok: true, value });
  });

  test.each([
    ['', 'Type a JSON object, such as {"cli": ["web"]}.'],
    ['{', 'This is not valid JSON.'],
    ['[]', 'The value must be an object with a list of toolsets for each platform.'],
    ['{"cli": "web"}', 'cli: the toolsets must be a list of names, such as ["web", "terminal"].'],
    ['{"cli": ["web", 3]}', 'cli: every toolset must be a name in quotes.'],
    ['{"cli": ["web", ""]}', 'cli: a toolset name cannot be empty.'],
    ['{" ": ["web"]}', 'A platform name cannot be empty.'],
  ])('%j is refused: %s', (text, message) => {
    expect(parsePlatformJson(text)).toEqual({ ok: false, message });
  });
});

describe('saving', () => {
  const columns = ['web', 'terminal', 'x_search'];

  test('writes only the platforms that changed, as sorted lists, and records every toolset the grid offered so one that was switched off stays off', () => {
    const saved = { cli: ['terminal', 'web'], telegram: ['web'] };
    const draft = { cli: ['terminal', 'web'], telegram: ['x_search', 'web'] };

    expect(platformToolsetsUpdate('coder', saved, draft, columns, { knownBuiltin: { telegram: ['kanban'] }, knownPlugin: {} })).toEqual({
      method: 'PUT',
      path: '/api/config?profile=coder',
      body: { config: { platform_toolsets: { telegram: ['web', 'x_search'] }, known_builtin_toolsets: { telegram: ['kanban', 'terminal', 'web', 'x_search'] }, known_plugin_toolsets: { telegram: ['terminal', 'web', 'x_search'] } } },
    });
  });

  test('a platform that was dropped is written as empty so that Hermes goes back to its default for it', () => {
    const request = platformToolsetsUpdate('default', { cli: ['web'], telegram: ['web'] }, { cli: ['web'] }, columns, noKnown);

    expect(request?.body).toEqual({ config: { platform_toolsets: { telegram: null } } });
  });

  test('nothing changed is nothing to send', () => {
    expect(platformToolsetsUpdate('default', { cli: ['web', 'terminal'] }, { cli: ['terminal', 'web'] }, columns, noKnown)).toBeUndefined();
  });
});

describe('how a setup ended', () => {
  test('is a success when Hermes exited 0 and said nothing went wrong', () => {
    expect(setupResult({ exitCode: 0, lines: ['Running post-setup hook: faster_whisper', '    faster-whisper is already installed', ''] })).toEqual({ ok: true });
  });

  test('is a failure with Hermes’s last line when it exited with an error, or with no code at all', () => {
    expect(setupResult({ exitCode: 1, lines: ['Running post-setup hook: x', 'Post-setup failed: boom', ''] })).toEqual({ ok: false, message: 'Hermes stopped with exit code 1. It said: Post-setup failed: boom' });
    expect(setupResult({ exitCode: null, lines: [] })).toEqual({ ok: false, message: 'Hermes stopped with exit code unknown.' });
  });

  test('is a failure when Hermes exited 0 but a step printed that it failed, which Hermes’s hooks do for an install that did not work', () => {
    expect(setupResult({ exitCode: 0, lines: ['    Installing kittentts...', '    kittentts install failed:', '  no network'] })).toEqual({ ok: false, message: 'Hermes finished but a step did not work. It said: kittentts install failed:' });
  });
});

describe('the Tool gateway card', () => {
  test('a feature Hermes routes through the Portal is told apart from one it runs another way, and a missing field is not a failure', () => {
    const portal = parsePortal({
      logged_in: true,
      portal_url: 'https://portal.example',
      free_tier: true,
      account_tier: 'plus',
      provider: 'nous',
      subscription_url: 'https://portal.example/manage',
      features: [
        { label: 'Web tools', state: 'via Nous Portal' },
        { label: 'Browser automation', state: 'Local browser' },
        { nope: 1 },
      ],
    });

    expect(portal).toEqual({
      loggedIn: true,
      freeTier: true,
      accountTier: 'plus',
      provider: 'nous',
      portalUrl: 'https://portal.example',
      subscriptionUrl: 'https://portal.example/manage',
      features: [
        { label: 'Web tools', state: 'via Nous Portal', viaPortal: true },
        { label: 'Browser automation', state: 'Local browser', viaPortal: false },
      ],
    });
    expect(parsePortal(undefined)).toMatchObject({ loggedIn: false, features: [] });
  });
});

describe('computer use', () => {
  const status = (extra: Record<string, unknown>) => ({ platform: 'darwin', platform_supported: true, installed: true, version: '0.4.1', ready: null, can_grant: true, checks: [], source: null, error: null, accessibility: null, screen_recording: null, screen_recording_capturable: null, ...extra });

  test.each([
    [{ platform: 'freebsd', platform_supported: false, installed: false, can_grant: false }, 'unsupported'],
    [{ installed: false }, 'not-installed'],
    [{ error: 'cua-driver permissions status timed out' }, 'error'],
    [{ ready: true, accessibility: true, screen_recording: true }, 'ready'],
    [{ ready: false, accessibility: true, screen_recording: false }, 'needs-permission'],
    [{ ready: null }, 'unknown'],
  ])('%j is %s', (extra, state) => {
    expect(parseComputerUse(status(extra)).state).toBe(state);
  });

  test('keeps what Hermes says of each permission, the driver’s own checks and its error', () => {
    expect(parseComputerUse(status({ ready: false, accessibility: true, screen_recording: false, screen_recording_capturable: false, checks: [{ label: 'Daemon', status: 'ok', message: 'running' }, { nope: 1 }], error: null }))).toMatchObject({
      version: '0.4.1',
      accessibility: true,
      screenRecording: false,
      capturable: false,
      canGrant: true,
      checks: [{ label: 'Daemon', status: 'ok', message: 'running' }],
    });
  });

  test('granting is a POST for the profile', () => {
    expect(computerUseGrant('coder')).toEqual({ method: 'POST', path: '/api/tools/computer-use/permissions/grant?profile=coder' });
  });
});

describe('finding a toolset', () => {
  const all = parseToolsets([row('web', { label: 'Web Search & Scraping', description: 'web_search, web_extract' }), row('vision', { configured: false }), row('video', { enabled: false }), row('kanban', { enabled: false, configured: false, description: 'task board' })]);

  test('search matches the label, the key, the description and the names of the tools, in any case', () => {
    expect(filterToolsets(all, { query: 'SCRAP', show: 'all' }).map((toolset) => toolset.name)).toEqual(['web']);
    expect(filterToolsets(all, { query: 'task board', show: 'all' }).map((toolset) => toolset.name)).toEqual(['kanban']);
    expect(filterToolsets(all, { query: 'video_tool', show: 'all' }).map((toolset) => toolset.name)).toEqual(['video']);
    expect(filterToolsets(all, { query: '  ', show: 'all' })).toHaveLength(4);
  });

  test('On, Off and Needs keys keep to that state', () => {
    expect(filterToolsets(all, { query: '', show: 'on' }).map((toolset) => toolset.name)).toEqual(['web', 'vision']);
    expect(filterToolsets(all, { query: '', show: 'off' }).map((toolset) => toolset.name)).toEqual(['video', 'kanban']);
    expect(filterToolsets(all, { query: '', show: 'needs-keys' }).map((toolset) => toolset.name)).toEqual(['vision', 'kanban']);
  });
});

describe('what Hermes says of a switch', () => {
  test('names the install it started because the toolset’s tool was not installed, and nothing when it started none', () => {
    expect(readToggleAnswer({ ok: true, name: 'computer_use', enabled: true, post_setup_started: 'cua_driver' })).toEqual({ installStarted: 'cua_driver' });
    expect(readToggleAnswer({ ok: true, post_setup_started: null })).toEqual({ installStarted: undefined });
    expect(readToggleAnswer(undefined)).toEqual({ installStarted: undefined });
  });
});
