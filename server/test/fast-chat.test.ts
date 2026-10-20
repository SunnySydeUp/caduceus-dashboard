import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat } from '../../web/src/modules/chat/chat-session.ts';
import crypto from 'node:crypto';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { createFastChat, type FastChat, type FastOptions } from '../../web/src/modules/chat/fast-chat.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Fast chat (M1 #18): the page's fast-chat engine over the browser's gateway connection through Caduceus (so every call passes the policy proxy), in front of
// the real Hermes whose provider is the stub LLM. What a test asserts is what Hermes was asked and what it holds afterwards.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer;
let page: TestGatewayConnection;
let cookie: string;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie = await ownerCookie(server.url);
  page = openGatewayConnection(server.url, cookie);
  await page.until((status) => status.state === 'connected');
}, 60_000);
afterAll(async () => {
  page?.connection.close();
  await server?.close();
  await llm?.close();
  await hermes.stop();
});

/** The methods a page asked of Hermes, in order: the engine's client is the page's, seen through a recorder. */
const asked: string[] = [];
const client: FastOptions['client'] = {
  request: (method, params) => {
    asked.push(method);
    return page.connection.client.request(method, params);
  },
};
afterEach(() => {
  asked.length = 0;
});

const fastChat = (options: Partial<FastOptions> = {}): FastChat => createFastChat({ client, profile: 'default', consent: { given: false }, confirm: async () => true, ...options });
const textsOf = (fast: FastChat) => fast.state.messages.map((message) => `${message.role}: ${message.text}`);
/** The sessions Hermes holds, over its REST API the way the page reads them. */
const sessionsHeld = async () => {
  // The body is Hermes's session list; the test only reads the ids.
  const listed = (await page.rest('/api/sessions')) as { sessions: { id: string }[] };
  return listed.sessions.map((session) => session.id);
};

describe('a fast prompt', () => {
  test('goes to Hermes\'s one-shot model and nothing else: its answer is shown, Hermes gets no session and no turn', async () => {
    const before = await sessionsHeld();
    llm.nextTitle('Four.');
    const fast = fastChat();

    expect(await fast.send('What is two plus two?')).toBe(true);

    expect(textsOf(fast)).toEqual(['user: What is two plus two?', 'assistant: Four.']);
    expect(asked).toEqual(['llm.oneshot']);
    expect(JSON.stringify(llm.titleRequests.at(-1)!.messages)).toContain('What is two plus two?');
    expect(llm.completions).toEqual([]);
    expect(await sessionsHeld()).toEqual(before);
  });
});

describe('the first fast call of a tab', () => {
  test('asks the owner (T1), naming the profile and the model; a refusal sends nothing, and once agreed the tab is not asked again', async () => {
    const consent = { given: false };
    const confirm = vi.fn<FastOptions['confirm']>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const fast = fastChat({ consent, confirm, model: () => 'stub-model' });

    expect(await fast.send('Hello?')).toBe(false);
    expect(asked).toEqual([]);
    expect(fast.state.messages).toEqual([]);

    llm.nextTitle('One.');
    expect(await fast.send('Hello?')).toBe(true);
    llm.nextTitle('Two.');
    expect(await fast.send('Again?')).toBe(true);
    // Another fast chat in the same tab is the same tab.
    llm.nextTitle('Three.');
    expect(await fastChat({ consent, confirm, model: () => 'stub-model' }).send('And again?')).toBe(true);

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(1, { profile: 'default', model: 'stub-model' });
    expect(asked).toEqual(['llm.oneshot', 'llm.oneshot', 'llm.oneshot']);
  });
});

