import { describe, expect, test } from 'vitest';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import type { ConfirmRequest } from '../src/palette.ts';
import { createTieredFetch, type TieredDeps, type TieredRequest, type TieredResult } from '../src/tiered-fetch.ts';

// `fetchTiered` is how every module calls a Hermes route that is not a plain read: it asks the policy map (the one the
// server enforces) for the route's tier, shows the shared confirmation dialog for it, and sends the request the way the
// server expects (a typed confirmation for a T3). Its boundaries (the network, the dialog, the passkey prompt, the clock
// of "online") are the test's to set; the policy map is the real one.
interface Sent {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Harness {
  /** What was sent to the server, in order. */
  sent: Sent[];
  /** What the dialog was asked, in order. */
  dialogs: ConfirmRequest[];
  /** How many times the passkey prompt was shown. */
  stepUps: number;
  state: { online: boolean; readOnly: boolean; dialog: 'confirm' | 'decline' | 'missing'; typed: string; stepUpNeeded: boolean };
  /** The server's answers, first to last; anything else is a 204. */
  answers: Response[];
  fetchTiered(request: TieredRequest): Promise<TieredResult>;
}

function harness(): Harness {
  const h: Harness = {
    sent: [],
    dialogs: [],
    stepUps: 0,
    state: { online: true, readOnly: false, dialog: 'confirm', typed: '', stepUpNeeded: false },
    answers: [],
    fetchTiered: undefined as never,
  };
  const deps: TieredDeps = {
    async fetch(path, init) {
      h.sent.push({ path, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), body: init.body as string | undefined });
      return h.answers.shift() ?? new Response(null, { status: 204 });
    },
    confirmer: () =>
      h.state.dialog === 'missing'
        ? undefined
        : async (request: ConfirmRequest) => {
            h.dialogs.push(request);
            return h.state.dialog === 'confirm' ? { typed: h.state.typed || request.object || request.label } : undefined;
          },
    async withStepUp(send) {
      // The server says a passkey is needed once; the owner confirms and the request is sent again.
      if (h.state.stepUpNeeded) {
        h.state.stepUpNeeded = false;
        h.stepUps++;
        await send();
      }
      return send();
    },
    online: () => h.state.online,
    readOnly: () => h.state.readOnly,
    sha256: async (text) => `sha256(${text})`,
  };
  const live = createTieredFetch(deps);
  h.fetchTiered = live;
  return h;
}

const refusalOf = (result: TieredResult): PolicyRefusal => {
  if (result.kind !== 'refused') throw new Error(`Expected a refusal, got ${result.kind}`);
  return result.refusal;
};

