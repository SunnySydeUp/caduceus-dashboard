// Reading Hermes for System › Plugins: the plugins it lists and the catalogue it curates, asked again now and at every `gateway.ready`.
// Only reads live here; every change goes through `plugin-actions.ts`. Nothing is kept beyond what the screen shows (D1).
import { useCallback, useRef, useState } from 'react';
import { useLiveLoad } from '../../gateway.ts';
import { parseCatalogue, parsePlugins, type Catalogue, type PluginRow } from './plugins-model.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface Loaded<Value> {
  value: Value | undefined;
  failed: boolean;
  reload(): Promise<void>;
}

/** Loads one thing now and at every `gateway.ready`; the last value stays while a newer one is asked for. */
function useHermesLoad<Value>(load: () => Promise<Value>): Loaded<Value> {
  const [value, setValue] = useState<Value>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await load();
      if (request !== latest.current) return;
      setValue(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
    // `load` is a module-level function and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLiveLoad(() => void reload());
  return { value, failed, reload };
}

export const usePlugins = (): Loaded<PluginRow[]> => useHermesLoad(async () => parsePlugins(await read('/api/dashboard/plugins/hub')));

export const useCatalogue = (): Loaded<Catalogue> => useHermesLoad(async () => parseCatalogue(await read('/api/dashboard/plugins/catalog')));
