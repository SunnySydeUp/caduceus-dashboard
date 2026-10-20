import { describe, expect, test } from 'vitest';
import { describeMicError, micSupport, reEnableSteps } from '../src/modules/voice/mic.ts';

// What the page says when it cannot use the microphone (M7 #07): why a page that is not a secure context cannot ask, and how to turn the
// permission back on in each browser after a "no". Typing always stays usable.
const domError = (name: string) => Object.assign(new Error(name), { name });

describe('microphone support', () => {
  test('a secure page with a recorder can ask', () => {
    expect(micSupport({ secure: true, hasMediaDevices: true, hasRecorder: true })).toEqual({ ok: true });
  });

  test('a page that is not a secure context explains why the browser will not ask', () => {
    const verdict = micSupport({ secure: false, hasMediaDevices: false, hasRecorder: true });
    expect(verdict).toMatchObject({ ok: false, reason: 'insecure' });
    expect(verdict.ok === false && verdict.message).toMatch(/https/i);
    expect(verdict.ok === false && verdict.message).toMatch(/localhost|Tailscale/i);
  });

  test('a browser with no recorder says so', () => {
    expect(micSupport({ secure: true, hasMediaDevices: true, hasRecorder: false })).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});

describe('what a refusal means', () => {
  test('denied says how to turn the microphone back on, and that typing still works', () => {
    const problem = describeMicError(domError('NotAllowedError'), 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    expect(problem.kind).toBe('denied');
    expect(problem.message).toMatch(/Settings/);
    expect(problem.message).toMatch(/type/i);
  });

  test('no microphone, a busy microphone and the unknown are told apart', () => {
    expect(describeMicError(domError('NotFoundError'), '').kind).toBe('missing');
    expect(describeMicError(domError('NotReadableError'), '').kind).toBe('busy');
    expect(describeMicError(new Error('boom'), '').kind).toBe('other');
  });

  test('the steps follow the browser', () => {
    expect(reEnableSteps('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toMatch(/Settings › Safari|aA|Website Settings/);
    expect(reEnableSteps('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toMatch(/lock|site settings/i);
    expect(reEnableSteps('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toMatch(/Safari › Settings/);
    expect(reEnableSteps('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:130.0) Gecko/20100101 Firefox/130.0')).toMatch(/permission|address bar/i);
    expect(reEnableSteps('something else')).toMatch(/site settings/i);
  });
});
