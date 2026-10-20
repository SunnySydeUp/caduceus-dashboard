import { describe, expect, test } from 'vitest';
import { confirmBlocker, recoverabilityText, TIER_LABELS } from '../src/tier-flow.ts';

// The pure rules of the tiered confirmation dialog (mobile-and-interaction.md §5): what each tier asks, and when its
// confirm button is allowed. The dialog itself (a sheet on a phone, a dialog elsewhere) is checked in a browser.
describe('the tiered confirmation dialog', () => {
  test('names each tier as the prototype does', () => {
    expect(TIER_LABELS).toEqual({
      T1: 'Tier 1 · confirm',
      T2: 'Tier 2 · passkey step-up',
      T3: 'Tier 3 · step-up + type to confirm',
    });
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
