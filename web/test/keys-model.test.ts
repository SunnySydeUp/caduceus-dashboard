import { describe, expect, test } from 'vitest';
import { candidateKeys, endpointProblems, emptyEndpointForm, followLogin, keyNameProblem, parseOauth, keyValueProblem, parseDeviceCode, type DeviceCode, type KeyRow, type LoginDriver } from '../src/modules/keys/keys-model.ts';

const CODE: DeviceCode = { sessionId: 's1', userCode: 'WDJB-MJHT', verificationUrl: 'https://portal.example/device', expiresIn: 600, pollInterval: 2 };

/** A driver that answers each poll from a script, and a clock that only the waits move. */
function scripted(answers: ({ status: number; body: unknown } | Error)[], beforePoll: (poll: number, advance: (ms: number) => void) => void = () => {}) {
  let clock = 1_000_000;
  let polls = 0;
  const waits: number[] = [];
  const driver: LoginDriver = {
    async poll() {
      beforePoll(++polls, (ms) => void (clock += ms));
      const next = answers.shift();
      if (!next) throw new Error('polled more often than the script allows');
      if (next instanceof Error) throw next;
      return next;
    },
    async wait(ms) {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { driver, waits, advance: (ms: number) => void (clock += ms) };
}
const pending = { status: 200, body: { status: 'pending' } };

describe('following a device-code sign-in', () => {
  test('polls at the interval Hermes gave until Hermes says it is approved', async () => {
    const { driver, waits } = scripted([pending, pending, { status: 200, body: { status: 'approved' } }]);

    expect(await followLogin(CODE, driver)).toEqual({ state: 'approved' });
    expect(waits).toEqual([2000, 2000]);
  });

  test('a sign-in that is declined ends as denied, in Hermes’s words', async () => {
    const { driver } = scripted([pending, { status: 200, body: { status: 'denied', error_message: 'You declined the sign-in.' } }]);

    expect(await followLogin(CODE, driver)).toEqual({ state: 'denied', message: 'You declined the sign-in.' });
  });

  test('an error ends it with the reason Hermes gave, unless the code had run out by then', async () => {
    const failed = scripted([{ status: 200, body: { status: 'error', error_message: 'MiniMax OAuth reported an error.' } }]);
    expect(await followLogin(CODE, failed.driver)).toEqual({ state: 'error', message: 'MiniMax OAuth reported an error.' });

    // The error is Hermes's own timeout, which arrives after the code's lifetime.
    const late = scripted([pending, { status: 200, body: { status: 'error', error_message: 'MiniMax OAuth timed out before authorization completed.' } }], (poll, advance) => poll === 2 && advance(CODE.expiresIn * 1000 + 1));
    expect(await followLogin(CODE, late.driver)).toMatchObject({ state: 'expired' });
  });

  test('a code that outlives its time, or that Hermes no longer knows, is expired', async () => {
    // The code outlives its time and the grace Hermes is given to say so itself, and Hermes still says pending.
    const lapsed = scripted([pending, pending], (poll, advance) => poll === 2 && advance(CODE.expiresIn * 1000 + 30_000));
    expect(await followLogin(CODE, lapsed.driver)).toMatchObject({ state: 'expired' });

    const forgotten = scripted([pending, { status: 404, body: { detail: 'Session not found or expired' } }]);
    expect(await followLogin(CODE, forgotten.driver)).toMatchObject({ state: 'expired', message: expect.stringContaining('no longer') });
  });

  test('a few failed polls in a row are survived, and many are not', async () => {
    const blip = scripted([new Error('network'), { status: 502, body: {} }, pending, { status: 200, body: { status: 'approved' } }]);
    expect(await followLogin(CODE, blip.driver)).toEqual({ state: 'approved' });

    const gone = scripted(Array.from({ length: 5 }, () => new Error('network')));
    expect(await followLogin(CODE, gone.driver)).toMatchObject({ state: 'error', message: expect.stringContaining('could not reach Hermes') });
  });

  test('stops at once when the owner cancels', async () => {
    const controller = new AbortController();
    const { driver } = scripted([pending]);
    const slow: LoginDriver = {
      ...driver,
      async wait() {
        controller.abort();
      },
    };

    expect(await followLogin(CODE, slow, controller.signal)).toEqual({ state: 'cancelled' });
  });
});

describe('the code Hermes gives', () => {
  test('is read from Hermes’s start answer, and anything else is refused', () => {
    expect(parseDeviceCode({ session_id: 's1', flow: 'device_code', user_code: 'WDJB-MJHT', verification_url: 'https://portal.example/device', expires_in: 600, poll_interval: 2 })).toEqual(CODE);
    expect(parseDeviceCode({ session_id: 's1' })).toBeUndefined();
    expect(parseDeviceCode({ session_id: 's1', user_code: 'X', verification_url: 'javascript:alert(1)', expires_in: 600, poll_interval: 2 })).toBeUndefined();
  });
});

describe('an endpoint form', () => {
  const valid = { ...emptyEndpointForm(), name: 'Local vLLM', baseUrl: 'http://127.0.0.1:8000/v1', model: 'qwen' };

  test('a complete form has no problem', () => {
    expect(endpointProblems(valid)).toEqual({});
    expect(endpointProblems({ ...valid, contextLength: '32768', apiKey: 'sk-abc' })).toEqual({});
  });

  test('says what is wrong with each field', () => {
    expect(Object.keys(endpointProblems(emptyEndpointForm()))).toEqual(['name', 'baseUrl', 'model']);
    expect(endpointProblems({ ...valid, baseUrl: 'ftp://host/v1' }).baseUrl).toContain('http://');
    expect(endpointProblems({ ...valid, baseUrl: '127.0.0.1:8000' }).baseUrl).toContain('http://');
    expect(endpointProblems({ ...valid, contextLength: '0' }).contextLength).toBeDefined();
    expect(endpointProblems({ ...valid, contextLength: '32k' }).contextLength).toBeDefined();
    expect(endpointProblems({ ...valid, apiKey: 'sk abc' }).apiKey).toBeDefined();
    expect(endpointProblems({ ...valid, name: 'x'.repeat(65) }).name).toBeDefined();
  });
});

describe('adding a key', () => {
  const keys: KeyRow[] = [
    { name: 'OPENROUTER_API_KEY', provider: 'openrouter', providerLabel: 'OpenRouter', description: 'OpenRouter API key', url: undefined, isSet: false, secret: true, custom: false },
    { name: 'ANTHROPIC_API_KEY', provider: 'anthropic', providerLabel: 'Anthropic', description: 'Anthropic API key', url: undefined, isSet: false, secret: true, custom: false },
    { name: 'FIRECRAWL_API_KEY', provider: '', providerLabel: '', description: 'Web scraping', url: undefined, isSet: true, secret: true, custom: false },
  ];

  test('the search matches every word against the variable, the provider and Hermes’s sentence, and leaves out keys that are set', () => {
    expect(candidateKeys(keys, '').map((key) => key.name)).toEqual(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']);
    expect(candidateKeys(keys, 'open key').map((key) => key.name)).toEqual(['OPENROUTER_API_KEY']);
    expect(candidateKeys(keys, 'anthropic').map((key) => key.name)).toEqual(['ANTHROPIC_API_KEY']);
    expect(candidateKeys(keys, 'firecrawl')).toEqual([]);
  });

  test('a variable of the owner’s own is a name Hermes can write to .env, and a value is not empty or spread over lines', () => {
    expect(keyNameProblem('MY_SERVICE_TOKEN')).toBeUndefined();
    expect(keyNameProblem('')).toBeDefined();
    expect(keyNameProblem('my token')).toBeDefined();
    expect(keyNameProblem('1TOKEN')).toBeDefined();
    expect(keyNameProblem('A'.repeat(101))).toBeDefined();
    expect(keyValueProblem('sk-abc123')).toBeUndefined();
    expect(keyValueProblem('')).toBeDefined();
    expect(keyValueProblem('sk abc')).toBeDefined();
    expect(keyValueProblem('sk-abc\n')).toBeUndefined();
  });
});

test('a sign-in whose source Hermes names by a file path is described in plain words, never with the path', () => {
  const [xai, nous] = parseOauth({ providers: [
    { id: 'xai', name: 'xAI', flow: 'external', status: { logged_in: true, source_label: '/Users/me/.hermes/auth.json' } },
    { id: 'nous', name: 'Nous Portal', flow: 'device_code', status: { logged_in: true, source_label: 'Nous Portal' } },
  ] });
  expect(xai!.sourceLabel).toBe('Sign-in saved on this Mac');
  expect(nous!.sourceLabel).toBe('Nous Portal');
});
