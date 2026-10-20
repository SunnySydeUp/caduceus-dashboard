import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { DEFAULT_TRANSCRIPT, startStubSpeech, toneWav, type StubSpeech } from './fixtures/stub-speech.ts';
import { readVoiceConfig, speak, transcribe, type Request } from '../../web/src/modules/voice/voice-api.ts';
import { ttsChange, ttsVoiceKey } from '../../web/src/modules/voice/tts-config.ts';

// Voice (M7 #07) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME whose speech provider is a local stub
// (`fixtures/stub-speech.ts`): no real speech service is ever called. The page's voice client (`voice-api.ts`) is run against the server.
let hermes: TestHermes;
let speech: StubSpeech;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  speech = await startStubSpeech();
  await speech.connect(hermes);
}, 90_000);
afterAll(async () => {
  await speech.close();
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** The page's way to call the server: the signed-in owner's cookie and origin on every request. */
async function page(): Promise<Request> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  // The owner has a passkey and has just used it: a Tier 3 save needs that, and then the typed name.
  await stepUp(url, cookie, await addPasskey(url, cookie));
  extra = {};
  return (method, route, body) => fetch(`${url}${route}`, { method, headers: { cookie, origin: url, ...extra, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
/** Headers the next requests carry besides the owner's session: a confirmation token, once a test has one. */
let extra: Record<string, string> = {};

describe('server transcription and speech through Hermes', () => {
  test('a recording is transcribed by the speech provider Hermes is set to', async () => {
    const request = await page();
    const transcript = await transcribe(new Blob([new Uint8Array(toneWav())], { type: 'audio/wav' }), { request });
    expect(transcript).toBe(DEFAULT_TRANSCRIPT);
    expect(speech.requests).toContain('POST /v1/audio/transcriptions');
    expect(speech.uploaded.at(-1)).toBeGreaterThan(toneWav().length);
  });
});

describe('speech and voice settings through Hermes', () => {
  test('a reply is spoken by the provider Hermes is set to and comes back as audio', async () => {
    const request = await page();
    const audio = await speak('Here is the answer.', { request });
    expect(speech.spoken.at(-1)).toBe('Here is the answer.');
    expect(audio.type).toBe('audio/mpeg');
    expect(audio.size).toBe(toneWav().length);
  });

  test('an empty text is refused in Hermes\'s words', async () => {
    const request = await page();
    await expect(speak('   ', { request })).rejects.toThrow('Text is required');
  });

  test('voice-config tells which providers Hermes uses, and a failed read says so', async () => {
    const request = await page();
    const config = await readVoiceConfig({ request });
    expect(config.stt).toMatchObject({ provider: 'openai' });
    expect(config.tts).toMatchObject({ provider: 'openai', voice: 'alloy' });
    await expect(readVoiceConfig({ request: async () => new Response('{}', { status: 502 }) })).rejects.toThrow('HTTP 502');
  });

  test('voice-config never carries the keys Hermes hands out for client-direct voice', async () => {
    const request = await page();
    // Hermes's own answer holds the provider's API key; what reaches the page has none.
    const raw = await (await request('GET', '/api/audio/voice-config')).text();
    expect(raw).not.toContain('stub-key');
    expect(raw).not.toContain('api_key');
    expect(raw).toContain('"provider":"openai"');
  });
});

describe('choosing the voice', () => {
  test('the engine and voice picked in Settings are a Tier 3 config save, and Hermes then speaks and reports them', async () => {
    const request = await page();
    const change = ttsChange('default', 'openai', 'nova');
    expect(change.body).toEqual({ config: { tts: { provider: 'openai', openai: { voice: 'nova' } } } });
    expect(ttsChange('default', 'elevenlabs', 'abc123').body).toEqual({ config: { tts: { provider: 'elevenlabs', elevenlabs: { voice_id: 'abc123' } } } });
    expect(ttsVoiceKey('edge')).toBe('tts.edge.voice');

    // Without the typed name the save is refused.
    const refused = await request('PUT', change.path, change.body);
    expect(await refused.json()).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    const minted: { token: string } = await (
      await request('POST', '/_caduceus/api/policy/confirmations', {
        operation: `PUT ${change.path}`,
        target: 'default',
        typed: 'default',
        bodySha256: crypto.createHash('sha256').update(JSON.stringify(change.body)).digest('hex'),
      })
    ).json();
    extra = { 'x-caduceus-confirmation': minted.token };
    expect((await request('PUT', change.path, change.body)).status).toBe(200);
    extra = {};

    try {
      expect((await readVoiceConfig({ request })).tts).toMatchObject({ provider: 'openai', voice: 'nova' });
      await speak('Now in another voice.', { request });
      expect(speech.spoken.at(-1)).toBe('Now in another voice.');
    } finally {
      // The other tests in this file read the voice Hermes was set up with.
      await hermes.cli('config', 'set', 'tts.openai.voice', 'alloy');
    }
  });
});
