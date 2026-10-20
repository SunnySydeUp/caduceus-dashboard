import { describe, expect, test } from 'vitest';
import { auditQuery, dayRange, signInErrorMessage, methodRefusal } from '../src/modules/settings/audit-model.ts';

describe('auditQuery', () => {
  test('writes only the filters that are set, as the server reads them, and adds a cursor and a format when asked', () => {
    expect(auditQuery({})).toBe('');
    expect(auditQuery({ tier: 'T2', action: 'passkey', profile: 'coder' })).toBe('?tier=T2&action=passkey&profile=coder');
    expect(auditQuery({ from: '2026-10-01T00:00:00.000Z' }, { before: 40, limit: 50 })).toBe('?from=2026-10-01T00%3A00%3A00.000Z&before=40&limit=50');
    expect(auditQuery({ tier: 'T1' }, { format: 'csv' })).toBe('?tier=T1&format=csv');
    expect(auditQuery({ action: ' ', profile: '' })).toBe('');
  });
});

describe('dayRange', () => {
  test('turns two calendar days (the owner’s own) into the first and last moment they cover, the second day included', () => {
    const { from, to } = dayRange('2026-10-07', '2026-10-08');

    expect(new Date(from!).getFullYear()).toBe(2026);
    expect(new Date(to!).getTime() - new Date(from!).getTime()).toBe(2 * 24 * 60 * 60 * 1000 - 1);
    expect(dayRange('', '')).toEqual({});
    expect(dayRange('2026-10-07', '').to).toBeUndefined();
  });
});

describe('words for what the sign-in page and Security are told', () => {
  test('names every refusal the OIDC way back can end in, and says nothing for an unknown code', () => {
    expect(signInErrorMessage('oidc-user-not-allowed')).toContain('not the one');
    expect(signInErrorMessage('oidc-token-invalid')).toContain('could not be trusted');
    expect(signInErrorMessage('oidc-disabled')).toContain('off');
    expect(signInErrorMessage('whatever')).toBeUndefined();
    expect(signInErrorMessage(null)).toBeUndefined();
  });

  test('tells the owner what a refused change of a sign-in method means', () => {
    expect(methodRefusal('oidc-test-failed', 'The provider says it is x.')).toBe('The provider did not pass the test, so OIDC stays as it was. The provider says it is x.');
    expect(methodRefusal('identity-not-seen', 'Open Caduceus through Tailscale.')).toBe('Open Caduceus through Tailscale.');
    expect(methodRefusal('step-up-required', undefined)).toBe('Not changed: confirming with a passkey was cancelled.');
    expect(methodRefusal('other', undefined)).toBe('Caduceus could not make the change.');
  });
});
