import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Work › Tasks' owner-defined saved filters (M3 #03): Caduceus-owned, kept in its store as filter definitions only, through the
// Caduceus server's HTTP API in front of the real Hermes in a throwaway HERMES_HOME.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** What the saved-filters routes answer with: one filter, or the list. */
interface Reply {
  id: string;
  name: string;
  definition: unknown;
  filters: { id: string; name: string; definition: unknown }[];
}

interface Owner {
  url: string;
  cookie: string;
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Reply }>;
}

async function start(previous?: Owner): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = previous ? previous.cookie : await ownerCookie(url);
  const call: Owner['call'] = async (method, route, body) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { url, cookie, call };
}

const FILTERS = '/_caduceus/api/work/filters';

describe('saved task filters', () => {
  test('the owner saves, renames and deletes a filter; the list keeps the order they were made in', async () => {
    const owner = await start();
    expect(await owner.call('GET', FILTERS)).toEqual({ status: 200, body: { filters: [] } });

    const first = await owner.call('POST', FILTERS, { name: 'Coder’s failures', definition: { assignee: 'coder', failed: true } });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ id: expect.any(String), name: 'Coder’s failures', definition: { assignee: 'coder', failed: true } });
    const second = await owner.call('POST', FILTERS, { name: '  Release  ', definition: { statuses: ['ready', 'running'], text: 'release', priority: 2 } });
    expect(second.body.name).toBe('Release');

    expect((await owner.call('GET', FILTERS)).body.filters.map((filter: { name: string }) => filter.name)).toEqual(['Coder’s failures', 'Release']);

    const renamed = await owner.call('PUT', `${FILTERS}/${first.body.id}`, { name: 'Failures of coder' });
    expect(renamed).toEqual({ status: 200, body: { id: first.body.id, name: 'Failures of coder', definition: { assignee: 'coder', failed: true } } });

    expect((await owner.call('DELETE', `${FILTERS}/${first.body.id}`)).status).toBe(204);
    expect((await owner.call('GET', FILTERS)).body.filters.map((filter: { name: string }) => filter.name)).toEqual(['Release']);
    expect((await owner.call('DELETE', `${FILTERS}/${first.body.id}`)).status).toBe(404);
    expect((await owner.call('PUT', `${FILTERS}/${first.body.id}`, { name: 'Gone' })).status).toBe(404);
  });

  test('filters outlast a Caduceus restart, and the store holds the definition only, never a task', async () => {
    const owner = await start();
    await owner.call('POST', FILTERS, { name: 'Mine, running', definition: { assignee: 'coder', statuses: ['running'] } });
    await server!.close();

    const again = await start(owner);
    expect((await again.call('GET', FILTERS)).body.filters).toEqual([expect.objectContaining({ name: 'Mine, running', definition: { assignee: 'coder', statuses: ['running'] } })]);

    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    try {
      const rows = db.prepare('SELECT * FROM saved_filters').all();
      expect(rows).toHaveLength(1);
      // Its columns are an id, a name and the definition: nothing a task could be kept in.
      expect(Object.keys(rows[0]).sort()).toEqual(['definition', 'id', 'name', 'position']);
      expect(JSON.parse(String(rows[0].definition))).toEqual({ assignee: 'coder', statuses: ['running'] });
    } finally {
      db.close();
    }
  });

  test('a filter that is not a filter is refused: no name, a name too long, an unknown key, a wrong value', async () => {
    const owner = await start();
    const bad = [
      { definition: { failed: true } },
      { name: '   ', definition: { failed: true } },
      { name: 'x'.repeat(61), definition: { failed: true } },
      { name: 'Unknown key', definition: { title: 'Hermes task title' } },
      { name: 'Wrong status', definition: { statuses: ['finished'] } },
      { name: 'Wrong type', definition: { priority: 'high' } },
      { name: 'Wrong flag', definition: { failed: 'yes' } },
      { name: 'Empty', definition: {} },
      { name: 'Not an object', definition: 'failed' },
    ];
    for (const body of bad) expect((await owner.call('POST', FILTERS, body)).status, JSON.stringify(body)).toBe(400);
    expect((await owner.call('PUT', `${FILTERS}/nothing`, { name: '' })).status).toBe(400);
    expect((await owner.call('GET', FILTERS)).body).toEqual({ filters: [] });
  });
});
