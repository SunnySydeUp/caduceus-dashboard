// Reading Hermes's checkpoints for Workspace › Checkpoints. Hermes's `rollback.*` methods need a live session on the workspace, so the page opens one through the
// gateway (`session.create` with the workspace as its folder: no prompt is sent and no chat is made) and closes it when the page moves on. Caduceus touches no file.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CADUCEUS_SESSION_SOURCE } from '@caduceus/contracts/caduceus-api';
import type { SessionCreateResult } from '@caduceus/contracts/hermes/gateway';
import { gatewayConnection } from '../../gateway.ts';
import { parseCheckpoints, parseStorage, type CheckpointList } from './checkpoints-model.ts';

const BUILD_TIMEOUT_MS = 30_000;

/** Opens a session on `cwd` and resolves with its id once Hermes has built its agent (the checkpoint manager is the agent's). */
export async function openWorkspaceSession(cwd: string, profile: string | undefined): Promise<string> {
  const { client } = gatewayConnection();
  const created = await client.request<SessionCreateResult>('session.create', { source: CADUCEUS_SESSION_SOURCE, cwd, ...(profile ? { profile } : {}) });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const stop = client.on('session.info', (event) => {
    if (event.session_id === created.session_id && Object.keys(event.payload?.tools ?? {}).length > 0) resolve();
  });
  const failed = client.on('error', (event) => {
    if (event.session_id === created.session_id) reject(new Error(String(event.payload?.message ?? 'Hermes could not open a session on this folder.')));
  });
  const timer = setTimeout(() => reject(new Error('Hermes took too long to open a session on this folder.')), BUILD_TIMEOUT_MS);
  try {
    await promise;
  } catch (error) {
    void client.request('session.close', { session_id: created.session_id }).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    stop();
    failed();
  }
  return created.session_id;
}

export type Checkpoints = { state: 'idle' } | { state: 'attaching' } | { state: 'failed'; message: string } | { state: 'ready'; sessionId: string; list: CheckpointList };

/** The checkpoints of a folder; `reload` lists them again (after a restore). The session opened for it is closed when the folder changes or the page goes. */
export function useCheckpoints(folder: string | undefined, profile: string | undefined): { checkpoints: Checkpoints; reload(): Promise<void> } {
  const [checkpoints, setCheckpoints] = useState<Checkpoints>({ state: 'idle' });
  const session = useRef<{ folder: string; id: string } | undefined>(undefined);
  const generation = useRef(0);

  const close = useCallback(() => {
    const open = session.current;
    session.current = undefined;
    if (open) void gatewayConnection().client.request('session.close', { session_id: open.id }).catch(() => undefined);
  }, []);

  const reload = useCallback(async () => {
    const open = session.current;
    if (!open) return;
    try {
      const list = parseCheckpoints(await gatewayConnection().client.request('rollback.list', { session_id: open.id }));
      setCheckpoints({ state: 'ready', sessionId: open.id, list });
    } catch (error) {
      setCheckpoints({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    if (folder === undefined) {
      setCheckpoints({ state: 'idle' });
      return;
    }
    const mine = ++generation.current;
    setCheckpoints({ state: 'attaching' });
    openWorkspaceSession(folder, profile).then(
      async (id) => {
        if (mine !== generation.current) {
          void gatewayConnection().client.request('session.close', { session_id: id }).catch(() => undefined);
          return;
        }
        session.current = { folder, id };
        await reload();
      },
      (error: unknown) => mine === generation.current && setCheckpoints({ state: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      generation.current++;
      close();
    };
  }, [folder, profile, reload, close]);

  return { checkpoints, reload };
}

/** The size of the checkpoint store (`GET /api/ops/checkpoints`); `undefined` until Hermes has answered, or when it cannot. */
export function useStorage(profile: string | undefined, version: unknown): { totalBytes: number } | undefined {
  const [storage, setStorage] = useState<{ totalBytes: number }>();
  useEffect(() => {
    let current = true;
    fetch(`/api/ops/checkpoints${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`)
      .then((res) => (res.ok ? res.json() : undefined), () => undefined)
      .then((body: unknown) => current && setStorage(parseStorage(body)));
    return () => {
      current = false;
    };
  }, [profile, version]);
  return storage;
}

/** One checkpoint's diff against the files now: Hermes's plain `diff`, its `stat` line, and nothing of its ANSI rendering. */
export async function readDiff(sessionId: string, hash: string): Promise<{ diff: string; stat: string }> {
  const answer = await gatewayConnection().client.request<{ diff?: unknown; stat?: unknown }>('rollback.diff', { session_id: sessionId, hash });
  return { diff: typeof answer.diff === 'string' ? answer.diff : '', stat: typeof answer.stat === 'string' ? answer.stat : '' };
}
