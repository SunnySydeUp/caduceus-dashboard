import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createDraftSync, type DraftContent, type DraftSync, type Timers } from '../../web/src/modules/chat/draft-sync.ts';
import type { Attachment } from '../../web/src/modules/chat/attachments.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { seedSessions } from './fixtures/seed-session.ts';

// The page's side of drafts (M1 #11): what the composer does with `draft-sync.ts` (save after a pause, on hide and on clear; load and adopt; the
// notice when another device wrote), against the real Caduceus server in front of the real Hermes. Two "devices" are two sign-ins.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  await seedSessions(hermes.home, [{ id: 's1' }]);
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** Timers the test winds by hand: nothing fires until `fire()`. */
interface ManualTimers extends Timers {
  pending(): number;
  fire(): void;
}

function manualTimers(): ManualTimers {
  const waiting = new Map<number, () => void>();
  let next = 0;
  return {
    set: (run) => {
      waiting.set(++next, run);
      return next;
    },
    clear: (handle) => void waiting.delete(handle as number),
    pending: () => waiting.size,
    fire() {
      const runs = [...waiting.values()];
      waiting.clear();
      runs.forEach((run) => run());
    },
  };
}

let counter = 0;
const attachment = (name: string, text: string, kind: Attachment['kind'] = 'file', type = 'text/plain'): Attachment => ({ id: `local-${++counter}`, name, kind, body: new Blob([text], { type }), size: new Blob([text]).size });
const content = (text: string, attachments: Attachment[] = []): DraftContent => ({ text, attachments });

interface Device {
  /** A draft sync of the composer of (profile, session) on this device; `adopted` is what its composer was given. */
  open(session?: string, profile?: string): { sync: DraftSync; timers: ManualTimers; adopted: DraftContent[]; requests: string[] };
  setReadOnly(on: boolean): Promise<void>;
}

