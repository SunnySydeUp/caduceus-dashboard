import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, transcriptOf, type Chat, type ChatState } from '../../web/src/modules/chat/chat-session.ts';
import type { ActivityItem, Notice } from '../../web/src/modules/chat/activity.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { DEFAULT_REPLY, startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// What the agent is doing (M1 #05): the chat engine's activity state (`web/src/modules/chat/activity.ts` folds Hermes's events into
// reasoning, tool, subagent and todo state), over the browser's gateway connection through Caduceus, in front of the real Hermes
// whose provider is the stub LLM. The stub scripts the model's reasoning and tool calls, and Hermes runs the tools for real (in a
// throwaway work directory), so every event here is one Hermes really sends.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  // Hermes defers some tools (todo_list among them) behind a search tool once there are many: the model here names them directly.
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-activity-')));
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
  fs.rmSync(work, { recursive: true, force: true });
});
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function openChat(options: Parameters<typeof createChat>[1] = {}) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const page = openGatewayConnection(server.url, await ownerCookie(server.url));
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, ...options });
  chats.push(chat);
  return { chat, page };
}

/** The activity cards of a transcript, in order. */
const activityOf = (state: Pick<ChatState, 'messages' | 'turn'>): ActivityItem[] => transcriptOf(state).flatMap((message) => message.activity ?? []);
const finished = (state: ChatState) => !state.running && state.turn === undefined && state.messages.length > 1;

