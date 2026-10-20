// What the Backup screen reads (M5 #14): the checkpoint listing from Hermes, the backup made in this visit, and the wait for Caduceus to be back after a restore.
// Hermes keeps the archives and the checkpoints; nothing is kept here but the name of the latest backup, in this tab's session storage.
import { useCallback, useEffect, useState } from 'react';
import type { CompatibilityReport } from '@caduceus/contracts/caduceus-api';
import { fetchUpdatesState } from '../../updates.ts';
import { checkpointSummary, type CheckpointSummary } from './backup-model.ts';

export interface CheckpointsData {
  summary?: CheckpointSummary;
  failed: boolean;
  loading: boolean;
  reload(): Promise<void>;
}

/** Hermes's checkpoint listing (`GET /api/ops/checkpoints`), read again on request. */
export function useCheckpoints(): CheckpointsData {
  const [state, setState] = useState<{ summary?: CheckpointSummary; failed: boolean; loading: boolean }>({ failed: false, loading: true });
  const reload = useCallback(async () => {
    setState((before) => ({ ...before, loading: true }));
    try {
      const res = await fetch('/api/ops/checkpoints');
      const summary = res.ok ? checkpointSummary(await res.json()) : undefined;
      setState({ summary, failed: summary === undefined, loading: false });
    } catch {
      setState((before) => ({ ...before, failed: true, loading: false }));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { ...state, reload };
}

const LATEST_KEY = 'caduceus.backup.latest';

/** The path and name of the backup made in this tab, which survives a reload of the page but not a closed tab. */
export function useLatestBackup(): [{ archive: string; name: string } | undefined, (backup: { archive: string; name: string }) => void] {
  const [latest, setLatest] = useState<{ archive: string; name: string } | undefined>(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(LATEST_KEY) ?? 'null');
      return typeof stored === 'object' && stored !== null && 'archive' in stored && 'name' in stored && typeof stored.archive === 'string' && typeof stored.name === 'string' ? { archive: stored.archive, name: stored.name } : undefined;
    } catch {
      return undefined;
    }
  });
  const remember = useCallback((backup: { archive: string; name: string }) => {
    setLatest(backup);
    try {
      sessionStorage.setItem(LATEST_KEY, JSON.stringify(backup));
    } catch {
      // Private browsing may refuse storage; the backup is still on the Mac.
    }
  }, []);
  return [latest, remember];
}

const POLL_MS = 1000;
/** How long Caduceus may take to come back after a restore, and how long Hermes's contract check may take after that. */
const RESTART_WAIT_MS = 3 * 60_000;
const CHECK_WAIT_MS = 60_000;

function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Waits for the Caduceus that restarts after a restore: the one that is going keeps draining until the process ends, so an answer that says it is not draining
 * is the new one (or a restore that ended without restarting). Resolves `false` if it did not come back in time.
 */
export async function waitForRestart(): Promise<boolean> {
  const until = Date.now() + RESTART_WAIT_MS;
  while (Date.now() < until) {
    const state = await fetchUpdatesState();
    if (state && !state.drain.active) return true;
    await pause(POLL_MS);
  }
  return false;
}

/** The contract check of the restarted Hermes, once it has run; `undefined` when Caduceus would not say. */
export async function waitForContractCheck(): Promise<CompatibilityReport | undefined> {
  const until = Date.now() + CHECK_WAIT_MS;
  for (;;) {
    try {
      const res = await fetch('/_caduceus/api/compatibility');
      if (res.ok) {
        const report = (await res.json()) as CompatibilityReport;
        if (report.state !== 'checking' || Date.now() >= until) return report;
      }
    } catch {
      if (Date.now() >= until) return undefined;
    }
    await pause(POLL_MS);
  }
}
