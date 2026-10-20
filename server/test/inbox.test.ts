import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InboxClarify, InboxItem, InboxState } from '@caduceus/contracts/inbox';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { seedPairingRequest } from './fixtures/seed-pairing.ts';
import type { InboxSource } from '../src/inbox-source.ts';

// The Inbox (M2 #01): what Hermes is waiting on, derived and never stored. The Caduceus server keeps its own observer connection
// to the gateway; these tests drive the Caduceus API the way the page does (`GET /_caduceus/api/inbox`, its event stream and the
// decision route), in front of the real Hermes whose provider is the stub LLM. A chat page is the fixture that makes Hermes ask
// (an approval, a question) and that can answer from "elsewhere".
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let work: string;
let cookie: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
const streams: EventStream[] = [];
let extraSources: InboxSource[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await hermes.cli('profile', 'create', 'work');
  await llm.connect(hermes, 'work');
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
  await hermes.cli('-p', 'work', 'config', 'set', 'tools.tool_search.enabled', 'off');
  // A profile whose approvals lapse after two seconds, for the test of one that nobody answers.
  await hermes.cli('profile', 'create', 'brief');
  await llm.connect(hermes, 'brief');
  await hermes.cli('-p', 'brief', 'config', 'set', 'tools.tool_search.enabled', 'off');
  await hermes.cli('-p', 'brief', 'config', 'set', 'approvals.timeout', '2');
}, 120_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-inbox-')));
});
afterEach(async () => {
  // Hermes outlives a test: a request one left open would be in the next test's Inbox.
  for (const chat of chats) {
    for (const request of chat.state.requests) {
      if (request.kind === 'approval') await chat.answerApproval(request.id, { choice: 'deny' });
      else await chat.answerClarify(request.id, {});
    }
    await chat.until((state) => state.requests.length === 0);
  }
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  for (const stream of streams.splice(0)) stream.close();
  await server?.close();
  server = undefined;
  extraSources = [];
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

/** Caduceus with a fast observer, and the owner signed in. */
async function openServer() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, inboxPollMs: 25, inboxReadMs: 150, inboxSources: extraSources });
  cookie = await ownerCookie(server.url);
  return { url: server.url, cookie };
}

/** A chat page of the owner's in a profile. */
async function openChat(profile?: string) {
  const { url } = await openServer();
  const page = openGatewayConnection(url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work, ...(profile ? { profile } : {}) });
  chats.push(chat);
  return { chat, page };
}

/** The Inbox as the page reads it: the state now, and the state after each change Caduceus announces. */
async function watchInbox({ notices = false } = {}) {
  const { url } = await openServer();
  const stream = await openEventStream(url, '/_caduceus/api/inbox/stream', cookie);
  streams.push(stream);
  let state: InboxState | undefined;
  return {
    async until(match: (state: InboxState) => boolean): Promise<InboxState> {
      for (;;) {
        if (state && match(state)) return state;
        const event = await stream.next();
        if (event.event !== 'inbox') continue;
        const said = event.data as InboxState;
        // The temp Hermes has things of its own to say (no gateway is running in it): a test of live requests looks at those alone.
        const items = notices ? said.items : said.items.filter((item) => item.kind !== 'notice');
        state = { ...said, items, needsDecision: items.filter((item) => item.group === 'decision').length };
      }
    },
  };
}

/** Makes the model's next completion call `terminal` with a command Hermes holds for approval (it deletes `dir`). The completion after it says `after`, if the test scripts it before the turn goes on. */
function askToRemove(dir: string, callId = 'call_rm') {
  llm.nextReply({ chunks: [], toolCalls: [{ id: callId, name: 'terminal', arguments: { command: `rm -rf ${dir}` } }] });
}

