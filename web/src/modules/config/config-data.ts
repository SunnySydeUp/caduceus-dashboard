// Reading Hermes for System › Config. Only GETs live here; the save is in `config-actions.ts`. Every load asks Hermes again and nothing is
// kept beyond what the page shows (D1). The four answers the form is made of are read together, so the form is never half of one moment
// and half of another.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveLoad } from '../../gateway.ts';
import { buildConfigForm, type ConfigForm } from './config-model.ts';

export interface ConfigView {
  /** `undefined` until Hermes has answered. It stays while a newer answer is asked for. */
  form: ConfigForm | undefined;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

async function readJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The config form of `profile`. Hermes has no signal for config, so it loads again at every `gateway.ready` (the first connect, a
 * reconnect, a Hermes restart) and when the tab comes back into view, and after each save the page makes. There is no timer.
 */
export function useConfigForm(profile: string): ConfigView {
  const [form, setForm] = useState<ConfigForm>();
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    const scoped = `?profile=${encodeURIComponent(profile)}`;
    try {
      const [schema, defaults, current, saved] = await Promise.all([readJson(`/api/config/schema${scoped}`), readJson('/api/config/defaults'), readJson(`/api/config${scoped}`), readJson(`/api/config${scoped}&include_defaults=false`)]);
      if (request !== latest.current) return;
      setForm(buildConfigForm({ schema, defaults, current, saved }));
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);

  useEffect(() => {
    // Another profile has another config: the last one's must not show as this one's while it loads.
    setForm(undefined);
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { form, failed, reload };
}

/** What `GET /api/config/raw` answers: Hermes's file as text (a set credential is the mask), and where the file is. */
export interface RawConfig {
  yaml: string;
  path: string;
}

/** Reads Hermes's raw file of `profile` now; throws when Hermes does not answer with one. */
export async function readRawConfig(profile: string): Promise<RawConfig> {
  const body = await readJson(`/api/config/raw?profile=${encodeURIComponent(profile)}`);
  if (typeof body !== 'object' || body === null || !('yaml' in body) || typeof body.yaml !== 'string') throw new Error('Hermes did not answer with its config file.');
  return { yaml: body.yaml, path: 'path' in body && typeof body.path === 'string' ? body.path : '' };
}

export interface RawView {
  /** `undefined` until Hermes has answered. */
  raw: RawConfig | undefined;
  failed: boolean;
  reload(): Promise<void>;
}

/** The raw file of `profile`, loaded again like the form is (`useConfigForm`): at every `gateway.ready`, and when the tab comes back into view. */
export function useRawConfig(profile: string): RawView {
  const [raw, setRaw] = useState<RawConfig>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const answer = await readRawConfig(profile);
      if (request !== latest.current) return;
      setRaw(answer);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);

  useEffect(() => {
    setRaw(undefined);
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { raw, failed, reload };
}