describe('a conversation in fast mode', () => {
  test('is sent whole with every prompt, as words under who said them, because a one-shot call has no history of its own', async () => {
    const fast = fastChat();
    llm.nextTitle('Blue.');
    await fast.send('What colour is the sky?');
    llm.nextTitle('Because of how air scatters sunlight.');

    expect(await fast.send('Why?')).toBe(true);

    expect(textsOf(fast)).toEqual(['user: What colour is the sky?', 'assistant: Blue.', 'user: Why?', 'assistant: Because of how air scatters sunlight.']);
    const [system, user] = llm.titleRequests.at(-1)!.messages;
    expect(system!.role).toBe('system');
    expect(user!.content).toBe('You: What colour is the sky?\n\nAssistant: Blue.\n\nYou: Why?');
  });
});

describe('a fast prompt that fails', () => {
  test('is an error under the message that says what Hermes said, and Retry asks again for the same message, with no second copy of it', async () => {
    const fast = fastChat();
    llm.nextTitle({ fail: { status: 400, message: 'model "stub-model" is not available to this key' } });

    expect(await fast.send('Hi there')).toBe(false);

    expect(fast.state.failure).toMatch(/not available to this key/);
    expect(textsOf(fast)).toEqual(['user: Hi there']);
    llm.nextTitle('Hello!');

    expect(await fast.retry()).toBe(true);

    expect(fast.state.failure).toBeUndefined();
    expect(textsOf(fast)).toEqual(['user: Hi there', 'assistant: Hello!']);
    expect(llm.titleRequests.at(-1)!.messages[1]!.content).toBe('You: Hi there');
  });
});

describe('the model of a fast prompt', () => {
  test('is the model of the chat\'s own Hermes session when it has one (the one the owner picked for the chat); a chat without a session uses the profile\'s model', async () => {
    const chat = createChat(page.connection, { history: page.rest });
    try {
      llm.nextReply({ chunks: ['Noted.'] });
      await chat.send('First');
      await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 2);
      await page.settled();
      expect(await chat.setModel({ provider: 'custom', model: 'stub-model-large' })).toEqual({ kind: 'set' });

      llm.nextTitle('From the chat.');
      expect(await fastChat({ session: () => chat.liveSession() }).send('Which model?')).toBe(true);
      expect(llm.titleRequests.at(-1)!.model).toBe('stub-model-large');

      llm.nextTitle('From the profile.');
      expect(await fastChat().send('And without a session?')).toBe(true);
      expect(llm.titleRequests.at(-1)!.model).toBe('stub-model');
    } finally {
      chat.dispose();
    }
  });
});

describe('what Caduceus keeps', () => {
  /** Every row of every table of Caduceus's store, as text: what a scan of the store can find. */
  const storeText = () => {
    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      return JSON.stringify(tables.map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all()));
    } finally {
      db.close();
    }
  };

  test('holds nothing of a fast chat: neither what was asked nor what was answered is in its store', async () => {
    // The scan can see what the store does hold: a draft, which is kept for a session.
    const saved = await fetch(`${server.url}/_caduceus/api/chat/draft?profile=default&session=any-session`, {
      method: 'PUT',
      headers: { origin: server.url, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A draft that is kept: BEACON-7421' }),
    });
    expect(saved.status).toBe(200);
    expect(storeText()).toContain('BEACON-7421');

    llm.nextTitle('An answer only Hermes and the page hear: ZEBRA-5530');
    expect(await fastChat().send('A question only the page knows: QUARTZ-9981')).toBe(true);

    expect(storeText()).not.toContain('QUARTZ-9981');
    expect(storeText()).not.toContain('ZEBRA-5530');
  });
});

