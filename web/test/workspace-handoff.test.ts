import { describe, expect, test, vi } from 'vitest';
import { offerWorkspace, onWorkspaceOffered, takeWorkspace } from '../src/modules/chat/workspace-handoff.ts';

describe('the workspace a worktree session hands to the next new chat (M1 #17)', () => {
  test('it is taken once, by the chat of the profile it was for', () => {
    offerWorkspace('coder', '/repo/.worktrees/a');
    expect(takeWorkspace('writer')).toBeUndefined();
    expect(takeWorkspace('coder')).toBe('/repo/.worktrees/a');
    expect(takeWorkspace('coder')).toBeUndefined();
  });

  test('a later offer replaces one that no chat took', () => {
    offerWorkspace('coder', '/repo/.worktrees/a');
    offerWorkspace('coder', '/repo/.worktrees/b');
    expect(takeWorkspace('coder')).toBe('/repo/.worktrees/b');
  });

  test('a new chat that is already open is told, until it stops listening', () => {
    const told = vi.fn();
    const stop = onWorkspaceOffered(told);
    offerWorkspace('coder', '/repo/.worktrees/c');
    expect(told).toHaveBeenCalledTimes(1);
    stop();
    offerWorkspace('coder', '/repo/.worktrees/d');
    expect(told).toHaveBeenCalledTimes(1);
    expect(takeWorkspace('coder')).toBe('/repo/.worktrees/d');
  });
});
