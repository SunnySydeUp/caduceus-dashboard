// Reading Hermes for Connect › Channels. Only GETs live here; every change goes through `channel-actions.ts`. Every load asks Hermes
// again and nothing is kept beyond what the page shows (D1). Hermes sends no stored value, only its redaction of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { parseChannels, type Channel } from './channels-model.ts';

async function readJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface ChannelsView {
  /** `undefined` until Hermes has answered. They stay while a newer list is asked for. */
  channels: Channel[] | undefined;
  startCommand: string | undefined;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

/**
 * Hermes's platforms for `profile`. They load again with no timer, whenever something they are made of may have changed: at every
 * `gateway.ready`, when Hermes says its platforms moved (`platforms.changed`: a gateway started, stopped or connected a channel)
 * and when the tab comes back into view.
 */
export function useChannels(profile: string | undefined): ChannelsView {
  const [state, setState] = useState<{ channels: Channel[] | undefined; startCommand: string | undefined }>({ channels: undefined, startCommand: undefined });
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!profile) return;
    const request = ++latest.current;
    try {
      const { channels, startCommand } = parseChannels(await readJson(`/api/messaging/platforms?profile=${encodeURIComponent(profile)}`));
      if (request !== latest.current) return;
      setState({ channels, startCommand });
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);

  useEffect(() => {
    // Another profile is another list: the last one must not show as this one's while it loads.
    setState({ channels: undefined, startCommand: undefined });
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());
  useGatewayEvent('platforms.changed', () => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { ...state, failed, reload };
}

export interface BehaviourSource {
  /** `GET /api/config/schema`, and `GET /api/config`; `undefined` until Hermes has answered. */
  schema: unknown;
  config: unknown;
  failed: boolean;
  reload(): Promise<void>;
}

/** The config schema and the profile's config, for the behaviour tab; asked when `wanted` first becomes true, and again after a save. */
export function useBehaviourSource(profile: string | undefined, wanted: boolean): BehaviourSource {
  const [data, setData] = useState<{ schema: unknown; config: unknown }>({ schema: undefined, config: undefined });
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!profile) return;
    const request = ++latest.current;
    try {
      const query = `?profile=${encodeURIComponent(profile)}`;
      const [schema, config] = await Promise.all([readJson(`/api/config/schema${query}`), readJson(`/api/config${query}`)]);
      if (request !== latest.current) return;
      setData({ schema, config });
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);
  useEffect(() => {
    if (wanted) void reload();
  }, [wanted, reload]);
  return { ...data, failed, reload };
}