describe('Continue as chat', () => {
  /** What the page sends a tiered request with: the owner's dialog (answered by the test) in front of Caduceus's server. */
  const tiered = (answer: { confirm: boolean }) => {
    const dialogs: ConfirmRequest[] = [];
    const send = createTieredFetch({
      fetch: (route, init) => fetch(`${server.url}${route}`, { ...init, headers: { origin: server.url, cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
      confirmer: () => async (request) => {
        dialogs.push(request);
        return answer.confirm ? { typed: request.object ?? request.label } : undefined;
      },
      withStepUp: (request) => request(),
      online: () => true,
      readOnly: () => false,
      sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
    });
    return { send, dialogs };
  };

  test('saves the conversation as a normal Hermes session and opens it: the chat holds the same words and answers with them as its context, and the fast conversation is over', async () => {
    const { send, dialogs } = tiered({ confirm: true });
    const fast = fastChat();
    llm.nextTitle('Blue.');
    await fast.send('What colour is the sky?');

    const outcome = await fast.continueAsChat({ send });

    if (outcome.kind !== 'continued') throw new Error(`Expected the chat to continue, got ${JSON.stringify(outcome)}`);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toMatchObject({ tier: 'T1', profile: 'default' });
    expect(fast.state.messages).toEqual([]);
    const held = (await page.rest(`/api/sessions/${outcome.storedId}/messages`)) as { messages: { role: string; content: string }[] };
    expect(held.messages.map((row) => `${row.role}: ${row.content}`)).toEqual(['user: What colour is the sky?', 'assistant: Blue.']);

    const chat = createChat(page.connection, { history: page.rest, storedId: outcome.storedId });
    try {
      await chat.until((state) => !state.syncing && state.messages.length === 2);
      llm.nextReply({ chunks: ['Light ', 'scatters.'] });
      await chat.send('Why?');
      await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 4);
      const asked = JSON.stringify(llm.completions.at(-1)!.messages);
      expect(asked).toContain('What colour is the sky?');
      expect(asked).toContain('Blue.');
      expect(asked).toContain('Why?');
    } finally {
      chat.dispose();
    }
  });

  test('a declined confirmation changes nothing: Hermes gets no session and the conversation stays', async () => {
    const { send } = tiered({ confirm: false });
    const fast = fastChat();
    llm.nextTitle('Fine.');
    await fast.send('How are you?');
    const before = await sessionsHeld();

    expect(await fast.continueAsChat({ send })).toEqual({ kind: 'cancelled' });

    expect(await sessionsHeld()).toEqual(before);
    expect(textsOf(fast)).toEqual(['user: How are you?', 'assistant: Fine.']);
  });
});

describe('a conversation that has grown long', () => {
  test('sends its newest messages that fit and says how many of the earliest were left out', async () => {
    const fast = fastChat();
    const long = (letter: string) => letter.repeat(15_000);
    for (const letter of ['a', 'b', 'c']) {
      llm.nextTitle('ok');
      expect(await fast.send(long(letter))).toBe(true);
    }

    const sent = String(llm.titleRequests.at(-1)!.messages[1]!.content);
    expect(sent).not.toContain('aaaa');
    expect(sent).toContain('bbbb');
    expect(sent).toContain('cccc');
    // Three messages of 15,000 characters do not fit in one call, two do: only the oldest is left out, and the short replies after it go.
    expect(fast.state.leftOut).toBe(1);
  });
});

describe('closing a fast conversation', () => {
  test('clear forgets the messages and any failure, and an answer that was still on its way finds nothing to join', async () => {
    const fast = fastChat();
    llm.nextTitle({ fail: { status: 400, message: 'refused' } });
    await fast.send('Hello?');
    expect(fast.state.failure).toBeDefined();

    fast.clear();

    expect(fast.state).toMatchObject({ messages: [], failure: undefined, leftOut: 0, waiting: false });
  });

  test('an answer that arrives after the conversation was cleared is dropped, not shown as the start of a new one', async () => {
    const held = Promise.withResolvers<void>();
    const slow: FastOptions['client'] = { request: async (method, params) => (await held.promise, client.request(method, params)) };
    const fast = fastChat({ client: slow });
    llm.nextTitle('Too late.');
    const sending = fast.send('Hello?');
    await fast.until((state) => state.waiting);

    fast.clear();
    held.resolve();
    await sending;

    expect(fast.state).toMatchObject({ messages: [], waiting: false, failure: undefined });
  });
});
