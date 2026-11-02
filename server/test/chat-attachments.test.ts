import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Attachments (M1 #10): images reach Hermes through the gateway's `image.attach_bytes`, files and PDFs through `file.attach`, and what was
// attached is in the message the model is sent and in the transcript after a reload. The chat engine over the browser's gateway connection
// through Caduceus (so every call passes the policy proxy), in front of the real Hermes whose provider is the stub LLM.
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
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
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-attach-')));
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

/** A chat on a page. With `refuseSubmit`, the page's next `prompt.submit` is refused with those words before it reaches Hermes, as Caduceus refuses a turn while it drains. */
async function openChat(options: Parameters<typeof createChat>[1] = {}, refuseSubmit?: string) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie ??= await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  let refusal = refuseSubmit;
  const client = new Proxy(page.connection.client, {
    get(target, property) {
      if (property === 'request')
        return (method: string, ...rest: unknown[]) => {
          if (method !== 'prompt.submit' || refusal === undefined) return (target.request as Function)(method, ...rest);
          const error = new Error(refusal);
          refusal = undefined;
          return Promise.reject(error);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const chat = createChat({ client, status: page.connection.status, onReady: page.connection.onReady.bind(page.connection) }, { history: page.rest, ...options });
  chats.push(chat);
  return chat;
}

const finished = (messages: number) => (state: { running: boolean; turn: unknown; messages: unknown[] }) => !state.running && state.turn === undefined && state.messages.length >= messages;
const lastCompletion = () => llm.completions.at(-1)!;
const image = (name: string) => ({ name, kind: 'image' as const, body: new Blob([PIXEL_PNG], { type: 'image/png' }) });

describe('images', () => {
  test('an image goes to Hermes with the message: the model is told of it, the message keeps it as @image: after a reload, and the file is in the profile’s images', async () => {
    const chat = await openChat({ cwd: work });
    const progress: string[] = [];
    expect(await chat.send('What is in this picture?', { attachments: [image('dot.png')], onProgress: (step) => progress.push(`${step.name}:${step.state}`) })).toBe(true);
    await chat.until(finished(2));

    expect(progress).toEqual(['dot.png:uploading', 'dot.png:attached']);
    const [sent] = chat.state.messages;
    const reference = /\n@image:(\S+\.png)$/.exec(sent!.text);
    expect(sent!.text.startsWith('What is in this picture?')).toBe(true);
    expect(reference).not.toBeNull();
    expect(fs.readFileSync(reference![1]!)).toEqual(PIXEL_PNG);
    expect(path.dirname(reference![1]!)).toBe(path.join(hermes.home, 'images'));
    // The model's message names the image Hermes stored (Hermes names the file itself, and has changed how between versions: the path is what ties them).
    expect(JSON.stringify(lastCompletion().messages)).toContain(reference![1]!);

    // The thumbnail in the transcript is read back from Hermes through Caduceus, by the path in the message.
    const read = (await pages[0]!.rest(`/api/fs/read-data-url?path=${encodeURIComponent(reference![1]!)}`)) as { dataUrl: string };
    expect(read.dataUrl).toBe(`data:image/png;base64,${PIXEL_PNG.toString('base64')}`);

    // Opened again from Hermes's history, it is the same message.
    const again = await openChat({ storedId: chat.state.storedId! });
    await again.until((state) => state.messages.length === 2);
    expect(again.state.messages[0]!.text).toBe(sent!.text);
  });

  test('an image whose prompt does not go is taken back from Hermes: the next message is sent without it', async () => {
    const chat = await openChat({ cwd: work }, 'Caduceus is updating or restarting, so new turns are paused. Try again in a moment.');
    expect(await chat.send('What is in this picture?', { attachments: [image('dot.png')] })).toBe(false);
    expect(chat.state.error).toMatch(/new turns are paused/);

    expect(await chat.send('Just words')).toBe(true);
    await chat.until(finished(2));
    expect(lastCompletion().messages.at(-1)).toEqual({ role: 'user', content: 'Just words' });
  });
});

describe('files and PDFs', () => {
  test('a file is staged by Hermes and the message names it, so that the agent reads it with its own tools; the transcript keeps the line', async () => {
    const chat = await openChat({ cwd: work });
    const notes = { name: 'notes.txt', kind: 'file' as const, body: new Blob(['The launch code is PELICAN-7.\n'], { type: 'text/plain' }) };
    const staged = path.join(fs.realpathSync(hermes.home), 'attachments', 'notes.txt');
    llm.nextReply({ chunks: ['Reading.'], toolCalls: [{ id: 'call_read', name: 'read_file', arguments: { path: staged } }] });
    llm.nextReply({ chunks: ['Read it.'] });
    expect(await chat.send('Summarise the attached notes', { attachments: [notes] })).toBe(true);
    await chat.until(finished(2));

    // Hermes's own @file: expansion refuses a path outside the workspace, so the message does not use one: it says where the file is, as Hermes's own drop does.
    expect(chat.state.messages[0]!.text).toBe(`Summarise the attached notes\n[User attached file: ${staged}]`);
    expect(fs.readFileSync(staged, 'utf8')).toBe('The launch code is PELICAN-7.\n');
    const [, afterTool] = llm.completions.slice(-2);
    expect(JSON.stringify(afterTool!.messages.at(-1))).toContain('PELICAN-7');
  });

  test('a PDF stays a PDF: Hermes stages the file itself, the message names it, and no page is turned into an image', async () => {
    const chat = await openChat({ cwd: work });
    const bytes = '%PDF-1.4\n%stand-in\n';
    const pdf = { name: 'report.pdf', kind: 'pdf' as const, body: new Blob([bytes], { type: 'application/pdf' }) };
    const staged = path.join(fs.realpathSync(hermes.home), 'attachments', 'report.pdf');
    expect(await chat.send('Read this report', { attachments: [pdf] })).toBe(true);
    await chat.until(finished(2));

    expect(chat.state.messages[0]!.text).toBe(`Read this report\n[User attached file: ${staged}]`);
    expect(fs.readFileSync(staged, 'utf8')).toBe(bytes);
    expect(JSON.stringify(lastCompletion().messages)).not.toMatch(/@image:|\.png/);
  });

  test('an attachment Hermes refuses stops the send: nothing is sent, the error names the file, and the images queued before it are taken back', async () => {
    const chat = await openChat({ cwd: work });
    const steps: string[] = [];
    const empty = { name: 'empty.png', kind: 'image' as const, body: new Blob([], { type: 'image/png' }) };
    const before = llm.completions.length;
    expect(await chat.send('Read both', { attachments: [image('first.png'), empty], onProgress: (step) => steps.push(`${step.name}:${step.state}`) })).toBe(false);

    expect(steps).toEqual(['first.png:uploading', 'first.png:attached', 'empty.png:uploading', 'empty.png:failed']);
    expect(chat.state.error).toMatch(/^empty\.png: /);
    expect(chat.state).toMatchObject({ running: false, turn: undefined });
    expect(llm.completions.length).toBe(before);

    // The first image was detached: the next message, sent with no attachment, carries no image.
    expect(await chat.send('Just words')).toBe(true);
    await chat.until(finished(2));
    expect(JSON.stringify(lastCompletion().messages)).not.toMatch(/upload_|@image:/);
  });
});
