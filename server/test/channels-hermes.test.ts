import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { behaviourSections, behaviourUpdate, changedBehaviour, channelTestPath, channelUpdate, parseChannels, readSaveAnswer, readTestAnswer, validateChannelForm } from '../../web/src/modules/channels/channels-model.ts';
import { guardPlatformSecrets } from '../src/channel-secrets.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Connect › Channels (M5 #02) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The page's own
// reading and request code (`web/src/modules/channels/channels-model.ts`) is run over what Hermes really answers. No platform is
// ever contacted: a bot token written here is only a string in the temp home's `.env`.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T; headers: Headers; text: string }>;
  /** The typed confirmation of a T3 request, as the tiered dialog makes it: its token. */
  confirm(operation: string, target: string, body?: unknown): Promise<string>;
}

/** The owner signed in at the server; with `steppedUp`, a passkey step-up too (what a Tier 2 action asks for). */
async function start({ steppedUp = true }: { steppedUp?: boolean } = {}): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call: Owner['call'] = async (method, route, { body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: (text.startsWith('{') ? JSON.parse(text) : text) as never };
  };
  const confirm: Owner['confirm'] = async (operation, target, body) => {
    const bodySha256 = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation, target, typed: target, ...(bodySha256 ? { bodySha256 } : {}) } });
    return minted.body.token;
  };
  return { call, confirm };
}

const RAW_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789';

describe('the list of channels', () => {
  test('is Hermes’s own list of platforms, read by the page’s code, and it is never kept by a cache', async () => {
    const owner = await start();

    const answer = await owner.call('GET', '/api/messaging/platforms?profile=default');
    const { channels, startCommand } = parseChannels(answer.body);

    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(channels.length).toBeGreaterThanOrEqual(23);
    expect(channels.map((channel) => channel.id)).toEqual(expect.arrayContaining(['telegram', 'discord', 'slack', 'whatsapp', 'matrix', 'signal', 'email']));
    // The command is Hermes's own wording, shown as Hermes says it: since 0.22 it names the profile (`hermes -p default gateway start`).
    expect(startCommand).toMatch(/^hermes( -p [\w-]+)? gateway start$/);
    expect(startCommand).toBe(((answer.body as { gateway_start_command: string }).gateway_start_command));
    const telegram = channels.find((channel) => channel.id === 'telegram')!;
    expect(telegram).toMatchObject({ name: 'Telegram', enabled: false, configured: false });
    expect(telegram.fields.find((field) => field.key === 'TELEGRAM_BOT_TOKEN')).toMatchObject({ required: true, secret: true, isSet: false, redacted: null });
  });
});

const telegramOf = async (owner: Owner, profile = 'default') => parseChannels((await owner.call('GET', `/api/messaging/platforms?profile=${profile}`)).body).channels.find((channel) => channel.id === 'telegram')!;