async function start(): Promise<{ device(): Promise<Device> }> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  return {
    async device() {
      const cookie = await ownerCookie(url);
      return {
        open(session = 's1', profile = 'default') {
          const timers = manualTimers();
          const adopted: DraftContent[] = [];
          const requests: string[] = [];
          const sync = createDraftSync({
            profile,
            session,
            timers,
            fetcher: (route, init) => {
              requests.push(`${init.method ?? 'GET'} ${route.split('?')[0]}`);
              return fetch(`${url}${route}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), origin: url, cookie } });
            },
            adopt: (made) => adopted.push(made),
          });
          return { sync, timers, adopted, requests };
        },
        async setReadOnly(on) {
          await stepUp(url, cookie, await addPasskey(url, cookie));
          const res = await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: on }) });
          expect(res.status).toBe(200);
        },
      };
    },
  };
}

describe('the composer’s draft sync', () => {
  test('typing is saved after a pause, not on every key; clearing the composer deletes the draft at once; another device opens the same draft', async () => {
    const owner = await start();
    const phone = (await owner.device()).open();
    await phone.sync.load(content(''));
    // An empty composer with no draft behind it asks the server for nothing.
    phone.sync.change(content(''));
    await phone.sync.idle();
    expect(phone.requests).toEqual(['GET /_caduceus/api/chat/draft']);

    phone.sync.change(content('Dra'));
    phone.sync.change(content('Draft the reply'));
    // One save is waiting, and nothing has gone to the server yet.
    expect(phone.timers.pending()).toBe(1);
    expect(phone.requests).toEqual(['GET /_caduceus/api/chat/draft']);
    phone.timers.fire();
    await phone.sync.idle();
    expect(phone.requests).toEqual(['GET /_caduceus/api/chat/draft', 'PUT /_caduceus/api/chat/draft']);

    // Another device opens the session and is given the draft.
    const desktop = (await owner.device()).open();
    await desktop.sync.load(content(''));
    expect(desktop.adopted).toEqual([content('Draft the reply')]);

    // Sending or clearing the composer deletes the draft without waiting for a pause.
    desktop.sync.change(content(''));
    await desktop.sync.idle();
    const again = (await owner.device()).open();
    await again.sync.load(content(''));
    expect(again.adopted).toEqual([]);
  });

  test('attachments are uploaded as they are added and come back, bytes and all, on another device', async () => {
    const owner = await start();
    const phone = (await owner.device()).open();
    await phone.sync.load(content(''));
    const photo = attachment('plan.png', 'not really a png', 'image', 'image/png');
    const notes = { ...attachment('pasted-text-1.md', '# Long paste', 'file', 'text/markdown'), pasted: true };

    phone.sync.change(content('', [photo, notes]));
    await phone.sync.idle();
    // The upload does not wait for the pause; the draft that names them does.
    expect(phone.requests.filter((r) => r.startsWith('POST'))).toHaveLength(2);
    phone.sync.flush();
    await phone.sync.idle();

    const desktop = (await owner.device()).open();
    await desktop.sync.load(content(''));
    const [made] = desktop.adopted;
    expect(made?.text).toBe('');
    expect(made?.attachments.map((a) => [a.name, a.kind, a.size, a.pasted ?? false])).toEqual([['plan.png', 'image', 16, false], ['pasted-text-1.md', 'file', 12, true]]);
    expect(await made?.attachments[0]?.body.text()).toBe('not really a png');
    expect(made?.attachments[0]?.body.type).toBe('image/png');

    // Removing one of them is saved; the other stays.
    const [first] = made!.attachments;
    desktop.sync.change(content('', [first!]));
    desktop.sync.flush();
    await desktop.sync.idle();
    const third = (await owner.device()).open();
    await third.sync.load(content(''));
    expect(third.adopted[0]?.attachments.map((a) => a.name)).toEqual(['plan.png']);
  });

  test('a draft another device saved first is not overwritten silently: the later save wins and the device is told, and can take the other version back', async () => {
    const owner = await start();
    const phone = (await owner.device()).open();
    const desktop = (await owner.device()).open();
    await phone.sync.load(content(''));
    await desktop.sync.load(content(''));

    phone.sync.change(content('Phone words'));
    phone.sync.flush();
    await phone.sync.idle();
    desktop.sync.change(content('Desktop words'));
    desktop.sync.flush();
    await desktop.sync.idle();

    const notice = desktop.sync.store.state.notice;
    expect(notice).toMatchObject({ kind: 'elsewhere', how: 'replaced', theirs: { text: 'Phone words' } });
    // The desktop's text stands, and the other version is one tap away.
    await desktop.sync.takeTheirs();
    expect(desktop.adopted.at(-1)).toEqual(content('Phone words'));
    expect(desktop.sync.store.state.notice).toBeUndefined();
  });

  test('a device that has typed nothing new takes the other device’s draft when it is looked at again, and says so; one with typed text is asked', async () => {
    const owner = await start();
    const phone = (await owner.device()).open();
    const desktop = (await owner.device()).open();
    const laptop = (await owner.device()).open();
    await phone.sync.load(content(''));
    await desktop.sync.load(content(''));
    await laptop.sync.load(content(''));

    phone.sync.change(content('From the phone'));
    phone.sync.flush();
    await phone.sync.idle();

    // The desktop was idle: it takes the draft and says that it did. The laptop was typing: nothing it typed is touched, it is asked.
    await desktop.sync.refresh(content(''));
    expect(desktop.adopted).toEqual([content('From the phone')]);
    expect(desktop.sync.store.state.notice).toMatchObject({ kind: 'elsewhere', how: 'updated' });
    laptop.sync.change(content('Laptop words'));
    await laptop.sync.refresh(content('Laptop words'));
    expect(laptop.adopted).toEqual([]);
    expect(laptop.sync.store.state.notice).toMatchObject({ kind: 'elsewhere', how: 'newer', theirs: { text: 'From the phone' } });

    // Keeping its own words saves them over the other draft, and asks no more.
    laptop.sync.keepMine();
    await laptop.sync.idle();
    expect(laptop.sync.store.state.notice).toBeUndefined();
    const check = (await owner.device()).open();
    await check.sync.load(content(''));
    expect(check.adopted).toEqual([content('Laptop words')]);
  });

  test('what the server refuses stays in the page, with the reason: a secret in the text, an attachment that looks like credentials, read-only mode', async () => {
    const owner = await start();
    const device = await owner.device();
    const phone = device.open();
    await phone.sync.load(content(''));

    phone.sync.change(content('Use OPENAI_API_KEY=sk-live-3f9a8b7c6d5e4f3a2b1c here'));
    phone.sync.flush();
    await phone.sync.idle();
    expect(phone.sync.store.state.notice).toMatchObject({ kind: 'refused', message: expect.stringContaining('not saved') });
    phone.sync.change(content('Use the key from the vault here'));
    phone.sync.flush();
    await phone.sync.idle();
    expect(phone.sync.store.state.notice).toBeUndefined();

    const env = attachment('.env', 'A=b');
    const fine = attachment('notes.txt', 'fine');
    phone.sync.change(content('Use the key from the vault here', [env, fine]));
    await phone.sync.idle();
    expect(phone.sync.store.state.unkept).toEqual([{ id: env.id, name: '.env', reason: expect.stringContaining('.env') }]);
    phone.sync.flush();
    await phone.sync.idle();
    const check = (await owner.device()).open();
    await check.sync.load(content(''));
    expect(check.adopted[0]?.attachments.map((a) => a.name)).toEqual(['notes.txt']);
    // Taking it off the composer ends the note.
    phone.sync.change(content('Use the key from the vault here', [fine]));
    await phone.sync.idle();
    expect(phone.sync.store.state.unkept).toEqual([]);

    await device.setReadOnly(true);
    phone.sync.change(content('Typed while read-only'));
    phone.sync.flush();
    await phone.sync.idle();
    expect(phone.sync.store.state.notice).toMatchObject({ kind: 'readonly', message: expect.stringContaining('Read-only mode is on') });
    await device.setReadOnly(false);
  });
});
