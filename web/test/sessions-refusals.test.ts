import { describe, expect, test } from 'vitest';
import { failureOf } from '../src/modules/chat/sessions-actions.ts';

// Hermes 0.22 refuses a session write with a short reason in `detail`; the owner reads it in words, and any other `detail` is shown as Hermes wrote it.
const refused = (status: number, body: unknown) => failureOf(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('why Hermes refused a session write', () => {
  test('a chat busy with a turn says so, in words', async () => {
    expect(await refused(409, { detail: 'session_busy' })).toBe('Hermes is working on this chat right now. Try again when it has finished.');
  });

  test('a change that raced another one, and a store that is not reachable, say so', async () => {
    expect(await refused(409, { detail: 'revision_conflict' })).toBe('The chat changed while this was being sent. Try again.');
    expect(await refused(503, { detail: 'storage_unavailable' })).toBe('Hermes could not reach its session store. Try again in a moment.');
  });

  test('a detail that is already words is shown as Hermes wrote it', async () => {
    expect(await refused(409, { detail: 'Exclusive maintenance refused: Gateway runtime already owns profile x.' })).toBe('Exclusive maintenance refused: Gateway runtime already owns profile x.');
  });

  test('a refusal by Caduceus keeps its own message', async () => {
    expect(await refused(403, { error: 'read-only', message: 'Caduceus is read-only.' })).toBe('Caduceus is read-only.');
  });
});
