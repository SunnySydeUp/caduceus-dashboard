import { describe, expect, test } from 'vitest';
import { checkpointSummary, formatBytes, pruneAdvice, restoreSteps, restoreVerdict } from '../src/modules/maintenance/backup-model.ts';

describe('formatBytes', () => {
  test('writes a size in the largest unit that keeps it above one, with one decimal below ten', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB');
  });
});

describe('checkpointSummary', () => {
  test('counts the sessions Hermes keeps checkpoints for, and their files and size, from its own listing', () => {
    const summary = checkpointSummary({ sessions: [{ session: 'a', files: 4, bytes: 2048 }, { session: 'b', files: 1, bytes: 1024 }], total_bytes: 3072 });

    expect(summary).toEqual({ sessions: 2, files: 5, bytes: 3072, text: '2 sessions hold checkpoints: 5 files, 3.0 KB' });
  });

  test('says there are none for an empty listing, and is nothing for an answer that is not Hermes’s listing', () => {
    expect(checkpointSummary({ sessions: [], total_bytes: 0 })?.text).toBe('No checkpoints');
    expect(checkpointSummary({ sessions: [{ session: 'a', files: 1, bytes: 1 }], total_bytes: 1 })?.text).toBe('1 session holds checkpoints: 1 file, 1 B');
    expect(checkpointSummary({ detail: 'nope' })).toBeUndefined();
    expect(checkpointSummary(undefined)).toBeUndefined();
  });
});

describe('pruneAdvice', () => {
  test('explains a prune that Hermes aborted because it could not ask about folders it cannot find', () => {
    const lines = ['This will permanently delete 1 orphan checkpoint project(s) whose workdir is not currently reachable:', 'Delete these orphan projects? [y/N]: ', 'Aborted.'];

    expect(pruneAdvice(lines)).toContain('hermes checkpoints prune');
    expect(pruneAdvice(['Pruning checkpoint store…', 'Scanned: 3'])).toBeUndefined();
  });
});

describe('restoreSteps', () => {
  test('lists the steps of a restore and marks where it is, and where it stopped when it failed', () => {
    expect(restoreSteps('importing', 'running').map((step) => `${step.label}:${step.state}`)).toEqual([
      'Pause new turns:done',
      'Hermes restores the backup:current',
      'Restart Hermes and Caduceus:todo',
      'Check Hermes against its contracts:todo',
    ]);
    expect(restoreSteps('importing', 'failed').find((step) => step.state === 'failed')?.label).toBe('Hermes restores the backup');
    expect(restoreSteps('checked', 'ok').every((step) => step.state === 'done')).toBe(true);
    expect(restoreSteps('restarting', 'running').map((step) => step.state)).toEqual(['done', 'done', 'current', 'todo']);
  });
});

describe('restoreVerdict', () => {
  test('is the contract check that ran after the restart, in words, with the differences when Hermes no longer matches', () => {
    expect(restoreVerdict({ state: 'compatible' })).toEqual({ tone: 'success', text: 'Hermes matches the contracts Caduceus was built for.' });
    expect(restoreVerdict({ state: 'incompatible', reasons: ['a route is gone'] })).toEqual({
      tone: 'warning',
      text: 'Hermes no longer matches the contracts Caduceus was built for. Health says whether read-only mode is on. Differences: a route is gone',
    });
    expect(restoreVerdict({ state: 'checking' }).tone).toBe('info');
    expect(restoreVerdict(undefined).tone).toBe('warning');
  });
});
