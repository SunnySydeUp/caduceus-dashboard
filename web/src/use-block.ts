// A block of a screen that loads and fails on its own (M2 #04, M8 #03): what it shows is one of loading, ready or an error with the words, and `reload` asks again.
// Nothing is kept beyond what is on screen (D1); a block reads again when Hermes says its data moved, never on a timer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BlockAsks } from './block-asks.ts';
import { useGatewayEvent, useLiveLoad } from './gateway.ts';

export type BlockState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

export interface Block<T> {
  state: BlockState<T>;
  /** Reads again; what is shown stays until the new answer is in. */
  reload(): void;
}

/**
 * Runs `load` when `key` changes (a profile scope, Hermes becoming ready) and again on `reload`, and says how it went. While `enabled` is false
 * (Hermes is not ready) the block shows nothing of an earlier Hermes. An answer is never dropped for a newer ask that is still out, only for one that
 * arrives after a newer answer (`block-asks.ts`): the first answer is what the screen is waiting for.
 */
export function useBlock<T>(load: () => Promise<T>, key: string, enabled: boolean, changedBy: readonly string[] = []): Block<T> {
  const [state, setState] = useState<BlockState<T>>({ status: 'loading' });
  const [asks] = useState(() => new BlockAsks());
  const loadNow = useRef(load);
  loadNow.current = load;

  const reload = useCallback(() => {
    const ask = asks.ask();
    loadNow.current().then(
      (data) => asks.accepts(ask, false) && setState({ status: 'ready', data }),
      (failure: unknown) => asks.accepts(ask, true) && setState({ status: 'error', message: failure instanceof Error ? failure.message : 'Hermes did not answer.' }),
    );
  }, [asks]);

  useEffect(() => {
    if (!enabled) {
      asks.drop();
      setState({ status: 'loading' });
      return;
    }
    reload();
    return () => asks.drop();
  }, [key, enabled, reload, asks]);

  // Hermes announces when its sessions, platforms or jobs moved: the blocks made of them read again.
  useGatewayEvent('sessions.changed', () => changedBy.includes('sessions.changed') && enabled && reload());
  useGatewayEvent('platforms.changed', () => changedBy.includes('platforms.changed') && enabled && reload());

  // Change broadcasts are not replayed: after a reconnect or a Hermes restart anything may have moved while the page was away.
  useLiveLoad((ready) => ready !== undefined && enabled && reload());

  return { state, reload };
}

/** What a block made of the Inbox's stream (Needs you, the crew's states, Work's running rows) shows while that stream is not up: the stream's own state, as a block's. */
export function feedBlock<T>(feed: { status: 'connecting' | 'live' | 'offline'; hermesUp: boolean }, data: T, retry: () => void): Block<T> {
  if (feed.status === 'connecting') return { state: { status: 'loading' }, reload: retry };
  if (feed.status === 'offline') return { state: { status: 'error', message: 'Caduceus lost its live connection to what Hermes is waiting on.' }, reload: retry };
  if (!feed.hermesUp) return { state: { status: 'error', message: 'Caduceus cannot reach Hermes, so this may be out of date.' }, reload: retry };
  return { state: { status: 'ready', data }, reload: retry };
}

/** The same block with its data made into something else; while it loads, or when it failed, it is as it was. Its `reload` is the original's. */
export function mapBlock<T, U>(block: Block<T>, map: (data: T) => U): Block<U> {
  const { state } = block;
  return { reload: block.reload, state: state.status === 'ready' ? { status: 'ready', data: map(state.data) } : state };
}
