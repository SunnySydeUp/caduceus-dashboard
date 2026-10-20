import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { sendSessionWrite } from '../src/session-fence.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { seedSessions } from './fixtures/seed-session.ts';
import type { DraftAttachment, DraftList, DraftReply, SavedPrompt, SavedPromptList } from '@caduceus/contracts/chat-drafts';

// Chat drafts (M1 #11): the owner's unsent composer text and attachments, kept by Caduceus per (profile, session or "new"), through the Caduceus
// server's HTTP API in front of the real Hermes in a throwaway HERMES_HOME. Two signed-in "devices" are two cookies on the same server.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  // The sessions the drafts below belong to: Hermes has them, as it has the owner's.
  await seedSessions(hermes.home, [{ id: 'abc123' }, { id: 'many' }, { id: 'gone' }, { id: 'kept' }]);
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** What the draft routes answer with: a draft, a list, or a refusal. */
type Reply = Partial<DraftReply> & Partial<DraftList> & Partial<SavedPromptList> & Partial<SavedPrompt> & { attachment?: DraftAttachment; error?: string; message?: string; what?: string; maxBytes?: number };

interface Device {
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Reply }>;
  /** A raw upload: the bytes as they are, with the content type a browser would send. */
  upload(route: string, bytes: Uint8Array | string, type?: string): Promise<{ status: number; body: Reply }>;
  /** Turns read-only mode on or off (a T2 action: the owner confirms with a passkey). */
  setReadOnly(on: boolean): Promise<void>;
  /** The bytes of a stored attachment, as a browser would read them. */
  download(route: string): Promise<{ status: number; type: string | null; bytes: Buffer }>;
}

async function startServer(options: Partial<Parameters<typeof startCaduceusServer>[0]> = {}): Promise<{ url: string; device(): Promise<Device> }> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, ...options });
  const { url } = server;
  return {
    url,
    async device() {
      const cookie = await ownerCookie(url);
      const send = async (method: string, route: string, init: { body?: BodyInit; type?: string }) => {
        const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(init.type ? { 'content-type': init.type } : {}) }, body: init.body });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : undefined };
      };
      return {
        call: (method, route, body) => send(method, route, body === undefined ? {} : { body: JSON.stringify(body), type: 'application/json' }),
        upload: (route, bytes, type = 'application/octet-stream') => send('POST', route, { body: typeof bytes === 'string' ? bytes : Buffer.from(bytes), type }),
        async setReadOnly(on) {
          await stepUp(url, cookie, await addPasskey(url, cookie));
          const res = await send('PUT', '/_caduceus/api/policy/read-only', { body: JSON.stringify({ readOnly: on }), type: 'application/json' });
          expect(res.status).toBe(200);
        },
        async download(route) {
          const res = await fetch(`${url}${route}`, { headers: { origin: url, cookie } });
          return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
        },
      };
    },
  };
}

const DRAFT = '/_caduceus/api/chat/draft';
const UPLOAD = '/_caduceus/api/chat/draft/attachments';
const key = (profile: string, session: string) => `?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}`;

