import { describe, expect, test, vi } from 'vitest';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { applyFence, planFence, sendSessionWrite, type Snapshot } from '../src/session-fence.ts';

// Hermes 0.22 commits a session write (a rename, an archive, a pin, a delete, an import) only against the identity of the write (`request_id`) and the
// revision it was made from (`expected_revision`, with `expected_generation` when the session has one). A write with none is answered 409
// `client_upgrade_required`. The page does not hold revisions, so Caduceus adds them on the way through: this is the part that decides what and where.
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const read = (body: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(body));
const snapshot = (revision: number, generation: number | null = null): Snapshot => ({ exists: true, runtime_revision: revision, runtime_generation: generation });

describe('which writes are fenced', () => {
  test('a rename or sidebar change names its session in the path, and a profile in the body or the query', () => {
    expect(planFence('PATCH', '/api/sessions/s1', json({ title: 'x', profile: 'work' }))).toEqual({ anchor: 's1', profile: 'work' });
    expect(planFence('PATCH', '/api/sessions/s%201?profile=coder', json({ pinned: true }))).toEqual({ anchor: 's 1', profile: 'coder' });
    expect(planFence('PATCH', '/api/sessions/s1', json({ pinned: true }))).toEqual({ anchor: 's1', profile: undefined });
  });

  test('a delete names its session in the path and its profile in the query', () => {
    expect(planFence('DELETE', '/api/sessions/s1?profile=work', undefined)).toEqual({ anchor: 's1', profile: 'work' });
  });

  test('an import is anchored on its first session, the one the revision is read for', () => {
    expect(planFence('POST', '/api/sessions/import', json({ sessions: [{ id: 'a' }, { id: 'b' }], profile: 'work' }))).toEqual({ anchor: 'a', profile: 'work' });
    expect(planFence('POST', '/api/sessions/import', json({ sessions: [] }))).toBeUndefined();
  });

  test('a write that already carries its identity is left as it is', () => {
    expect(planFence('PATCH', '/api/sessions/s1', json({ title: 'x', request_id: 'r1', expected_revision: 4 }))).toBeUndefined();
    expect(planFence('DELETE', '/api/sessions/s1?request_id=r1&expected_revision=4', undefined)).toBeUndefined();
  });

  test('nothing else is fenced: reads, the other session calls, other routes, a body that is not JSON', () => {
    expect(planFence('GET', '/api/sessions/s1', undefined)).toBeUndefined();
    expect(planFence('POST', '/api/sessions/bulk-delete', json({ ids: ['a'] }))).toBeUndefined();
    expect(planFence('POST', '/api/sessions/s1/messages', json({}))).toBeUndefined();
    expect(planFence('PATCH', '/api/kanban/tasks/t1', json({}))).toBeUndefined();
    expect(planFence('PATCH', '/api/sessions/s1', new TextEncoder().encode('not json'))).toBeUndefined();
    expect(planFence('PATCH', '/api/sessions/s1', json(['not', 'an', 'object']))).toBeUndefined();
  });
});

describe('the identity that is added', () => {
  test('a rename carries the revision and generation the session has now, and a fresh request id', () => {
    const fenced = applyFence('PATCH', '/api/sessions/s1', json({ title: 'x' }), snapshot(7, 2), 'req-1');
    expect(fenced.target).toBe('/api/sessions/s1');
    expect(read(fenced.body)).toEqual({ title: 'x', request_id: 'req-1', expected_revision: 7, expected_generation: 2 });
  });

  test('a session with no generation sends none', () => {
    expect(read(applyFence('PATCH', '/api/sessions/s1', json({ title: 'x' }), snapshot(0), 'req-1').body)).toEqual({ title: 'x', request_id: 'req-1', expected_revision: 0 });
  });

  test('a delete carries it in the query, beside the profile it already had', () => {
    const fenced = applyFence('DELETE', '/api/sessions/s1?profile=work', undefined, snapshot(3, 1), 'req-2');
    expect(fenced.body).toBeUndefined();
    const url = new URL(fenced.target, 'http://hermes');
    expect(url.pathname).toBe('/api/sessions/s1');
    expect(Object.fromEntries(url.searchParams)).toEqual({ profile: 'work', request_id: 'req-2', expected_revision: '3', expected_generation: '1' });
  });

  test('an import of a session Hermes does not have is revision zero', () => {
    const body = json({ sessions: [{ id: 'new' }] });
    const fenced = applyFence('POST', '/api/sessions/import', body, { exists: false, runtime_revision: 0, runtime_generation: null }, 'req-3');
    expect(read(fenced.body)).toEqual({ sessions: [{ id: 'new' }], request_id: 'req-3', expected_revision: 0 });
  });
});

