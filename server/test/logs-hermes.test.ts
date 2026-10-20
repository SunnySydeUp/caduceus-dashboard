import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { LOG_FILES } from '../src/log-files.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { logLine, writeLog } from './fixtures/seed-logs.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Observe › Logs (M5 #06) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The log files are written
// the way Hermes's handlers write them; what is filtered, and how, is Hermes's own answer to `GET /api/logs`.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const streams: EventStream[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(path.join(hermes.home, 'logs'), { recursive: true, force: true });
});

/** The owner signed in at a server that asks Hermes for new log lines every 20 ms (a real second would only slow the tests down). */
async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, logPollMs: 20 });
  const { url } = server;
  const cookie = await ownerCookie(url);
  return {
    url,
    cookie,
    async watch(query: string) {
      const stream = await openEventStream(url, `/_caduceus/api/logs/stream${query}`, cookie);
      streams.push(stream);
      return stream;
    },
  };
}

describe('the live tail of a log', () => {
  test('starts with the lines Hermes gives for the filters in the query, then pushes the lines that are written after, filtered the same way', async () => {
    writeLog(hermes.home, 'gateway.log', [logLine(0, 'INFO', 'gateway.run', 'started'), logLine(1, 'ERROR', 'tools.terminal_tool', 'boom one'), logLine(2, 'WARNING', 'agent.core', 'careful')]);
    const owner = await start();

    const stream = await owner.watch('?file=gateway&level=ERROR&lines=100');
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('no-store');
    expect(await stream.next()).toEqual({ event: 'replace', data: { kind: 'replace', lines: [logLine(1, 'ERROR', 'tools.terminal_tool', 'boom one')] } });

    writeLog(hermes.home, 'gateway.log', [logLine(3, 'INFO', 'gateway.run', 'quiet'), logLine(4, 'CRITICAL', 'agent.core', 'boom two')]);

    expect(await stream.next()).toEqual({ event: 'append', data: { kind: 'append', lines: [logLine(4, 'CRITICAL', 'agent.core', 'boom two')] } });
  });
});

describe('what the query hands to Hermes', () => {
  test('search and component are Hermes’s own filters, and an unknown component is Hermes’s refusal, told on the stream before it ends', async () => {
    writeLog(hermes.home, 'gateway.log', [logLine(0, 'INFO', 'gateway.run', 'connected telegram'), logLine(1, 'INFO', 'cron.scheduler', 'tick telegram'), logLine(2, 'INFO', 'gateway.run', 'connected discord')]);
    const owner = await start();

    const searched = await owner.watch('?file=gateway&component=gateway&search=TELEGRAM');
    const refused = await owner.watch('?file=gateway&component=nope');

    expect(await searched.next()).toEqual({ event: 'replace', data: { kind: 'replace', lines: [logLine(0, 'INFO', 'gateway.run', 'connected telegram')] } });
    const rejection = await refused.next();
    expect(rejection.event).toBe('rejected');
    expect(rejection.data).toMatchObject({ kind: 'rejected', message: expect.stringContaining('Unknown component: nope') });
    await expect(refused.next()).rejects.toThrow('ended');
  });

  test('a view that is not one (no number of lines, too many of them) is refused, and so is a request with no session', async () => {
    const owner = await start();

    expect((await openEventStream(owner.url, '/_caduceus/api/logs/stream?lines=0', owner.cookie)).status).toBe(400);
    expect((await openEventStream(owner.url, '/_caduceus/api/logs/stream?lines=501', owner.cookie)).status).toBe(400);
    expect((await openEventStream(owner.url, '/_caduceus/api/logs/stream?lines=ten', owner.cookie)).status).toBe(400);
    expect((await openEventStream(owner.url, '/_caduceus/api/logs/stream', '')).status).toBe(401);
  });
});

describe('several clients on one view', () => {
  test('each is told the same new lines, and one leaving does not end the others', async () => {
    writeLog(hermes.home, 'errors.log', [logLine(0, 'ERROR', 'agent.core', 'first')]);
    const owner = await start();
    const one = await owner.watch('?file=errors');
    const two = await owner.watch('?file=errors');
    expect((await one.next()).event).toBe('replace');
    expect((await two.next()).event).toBe('replace');

    one.close();
    writeLog(hermes.home, 'errors.log', [logLine(1, 'ERROR', 'agent.core', 'second')]);

    expect(await two.next()).toEqual({ event: 'append', data: { kind: 'append', lines: [logLine(1, 'ERROR', 'agent.core', 'second')] } });
  });

  test('the stream of a session that signs out ends with it', async () => {
    const owner = await start();
    const stream = await owner.watch('?file=agent');
    expect((await stream.next()).event).toBe('replace');

    const out = await fetch(`${owner.url}/_caduceus/api/auth/sign-out`, { method: 'POST', headers: { origin: owner.url, cookie: owner.cookie } });

    expect(out.ok).toBe(true);
    await expect(stream.next()).rejects.toThrow('ended');
  });
});