describe('drafts', () => {
  test('the composer text is saved per profile and session, read back, and gone when the owner clears it', async () => {
    const owner = await (await startServer()).device();
    expect((await owner.call('GET', DRAFT + key('default', 'new'))).body).toEqual({ draft: null });

    const saved = await owner.call('PUT', DRAFT + key('default', 'new'), { text: 'Plan the release notes' });
    expect(saved.status).toBe(200);
    expect(saved.body.draft).toEqual({ profile: 'default', session: 'new', text: 'Plan the release notes', attachments: [], revision: expect.any(Number), updatedAt: expect.any(Number) });
    await owner.call('PUT', DRAFT + key('default', 'abc123'), { text: 'A reply for that session' });
    await owner.call('PUT', DRAFT + key('coder', 'new'), { text: 'Another profile’s new chat' });

    // Each key has its own draft.
    expect((await owner.call('GET', DRAFT + key('default', 'new'))).body.draft?.text).toBe('Plan the release notes');
    expect((await owner.call('GET', DRAFT + key('default', 'abc123'))).body.draft?.text).toBe('A reply for that session');
    expect((await owner.call('GET', DRAFT + key('coder', 'new'))).body.draft?.text).toBe('Another profile’s new chat');

    // Clearing the composer (a save of nothing) and sending (a delete) both leave no draft.
    expect((await owner.call('PUT', DRAFT + key('default', 'new'), { text: '  \n' })).body).toEqual({ draft: null });
    expect((await owner.call('GET', DRAFT + key('default', 'new'))).body).toEqual({ draft: null });
    expect((await owner.call('DELETE', DRAFT + key('default', 'abc123'))).status).toBe(204);
    expect((await owner.call('GET', DRAFT + key('default', 'abc123'))).body).toEqual({ draft: null });
    expect((await owner.call('GET', DRAFT + key('coder', 'new'))).body.draft?.text).toBe('Another profile’s new chat');
  });

  test('two devices: the latest write wins, and the device whose save replaced a newer draft is told what it replaced', async () => {
    const owner = await startServer();
    const phone = await owner.device();
    const desktop = await owner.device();
    const here = DRAFT + key('default', 'abc123');

    const first = await phone.call('PUT', here, { text: 'Outline the talk' });
    expect(first.body.replaced).toBeUndefined();
    // The desktop opens the session and sees the phone's draft; its next save names the revision it saw and replaces nothing.
    const seen = (await desktop.call('GET', here)).body.draft!;
    expect(seen.text).toBe('Outline the talk');
    const second = await desktop.call('PUT', here, { text: 'Outline the talk, then the demo', base: seen.revision });
    expect(second.body.replaced).toBeUndefined();
    expect(second.body.draft!.revision).toBeGreaterThan(seen.revision);

    // The phone, which has not seen that, saves on top of it: its text wins and it is handed the text it replaced.
    const third = await phone.call('PUT', here, { text: 'Outline the talk, then questions', base: first.body.draft!.revision });
    expect(third.body.draft?.text).toBe('Outline the talk, then questions');
    expect(third.body.replaced?.text).toBe('Outline the talk, then the demo');
    expect((await desktop.call('GET', here)).body.draft?.text).toBe('Outline the talk, then questions');

    // Writing the same words again loses nothing, so it is no conflict.
    const same = await desktop.call('PUT', here, { text: 'Outline the talk, then questions', base: seen.revision });
    expect(same.body.replaced).toBeUndefined();
  });

  test('a draft that holds a secret, or is too long, is refused and nothing is stored; ordinary talk of keys and tokens is not a secret', async () => {
    const owner = await (await startServer()).device();
    const here = DRAFT + key('default', 'new');
    await owner.call('PUT', here, { text: 'Rotate the staging credentials' });

    const withKey = await owner.call('PUT', here, { text: 'Use OPENAI_API_KEY=sk-live-3f9a8b7c6d5e4f3a2b1c in the script' });
    expect(withKey.status).toBe(422);
    expect(withKey.body).toMatchObject({ error: 'secret', what: expect.stringContaining('key'), message: expect.stringContaining('not saved') });
    // The refused words are nowhere in the answer, and the earlier draft is untouched.
    expect(JSON.stringify(withKey.body)).not.toContain('sk-live');
    expect((await owner.call('GET', here)).body.draft?.text).toBe('Rotate the staging credentials');

    expect((await owner.call('PUT', here, { text: 'password: hunter2hunter2' })).status).toBe(422);
    expect((await owner.call('PUT', here, { text: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn' })).status).toBe(422);
    expect((await owner.call('PUT', here, { text: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345' })).status).toBe(422);

    expect((await owner.call('PUT', here, { text: 'Explain how the API key and the access token are rotated, and where the password lives' })).status).toBe(200);

    const long = await owner.call('PUT', here, { text: 'word '.repeat(9000) });
    expect(long.status).toBe(413);
    expect(long.body).toMatchObject({ error: 'too-large', message: expect.stringContaining('40 KB') });
  });

  test('attachments are kept with the draft, come back on another device, and leave with the draft', async () => {
    const owner = await startServer();
    const phone = await owner.device();
    const desktop = await owner.device();
    const here = key('default', 'abc123');
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);

    const stored = await phone.upload(`${UPLOAD}${here}&name=${encodeURIComponent('floor plan.png')}&kind=image`, bytes, 'image/png');
    expect(stored.status).toBe(201);
    expect(stored.body.attachment).toEqual({ id: expect.any(String), name: 'floor plan.png', kind: 'image', mime: 'image/png', size: 5000 });
    const note = await phone.upload(`${UPLOAD}${here}&name=pasted-text-1.md&kind=file&pasted=1`, '# Notes\nthe long paste', 'text/markdown');
    expect(note.body.attachment).toMatchObject({ name: 'pasted-text-1.md', pasted: true });

    // The draft names the attachments it keeps, in that order; text may be empty while there are attachments.
    const saved = await phone.call('PUT', DRAFT + here, { text: '', attachments: [note.body.attachment!.id, stored.body.attachment!.id] });
    expect(saved.body.draft?.attachments.map((a) => a.name)).toEqual(['pasted-text-1.md', 'floor plan.png']);

    const opened = (await desktop.call('GET', DRAFT + here)).body.draft!;
    expect(opened.attachments).toHaveLength(2);
    const read = await desktop.download(`${UPLOAD}/${stored.body.attachment!.id}${here}`);
    expect(read.status).toBe(200);
    expect(read.bytes.equals(Buffer.from(bytes))).toBe(true);
    // Stored bytes are never served as a page.
    expect(read.type).toBe('application/octet-stream');

    // An attachment left out of the next save is deleted with its bytes; one never named by a save is swept away by it.
    const stray = await phone.upload(`${UPLOAD}${here}&name=stray.txt&kind=file`, 'x', 'text/plain');
    await phone.call('PUT', DRAFT + here, { text: 'with the plan', attachments: [stored.body.attachment!.id] });
    expect((await desktop.download(`${UPLOAD}/${note.body.attachment!.id}${here}`)).status).toBe(404);
    expect((await desktop.download(`${UPLOAD}/${stray.body.attachment!.id}${here}`)).status).toBe(404);
    expect((await desktop.call('GET', DRAFT + here)).body.draft?.attachments).toHaveLength(1);

    // Saving text alone leaves the attachments as they are; sending (delete) takes everything.
    await desktop.call('PUT', DRAFT + here, { text: 'with the plan, please' });
    expect((await desktop.call('GET', DRAFT + here)).body.draft?.attachments).toHaveLength(1);
    expect((await phone.call('DELETE', DRAFT + here)).status).toBe(204);
    expect((await desktop.download(`${UPLOAD}/${stored.body.attachment!.id}${here}`)).status).toBe(404);
    // An empty save of a draft with no attachments left deletes it.
    const again = await phone.upload(`${UPLOAD}${here}&name=a.txt&kind=file`, 'a', 'text/plain');
    await phone.call('PUT', DRAFT + here, { text: 'x', attachments: [again.body.attachment!.id] });
    expect((await phone.call('PUT', DRAFT + here, { text: ' ', attachments: [] })).body).toEqual({ draft: null });
    expect((await desktop.download(`${UPLOAD}/${again.body.attachment!.id}${here}`)).status).toBe(404);
  });

  test('an attachment that is too large, too many, or looks like credentials is refused with the reason, and the draft keeps the rest', async () => {
    const owner = await (await startServer()).device();
    const here = key('default', 'new');
    const MB = 1024 * 1024;

    const huge = await owner.upload(`${UPLOAD}${here}&name=video.mov&kind=file`, new Uint8Array(8 * MB + 1));
    expect(huge.status).toBe(413);
    expect(huge.body).toMatchObject({ error: 'too-large', message: expect.stringContaining('8 MB') });

    const env = await owner.upload(`${UPLOAD}${here}&name=.env&kind=file`, 'HELLO=world', 'text/plain');
    expect(env.status).toBe(422);
    expect(env.body).toMatchObject({ error: 'secret', message: expect.stringContaining('.env') });
    // A dotenv file by any of its usual names.
    for (const name of ['prod.env', '.env.local']) expect((await owner.upload(`${UPLOAD}${here}&name=${name}&kind=file`, 'A=b', 'text/plain')).status).toBe(422);
    const withKey = await owner.upload(`${UPLOAD}${here}&name=deploy.sh&kind=file`, 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'text/plain');
    expect(withKey.status).toBe(422);
    expect(JSON.stringify(withKey.body)).not.toContain('ghp_');
    // A picture is not read for words.
    expect((await owner.upload(`${UPLOAD}${here}&name=shot.png&kind=image`, new Uint8Array(100), 'image/png')).status).toBe(201);

    // Three of 7 MB fit under 24 MB together; a fourth does not.
    for (const n of [1, 2, 3]) expect((await owner.upload(`${UPLOAD}${here}&name=part-${n}.bin&kind=file`, new Uint8Array(7 * MB))).status).toBe(201);
    const fourth = await owner.upload(`${UPLOAD}${here}&name=part-4.bin&kind=file`, new Uint8Array(7 * MB));
    expect(fourth.status).toBe(413);
    expect(fourth.body.message).toContain('24 MB');

    // Twenty at most.
    const other = key('default', 'many');
    for (let n = 1; n <= 20; n++) expect((await owner.upload(`${UPLOAD}${other}&name=f${n}.txt&kind=file`, 'x', 'text/plain')).status).toBe(201);
    const twentyFirst = await owner.upload(`${UPLOAD}${other}&name=f21.txt&kind=file`, 'x', 'text/plain');
    expect(twentyFirst.status).toBe(409);
    expect(twentyFirst.body).toMatchObject({ error: 'too-many', message: expect.stringContaining('20') });
  });

  test('a session deleted in Hermes takes its draft with it, and the list names the drafts of sessions that are still there', async () => {
    const owner = await (await startServer()).device();
    const note = await owner.upload(`${UPLOAD}${key('default', 'gone')}&name=n.txt&kind=file`, 'keep me', 'text/plain');
    await owner.call('PUT', DRAFT + key('default', 'gone'), { text: 'Reply about the trip', attachments: [note.body.attachment!.id] });
    await owner.call('PUT', DRAFT + key('default', 'kept'), { text: 'Still here' });
    await owner.call('PUT', DRAFT + key('default', 'new'), { text: 'Fresh chat' });
    await owner.call('PUT', DRAFT + key('coder', 'new'), { text: 'Coder’s fresh chat' });
    const listed = async (profile?: string) => (await owner.call('GET', `/_caduceus/api/chat/drafts${profile ? `?profile=${profile}` : ''}`)).body.drafts!.map((d) => `${d.profile}/${d.session}`).sort();

    expect(await listed('default')).toEqual(['default/gone', 'default/kept', 'default/new']);
    expect((await owner.call('GET', '/_caduceus/api/chat/drafts')).body.drafts!.find((d) => d.session === 'gone')).toMatchObject({ chars: 20, attachments: 1, updatedAt: expect.any(Number) });

    // The owner deletes the session in Hermes (here or from the CLI): the draft is orphaned and goes, attachments too.
    expect((await sendSessionWrite(hermes.backend, 'DELETE', '/api/sessions/gone?profile=default', undefined)).ok).toBe(true);
    expect(await listed('default')).toEqual(['default/kept', 'default/new']);
    expect((await owner.call('GET', DRAFT + key('default', 'gone'))).body).toEqual({ draft: null });
    expect((await owner.download(`${UPLOAD}/${note.body.attachment!.id}`)).status).toBe(404);
    expect(await listed()).toEqual(['coder/new', 'default/kept', 'default/new']);

    // Opening a draft whose session is gone drops it too, without the list having asked.
    await owner.call('PUT', DRAFT + key('default', 'kept'), { text: 'Still here, edited' });
    expect((await sendSessionWrite(hermes.backend, 'DELETE', '/api/sessions/kept?profile=default', undefined)).ok).toBe(true);
    expect((await owner.call('GET', DRAFT + key('default', 'kept'))).body).toEqual({ draft: null });
  });

  test('read-only mode refuses every draft write with a clear message, and reads still work', async () => {
    const owner = await (await startServer()).device();
    const here = key('default', 'abc123');
    await owner.call('PUT', DRAFT + here, { text: 'Written before' });
    await owner.setReadOnly(true);

    const refusals = [
      await owner.call('PUT', DRAFT + here, { text: 'Typed now' }),
      await owner.call('DELETE', DRAFT + here),
      await owner.upload(`${UPLOAD}${here}&name=a.txt&kind=file`, 'a', 'text/plain'),
    ];
    for (const refusal of refusals) expect(refusal).toMatchObject({ status: 403, body: { error: 'read-only', message: expect.stringContaining('Read-only mode is on') } });
    expect((await owner.call('GET', DRAFT + here)).body.draft?.text).toBe('Written before');

    await owner.setReadOnly(false);
    expect((await owner.call('PUT', DRAFT + here, { text: 'Typed now' })).status).toBe(200);
  });

  test('saved prompts: create, list for a profile (scoped ones stay hidden from the others), edit, delete', async () => {
    const owner = await (await startServer()).device();
    const PROMPTS = '/_caduceus/api/chat/prompts';
    expect((await owner.call('GET', PROMPTS)).body).toEqual({ prompts: [] });

    const review = await owner.call('POST', PROMPTS, { name: '  Code   review ', text: 'Review this diff for bugs and style:\n\n', tags: ['Review', 'code', ' review '], profile: null });
    expect(review.status).toBe(201);
    expect(review.body).toEqual({ id: expect.any(String), name: 'Code review', text: 'Review this diff for bugs and style:\n\n', tags: ['review', 'code'], profile: null, updatedAt: expect.any(Number) });
    const standup = await owner.call('POST', PROMPTS, { name: 'Standup notes', text: 'Summarise yesterday’s commits', tags: [], profile: 'coder' });
    const apple = await owner.call('POST', PROMPTS, { name: 'apple pie', text: 'Recipe, please', tags: ['food'], profile: 'default' });

    const names = async (profile?: string) => (await owner.call('GET', profile ? `${PROMPTS}?profile=${profile}` : PROMPTS)).body.prompts!.map((p) => p.name);
    expect(await names('coder')).toEqual(['Code review', 'Standup notes']);
    expect(await names('default')).toEqual(['apple pie', 'Code review']);
    expect(await names('other')).toEqual(['Code review']);
    expect(await names()).toEqual(['apple pie', 'Code review', 'Standup notes']);

    const edited = await owner.call('PUT', `${PROMPTS}/${standup.body.id}`, { name: 'Standup', text: 'Summarise the last day’s commits', tags: ['daily'], profile: null });
    expect(edited.body).toMatchObject({ id: standup.body.id, name: 'Standup', tags: ['daily'], profile: null });
    expect(await names('other')).toEqual(['Code review', 'Standup']);

    expect((await owner.call('DELETE', `${PROMPTS}/${apple.body.id}`)).status).toBe(204);
    expect((await owner.call('DELETE', `${PROMPTS}/${apple.body.id}`)).status).toBe(404);
    expect((await owner.call('PUT', `${PROMPTS}/${apple.body.id}`, { name: 'x', text: 'y', tags: [], profile: null })).status).toBe(404);
    expect(await names()).toEqual(['Code review', 'Standup']);
  });

  test('a saved prompt needs a name and text, stays within its limits, and is never one that holds a secret; read-only mode blocks the writes', async () => {
    const owner = await (await startServer()).device();
    const PROMPTS = '/_caduceus/api/chat/prompts';
    const ok = { name: 'Fine', text: 'Hello', tags: [], profile: null };
    for (const bad of [{ ...ok, name: '  ' }, { ...ok, text: '' }, { ...ok, name: 'n'.repeat(81) }, { ...ok, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }, { ...ok, tags: ['t'.repeat(25)] }, { ...ok, profile: '' }, { ...ok, tags: 'x' }, { ...ok, text: 'x'.repeat(20_001) }]) {
      expect((await owner.call('POST', PROMPTS, bad)).status).toBe(400);
    }
    const secret = await owner.call('POST', PROMPTS, { ...ok, text: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" https://x' });
    expect(secret).toMatchObject({ status: 422, body: { error: 'secret', message: expect.stringContaining('not saved') } });
    const saved = await owner.call('POST', PROMPTS, ok);
    expect((await owner.call('PUT', `${PROMPTS}/${saved.body.id}`, { ...ok, text: 'OPENAI_API_KEY=sk-live-3f9a8b7c6d5e4f3a2b1c' })).status).toBe(422);

    await owner.setReadOnly(true);
    for (const refusal of [await owner.call('POST', PROMPTS, ok), await owner.call('PUT', `${PROMPTS}/${saved.body.id}`, ok), await owner.call('DELETE', `${PROMPTS}/${saved.body.id}`)]) {
      expect(refusal).toMatchObject({ status: 403, body: { error: 'read-only', message: expect.stringContaining('Read-only mode is on') } });
    }
    expect((await owner.call('GET', PROMPTS)).body.prompts).toHaveLength(1);
    await owner.setReadOnly(false);

    for (let n = 0; n < 199; n++) expect((await owner.call('POST', PROMPTS, { ...ok, name: `P${n}` })).status).toBe(201);
    expect((await owner.call('POST', PROMPTS, ok)).status).toBe(409);
  });
});