// The writes go to Hermes through `sendSessionWrite`; Hermes is the boundary, so it is stood in for here by a backend that answers as 0.22 does.
describe('sending a session write', () => {
  interface Call {
    method: string;
    path: string;
    body: Record<string, unknown> | undefined;
  }
  interface Scripted {
    backend: HermesBackend;
    calls: Call[];
    /** The most writes that were being committed at the same moment. */
    peak(): number;
  }
  const answer = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

  function hermesThat(respond: (call: Call, order: number) => Response | Promise<Response>): Scripted {
    const calls: Call[] = [];
    let writing = 0;
    let peak = 0;
    const backend = {
      async fetch(path: string, init?: RequestInit) {
        const method = init?.method ?? 'GET';
        const text = typeof init?.body === 'string' ? init.body : init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : undefined;
        const call = { method, path, body: text === undefined ? undefined : (JSON.parse(text) as Record<string, unknown>) };
        calls.push(call);
        if (method === 'GET') return respond(call, calls.length);
        writing += 1;
        peak = Math.max(peak, writing);
        try {
          return await respond(call, calls.length);
        } finally {
          writing -= 1;
        }
      },
    } as unknown as HermesBackend;
    return { backend, calls, peak: () => peak };
  }

  const snapshotOf = (revision: number) => answer(200, { session_id: 's1', exists: true, runtime_revision: revision, runtime_generation: 0 });

  test('a rename is sent with the revision Hermes reports now', async () => {
    const hermes = hermesThat((call) => (call.method === 'GET' ? snapshotOf(5) : answer(200, { ok: true })));
    const sent = await sendSessionWrite(hermes.backend, 'PATCH', '/api/sessions/s1', json({ title: 'x' }));
    expect(sent.status).toBe(200);
    expect(hermes.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/sessions/s1/mutation-snapshot', 'PATCH /api/sessions/s1']);
    expect(hermes.calls[1]!.body).toMatchObject({ title: 'x', expected_revision: 5, expected_generation: 0 });
    expect(hermes.calls[1]!.body?.request_id).toEqual(expect.any(String));
  });

  test('an import into a profile that has no store yet is written against revision zero', async () => {
    const hermes = hermesThat((call) => (call.method === 'GET' ? answer(503, { detail: "Session store is not initialized. Start this profile's gateway to initialize it." }) : answer(200, { ok: true })));
    await sendSessionWrite(hermes.backend, 'POST', '/api/sessions/import', json({ sessions: [{ id: 'a' }], profile: 'work' }));
    expect(hermes.calls[0]!.path).toBe('/api/sessions/a/mutation-snapshot?profile=work');
    expect(hermes.calls[1]!.body).toMatchObject({ expected_revision: 0 });
    expect(hermes.calls[1]!.body).not.toHaveProperty('expected_generation');
  });

  test('a store Hermes cannot read the counters of is left to Hermes, which refuses the write in its own words', async () => {
    const hermes = hermesThat((call) => (call.method === 'GET' ? answer(503, { detail: 'Session store is busy' }) : answer(409, { detail: 'client_upgrade_required' })));
    const sent = await sendSessionWrite(hermes.backend, 'PATCH', '/api/sessions/s1', json({ pinned: true }));
    expect(sent.status).toBe(409);
    expect(hermes.calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
    expect(hermes.calls[1]!.body).toEqual({ pinned: true });
  });

  test('a write whose counters moved on is sent once more against fresh ones, and no more than once', async () => {
    let revision = 1;
    const moving = hermesThat((call) => {
      if (call.method === 'GET') return snapshotOf(revision++);
      return call.body?.expected_revision === 2 ? answer(200, { ok: true }) : answer(409, { detail: 'revision_conflict' });
    });
    expect((await sendSessionWrite(moving.backend, 'PATCH', '/api/sessions/s1', json({ pinned: true }))).status).toBe(200);
    expect(moving.calls.filter((call) => call.method === 'PATCH').map((call) => call.body?.expected_revision)).toEqual([1, 2]);
    expect(new Set(moving.calls.filter((call) => call.method === 'PATCH').map((call) => call.body?.request_id)).size).toBe(2);

    const stuck = hermesThat((call) => (call.method === 'GET' ? snapshotOf(1) : answer(409, { detail: 'stale_generation' })));
    expect((await sendSessionWrite(stuck.backend, 'PATCH', '/api/sessions/s1', json({ pinned: true }))).status).toBe(409);
    expect(stuck.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
  });

  test('a session busy with a turn is not retried: the refusal is Hermes’s', async () => {
    const hermes = hermesThat((call) => (call.method === 'GET' ? snapshotOf(1) : answer(409, { detail: 'session_busy' })));
    const sent = await sendSessionWrite(hermes.backend, 'DELETE', '/api/sessions/s1', undefined);
    expect(sent.status).toBe(409);
    expect(await sent.json()).toEqual({ detail: 'session_busy' });
    expect(hermes.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  test('writes to one profile go one at a time, and a profile does not wait for another', async () => {
    const gate = Promise.withResolvers<void>();
    const hermes = hermesThat(async (call) => {
      if (call.method === 'GET') return snapshotOf(1);
      await gate.promise;
      return answer(200, { ok: true });
    });
    const send = (id: string, profile: string) => sendSessionWrite(hermes.backend, 'PATCH', `/api/sessions/${id}`, json({ pinned: true, profile }));
    const same = [send('a', 'work'), send('b', 'work'), send('c', 'work')];
    const other = send('d', 'coder');
    await vi.waitFor(() => expect(hermes.peak()).toBe(2));
    gate.resolve();
    expect((await Promise.all([...same, other])).map((sent) => sent.status)).toEqual([200, 200, 200, 200]);
    expect(hermes.peak()).toBe(2);
  });

  test('a write that is not a session write goes straight through', async () => {
    const hermes = hermesThat(() => answer(200, { ok: true }));
    await sendSessionWrite(hermes.backend, 'PUT', '/api/config', json({ a: 1 }));
    expect(hermes.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /api/config']);
  });
});
