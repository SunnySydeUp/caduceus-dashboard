import { describe, expect, test } from 'vitest';
import { findSessionHome, isSessionMissing } from '../src/modules/chat/session-home.ts';

// Which profile a session belongs to when a link names the wrong one (talk audit #3, #4). The REST read is the system boundary, so it is the one thing faked.
const missing = () => new Error('Session not found');

/** A Hermes whose sessions are `{ profile: [ids] }`: a profile that has the id answers, the others answer 404. */
const hermes = (sessions: Record<string, string[]>, broken: string[] = []) => async (path: string) => {
  const url = new URL(path, 'http://x');
  const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
  const profile = url.searchParams.get('profile')!;
  if (broken.includes(profile)) throw new Error('Hermes answered 500 to /api/sessions');
  if (sessions[profile]?.includes(id)) return { id };
  throw missing();
};

describe('a session that is not in the profile the link named', () => {
  test('is found in the profile that has it', async () => {
    const rest = hermes({ default: [], research: ['seed_r1'], coder: [] });
    expect(await findSessionHome(rest, { storedId: 'seed_r1', tried: 'default', profiles: ['default', 'research', 'coder'] })).toEqual({ kind: 'found', profile: 'research' });
  });

  test('is not looked for again in the profile that already said no', async () => {
    const asked: string[] = [];
    const rest = async (path: string) => {
      asked.push(new URL(path, 'http://x').searchParams.get('profile')!);
      throw missing();
    };
    await findSessionHome(rest, { storedId: 'x', tried: 'default', profiles: ['default', 'research'] });
    expect(asked).toEqual(['research']);
  });

  test('is gone only when every profile says so', async () => {
    expect(await findSessionHome(hermes({}), { storedId: 'nope', tried: 'research', profiles: ['default', 'research', 'coder'] })).toEqual({ kind: 'missing' });
    expect(await findSessionHome(hermes({}), { storedId: 'nope', tried: 'default', profiles: ['default'] })).toEqual({ kind: 'missing' });
  });

  test('may still exist when a profile could not be asked and no other has it', async () => {
    expect(await findSessionHome(hermes({}, ['coder']), { storedId: 'nope', tried: 'default', profiles: ['default', 'research', 'coder'] })).toEqual({ kind: 'unknown' });
  });

  test('is found even when another profile could not be asked', async () => {
    expect(await findSessionHome(hermes({ research: ['seed_r1'] }, ['coder']), { storedId: 'seed_r1', tried: 'default', profiles: ['default', 'coder', 'research'] })).toEqual({ kind: 'found', profile: 'research' });
  });

  test('goes to the first profile in the list when two have it', async () => {
    expect(await findSessionHome(hermes({ coder: ['same'], research: ['same'] }), { storedId: 'same', tried: 'default', profiles: ['default', 'research', 'coder'] })).toEqual({ kind: 'found', profile: 'research' });
  });
});

describe('what counts as a missing session', () => {
  test('Hermes’s own words, or a bare 404, but not other failures', () => {
    expect(isSessionMissing(new Error('Session not found'))).toBe(true);
    expect(isSessionMissing(new Error('Hermes answered 404 to /api/sessions/x'))).toBe(true);
    // A profile that has never had a session has no store yet (503): it cannot hold this one.
    expect(isSessionMissing(new Error("Session store is not initialized. Start this profile's gateway to initialize it."))).toBe(true);
    expect(isSessionMissing(new Error('Hermes answered 500 to /api/sessions/x'))).toBe(false);
    expect(isSessionMissing('Session not found')).toBe(false);
  });
});
