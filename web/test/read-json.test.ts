import { afterEach, describe, expect, test, vi } from 'vitest';
import { readJson } from '../src/modules/work/projects-data.ts';

// Hermes 0.22 answers every read of a profile that has never held a chat (it has no session store yet) with 503 "Session store is not initialized". For
// the owner that is a profile with nothing in it, not a failure: Talk's details and Insights must show zero use, not an error.
afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));

describe('reading Hermes', () => {
  test('a profile with no session store yet reads as an empty answer', async () => {
    answer(503, { detail: "Session store is not initialized. Start this profile's gateway to initialize it." });
    expect(await readJson('/api/analytics/usage?profile=fresh')).toEqual({});
  });

  test('any other refusal is still a failure, with its status', async () => {
    answer(503, { detail: 'Hermes is draining.' });
    await expect(readJson('/api/sessions')).rejects.toThrow('HTTP 503');
    answer(500, { detail: 'Session store is not initialized.' });
    await expect(readJson('/api/sessions')).rejects.toThrow('HTTP 500');
    answer(404, {});
    await expect(readJson('/api/sessions')).rejects.toThrow('HTTP 404');
  });

  test('an answer is its JSON', async () => {
    answer(200, { daily: [] });
    expect(await readJson('/api/analytics/usage')).toEqual({ daily: [] });
  });
});
