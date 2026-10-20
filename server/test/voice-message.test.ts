import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { splitAttachments } from '../../web/src/modules/chat/message-attachments.ts';
import { audioBlobAt } from '../../web/src/modules/voice/audio-attachment.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { toneWav } from './fixtures/stub-speech.ts';
import { ownerCookie } from './fixtures/owner.ts';

// A raw audio message (M7 #07): the recording is attached through the gateway's `file.attach` as a data URL, the message keeps a line that names
// the file Hermes staged, and the transcript plays it back by reading the file through Caduceus. The chat engine runs over the browser's gateway
// connection through Caduceus (so every call passes the policy proxy), in front of the real Hermes whose provider is the stub LLM.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let cookie: string | undefined;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-voice-')));
});
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  cookie = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

async function openChat() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie ??= await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work });
  chats.push(chat);
  return { chat };
}

const finished = (messages: number) => (state: { running: boolean; turn: unknown; messages: unknown[] }) => !state.running && state.turn === undefined && state.messages.length >= messages;

describe('raw audio message', () => {
  test('a recording goes to Hermes as a file, the message names it as audio, and the transcript reads it back to play', async () => {
    const { chat } = await openChat();
    const recording = toneWav(0.5);
    const voice = { name: 'voice-message-2026-10-19-0930.webm', kind: 'file' as const, body: new Blob([new Uint8Array(recording)], { type: 'audio/webm' }) };
    expect(await chat.send('', { attachments: [voice] })).toBe(true);
    await chat.until(finished(2));

    const staged = path.join(fs.realpathSync(hermes.home), 'attachments', voice.name);
    expect(chat.state.messages[0]!.text).toBe(`[User attached file: ${staged}]`);
    expect(fs.readFileSync(staged)).toEqual(recording);

    // The message is shown as a recording to play, not as a file chip.
    expect(splitAttachments(chat.state.messages[0]!.text).attachments).toEqual([{ kind: 'audio', path: staged, name: voice.name }]);

    // The player reads the bytes back from Hermes through Caduceus, typed as audio.
    const audio = await audioBlobAt(staged, async (route) => {
      const reply = await fetch(`${server!.url}${route}`, { headers: { cookie: cookie! } });
      if (!reply.ok) return undefined;
      const body: { dataUrl: string } = await reply.json();
      return body.dataUrl;
    });
    expect(audio).toBeInstanceOf(Blob);
    expect(audio!.type).toBe('audio/webm');
    expect(Buffer.from(await audio!.arrayBuffer())).toEqual(recording);
  });
});
