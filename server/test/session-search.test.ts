import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat } from '../../web/src/modules/chat/chat-session.ts';
import { locateHit, searchSessions } from '../../web/src/modules/chat/session-search.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSession } from './fixtures/seed-session.ts';

// Session search (M1 #15): the page's search of Hermes's own full-text index (`GET /api/sessions/search`) and the jump from a hit to the first
// message that matches, through Hermes's timeline and messages-around endpoints, over a real Hermes in a throwaway HERMES_HOME. Caduceus keeps
// no index and no copy of any text: what a test asserts is what Hermes answers.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];
let longRows: number[];

/** 1,000 messages: the owner's `Q<n>` and Hermes's `A<n>`; one answer far back mentions the zeppelin, and the last one does too. */
const LONG = Array.from({ length: 500 }, (_, n) => [
  { role: 'user' as const, content: `Q${n}` },
  { role: 'assistant' as const, content: n === 40 ? `A${n}: the zeppelin docks at dawn` : n === 499 ? `A${n}: another zeppelin` : `A${n}` },
]).flat();

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  await seedSession(hermes.home, 'deploy-notes', [
    { role: 'user', content: 'Why did the staging deployment fail last night?' },
    { role: 'assistant', content: 'The migration step timed out, so the deployment was rolled back.' },
  ], { title: 'Deploy post-mortem', source: 'telegram' });
  await seedSession(hermes.home, 'unrelated', [{ role: 'user', content: 'What is for lunch?' }, { role: 'assistant', content: 'Soup.' }], { title: 'Lunch' });
  longRows = await seedSession(hermes.home, 'long-one', LONG, { title: 'A long one' });
}, 120_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function openPage() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

describe('searching the sessions', () => {
  test('a word of a message finds its session, with the snippet Hermes cut around it, the title, the profile and the date', async () => {
    const page = await openPage();
    const hits = await searchSessions(page.rest, 'migrat', { profile: 'default' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId: 'deploy-notes', title: 'Deploy post-mortem', profile: 'default', source: 'telegram' });
    expect(hits[0]!.at).toBeGreaterThan(1_700_000_000);
    // The words of the snippet are Hermes's; the matched ones are marked.
    expect(hits[0]!.snippet.filter((part) => part.match).map((part) => part.text.toLowerCase())).toContain('migration');
    expect(hits[0]!.snippet.map((part) => part.text).join('')).toMatch(/migration step timed out/);
  });
});

describe('opening a hit', () => {
  test('far back in a 1,000-message session: the first matching message is found, and the chat opens on its page through messages-around, focused on it', async () => {
    const page = await openPage();
    const [hit] = await searchSessions(page.rest, 'zeppelin', { profile: 'default' });
    expect(hit).toMatchObject({ sessionId: 'long-one', title: 'A long one' });

    const asked: string[] = [];
    const rest = (path: string) => (asked.push(path), page.rest(path));
    const spot = await locateHit(rest, { sessionId: hit!.sessionId, profile: 'default', query: 'zeppelin' });
    // `A40` is the first to mention it (the 82nd message); the prompt it answers is `Q40`.
    expect(spot).toEqual({ message: longRows[81], prompt: longRows[80] });
    // The search read the history a page at a time and stopped at the match.
    expect(asked.filter((path) => path.includes('/messages?'))).toHaveLength(1);

    const chat = createChat(page.connection, { history: rest, storedId: hit!.sessionId, around: spot!.prompt, focus: spot!.message });
    try {
      await chat.until((state) => !state.syncing && state.messages.length > 0);
      expect(asked.some((path) => path.includes('/messages/around?'))).toBe(true);
      expect(chat.state.messages[0]).toMatchObject({ id: spot!.prompt, text: 'Q40' });
      expect(chat.state.focusId).toBe(spot!.message);
      expect(chat.state.messages.find((message) => message.id === spot!.message)?.text).toBe('A40: the zeppelin docks at dawn');
      expect(chat.state).toMatchObject({ hasOlder: true, hasNewer: true });
    } finally {
      chat.dispose();
    }
  });

  test('a hit on a session’s id (pasted, never in its messages) has no message to go to: the chat opens at the newest messages', async () => {
    const page = await openPage();
    const hits = await searchSessions(page.rest, 'deploy-no', { profile: 'default' });
    expect(hits.map((hit) => hit.sessionId)).toEqual(['deploy-notes']);
    expect(await locateHit(page.rest, { sessionId: 'deploy-notes', profile: 'default', query: 'deploy-no' })).toBeUndefined();
  });

  test('loading all of it from a window in the middle reads both ways until the whole transcript is there, once each message', async () => {
    const page = await openPage();
    const chat = createChat(page.connection, { history: page.rest, storedId: 'long-one', around: longRows[80]!, focus: longRows[81]! });
    try {
      await chat.until((state) => !state.syncing && state.messages.length > 0);
      await chat.loadAll();
      expect(chat.state).toMatchObject({ hasOlder: false, hasNewer: false, loadingMore: false });
      expect(chat.state.messages).toHaveLength(1000);
      expect(chat.state.messages.map((message) => message.id)).toEqual(longRows);
      expect(chat.state.focusId).toBe(longRows[81]);
    } finally {
      chat.dispose();
    }
  });
});