describe('the Inbox over live sessions', () => {
  test('lists the pending approvals of sessions in every profile with the exact command, and stores nothing', async () => {
    const first = path.join(work, 'first');
    const second = path.join(work, 'second');
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    const { chat: inDefault } = await openChat();
    const { chat: inWork } = await openChat('work');
    const inbox = await watchInbox();
    expect(await inbox.until((state) => state.live)).toMatchObject({ items: [], needsDecision: 0 });

    askToRemove(first);
    await inDefault.send('Clean the first');
    await inDefault.until((state) => state.requests.length === 1);
    askToRemove(second, 'call_rm2');
    await inWork.send('Clean the second');
    await inWork.until((state) => state.requests.length === 1);

    const state = await inbox.until((current) => current.items.length === 2);

    expect(state.needsDecision).toBe(2);
    const byProfile = Object.fromEntries(state.items.map((item) => [item.profile, item]));
    expect(byProfile.default).toMatchObject({ kind: 'approval', group: 'decision', command: `rm -rf ${first}`, description: 'delete in root path', choices: ['once', 'session', 'always', 'deny'] });
    expect(byProfile.work).toMatchObject({ kind: 'approval', group: 'decision', command: `rm -rf ${second}` });
    expect(byProfile.work?.id).toMatch(/^srq-/);
    // The page's own approval card and the Inbox item are the same request.
    expect(byProfile.default?.id).toBe(inDefault.state.requests[0]!.id);
    // Hermes is holding both commands.
    expect(fs.existsSync(first) && fs.existsSync(second)).toBe(true);
    // Only the owner's sessions, passkeys and the like are stored: no table for items, and no row written for them.
    const store = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    const tables = store.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
    // The one table is what a device put aside, by reference (checked in the next describe); there is none for items, requests or approvals.
    expect(tables.filter((name) => /inbox|request|approval/i.test(name))).toEqual(['inbox_hidden']);
    expect(store.prepare('SELECT COUNT(*) AS n FROM inbox_hidden').get()).toEqual({ n: 0 });
    expect(store.prepare('SELECT COUNT(*) AS n FROM audit').get()).toEqual({ n: expect.any(Number) });
    store.close();
  }, HERMES_WORK_TIMEOUT_MS);

  test('an approval nobody answers lapses at Hermes\'s own deadline, and its item goes with it', async () => {
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    const { chat } = await openChat('brief');
    const inbox = await watchInbox();
    askToRemove(kept);
    await chat.send('Clean up');

    await inbox.until((state) => state.items.length === 1);
    await inbox.until((state) => state.items.length === 0);

    // Hermes refused the command when its two seconds ran out; Caduceus answered nothing in the meantime.
    await chat.until((state) => state.settled.length === 1);
    expect(chat.state.settled[0]).toMatchObject({ kind: 'approval', outcome: 'expired' });
    expect(fs.existsSync(kept)).toBe(true);
  }, HERMES_WORK_TIMEOUT_MS);

  /** The owner's decision on an item, as the page sends it. */
  const decide = (id: string, body: unknown, withCookie = cookie) =>
    fetch(`${server!.url}/_caduceus/api/inbox/${id}/decision`, { method: 'POST', headers: { origin: server!.url, cookie: withCookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('Allow once from the Inbox lets the command run, and the chat that asked goes on', async () => {
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    const { chat } = await openChat();
    const inbox = await watchInbox();
    askToRemove(doomed);
    llm.nextReply({ chunks: ['Removed it.'] });
    await chat.send('Clean up');
    const [item] = (await inbox.until((state) => state.items.length === 1)).items;

    const res = await decide(item!.id, { choice: 'once' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'resolved' });
    await chat.until((state) => !state.running && state.messages.some((message) => message.text === 'Removed it.'));
    expect(fs.existsSync(doomed)).toBe(false);
    await inbox.until((state) => state.items.length === 0);
  }, HERMES_WORK_TIMEOUT_MS);

  test('Deny keeps the command from running, and the agent is told why', async () => {
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    const { chat } = await openChat();
    const inbox = await watchInbox();
    askToRemove(kept);
    llm.nextReply({ chunks: ['Left it alone.'] });
    await chat.send('Clean up');
    const [item] = (await inbox.until((state) => state.items.length === 1)).items;

    const res = await decide(item!.id, { choice: 'deny', reason: 'those are my tax records' });

    expect(await res.json()).toEqual({ status: 'resolved' });
    await chat.until((state) => !state.running && state.messages.some((message) => message.text === 'Left it alone.'));
    expect(fs.existsSync(kept)).toBe(true);
    const heard = JSON.stringify(llm.completions.at(-1)!.messages.filter((message) => message.role === 'tool' || message.role === 'user').map((message) => message.content));
    expect(heard).toContain('BLOCKED');
    expect(heard).toContain('those are my tax records');
  }, HERMES_WORK_TIMEOUT_MS);

  test('an item answered somewhere else is removed by itself, and answering it afterwards says so instead of failing', async () => {
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    const { chat } = await openChat();
    const inbox = await watchInbox();
    askToRemove(doomed);
    await chat.send('Clean up');
    const [item] = (await inbox.until((state) => state.items.length === 1)).items;

    // The owner answers in the chat (or from Telegram, or the TUI: Hermes does not say which).
    await chat.answerApproval(item!.id, { choice: 'deny' });
    await inbox.until((state) => state.items.length === 0);
    const late = await decide(item!.id, { choice: 'once' });

    expect(late.status).toBe(200);
    expect(await late.json()).toEqual({ status: 'already-answered' });
    expect(fs.existsSync(doomed)).toBe(true);
  }, HERMES_WORK_TIMEOUT_MS);

  test('a question is answered from the Inbox and the agent hears the answer', async () => {
    const { chat } = await openChat();
    const inbox = await watchInbox();
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_ask', name: 'clarify', arguments: { questions: [{ question: 'Which colour?', choices: ['Red', 'Blue'] }] } }] });
    llm.nextReply({ chunks: ['Blue it is.'] });
    await chat.send('Pick a colour for me');
    const state = await inbox.until((current) => current.items.length === 1);
    const item = state.items[0] as InboxClarify;

    expect(item).toMatchObject({ kind: 'clarify', group: 'decision', questions: [{ qid: 'q0', question: 'Which colour?', choices: expect.arrayContaining(['Blue']), multiSelect: false }] });
    // Hermes waits an hour by default, from when it was asked.
    expect(item.expiresAt).toBe(item.at + 3600 * 1000);
    expect(state.needsDecision).toBe(1);

    const res = await decide(item.id, { result: { answers: { q0: 'Blue' } } });

    expect(await res.json()).toEqual({ status: 'resolved' });
    await chat.until((current) => !current.running && current.messages.some((message) => message.text === 'Blue it is.'));
    const said = llm.completions.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => String(message.content)).join('\n');
    expect(JSON.parse(said)).toMatchObject({ outcome: 'submitted', responses: [{ question: 'Which colour?', status: 'answered', user_response: 'Blue' }] });
  }, HERMES_WORK_TIMEOUT_MS);

  test('read-only mode lets a Deny through and blocks every other decision', async () => {
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    const { chat } = await openChat();
    const inbox = await watchInbox();
    askToRemove(kept);
    llm.nextReply({ chunks: ['Left it alone.'] });
    await chat.send('Clean up');
    const [item] = (await inbox.until((state) => state.items.length === 1)).items;
    // Read-only mode stops the chat from starting turns too, so it goes on once Hermes is already asking.
    await stepUp(server!.url, cookie, await addPasskey(server!.url, cookie));
    const on = await fetch(`${server!.url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: server!.url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: true }) });
    expect(on.status).toBe(200);

    const refused = await decide(item!.id, { choice: 'once' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'read-only' });
    expect(fs.existsSync(kept)).toBe(true);

    const denied = await decide(item!.id, { choice: 'deny' });
    expect(await denied.json()).toEqual({ status: 'resolved' });
    await chat.until((state) => !state.running && state.messages.some((message) => message.text === 'Left it alone.'));
    expect(fs.existsSync(kept)).toBe(true);
  }, HERMES_WORK_TIMEOUT_MS);

  test('Hermes sends no request to the observer and the observer answers none: a second gateway socket that attaches to nothing sees no approval or withdrawal', async () => {
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    const { chat } = await openChat();
    const inbox = await watchInbox();
    // Another connection like the observer: open, never attached to a session.
    const bystander = await hermes.backend.openGateway();
    const frames: string[] = [];
    bystander.on('message', (data) => frames.push(data.toString()));
    askToRemove(kept);
    await chat.send('Clean up');
    const [item] = (await inbox.until((state) => state.items.length === 1)).items;
    // The page that is attached to the session was sent the request, and the Inbox still learned of it.
    expect(chat.state.requests.map((request) => request.id)).toEqual([item!.id]);
    await chat.answerApproval(item!.id, { choice: 'deny' });
    await inbox.until((state) => state.items.length === 0);
    bystander.close();

    expect(frames.filter((frame) => /"method":"approval"|request\.cancel/.test(frame))).toEqual([]);
  }, HERMES_WORK_TIMEOUT_MS);
});

/** A source a later module could add: one notice whose stamp the test moves. */
function testSource(): InboxSource & { set(stamp: string | undefined): void } {
  const listeners = new Set<() => void>();
  let stamp: string | undefined = '1';
  const item = (): InboxItem[] => (stamp === undefined ? [] : [{ kind: 'notice', id: 'budget:day', ref: 'budget:day', stamp, group: 'failed', category: 'system', profile: undefined, at: 5, title: 'Daily budget crossed 80%', detail: undefined, actions: [], link: { label: 'Open spend', to: '/home' } }]);
  return {
    items: item,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    close: () => listeners.clear(),
    set(next) {
      stamp = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('sources beyond live chats', () => {
  const post = (route: string, body: unknown, device: string) => fetch(`${server!.url}/_caduceus/api/inbox/${route}`, { method: 'POST', headers: { origin: server!.url, cookie: `${cookie}; caduceus_device=${device}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const watchAs = async (device: string) => {
    const stream = await openEventStream(server!.url, '/_caduceus/api/inbox/stream', `${cookie}; caduceus_device=${device}`);
    streams.push(stream);
    let state: InboxState | undefined;
    return {
      async until(match: (state: InboxState) => boolean): Promise<InboxState> {
        for (;;) {
          if (state && match(state)) return state;
          const event = await stream.next();
          if (event.event !== 'inbox') continue;
          // Only the test source's item: the temp Hermes has Repairs of its own.
          const said = event.data as InboxState;
          state = { ...said, items: said.items.filter((item) => item.ref === 'budget:day'), snoozed: said.snoozed.filter(({ item }) => item.ref === 'budget:day') };
        }
      },
    };
  };
  const phone = 'a'.repeat(32);
  const laptop = 'b'.repeat(32);

  test('a source a later module adds shows its items with no change to the Inbox, and counts for the badge only if it needs a decision', async () => {
    const source = testSource();
    extraSources = [source];
    await openServer();
    const inbox = await watchInbox({ notices: true });

    const state = await inbox.until((current) => current.items.some((item) => item.ref === 'budget:day'));

    expect(state.items.find((item) => item.ref === 'budget:day')).toMatchObject({ kind: 'notice', group: 'failed', link: { to: '/home' } });
    expect(state.needsDecision).toBe(0);
    source.set(undefined);
    await inbox.until((current) => !current.items.some((item) => item.ref === 'budget:day'));
  });

  test('a snooze or a dismissal is of one device, comes back with a new state of what it is about, and is stored by reference, not as an item', async () => {
    const source = testSource();
    extraSources = [source];
    await openServer();
    const onPhone = await watchAs(phone);
    const onLaptop = await watchAs(laptop);
    await onPhone.until((state) => state.items.some((item) => item.ref === 'budget:day'));

    expect((await post('hide', { ref: 'budget:day', stamp: '1' }, phone)).status).toBe(200);
    await onPhone.until((state) => state.items.length === 0);
    // The laptop still has it.
    expect((await onLaptop.until((state) => state.items.length === 1)).snoozed).toEqual([]);

    // Its state changes again: it comes back on the phone.
    source.set('2');
    await onPhone.until((state) => state.items.length === 1);

    // A snooze lists the item with when it returns, and bringing it back is the device's own.
    const until = Date.now() + 3_600_000;
    await post('hide', { ref: 'budget:day', stamp: '2', until }, phone);
    const asleep = await onPhone.until((state) => state.snoozed.length === 1);
    expect(asleep.snoozed[0]).toMatchObject({ until, item: { ref: 'budget:day' } });
    expect(asleep.items).toEqual([]);
    await fetch(`${server!.url}/_caduceus/api/inbox/hide?ref=budget%3Aday`, { method: 'DELETE', headers: { origin: server!.url, cookie: `${cookie}; caduceus_device=${phone}` } });
    await onPhone.until((state) => state.items.length === 1 && state.snoozed.length === 0);

    const store = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    const columns = store.prepare('PRAGMA table_info(inbox_hidden)').all().map((column) => String(column.name));
    store.close();
    expect(columns).toEqual(['device_id', 'ref', 'stamp', 'until', 'at']);
  });

  test('a person waiting to be paired is a decision with Approve, and goes when the request is approved in Hermes', async () => {
    await openServer();
    const inbox = await watchInbox({ notices: true });
    await seedPairingRequest(hermes.home, 'telegram', '4711', 'Ada', 'work');

    const state = await inbox.until((current) => current.items.some((item) => item.category === 'pairing'));
    const item = state.items.find((candidate) => candidate.category === 'pairing')!;

    expect(item).toMatchObject({ kind: 'notice', group: 'decision', profile: 'work', title: 'Ada (4711) wants to talk to your Telegram bot', actions: [expect.objectContaining({ id: 'approve' })] });
    expect(state.items.filter((candidate) => candidate.group === 'decision')).toHaveLength(1);
    // Approved somewhere else (the CLI, another device): through Hermes's own route here.
    const action = (item as Extract<InboxItem, { kind: 'notice' }>).actions[0]!;
    const res = await hermes.backend.fetch(action.request.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action.request.body) });
    expect(res.ok).toBe(true);
    await inbox.until((current) => !current.items.some((candidate) => candidate.category === 'pairing'));
  }, HERMES_WORK_TIMEOUT_MS);

  test('a job whose run failed is a failure with Run now, and a later good run clears it', async () => {
    await openServer();
    const inbox = await watchInbox({ notices: true });
    const created = await hermes.backend.fetch('/api/cron/jobs?profile=work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Say hello', schedule: 'every 6h', name: 'Hello job' }) });
    expect(created.ok).toBe(true);
    const { id } = (await created.json()) as { id: string };
    llm.nextReply({ chunks: [], fail: { status: 400, message: 'the model is gone' } });
    await hermes.backend.fetch(`/api/cron/jobs/${id}/trigger?profile=work`, { method: 'POST' });

    const state = await inbox.until((current) => current.items.some((item) => item.ref === `cron:work:${id}`));
    const item = state.items.find((candidate) => candidate.ref === `cron:work:${id}`)!;
    expect(item).toMatchObject({ kind: 'notice', group: 'failed', category: 'automation', profile: 'work', title: '“Hello job” failed' });

    llm.nextReply({ chunks: ['Hello.'] });
    const run = (item as Extract<InboxItem, { kind: 'notice' }>).actions.find((action) => action.id === 'run-now')!;
    await hermes.backend.fetch(run.request.path, { method: run.request.method });
    await inbox.until((current) => !current.items.some((candidate) => candidate.ref === `cron:work:${id}`));
    await hermes.backend.fetch(`/api/cron/jobs/${id}?profile=work`, { method: 'DELETE' });
  }, HERMES_WORK_TIMEOUT_MS);

  test('a run that finishes is in the activity feed, unseen until this device says it has seen it, and each device keeps its own cursor', async () => {
    const { chat } = await openChat();
    await openServer();
    const onPhone = await watchAs(phone);
    const onLaptop = await watchAs(laptop);
    const reply = llm.nextReply({ chunks: ['One ', 'two.'], pauseAfter: 1 });
    await chat.send('Count');
    await reply.paused;
    // Hermes is mid-run: the Inbox has had time to see it working.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    reply.resume();

    const state = await onPhone.until((current) => current.activity.length === 1);
    expect(state.activity[0]).toMatchObject({ profile: 'default', title: expect.any(String) });
    expect(state.unseen).toBe(1);

    await post('activity/seen', { seq: state.activity[0]!.seq }, phone);
    await onPhone.until((current) => current.unseen === 0);
    expect((await onLaptop.until((current) => current.activity.length === 1)).unseen).toBe(1);
  }, HERMES_WORK_TIMEOUT_MS);
});