describe('truncating a log file', () => {
  /** The owner with a passkey step-up, calling the Caduceus API the way the page does (a JSON body, an optional typed confirmation). */
  async function steppedUpOwner() {
    const owner = await start();
    await stepUp(owner.url, owner.cookie, await addPasskey(owner.url, owner.cookie));
    const call = async (method: string, route: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) => {
      const res = await fetch(`${owner.url}${route}`, {
        method,
        headers: { origin: owner.url, cookie: owner.cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as Record<string, unknown> };
    };
    /** Asks for `POST /_caduceus/api/logs/truncate` with `body` to be confirmed by typing `typed`, and gives the header the request must carry. */
    const confirmed = async (body: Record<string, unknown>, typed: string) => {
      const bodySha256 = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const minted = await call('POST', '/_caduceus/api/policy/confirmations', { operation: 'POST /_caduceus/api/logs/truncate', target: typed, typed, bodySha256 });
      return { 'x-caduceus-confirmation': String(minted.body.token) };
    };
    return { ...owner, call, confirmed };
  }

  test('is Tier 3: it needs the passkey and the typed file name, and without them nothing is emptied', async () => {
    const file = writeLog(hermes.home, 'agent.log', [logLine(0, 'INFO', 'agent.core', 'keep me')]);
    const owner = await start();
    const post = (headers?: Record<string, string>) =>
      fetch(`${owner.url}/_caduceus/api/logs/truncate`, { method: 'POST', headers: { origin: owner.url, cookie: owner.cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ file: 'agent' }) });

    const withoutPasskey = await post();
    expect(withoutPasskey.status).toBe(403);
    expect(await withoutPasskey.json()).toMatchObject({ error: 'step-up-required', tier: 'T3' });

    await stepUp(owner.url, owner.cookie, await addPasskey(owner.url, owner.cookie));
    const withoutTyping = await post();
    expect(withoutTyping.status).toBe(403);
    expect(await withoutTyping.json()).toMatchObject({ error: 'confirmation-required', tier: 'T3' });

    expect(fs.readFileSync(file, 'utf8')).toContain('keep me');
  });
  test('with the passkey and the typed file name it empties that file only, says how much it held, and is audited with the file and the profile', async () => {
    // `errors.log` and `gateway.log` are quiet in this home; Hermes itself writes to `agent.log` while it runs.
    const errors = writeLog(hermes.home, 'errors.log', [logLine(0, 'ERROR', 'agent.core', 'one'), logLine(1, 'ERROR', 'agent.core', 'two')]);
    const gateway = writeLog(hermes.home, 'gateway.log', [logLine(2, 'INFO', 'gateway.run', 'kept')]);
    const size = fs.statSync(errors).size;
    const owner = await steppedUpOwner();
    const body = { file: 'errors' };

    const done = await owner.call('POST', '/_caduceus/api/logs/truncate', body, await owner.confirmed(body, 'errors.log'));
    const audit = await owner.call('GET', '/_caduceus/api/audit');

    expect(done).toEqual({ status: 200, body: { truncated: true, file: 'errors', bytes: size } });
    expect(fs.statSync(errors).size).toBe(0);
    expect(fs.readFileSync(gateway, 'utf8')).toContain('kept');
    const entries = (audit.body as { entries: Record<string, unknown>[] }).entries;
    expect(entries.find((entry) => entry.action === 'logs.truncate')).toMatchObject({ target: 'errors.log', tier: 'T3', profile: 'default' });
    expect(entries.find((entry) => entry.action === 'POST /_caduceus/api/logs/truncate')).toMatchObject({ tier: 'T3' });
    // Hermes appends: a line written after starts the file again, and the tail shows it.
    writeLog(hermes.home, 'errors.log', [logLine(3, 'ERROR', 'agent.core', 'fresh')]);
    expect(fs.readFileSync(errors, 'utf8')).toBe(`${logLine(3, 'ERROR', 'agent.core', 'fresh')}\n`);
  });

  test('a confirmation is for the file it was typed for, once: another file, or the same one twice, is refused and nothing is emptied', async () => {
    const gateway = writeLog(hermes.home, 'gateway.log', [logLine(0, 'INFO', 'gateway.run', 'gateway line')]);
    const errors = writeLog(hermes.home, 'errors.log', [logLine(1, 'ERROR', 'agent.core', 'errors line')]);
    const owner = await steppedUpOwner();

    const forGateway = await owner.confirmed({ file: 'gateway' }, 'gateway.log');
    const other = await owner.call('POST', '/_caduceus/api/logs/truncate', { file: 'errors' }, forGateway);
    expect(other.status).toBe(403);
    expect(other.body).toMatchObject({ error: 'confirmation-invalid', tier: 'T3' });

    const again = await owner.confirmed({ file: 'gateway' }, 'gateway.log');
    expect((await owner.call('POST', '/_caduceus/api/logs/truncate', { file: 'gateway' }, again)).status).toBe(200);
    expect((await owner.call('POST', '/_caduceus/api/logs/truncate', { file: 'gateway' }, again)).body).toMatchObject({ error: 'confirmation-invalid' });

    expect(fs.statSync(gateway).size).toBe(0);
    expect(fs.readFileSync(errors, 'utf8')).toContain('errors line');
  });

  test('is refused in read-only mode, even with a confirmation, and nothing is emptied', async () => {
    const agent = writeLog(hermes.home, 'agent.log', [logLine(0, 'INFO', 'agent.core', 'keep me')]);
    const owner = await steppedUpOwner();
    const body = { file: 'agent' };
    const headers = await owner.confirmed(body, 'agent.log');
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });

    const refused = await owner.call('POST', '/_caduceus/api/logs/truncate', body, headers);

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'read-only', tier: 'T3' });
    expect(fs.readFileSync(agent, 'utf8')).toContain('keep me');
  });

  test('touches only Hermes’s log files in a profile’s logs directory: no other name, no path, no link, no profile outside the root', async () => {
    const outside = path.join(hermes.home, 'outside.txt');
    fs.writeFileSync(outside, 'not a log');
    fs.mkdirSync(path.join(hermes.home, 'logs'), { recursive: true });
    fs.symlinkSync(outside, path.join(hermes.home, 'logs', 'gui.log'));
    fs.writeFileSync(path.join(hermes.home, '.env'), 'SECRET=1');
    const owner = await steppedUpOwner();
    const attempt = async (body: Record<string, unknown>) => (await owner.call('POST', '/_caduceus/api/logs/truncate', body, await owner.confirmed(body, 'x'))).body;

    expect(await attempt({ file: '../.env' })).toEqual({ error: 'unknown-file' });
    expect(await attempt({ file: 'config' })).toEqual({ error: 'unknown-file' });
    expect(await attempt({ file: 'errors', profile: '../..' })).toEqual({ error: 'unknown-profile' });
    expect(await attempt({ file: 'errors', profile: 'nobody' })).toEqual({ error: 'unknown-profile' });
    expect(await attempt({ file: 'mcp' })).toEqual({ error: 'no-such-log' });
    expect(await attempt({ file: 'gui' })).toEqual({ error: 'not-a-log-file' });
    expect(await attempt({})).toEqual({ error: 'bad-request' });

    // A link to this file in Hermes's logs directory gets Hermes's own lines appended, so only what is at the start is the test's.
    expect(fs.readFileSync(outside, 'utf8')).toMatch(/^not a log/);
    expect(fs.readFileSync(path.join(hermes.home, '.env'), 'utf8')).toBe('SECRET=1');
    fs.rmSync(outside);
    fs.rmSync(path.join(hermes.home, '.env'));
  });

  test('reaches a named profile’s own logs directory, and the names it accepts are the ones Hermes serves', async () => {
    const coder = writeLog(path.join(hermes.home, 'profiles', 'coder'), 'gateway.log', [logLine(0, 'INFO', 'gateway.run', 'coder gateway')]);
    const root = writeLog(hermes.home, 'gateway.log', [logLine(1, 'INFO', 'gateway.run', 'default gateway')]);
    const owner = await steppedUpOwner();
    const body = { file: 'gateway', profile: 'Coder' };

    const done = await owner.call('POST', '/_caduceus/api/logs/truncate', body, await owner.confirmed(body, 'gateway.log'));

    expect(done.status).toBe(200);
    expect(fs.statSync(coder).size).toBe(0);
    expect(fs.readFileSync(root, 'utf8')).toContain('default gateway');
    for (const file of Object.keys(LOG_FILES)) expect((await hermes.backend.fetch(`/api/logs?file=${file}`)).status, file).toBe(200);
    expect((await hermes.backend.fetch('/api/logs?file=nope')).status).toBe(400);
    fs.rmSync(path.join(hermes.home, 'profiles'), { recursive: true, force: true });
  });
});
