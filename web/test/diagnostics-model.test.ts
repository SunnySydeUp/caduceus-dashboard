import { describe, expect, test } from 'vitest';
import type { InstallFacts } from '@caduceus/contracts/caduceus-api';
import { bugReportText, DIAGNOSTIC_ACTIONS, endWords, foldAction, startAction } from '../src/modules/maintenance/diagnostics-model.ts';

const FACTS: InstallFacts = {
  caduceus: { version: '1.0.0 (abc123def456)', node: 'v22.22.2', platform: 'Darwin 25.4.0', arch: 'arm64' },
  hermes: { version: '0.21.4', state: 'ready' },
  contracts: { pinned: '0.21.4', hermes: '0.21.4', state: 'compatible', differences: [] },
  host: { role: 'serve', protocolVersion: 1, servesSpa: false },
};

describe('Copy for bug report', () => {
  test('is a short block of the versions and states, one fact to a line', () => {
    expect(bugReportText(FACTS)).toBe(
      [
        'Caduceus Dashboard: 1.0.0 (abc123def456)',
        'Node: v22.22.2',
        'Platform: Darwin 25.4.0 arm64',
        'Hermes: 0.21.4 (ready)',
        'Contracts: pinned 0.21.4, Hermes 0.21.4, compatible',
        'Hermes host: serve, protocol 1',
      ].join('\n'),
    );
  });

  test('says what differs when Hermes does not match the contracts, and says "unknown" for what Hermes did not tell', () => {
    const text = bugReportText({ ...FACTS, hermes: { version: null, state: 'starting' }, contracts: { pinned: '0.21.4', hermes: null, state: 'incompatible', differences: ['REST removed: GET /api/retired'] }, host: { role: null, protocolVersion: null, servesSpa: null } });

    expect(text).toContain('Hermes: unknown version (starting)');
    expect(text).toContain('Contracts: pinned 0.21.4, Hermes unknown, incompatible');
    expect(text).toContain('  - REST removed: GET /api/retired');
    expect(text).toContain('Hermes host: unknown');
  });

  test('is redacted even when a fact carries what should not leave: a home folder, an address, a key', () => {
    const text = bugReportText({ ...FACTS, contracts: { ...FACTS.contracts, state: 'incompatible', differences: ['read /Users/sunny/.hermes/config.yaml as sunny@example.com with sk-abcdefghijklmnopqrstuvwx0123456789'] } });

    expect(text).toContain('read ~/.hermes/config.yaml as [redacted] with [redacted]');
    expect(text).not.toContain('sunny');
    expect(text).not.toContain('sk-abc');
  });
});

describe('the output of a diagnostic action as the page folds it', () => {
  test('collects lines and ends with the exit code Hermes gave', () => {
    let state = startAction();
    state = foldAction(state, { event: 'line', data: { text: 'Checking Python…' } });
    state = foldAction(state, { event: 'end', data: { ok: false, exitCode: 1 } });

    expect(state).toEqual({ status: 'failed', lines: ['Checking Python…'], exitCode: 1 });
  });

  test('a stream that closes before its end says the page lost the output, and a finished state does not change', () => {
    expect(foldAction(startAction(), { event: 'dropped', data: undefined }).status).toBe('lost');
    const done = foldAction(startAction(), { event: 'end', data: { ok: true, exitCode: 0 } });
    expect(foldAction(done, { event: 'line', data: { text: 'late' } })).toBe(done);
  });
});

describe('the diagnostic actions', () => {
  test('doctor, the security audit, the support dump and config migrate ask for a confirmation (Tier 1); prompt size, a read, does not', () => {
    expect(DIAGNOSTIC_ACTIONS.map((action) => [action.id, action.tier])).toEqual([
      ['doctor', 'T1'],
      ['security-audit', 'T1'],
      ['prompt-size', 'T0'],
      ['dump', 'T1'],
      ['config-migrate', 'T1'],
    ]);
  });
});

describe('how a finished action is worded', () => {
  const failed = (lines: string[], exitCode: number | null = 1) => ({ status: 'failed' as const, lines, exitCode });

  test('doctor that lists issues found them: a warning, with the count, not a crash', () => {
    const lines = ['Checking Python…', '  Found 6 issue(s) to address:', '  1. Missing key'];
    expect(endWords(failed(lines))).toEqual({ tone: 'warning', text: 'Doctor found 6 issues to look at (it exits with code 1 when it does).' });
    expect(endWords(failed(['  Found 1 issue(s) to address:']))).toMatchObject({ tone: 'warning', text: expect.stringContaining('found 1 issue to look at') });
  });

  test('an error with no issues listed stays an error, with its exit code', () => {
    expect(endWords(failed(['Traceback…'], 2))).toEqual({ tone: 'danger', text: 'Hermes ended with an error (exit code 2).' });
    expect(endWords(failed(['Traceback…'], null))).toEqual({ tone: 'danger', text: 'Hermes ended with an error.' });
  });

  test('a clean finish is a success, and one still running or lost has no ending to word', () => {
    expect(endWords({ status: 'ok', lines: [], exitCode: 0 })).toEqual({ tone: 'success', text: 'Finished.' });
    expect(endWords(startAction())).toBeUndefined();
    expect(endWords({ status: 'lost', lines: [], exitCode: null })).toBeUndefined();
  });
});
