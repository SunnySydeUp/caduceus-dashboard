import { describe, expect, test } from 'vitest';
import { confirmBlocker, isDestructive, recoverabilityText, TIER_LABELS } from '../src/tier-flow.ts';

// The pure rules of the tiered confirmation dialog (mobile-and-interaction.md §5): what each tier asks, and when its
// confirm button is allowed. The dialog itself (a sheet on a phone, a dialog elsewhere) is checked in a browser.
describe('the tiered confirmation dialog', () => {
  test('names each tier in plain words, with no tier numbers', () => {
    expect(TIER_LABELS).toEqual({ T1: 'Confirm', T2: 'Needs your passkey', T3: 'Needs your passkey and the name' });
  });

  test('says up front that a T2 or T3 cannot go ahead without a passkey, and blocks a T1 for nothing', () => {
    const state = { object: 'coder', typed: 'coder', online: true, readOnly: false } as const;

    expect([
      confirmBlocker({ ...state, tier: 'T1', hasPasskey: false }),
      confirmBlocker({ ...state, tier: 'T2', hasPasskey: false }),
      confirmBlocker({ ...state, tier: 'T3', hasPasskey: false }),
      // Not known yet, or covered by a passkey given a moment ago: nothing to block.
      confirmBlocker({ ...state, tier: 'T2' }),
      confirmBlocker({ ...state, tier: 'T2', hasPasskey: false, covered: true }),
      confirmBlocker({ ...state, tier: 'T2', hasPasskey: true }),
      // Offline and read-only are the more basic reasons, and are named first.
      confirmBlocker({ ...state, tier: 'T2', hasPasskey: false, online: false }),
      confirmBlocker({ ...state, tier: 'T3', hasPasskey: false, readOnly: true }),
    ]).toEqual([undefined, 'no-passkey', 'no-passkey', undefined, undefined, undefined, 'offline', 'read-only']);
  });

  test('lets a T1 or T2 through when it can be sent, and a T3 only once its name is typed', () => {
    const state = { object: 'coder', typed: '', online: true, readOnly: false } as const;

    expect([
      confirmBlocker({ ...state, tier: 'T1' }),
      confirmBlocker({ ...state, tier: 'T2' }),
      confirmBlocker({ ...state, tier: 'T3' }),
      confirmBlocker({ ...state, tier: 'T3', typed: 'code' }),
      confirmBlocker({ ...state, tier: 'T3', typed: 'Coder' }),
      confirmBlocker({ ...state, tier: 'T3', typed: 'coder' }),
      // Blanks around what was typed do not matter: a name pasted with a trailing space still confirms.
      confirmBlocker({ ...state, tier: 'T3', typed: '  coder ' }),
    ]).toEqual([undefined, undefined, 'typed', 'typed', 'typed', undefined, undefined]);
  });

  test('refuses a T2 or T3 while offline and a T3 in read-only mode, whatever was typed: they are never queued', () => {
    const typed = { object: 'coder', typed: 'coder' } as const;

    expect([
      confirmBlocker({ ...typed, tier: 'T1', online: false, readOnly: false }),
      confirmBlocker({ ...typed, tier: 'T2', online: false, readOnly: false }),
      confirmBlocker({ ...typed, tier: 'T3', online: false, readOnly: false }),
      confirmBlocker({ ...typed, tier: 'T3', online: true, readOnly: true }),
      confirmBlocker({ ...typed, tier: 'T3', online: false, readOnly: true }),
      // A T1 or T2 that is a read (a connection test) is still allowed in read-only mode; one that writes never gets this far.
      confirmBlocker({ ...typed, tier: 'T1', online: true, readOnly: true }),
      confirmBlocker({ ...typed, tier: 'T2', online: true, readOnly: true }),
    ]).toEqual([undefined, 'offline', 'offline', 'read-only', 'read-only', undefined, undefined]);
  });

  test('states plainly whether a T3 can be undone', () => {
    expect([
      recoverabilityText(undefined),
      recoverabilityText({ undoable: false }),
      recoverabilityText({ undoable: false, note: 'Pruned checkpoints are not in backups.' }),
      recoverabilityText({ undoable: true, note: 'Restorable from the last backup.' }),
      recoverabilityText({ undoable: true }),
    ]).toEqual([
      'This cannot be undone.',
      'This cannot be undone.',
      'This cannot be undone. Pruned checkpoints are not in backups.',
      'This can be undone. Restorable from the last backup.',
      'This can be undone.',
    ]);
  });
});

describe('the danger button', () => {
  test('is drawn for a T3 that cannot be undone, for an action that says it is destructive, and for a button named for taking something away', () => {
    expect([
      isDestructive({ tier: 'T3' }),
      isDestructive({ tier: 'T3', recoverability: { undoable: false } }),
      isDestructive({ tier: 'T1', destructive: true }),
      isDestructive({ tier: 'T1', confirmLabel: 'Delete skill' }),
      isDestructive({ tier: 'T2', confirmLabel: 'Revoke' }),
      isDestructive({ tier: 'T1', confirmLabel: 'Remove' }),
    ]).toEqual([true, true, true, true, true, true]);
  });

  test('is not drawn for a save, nor for a T3 that can be undone, and an action can say it is not destructive whatever its button says', () => {
    expect([
      isDestructive({ tier: 'T1' }),
      isDestructive({ tier: 'T2', confirmLabel: 'Save' }),
      isDestructive({ tier: 'T3', recoverability: { undoable: true }, confirmLabel: 'Save' }),
      isDestructive({ tier: 'T1', confirmLabel: 'Delete draft', destructive: false }),
      isDestructive({ tier: 'T3', destructive: false }),
    ]).toEqual([false, false, false, false, false]);
  });
});
