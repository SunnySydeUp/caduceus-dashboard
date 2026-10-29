import { describe, expect, test } from 'vitest';
import type { UpdateCheck } from '@caduceus/contracts/caduceus-api';
import { drainBanner, drainStateOf, updateBanner } from '../src/update-banners.ts';

const CHECK: UpdateCheck = { current_version: '0.21.4', behind: 3, update_available: true, can_apply: true, message: null };

describe('the update-available banner', () => {
  test('names what has an update, what is running and how far behind it is, and links to the Updates screen', () => {
    expect(updateBanner('Hermes', CHECK)).toMatchObject({
      id: 'update-available:hermes',
      tone: 'info',
      title: 'Hermes has an update',
      body: 'You are running 0.21.4, 3 changes behind. Nothing changes until you update.',
      actions: [{ label: 'View update', to: '/system/maintenance' }],
      dismissible: true,
    });
  });

  test('stays off the page it links to and off a chat thread', () => {
    expect(updateBanner('Hermes', CHECK)?.hideOn).toEqual(['/system/maintenance', '/chat']);
  });

  test('says nothing when there is no update, or the check could not run', () => {
    expect(updateBanner('Hermes', { ...CHECK, update_available: false, behind: 0 })).toBeUndefined();
    expect(updateBanner('Caduceus', { ...CHECK, update_available: false, behind: null })).toBeUndefined();
  });

  test('says nothing of the count when the source could not count', () => {
    expect(updateBanner('Caduceus', { ...CHECK, behind: -1, current_version: '1.0.0 (abc)' })).toMatchObject({ id: 'update-available:caduceus', body: 'You are running 1.0.0 (abc). Nothing changes until you update.' });
  });
});

describe('the drain banner', () => {
  test('tells every screen that new turns are paused, and why', () => {
    expect(drainBanner({ active: true, reason: 'Hermes is being updated.', since: 1 })).toMatchObject({ id: 'drain', tone: 'warning', title: 'New turns are paused', body: 'Hermes is being updated. Turns start again when it is done.' });
  });

  test('is gone once the drain ends', () => {
    expect(drainBanner({ active: false, reason: null, since: null })).toBeUndefined();
  });
});

describe('the drain event the page hears', () => {
  test('is read from its payload, and a payload that is not a drain state is ignored', () => {
    expect(drainStateOf({ active: true, reason: 'Hermes is being updated.', since: 5 })).toEqual({ active: true, reason: 'Hermes is being updated.', since: 5 });
    expect(drainStateOf({ active: false })).toEqual({ active: false, reason: null, since: null });
    expect(drainStateOf({ reason: 'x' })).toBeUndefined();
    expect(drainStateOf(undefined)).toBeUndefined();
  });
});