// Last in the file: Allow always writes the command's kind into the temp home's config, where Hermes keeps it for every later approval.
describe('Allow always from the Inbox', () => {
  test('is a standing permission: it needs a passkey first, and Hermes remembers the answer', async () => {
    const forever = path.join(work, 'forever');
    fs.mkdirSync(forever);
    const { chat } = await openChat();
    const inbox = await watchInbox();
    // A relative path is another kind of command than the absolute ones the other tests run (Hermes remembers an answer per kind).
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_rm_forever', name: 'terminal', arguments: { command: 'rm -r forever' } }] });
    llm.nextReply({ chunks: ['Removed it.'] });
    await chat.send('Clean up');
    const [item] = (await inbox.until((state) => state.items.length === 1)).items;
    expect(item).toMatchObject({ command: 'rm -r forever', description: 'recursive delete' });

    const refused = await fetch(`${server!.url}/_caduceus/api/inbox/${item!.id}/decision`, { method: 'POST', headers: { origin: server!.url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ choice: 'always' }) });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(fs.existsSync(forever)).toBe(true);

    await stepUp(server!.url, cookie, await addPasskey(server!.url, cookie));
    const allowed = await fetch(`${server!.url}/_caduceus/api/inbox/${item!.id}/decision`, { method: 'POST', headers: { origin: server!.url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ choice: 'always' }) });
    expect(await allowed.json()).toEqual({ status: 'resolved' });
    await chat.until((state) => !state.running && state.messages.some((message) => message.text === 'Removed it.'));
    expect(fs.existsSync(forever)).toBe(false);
    expect(fs.readFileSync(path.join(hermes.home, 'config.yaml'), 'utf8')).toContain('recursive delete');
  }, HERMES_WORK_TIMEOUT_MS);
});
