// Reading Hermes for Agents › Models and the shared model picker. Only GETs live here; every change goes through
// `model-actions.ts`. Nothing is kept beyond what the screen shows: a reload shows Hermes's values (D1).
//
// Every read names the profile (`?profile=`), so what shows is the config.yaml of the profile the screen is scoped to.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveLoad } from '../../gateway.ts';
import { parseFallback, type Fallback } from './fallback.ts';
import { parseMoa, type Moa } from './moa.ts';
import { parseUsage, usagePath, type Usage, type UsageDays } from './usage.ts';
import { parseCatalogue, recommendedProvider, type Catalogue, type ModelChoice } from './model-catalogue.ts';
import { parseAuxiliary, readModelInfo, readReasoning, readRecommended, recommendedDefaultPath, type Auxiliary, type ModelInfo } from './model-settings.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

const scoped = (route: string, profile: string, extra = '') => `${route}?profile=${encodeURIComponent(profile)}${extra}`;

/** Hermes's live catalogue for a profile. `refresh` busts Hermes's own per-provider cache and asks every provider again. Unconfigured providers are listed, labelled. */
export async function fetchCatalogue(profile: string, { refresh = false }: { refresh?: boolean } = {}): Promise<Catalogue> {
  return parseCatalogue(await read(scoped('/api/model/options', profile, `&include_unconfigured=true${refresh ? '&refresh=true' : ''}`)));
}

export interface CatalogueView {
  /** `undefined` until Hermes has answered. It stays, as the last list Hermes gave, while a newer one is asked for or Hermes does not answer. */
  catalogue: Catalogue | undefined;
  /** The last ask failed: Hermes did not answer, so a list that shows is the last one Hermes gave. */
  failed: boolean;
  /** An ask is on its way. */
  loading: boolean;
  /** Asks Hermes again; `live` makes it re-probe every provider (the picker's Refresh). */
  reload(options?: { live?: boolean }): Promise<void>;
}

/** Hermes's model catalogue for the profile, loaded when the component mounts (a picker opening) and when the profile changes. */
export function useModelCatalogue(profile: string | undefined): CatalogueView {
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(
    async ({ live = false }: { live?: boolean } = {}) => {
      if (!profile) return;
      const request = ++latest.current;
      setLoading(true);
      try {
        const next = await fetchCatalogue(profile, { refresh: live });
        if (request !== latest.current) return;
        setCatalogue(next);
        setFailed(false);
      } catch {
        if (request === latest.current) setFailed(true);
      } finally {
        if (request === latest.current) setLoading(false);
      }
    },
    [profile],
  );

  useEffect(() => {
    // Another profile has another list: do not show this one's while it loads.
    setCatalogue(undefined);
    setFailed(false);
    void reload();
  }, [reload]);

  return { catalogue, failed, loading, reload };
}

/** What Hermes says about a profile's main model. */
export interface MainModelState {
  main: ModelChoice;
  info: ModelInfo | undefined;
  /** The default reasoning effort in the profile's config; empty when none is set. */
  reasoning: string;
  /** With no model set: Hermes's recommendation for the first provider the profile can use. */
  recommended: ModelChoice | undefined;
}

/** Reads the main model, what Hermes knows of it, the reasoning default and, when nothing is set, Hermes's recommendation. */
export async function fetchMainModel(profile: string): Promise<MainModelState> {
  const [auxiliary, info, config] = await Promise.all([read(scoped('/api/model/auxiliary', profile)), read(scoped('/api/model/info', profile)).catch(() => undefined), read(scoped('/api/config', profile))]);
  const main = parseAuxiliary(auxiliary).main;
  let recommended: ModelChoice | undefined;
  if (main.model === '') {
    const provider = recommendedProvider(await fetchCatalogue(profile).catch(() => ({ current: main, providers: [] })));
    if (provider) recommended = readRecommended(await read(recommendedDefaultPath(profile, provider)).catch(() => undefined));
  }
  return { main, info: readModelInfo(info), reasoning: readReasoning(config), recommended };
}

export interface LoadedView<Value> {
  value: Value | undefined;
  failed: boolean;
  reload(): Promise<void>;
}

/** Loads one thing about a profile now and at every `gateway.ready`; the last value stays while a newer one is asked for. A screen mounts one per profile (`key={profile}`). */
export function useProfileLoad<Value>(profile: string | undefined, load: (profile: string) => Promise<Value>): LoadedView<Value> {
  const [value, setValue] = useState<Value>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!profile) return;
    const request = ++latest.current;
    try {
      const next = await load(profile);
      if (request !== latest.current) return;
      setValue(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
    // `load` is a module-level function of the caller's choosing and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  useLiveLoad(() => void reload());
  return { value, failed, reload };
}

export const useMainModel = (profile: string | undefined) => useProfileLoad(profile, fetchMainModel);

/** Hermes's auxiliary slots for a profile: every one Hermes reports. */
export const useAuxiliary = (profile: string | undefined): LoadedView<Auxiliary> => useProfileLoad(profile, async (name) => parseAuxiliary(await read(scoped('/api/model/auxiliary', name))));

/** Hermes's Mixture-of-Agents presets for a profile. */
export const useMoa = (profile: string | undefined): LoadedView<Moa> => useProfileLoad(profile, async (name) => parseMoa(await read(scoped('/api/model/moa', name))));

/** The fallback chain, the entries turned off and the failing-over settings in the profile's config. */
export const useFallback = (profile: string | undefined): LoadedView<Fallback> => useProfileLoad(profile, async (name) => parseFallback(await read(scoped('/api/config', name))));

/** Hermes's usage of each model over the last `days` days, for a profile; another period asks again. */
export function useUsage(profile: string | undefined, days: UsageDays): LoadedView<Usage> {
  const [value, setValue] = useState<Usage>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!profile) return;
    const request = ++latest.current;
    try {
      const next = parseUsage(await read(usagePath(profile, days)));
      if (request !== latest.current) return;
      setValue(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile, days]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());
  return { value, failed, reload };
}