describe('reasoning and tool cards', () => {
  test('a turn with reasoning and tool calls builds cards from the events as they arrive, and the same cards come back from Hermes\'s history', async () => {
    const { chat } = await openChat({ cwd: work });
    const target = path.join(work, 'notes.txt');
    fs.writeFileSync(target, 'hello\n');
    const missing = path.join(work, 'missing.txt');
    llm.nextReply({
      chunks: ['Let me plan. '],
      reasoning: ['think ', 'hard'],
      toolCalls: [
        { id: 'call_todo', name: 'todo_list', arguments: { todos: [{ id: 'a', content: 'First', status: 'in_progress' }] } },
        { id: 'call_patch', name: 'patch', arguments: { mode: 'replace', path: target, old_string: 'hello', new_string: 'bye' } },
        { id: 'call_read', name: 'read_file', arguments: { path: missing } },
      ],
    });
    llm.nextReply({ chunks: ['All done.'] });

    // Cards as they are while Hermes is still working: the reasoning streams in, and the tools go from running to done.
    const reasoningSeen: string[] = [];
    chat.subscribe(() => {
      const card = activityOf(chat.state).find((item) => item.kind === 'reasoning');
      if (card && card.text !== reasoningSeen.at(-1)) reasoningSeen.push(card.text);
    });
    await chat.send('Plan it');
    await chat.until((state) => state.turn !== undefined && activityOf(state).filter((item) => item.kind === 'tool' && (item.status === 'done' || item.status === 'failed')).length === 3);
    const live = activityOf(chat.state);
    await chat.until(finished);
    const reloaded = activityOf(chat.state);

    expect(reasoningSeen).toEqual(['think ', 'think hard']);
    for (const cards of [live, reloaded]) {
      expect(cards.filter((item) => item.kind === 'reasoning').map((item) => item.text)).toEqual(['think hard']);
      const tools = cards.filter((item) => item.kind === 'tool');
      expect(tools.map((item) => [item.id, item.name, item.status])).toEqual([
        ['call_todo', 'todo_list', 'done'],
        ['call_patch', 'patch', 'done'],
        ['call_read', 'read_file', 'failed'],
      ]);
      // Arguments, the file diff and the failure are on the cards.
      expect(tools[0]!.args).toEqual({ todos: [{ id: 'a', content: 'First', status: 'in_progress' }] });
      expect(tools[1]!.args).toMatchObject({ path: target, old_string: 'hello', new_string: 'bye' });
      expect(tools[1]!.diff).toContain('-hello\n+bye');
      expect(tools[2]!.error).toBe(`File not found: ${missing}`);
      expect(tools[0]!.output).toContain('"revision": 1');
    }
    expect(live.find((item) => item.kind === 'tool')!.durationS).toBeGreaterThanOrEqual(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('bye\n');
  });
});

describe('the todo list, usage and what the agent saves', () => {
  test('todo.updated keeps the task list, the reply footer carries tokens and tokens per second, and saving a memory or a skill raises a notice', async () => {
    const notices: Notice[] = [];
    const { chat } = await openChat({ notify: (notice) => notices.push(notice) });
    llm.nextReply({
      chunks: [],
      toolCalls: [
        { id: 'call_t1', name: 'todo_list', arguments: { todos: [{ id: 'a', content: 'Read the brief', status: 'in_progress' }, { id: 'b', content: 'Write the plan', status: 'pending' }] } },
        { id: 'call_m', name: 'memory', arguments: { action: 'add', target: 'memory', content: 'The owner prefers tea' } },
        { id: 'call_s', name: 'skill_manage', arguments: { action: 'create', name: 'tea-brewing', content: '---\nname: tea-brewing\ndescription: How the owner likes tea\n---\n\n# Tea\n\nBoil, steep three minutes.\n' } },
      ],
      usage: { prompt: 30, completion: 12 },
    });
    llm.nextReply({ chunks: ['Noted.'], usage: { prompt: 50, completion: 8 } });
    await chat.send('Remember my tea');
    await chat.until((state) => state.todos.length === 2);
    expect(chat.state.todos).toEqual([
      { id: 'a', content: 'Read the brief', status: 'in_progress' },
      { id: 'b', content: 'Write the plan', status: 'pending' },
    ]);
    await chat.until(finished);

    // The footer of the reply: Hermes's token counts for the turn (two model calls), and a speed.
    const reply = transcriptOf(chat.state).at(-1)!;
    expect(reply).toMatchObject({ role: 'assistant', text: 'Noted.' });
    expect(reply.stats).toMatchObject({ input: 80, output: 20, total: 100 });
    expect(reply.stats!.tps).toBeGreaterThan(0);
    expect(chat.state.usage).toMatchObject({ input: 80, output: 20, calls: 2 });
    expect(notices).toEqual([
      { tone: 'success', message: 'Memory saved', detail: 'The owner prefers tea' },
      { tone: 'success', message: 'Skill saved', detail: 'tea-brewing' },
    ]);

    // A page that opens the chat later has the task list from Hermes, and no notices for what happened before it came.
    const later: Notice[] = [];
    const { chat: reopened } = await openChat({ storedId: chat.state.storedId, notify: (notice) => later.push(notice) });
    await reopened.until((state) => state.messages.length > 0 && !state.syncing);
    expect(reopened.state.todos.map((todo) => todo.id)).toEqual(['a', 'b']);
    expect(later).toEqual([]);
  });
});

describe('subagents', () => {
  test('a delegated child is a card that follows its status, listed for the session, and still there when the chat is opened again', async () => {
    const { chat } = await openChat();
    // The child and the parent's next call both take the default reply: which of them asks the model first is Hermes's to say.
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_delegate', name: 'delegate_task', arguments: { goal: 'Say hi' } }] });
    await chat.send('Ask a helper');

    await chat.until((state) => state.subagents.length === 1);
    const started = chat.state.subagents[0]!;
    expect(started).toMatchObject({ goal: 'Say hi', model: 'stub-model' });
    expect(started.childSessionId).toEqual(expect.any(String));
    // The card in the transcript names the same child, and shows how it is now.
    await chat.until((state) => state.subagents.every((child) => child.status === 'completed'));
    await chat.until(finished);
    const done = chat.state.subagents[0]!;
    expect(done).toMatchObject({ id: started.id, status: 'completed', summary: DEFAULT_REPLY.join(''), childSessionId: started.childSessionId });
    const shown = transcriptOf(chat.state).flatMap((message) => message.activity ?? []).find((item) => item.kind === 'subagent');
    expect(shown).toMatchObject({ id: started.id, status: 'completed', goal: 'Say hi' });

    // Opened again, the chat knows the child from the stored tool result, as delegated.
    const { chat: reopened } = await openChat({ storedId: chat.state.storedId });
    await reopened.until((state) => state.messages.length > 0 && !state.syncing);
    const again = transcriptOf(reopened.state).flatMap((message) => message.activity ?? []);
    expect(again.map((item) => [item.kind, item.kind === 'tool' ? item.name : item.kind === 'subagent' ? item.goal : ''])).toEqual([
      ['tool', 'delegate_task'],
      ['subagent', 'Say hi'],
    ]);
    expect(again[1]).toMatchObject({ id: started.id, status: 'delegated' });
  });
});

describe('activity modes', () => {
  test('a mode goes to Hermes as details_mode and tool progress (for the config and the running session); in Final only Hermes stops sending tool events, and the stored history still has the cards', async () => {
    const { chat, page } = await openChat({ activityMode: 'final', cwd: work });
    const { client } = page.connection;
    const events: string[] = [];
    client.onEvent((event) => events.push(event.type));
    const hermesSays = async () => ({
      details: (await client.request<{ value: string }>('config.get', { key: 'details_mode' })).value,
      progress: (await client.request<{ tool_progress: string }>('config.get', { key: 'focus' })).tool_progress,
    });

    // The device's choice is sent when the session starts, before the first prompt.
    await chat.start();
    expect(await hermesSays()).toEqual({ details: 'hidden', progress: 'off' });
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_read', name: 'read_file', arguments: { path: path.join(work, 'missing.txt') } }] });
    llm.nextReply({ chunks: ['Nothing there.'] });
    await chat.send('Look');
    await chat.until(finished);
    expect(events).not.toContain('tool.start');
    expect(activityOf(chat.state).map((item) => item.kind === 'tool' && item.status)).toEqual(['failed']);

    await chat.setActivityMode('stream');
    expect(await hermesSays()).toEqual({ details: 'expanded', progress: 'all' });
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_read2', name: 'read_file', arguments: { path: path.join(work, 'missing.txt') } }] });
    llm.nextReply({ chunks: ['Still nothing.'] });
    await chat.send('Look again');
    await chat.until((state) => state.messages.filter((message) => message.role === 'assistant' && message.text === 'Still nothing.').length === 1);
    expect(events).toContain('tool.start');

    await chat.setActivityMode('worklog');
    expect(await hermesSays()).toEqual({ details: 'collapsed', progress: 'all' });
  });
});