describe('fetchTiered', () => {
  test('sends a T0 request and a read at once, with no dialog', async () => {
    const h = harness();

    const rename = await h.fetchTiered({ method: 'PATCH', path: '/api/sessions/s1', body: { title: 'New' } });
    const read = await h.fetchTiered({ method: 'GET', path: '/api/sessions?profile=coder' });

    expect(rename.kind).toBe('sent');
    expect(read.kind).toBe('sent');
    expect(h.dialogs).toEqual([]);
    expect(h.sent).toEqual([
      { path: '/api/sessions/s1', method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"title":"New"}' },
      { path: '/api/sessions?profile=coder', method: 'GET', headers: {}, body: undefined },
    ]);
  });

  test('sends the extra headers a request names with every send, a T3 included, beside the confirmation token', async () => {
    const h = harness();
    h.answers.push(new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 }));

    await h.fetchTiered({ method: 'PUT', path: '/api/profiles/coder/soul', body: { content: 'x' }, headers: { 'x-caduceus-base-sha256': 'abc' }, confirm: { title: 'Save', object: 'coder' } });

    expect(h.sent.at(-1)?.headers).toEqual({ 'content-type': 'application/json', 'x-caduceus-base-sha256': 'abc', 'x-caduceus-confirmation': 'tok-1' });
  });

  test('sends a file upload as the form it is, without a JSON content type, and a T3 one is confirmed for the request line only (a form has no body to bind)', async () => {
    const h = harness();
    h.answers.push(new Response(JSON.stringify({ token: 'tok-up' }), { status: 200 }));
    const form = new FormData();
    form.set('file', new Blob(['zip']), 'backup.zip');

    await h.fetchTiered({ method: 'POST', path: '/api/ops/import-upload', form, confirm: { title: 'Restore?', object: 'restore' } });

    const [mint, upload] = h.sent;
    expect(JSON.parse(mint.body!)).toEqual({ operation: 'POST /api/ops/import-upload', target: 'restore', typed: 'restore' });
    expect(upload).toMatchObject({ path: '/api/ops/import-upload', method: 'POST', headers: { 'x-caduceus-confirmation': 'tok-up' } });
    expect(upload.body).toBe(form);
  });

  test('refuses what the policy denies without sending it, with the reason the server would give', async () => {
    const h = harness();

    const terminal = await h.fetchTiered({ method: 'POST', path: '/api/profiles/coder/open-terminal' });
    const unknown = await h.fetchTiered({ method: 'GET', path: '/api/plugins/other/thing' });

    expect(refusalOf(terminal)).toMatchObject({
      error: 'denied',
      tier: 'denied',
      reason: 'host-terminal',
      operation: 'POST /api/profiles/{name}/open-terminal',
      message: 'Opening a terminal on the host is not available through Caduceus. Copy the command and run it yourself.',
    });
    expect(refusalOf(unknown)).toMatchObject({ error: 'denied', reason: 'unclassified' });
    expect(h.sent).toEqual([]);
    expect(h.dialogs).toEqual([]);
  });

  test('asks a T1 to be confirmed, naming the object and the profile, and sends it only when the owner confirms', async () => {
    const h = harness();
    const request: TieredRequest = {
      method: 'POST',
      path: '/api/ops/doctor?profile=coder',
      confirm: { title: 'Run the doctor?', text: 'Takes a few minutes.', object: 'coder’s home', confirmLabel: 'Back up' },
    };

    const confirmed = await h.fetchTiered(request);
    h.state.dialog = 'decline';
    const declined = await h.fetchTiered(request);

    expect(confirmed.kind).toBe('sent');
    expect(declined.kind).toBe('cancelled');
    expect(h.dialogs).toEqual([
      { tier: 'T1', moduleId: 'hermes', action: 'POST /api/ops/doctor', label: 'Run the doctor?', text: 'Takes a few minutes.', object: 'coder’s home', profile: 'coder', confirmLabel: 'Back up' },
      { tier: 'T1', moduleId: 'hermes', action: 'POST /api/ops/doctor', label: 'Run the doctor?', text: 'Takes a few minutes.', object: 'coder’s home', profile: 'coder', confirmLabel: 'Back up' },
    ]);
    expect(h.sent).toHaveLength(1);
  });

  test('tells the screen the request is on its way only after the owner confirmed, so a Saving state does not start while the dialog is open', async () => {
    const h = harness();
    const order: string[] = [];
    const request: TieredRequest = { method: 'POST', path: '/api/ops/doctor?profile=coder', confirm: { title: 'Run the doctor?' }, onConfirmed: () => order.push(`confirmed after ${h.dialogs.length} dialog`) };

    h.state.dialog = 'decline';
    await h.fetchTiered(request);
    expect(order).toEqual([]);

    h.state.dialog = 'confirm';
    await h.fetchTiered(request);
    expect(order).toEqual(['confirmed after 2 dialog']);

    // A request that needs no confirmation is on its way at once.
    await h.fetchTiered({ method: 'POST', path: '/api/plugins/kanban/dispatch', alreadyConfirmed: true, onConfirmed: () => order.push('at once') });
    expect(order).toEqual(['confirmed after 2 dialog', 'at once']);
  });

  test('passes the destructive mark on to the dialog', async () => {
    const h = harness();
    await h.fetchTiered({ method: 'POST', path: '/api/ops/doctor?profile=coder', confirm: { title: 'Delete it?', destructive: true } });
    expect(h.dialogs[0]).toMatchObject({ destructive: true });
  });

  test('sends a T1 without asking again when the owner already confirmed the larger action it belongs to, and still asks a T2', async () => {
    const h = harness();
    const t1 = await h.fetchTiered({ method: 'POST', path: '/api/plugins/kanban/dispatch', alreadyConfirmed: true });
    expect(t1.kind).toBe('sent');
    expect(h.dialogs).toEqual([]);
    const t2 = await h.fetchTiered({ method: 'DELETE', path: '/api/plugins/kanban/tasks/t_1', alreadyConfirmed: true, confirm: { title: 'Delete?' } });
    expect(t2.kind).toBe('sent');
    expect(h.dialogs).toHaveLength(1);
  });

  test('takes the profile for the dialog from the request: its path, its body or its query', async () => {
    const h = harness();
    const confirm = { title: 'Do it?' };

    await h.fetchTiered({ method: 'POST', path: '/api/profiles/writer/describe-auto', confirm });
    await h.fetchTiered({ method: 'POST', path: '/api/ops/doctor', body: { profile: 'researcher' }, confirm });
    await h.fetchTiered({ method: 'POST', path: '/api/ops/doctor', confirm });

    expect(h.dialogs.map((d) => d.profile)).toEqual(['writer', 'researcher', undefined]);
  });

  test('retries a T2 after the passkey prompt when the server asks for one, and sends no confirmation header', async () => {
    const h = harness();
    h.state.stepUpNeeded = true;

    const result = await h.fetchTiered({ method: 'POST', path: '/api/gateway/restart', confirm: { title: 'Restart the gateway?', profile: 'coder' } });

    expect(result.kind).toBe('sent');
    expect(h.dialogs).toEqual([{ tier: 'T2', moduleId: 'hermes', action: 'POST /api/gateway/restart', label: 'Restart the gateway?', profile: 'coder' }]);
    expect(h.stepUps).toBe(1);
    expect(h.sent.map((s) => s.headers['x-caduceus-confirmation'])).toEqual([undefined, undefined]);
  });

  test('asks a T3 for its typed name, has the server bind that confirmation to the request, and sends the token with it', async () => {
    const h = harness();
    h.answers.push(Response.json({ token: 'tok-1', expiresAt: '2026-10-07T09:01:00.000Z' }));

    const result = await h.fetchTiered({
      method: 'DELETE',
      path: '/api/profiles/coder',
      confirm: { title: 'Delete the profile “coder”?', object: 'coder', recoverability: { undoable: false, note: 'Its sessions go with it.' } },
    });

    expect(result.kind).toBe('sent');
    expect(h.dialogs).toEqual([
      {
        tier: 'T3',
        moduleId: 'hermes',
        action: 'DELETE /api/profiles/{name}',
        label: 'Delete the profile “coder”?',
        object: 'coder',
        profile: 'coder',
        recoverability: { undoable: false, note: 'Its sessions go with it.' },
      },
    ]);
    expect(h.sent).toEqual([
      {
        path: '/_caduceus/api/policy/confirmations',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'DELETE /api/profiles/coder', target: 'coder', typed: 'coder' }),
      },
      { path: '/api/profiles/coder', method: 'DELETE', headers: { 'x-caduceus-confirmation': 'tok-1' }, body: undefined },
    ]);
  });

  test('does not send a destructive session call that names no profile, and asks nobody about it', async () => {
    const h = harness();
    const calls: TieredRequest[] = [
      { method: 'DELETE', path: '/api/sessions/s1', confirm: { title: 'Delete?' } },
      { method: 'DELETE', path: '/api/sessions/empty', confirm: { title: 'Delete?' } },
      { method: 'POST', path: '/api/sessions/bulk-delete', body: { ids: ['a'] }, confirm: { title: 'Delete?' } },
      { method: 'POST', path: '/api/sessions/prune', body: { older_than_days: 30 }, confirm: { title: 'Delete?' } },
    ];
    const refusals = [];
    for (const request of calls) refusals.push(refusalOf(await h.fetchTiered(request)));

    expect(refusals.map((refusal) => refusal.error)).toEqual(['profile-required', 'profile-required', 'profile-required', 'profile-required']);
    expect(h.dialogs).toEqual([]);
    expect(h.sent).toEqual([]);
    // A preview prune changes nothing, so it needs none.
    const preview = await h.fetchTiered({ method: 'POST', path: '/api/sessions/prune', body: { dry_run: true, older_than_days: 30 } });
    expect(preview.kind).toBe('sent');
  });

  test('binds a T3 with a body to that exact body, and names the title when the action has no object of its own', async () => {
    const h = harness();
    h.answers.push(Response.json({ token: 'tok-2', expiresAt: '2026-10-07T09:01:00.000Z' }));

    await h.fetchTiered({ method: 'POST', path: '/api/sessions/bulk-delete', body: { ids: ['a', 'b'], profile: 'default' }, confirm: { title: 'Delete 2 sessions' } });

    expect(h.dialogs[0]).toMatchObject({ tier: 'T3', label: 'Delete 2 sessions' });
    expect(JSON.parse(h.sent[0].body!)).toEqual({
      operation: 'POST /api/sessions/bulk-delete',
      target: 'Delete 2 sessions',
      typed: 'Delete 2 sessions',
      bodySha256: 'sha256({"ids":["a","b"],"profile":"default"})',
    });
    expect(h.sent[1]).toMatchObject({ method: 'POST', path: '/api/sessions/bulk-delete', body: '{"ids":["a","b"],"profile":"default"}', headers: { 'x-caduceus-confirmation': 'tok-2' } });
  });

  test('takes the tier a file write’s own place and body give it: T1 in a workspace, but a recursive delete is T3 there, and anywhere else every write is T3', async () => {
    const h = harness();
    const token = (name: string) => h.answers.push(Response.json({ token: name, expiresAt: '2026-10-07T09:01:00.000Z' }));

    await h.fetchTiered({ method: 'DELETE', path: '/api/files', body: { path: '/work/a.txt' }, inWorkspace: true, confirm: { title: 'Delete a.txt?', object: 'a.txt' } });
    token('tok-3');
    await h.fetchTiered({ method: 'DELETE', path: '/api/files', body: { path: '/work/tmp', recursive: true }, inWorkspace: true, confirm: { title: 'Delete tmp?', object: 'tmp' } });
    token('tok-4');
    await h.fetchTiered({ method: 'DELETE', path: '/api/files', body: { path: '/Users/me/a.txt' }, confirm: { title: 'Delete a.txt?', object: 'a.txt' } });
    token('tok-5');
    await h.fetchTiered({ method: 'POST', path: '/api/files/mkdir', body: { path: '/Users/me/new' }, confirm: { title: 'Make new?', object: 'new' } });
    await h.fetchTiered({ method: 'POST', path: '/_caduceus/api/files/rename', body: { path: '/work/a.txt', name: 'b.txt' }, inWorkspace: true, confirm: { title: 'Rename a.txt?', object: 'a.txt' } });

    expect(h.dialogs.map((d) => d.tier)).toEqual(['T1', 'T3', 'T3', 'T3']);
  });

  test('refuses a T2 or T3 while offline, and any write in read-only mode, before asking anything', async () => {
    const h = harness();
    const confirm = { title: 'Do it?', object: 'x' };
    h.state.online = false;

    const offlineT3 = await h.fetchTiered({ method: 'DELETE', path: '/api/profiles/coder', confirm });
    const offlineT2 = await h.fetchTiered({ method: 'POST', path: '/api/gateway/restart', confirm });
    const offlineT1 = await h.fetchTiered({ method: 'POST', path: '/api/ops/doctor', confirm });
    h.state.online = true;
    h.state.readOnly = true;
    const readOnlyWrite = await h.fetchTiered({ method: 'PATCH', path: '/api/sessions/s1', body: {} });
    const readOnlyT3Read = await h.fetchTiered({ method: 'GET', path: '/api/ops/backup/download', confirm });
    const readOnlyRead = await h.fetchTiered({ method: 'GET', path: '/api/sessions' });

    expect([offlineT3, offlineT2].map((r) => refusalOf(r).error)).toEqual(['offline', 'offline']);
    expect(refusalOf(offlineT3).message).toBe('You are offline. This action is never queued: do it when you are back online.');
    // A T1 may be queued by the module that owns it; asking is the dialog's business, not this one's.
    expect(offlineT1.kind).toBe('sent');
    expect(refusalOf(readOnlyWrite)).toMatchObject({ error: 'read-only', tier: 'T0', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
    expect(refusalOf(readOnlyT3Read).error).toBe('read-only');
    expect(readOnlyRead.kind).toBe('sent');
    expect(h.dialogs.map((d) => d.action)).toEqual(['POST /api/ops/doctor']);
    expect(h.sent.map((s) => s.path)).toEqual(['/api/ops/doctor', '/api/sessions']);
  });

  test('knows what Caduceus does itself: Truncate file is a T3 with the file’s name typed, refused offline and in read-only mode like the rest', async () => {
    const h = harness();
    const request: TieredRequest = { method: 'POST', path: '/_caduceus/api/logs/truncate', body: { file: 'agent', profile: 'coder' }, confirm: { title: 'Empty agent.log?', object: 'agent.log' } };
    h.state.online = false;
    const offline = await h.fetchTiered(request);
    h.state.online = true;
    h.state.readOnly = true;
    const readOnly = await h.fetchTiered(request);
    h.state.readOnly = false;
    h.answers.push(Response.json({ token: 'tok-4', expiresAt: '2026-10-07T09:01:00.000Z' }));

    const sent = await h.fetchTiered(request);

    expect([offline, readOnly].map((r) => refusalOf(r))).toMatchObject([{ error: 'offline', tier: 'T3' }, { error: 'read-only', tier: 'T3' }]);
    expect(sent.kind).toBe('sent');
    expect(h.dialogs).toEqual([{ tier: 'T3', moduleId: 'hermes', action: 'POST /_caduceus/api/logs/truncate', label: 'Empty agent.log?', object: 'agent.log', profile: 'coder' }]);
    expect(JSON.parse(h.sent[0].body!)).toEqual({ operation: 'POST /_caduceus/api/logs/truncate', target: 'agent.log', typed: 'agent.log', bodySha256: 'sha256({"file":"agent","profile":"coder"})' });
    expect(h.sent[1]).toMatchObject({ path: '/_caduceus/api/logs/truncate', headers: { 'x-caduceus-confirmation': 'tok-4' } });
  });

  test('says so when there is no dialog to ask, and passes the server’s refusal of a confirmation on', async () => {
    const h = harness();
    h.state.dialog = 'missing';
    const noDialog = await h.fetchTiered({ method: 'POST', path: '/api/ops/doctor', confirm: { title: 'Run the doctor?' } });
    h.state.dialog = 'confirm';
    h.answers.push(Response.json({ error: 'read-only', tier: 'T3', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' }, { status: 403 }));

    const refusedMint = await h.fetchTiered({ method: 'DELETE', path: '/api/profiles/coder', confirm: { title: 'Delete?', object: 'coder' } });

    expect(refusalOf(noDialog)).toMatchObject({ error: 'confirmation-required', message: 'The confirmation dialog is not available.' });
    expect(refusalOf(refusedMint)).toMatchObject({ error: 'read-only', tier: 'T3' });
    // The request itself was never sent: only the mint was.
    expect(h.sent.map((s) => s.path)).toEqual(['/_caduceus/api/policy/confirmations']);
  });

  test('a raw text save in a workspace Caduceus knows is a T1 (one confirmation, no step-up, no typed name), and read-only mode still stops it', async () => {
    const h = harness();

    const saved = await h.fetchTiered({ method: 'POST', path: '/api/fs/write-text', body: { path: '/work/app/a.ts', content: 'x' }, inWorkspace: true, confirm: { title: 'Save a.ts?', object: 'a.ts' } });
    h.state.readOnly = true;
    const whileReadOnly = await h.fetchTiered({ method: 'POST', path: '/api/fs/write-text', body: { path: '/work/app/a.ts', content: 'x' }, inWorkspace: true, confirm: { title: 'Save a.ts?' } });

    expect(saved.kind).toBe('sent');
    expect(h.dialogs).toEqual([expect.objectContaining({ tier: 'T1', action: 'POST /api/fs/write-text' })]);
    expect(h.sent.map((s) => s.path)).toEqual(['/api/fs/write-text']);
    expect(refusalOf(whileReadOnly)).toMatchObject({ error: 'read-only' });
  });
});