describe('saving a channel', () => {
  test('is Tier 2: without a passkey step-up Hermes is not asked and nothing changes', async () => {
    const owner = await start({ steppedUp: false });
    const request = channelUpdate('telegram', 'default', { values: { TELEGRAM_BOT_TOKEN: RAW_TOKEN }, enabled: true });

    const refused = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(await telegramOf(owner)).toMatchObject({ enabled: false, configured: false });
  });

  test('writes through Hermes, is audited by name and profile with no value in it, and what comes back is only Hermes’s redaction', async () => {
    const owner = await start();
    const request = channelUpdate('telegram', 'default', { values: { TELEGRAM_BOT_TOKEN: RAW_TOKEN, TELEGRAM_ALLOWED_USERS: '1001, 1002' }, enabled: true });

    const saved = await owner.call(request.method, request.path, { body: request.body });
    const listed = await owner.call('GET', '/api/messaging/platforms?profile=default');
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(saved.status).toBe(200);
    expect(readSaveAnswer(saved.body)).toEqual({ needsRestart: true });
    expect(fs.readFileSync(path.join(hermes.home, '.env'), 'utf8')).toContain(`TELEGRAM_BOT_TOKEN=${RAW_TOKEN}`);
    const telegram = parseChannels(listed.body).channels.find((channel) => channel.id === 'telegram')!;
    expect(telegram).toMatchObject({ enabled: true, configured: true });
    // What comes back is Hermes's redaction of the token (`1234...6789`; Hermes 0.22 marks it `«redacted:1234...6789»`, and the page shows it without the marker), never the token.
    const hermesToken = ((await (await hermes.backend.fetch('/api/messaging/platforms?profile=default')).json()) as { platforms: { id: string; env_vars: { key: string; redacted_value: string }[] }[] }).platforms
      .find((platform) => platform.id === 'telegram')!.env_vars.find((field) => field.key === 'TELEGRAM_BOT_TOKEN')!;
    expect(hermesToken.redacted_value).not.toContain(RAW_TOKEN);
    expect(hermesToken.redacted_value).toMatch(/^«redacted:.+»$/);
    expect(telegram.fields.find((field) => field.key === 'TELEGRAM_BOT_TOKEN')).toMatchObject({ isSet: true, redacted: hermesToken.redacted_value.replace(/^«redacted:(.*)»$/, '$1') });
    expect(telegram.fields.find((field) => field.key === 'TELEGRAM_BOT_TOKEN')!.redacted).toMatch(/^\d{4}\.\.\.\d{4}$/);
    expect(telegram.fields.find((field) => field.key === 'TELEGRAM_ALLOWED_USERS')).toMatchObject({ isSet: true, redacted: '***' });
    // Nothing that reaches the browser or the audit trail has the token, or the user ids.
    expect(listed.text).not.toContain(RAW_TOKEN);
    expect(audit.text).not.toContain(RAW_TOKEN);
    expect(audit.text).not.toContain('1002');
    expect(audit.body.entries.find((entry) => entry.action === 'PUT /api/messaging/platforms/{platform_id}')).toMatchObject({ tier: 'T2', target: '/api/messaging/platforms/telegram', profile: 'default' });
  });

  test('a value Hermes does not accept is refused with Hermes’s own words, which are the words the form shows, and nothing is saved', async () => {
    const owner = await start();
    const problems = [
      ['telegram', 'TELEGRAM_BOT_TOKEN', 'nope'],
      ['telegram', 'TELEGRAM_ALLOWED_USERS', '12, x'],
      ['slack', 'SLACK_BOT_TOKEN', 'xapp-1'],
      ['slack', 'SLACK_APP_TOKEN', 'xoxb-1'],
      ['slack', 'SLACK_ALLOWED_USERS', 'U01ABC2DEF3, nobody'],
    ] as const;

    for (const [id, key, value] of problems) {
      const channel = parseChannels((await owner.call('GET', '/api/messaging/platforms?profile=default')).body).channels.find((entry) => entry.id === id)!;
      const request = channelUpdate(id, 'default', { values: { [key]: value } });
      const refused = await owner.call<{ detail: string }>(request.method, request.path, { body: request.body });
      expect(refused.status).toBe(400);
      expect(validateChannelForm(channel, { [key]: value })[key]).toBe(refused.body.detail);
    }
  });

  test('Test says what Hermes says: why it cannot pass for a platform that is off, and that is its message word for word', async () => {
    const owner = await start();
    const answer = await owner.call('POST', channelTestPath('discord', 'default'));

    expect(answer.status).toBe(200);
    expect(readTestAnswer(answer.body)).toEqual({ ok: false, message: 'Discord is disabled. Enable it, then restart the gateway.' });
    const unknown = await owner.call<{ detail: string }>('POST', channelTestPath('nope', 'default'));
    expect(unknown.status).toBe(404);
    expect(unknown.body.detail).toBe('Unknown messaging platform: nope');
  });
});

describe('a channel’s behaviour settings', () => {
  const discordSection = async (owner: Owner) => {
    const schema = (await owner.call('GET', '/api/config/schema?profile=default')).body;
    const config = (await owner.call('GET', '/api/config?profile=default')).body;
    return behaviourSections(schema, config, 'discord');
  };

  test('take their types from Hermes’s schema and their values from its config, and a save is a Tier 3 config write that changes only that key', async () => {
    const owner = await start();
    const [channel] = await discordSection(owner);
    const autoThread = channel.fields.find((field) => field.key === 'discord.auto_thread')!;
    expect(autoThread).toMatchObject({ kind: 'boolean', value: true });
    expect(channel.fields.find((field) => field.key === 'discord.history_backfill_limit')).toMatchObject({ kind: 'number', value: 50 });
    const shared = (await discordSection(owner)).find((section) => section.id === 'shared')!;
    expect(shared.fields.find((field) => field.key === 'human_delay.mode')).toMatchObject({ kind: 'select', options: ['off', 'typing', 'fixed'] });

    const request = behaviourUpdate('default', changedBehaviour(channel.fields, { 'discord.auto_thread': false }));
    const unconfirmed = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
    expect(unconfirmed.body.error).toBe('confirmation-required');
    const token = await owner.confirm(`${request.method} ${request.path}`, 'default', request.body);
    const saved = await owner.call(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': token } });

    expect(saved.status).toBe(200);
    const [after] = await discordSection(owner);
    expect(after.fields.find((field) => field.key === 'discord.auto_thread')!.value).toBe(false);
    expect(after.fields.find((field) => field.key === 'discord.history_backfill_limit')!.value).toBe(50);
    expect(fs.readFileSync(path.join(hermes.home, 'config.yaml'), 'utf8')).toMatch(/auto_thread: false/);
  });
});

describe('the second lock on a channel\'s credentials', () => {
  const shown = (redacted: unknown) => {
    const guarded = guardPlatformSecrets({ platforms: [{ id: 'x', env_vars: [{ key: 'K', redacted_value: redacted }] }] }) as { platforms: { env_vars: { redacted_value: unknown }[] }[] };
    return guarded.platforms[0].env_vars[0].redacted_value;
  };

  test('lets Hermes\'s redaction through, with or without the 0.22 marker, and nothing else: a value that could be a secret is replaced by the mask', () => {
    expect(shown('1234...6789')).toBe('1234...6789');
    expect(shown('«redacted:1234...6789»')).toBe('1234...6789');
    expect(shown('«redacted:***»')).toBe('***');
    expect(shown('***')).toBe('***');
    expect(shown(null)).toBeNull();
    expect(shown(RAW_TOKEN)).toBe('***');
    expect(shown(`«redacted:${RAW_TOKEN}»`)).toBe('***');
  });
});
