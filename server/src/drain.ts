// The drain (architecture §8, M5 #12): while an update or a restart is under way Caduceus takes no new turns, so that the work in progress can settle
// before Hermes or Caduceus stops. It is Caduceus's own switch and is kept only in memory: a Caduceus that restarts is not draining any more.
import { setTimeout as delay } from 'node:timers/promises';
import type { DrainState } from '@caduceus/contracts/caduceus-api';
import { workingTurns } from './active-turns.ts';
import type { HermesBackend } from './hermes-backend.ts';

export interface Drain {
  /** Whether a new turn is refused now. */
  active(): boolean;
  readonly state: DrainState;
  /** Begins draining, for `reason` (words for the owner). Beginning twice keeps the first reason. */
  begin(reason: string): void;
  end(): void;
  /** Calls `listener` with the new state whenever it changes; returns what stops it. */
  onChange(listener: (state: DrainState) => void): () => void;
}

export function createDrain(now: () => number): Drain {
  let state: DrainState = { active: false, reason: null, since: null };
  const listeners = new Set<(state: DrainState) => void>();
  const set = (next: DrainState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
  return {
    active: () => state.active,
    get state() {
      return state;
    },
    begin(reason) {
      if (!state.active) set({ active: true, reason, since: now() });
    },
    end() {
      if (state.active) set({ active: false, reason: null, since: null });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Waits for the turns Hermes is working on to end, for at most `timeoutMs`, saying what it is doing through `say` (once it has to wait, and again if it gives up).
 * Hermes not saying how many are working (it is down) is the same as none: there is nothing to wait for.
 */
export async function waitForTurns(backend: HermesBackend, { pollMs, timeoutMs, say }: { pollMs: number; timeoutMs: number; say(line: string): void }): Promise<void> {
  const began = performance.now();
  let said = false;
  for (;;) {
    const working = await workingTurns(backend).catch(() => undefined);
    if (!working) return;
    if (!said) say(`${working} ${working === 1 ? 'turn is' : 'turns are'} still being worked on. Waiting for ${working === 1 ? 'it' : 'them'} to finish.`);
    said = true;
    if (performance.now() - began >= timeoutMs) {
      say(`Not waiting any longer: ${working === 1 ? 'the turn' : 'the turns'} still running will be interrupted when Hermes restarts.`);
      return;
    }
    await delay(pollMs);
  }
}
