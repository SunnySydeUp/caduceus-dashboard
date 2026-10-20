import { afterEach, describe, expect, test, vi } from 'vitest';
import { getHermes } from '../src/hermes-api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('getHermes', () => {
  test('asks made while the same GET is on its way share one request, and a later ask is a new request', async () => {
    const answers = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
    const fetched: string[] = [];
    vi.stubGlobal('fetch', (path: string) => {
      fetched.push(path);
      return answers[fetched.length - 1].promise;
    });

    const together = [getHermes('/api/status'), getHermes('/api/status'), getHermes('/api/profiles')];
    expect(fetched).toEqual(['/api/status', '/api/profiles']);
    answers[0].resolve(Response.json({ version: '1' }));
    answers[1].resolve(Response.json({ profiles: [] }));
    expect(await Promise.all(together)).toEqual([{ version: '1' }, { version: '1' }, { profiles: [] }]);

    const again = getHermes('/api/status');
    expect(fetched).toEqual(['/api/status', '/api/profiles', '/api/status']);
    answers[2].resolve(Response.json({ version: '2' }));
    expect(await again).toEqual({ version: '2' });
  });

  test('a refusal reaches every asker, and the next ask tries again', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => (++calls === 1 ? new Response('no', { status: 502 }) : Response.json({ ok: true })));

    const refused = [getHermes('/api/status'), getHermes('/api/status')];
    await expect(refused[0]).rejects.toThrow('GET /api/status: HTTP 502');
    await expect(refused[1]).rejects.toThrow('GET /api/status: HTTP 502');
    await expect(getHermes('/api/status')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
