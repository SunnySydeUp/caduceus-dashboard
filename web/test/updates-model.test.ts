import { describe, expect, test } from 'vitest';
import type { UpdateCheck, WhatsNewEntry } from '@caduceus/contracts/caduceus-api';
import { checkView, foldUpdate, phaseSteps, startUpdate, whatsNewTitle } from '../src/modules/maintenance/updates-model.ts';

const CURRENT: UpdateCheck = { current_version: '0.21.4', behind: 0, update_available: false, can_apply: true, message: "You're on the latest version." };

describe('what an update check says on its card', () => {
  test('an install that is up to date says so and offers nothing', () => {
    expect(checkView('Hermes', CURRENT, { restartable: true })).toMatchObject({ status: 'current', headline: 'Hermes 0.21.4 is up to date', canUpdate: false });
  });

  test('a check that could not run is "could not check", never "up to date"', () => {
    const view = checkView('Hermes', { ...CURRENT, behind: null, message: "Couldn't reach the update source — try again later." }, { restartable: true });

    expect(view).toMatchObject({ status: 'unknown', headline: 'Hermes could not check for an update', detail: "Couldn't reach the update source — try again later.", canUpdate: false });
  });

  test('an update that is available says how far behind the install is, lists what is new and can be applied', () => {
    const commits = [{ sha: 'abc', summary: 'Fix a cron race' }];

    const view = checkView('Hermes', { ...CURRENT, behind: 1, update_available: true, message: null, commits }, { restartable: true });

    expect(view).toMatchObject({ status: 'available', headline: 'A Hermes update is available: 1 change', canUpdate: true, changes: commits });
    expect(checkView('Hermes', { ...CURRENT, behind: 12, update_available: true, message: null }, { restartable: true }).headline).toBe('A Hermes update is available: 12 changes');
    // Hermes could not count the commits (-1): the headline does not say a number.
    expect(checkView('Hermes', { ...CURRENT, behind: -1, update_available: true, message: null }, { restartable: true }).headline).toBe('A Hermes update is available');
  });

  test('an update Caduceus cannot apply in place says what to do instead (Hermes names the command)', () => {
    const view = checkView('Hermes', { ...CURRENT, behind: 3, update_available: true, can_apply: false, message: 'Hermes is managed by Termux APT; run `pkg upgrade hermes-agent`.', update_command: 'pkg upgrade hermes-agent' }, { restartable: true });

    expect(view).toMatchObject({ status: 'available', canUpdate: false, detail: 'Hermes is managed by Termux APT; run `pkg upgrade hermes-agent`.', command: 'pkg upgrade hermes-agent' });
  });

  test('Caduceus that cannot restart itself cannot be updated by itself', () => {
    const view = checkView('Caduceus', { ...CURRENT, behind: 2, update_available: true }, { restartable: false });

    expect(view).toMatchObject({ status: 'available', canUpdate: false });
    expect(view.detail).toContain('background service');
  });
});

describe('the steps of an update, as they are shown', () => {
  test('mark what is done, what is going on and what is still to come, in the order the server does them', () => {
    expect(phaseSteps('hermes', 'updating').map((step) => [step.label, step.state])).toEqual([
      ['Pause new turns', 'done'],
      ['Update Hermes', 'current'],
      ['Restart Hermes', 'todo'],
      ['Check the result', 'todo'],
      ['Allow new turns', 'todo'],
    ]);
    expect(phaseSteps('caduceus', 'draining').map((step) => [step.label, step.state])).toEqual([
      ['Pause new turns', 'current'],
      ['Update Caduceus', 'todo'],
      ['Restart Caduceus', 'todo'],
    ]);
  });

  test('all done once the update ended well', () => {
    const state = foldUpdate(foldUpdate(startUpdate(), { event: 'phase', data: { phase: 'resuming' } }), { event: 'end', data: { ok: true, message: 'Hermes is updated.' } });

    expect(phaseSteps('hermes', state.phase, state.status).every((step) => step.state === 'done')).toBe(true);
  });

  test('stop at the step that was under way when the update failed', () => {
    const state = foldUpdate(foldUpdate(startUpdate(), { event: 'phase', data: { phase: 'updating' } }), { event: 'end', data: { ok: false, message: 'Hermes failed.' } });

    expect(phaseSteps('hermes', state.phase, state.status).map((step) => step.state)).toEqual(['done', 'failed', 'todo', 'todo', 'todo']);
  });
});

describe('the live log as the page folds it', () => {
  test('collects lines and phases, and ends with the server’s own sentence', () => {
    let state = startUpdate();
    state = foldUpdate(state, { event: 'phase', data: { phase: 'updating' } });
    state = foldUpdate(state, { event: 'line', data: { text: 'Fetching origin…' } });
    state = foldUpdate(state, { event: 'end', data: { ok: true, message: 'Hermes is updated to 0.22.0.' } });

    expect(state).toEqual({ status: 'ok', phase: 'updating', lines: ['Fetching origin…'], message: 'Hermes is updated to 0.22.0.' });
  });

  test('a stream that closes before its end says the page lost the log; once ended, nothing changes the state', () => {
    const lost = foldUpdate(startUpdate(), { event: 'dropped', data: undefined });
    const ended = foldUpdate(startUpdate(), { event: 'end', data: { ok: false, message: 'No.' } });

    expect(lost.status).toBe('lost');
    expect(foldUpdate(ended, { event: 'line', data: { text: 'late' } })).toBe(ended);
  });
});

describe("What's New", () => {
  const entry: WhatsNewEntry = { id: 'a', target: 'hermes', at: 1_790_000_000_000, ok: true, message: 'Hermes is updated to 0.22.0.', fromVersion: '0.21.4', toVersion: '0.22.0', changes: [] };

  test('is titled by what was updated and the versions it went between', () => {
    expect(whatsNewTitle(entry)).toBe('Hermes 0.21.4 → 0.22.0');
    expect(whatsNewTitle({ ...entry, toVersion: null })).toBe('Hermes from 0.21.4');
    expect(whatsNewTitle({ ...entry, fromVersion: null, toVersion: null, target: 'caduceus' })).toBe('Caduceus');
  });
});
