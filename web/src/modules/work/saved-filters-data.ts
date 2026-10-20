// The owner's saved task filters, as Caduceus's store keeps them (`/_caduceus/api/work/filters`): a name and a definition each, never a
// task. The page's copy is what the server last said; every change goes to the server first and the copy follows its answer.
import { useCallback, useEffect, useState } from 'react';
import { readFilterDefinition, readFilterName, type FilterDefinition, type SavedFilter, type SavedFilters } from '@caduceus/contracts/task-filters';

const ROUTE = '/_caduceus/api/work/filters';

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Caduceus did not save the filter (HTTP ${response.status}).`);
  return response;
}

/** What the server answered, as filters; a row that is not one is left out. */
function readFilters(body: SavedFilters): SavedFilter[] {
  return (Array.isArray(body.filters) ? body.filters : []).flatMap((item) => {
    const name = readFilterName(item.name);
    const definition = readFilterDefinition(item.definition);
    return typeof item.id === 'string' && name !== undefined && definition !== undefined ? [{ id: item.id, name, definition }] : [];
  });
}

export interface SavedFiltersState {
  filters: SavedFilter[];
  /** The server has answered once. */
  loaded: boolean;
  /** Why the list could not be read. */
  error?: string;
  save(name: string, definition: FilterDefinition): Promise<SavedFilter>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function useSavedFilters(): SavedFiltersState {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    fetch(ROUTE).then(
      async (response) => {
        if (!current) return;
        if (!response.ok) {
          setError(`Caduceus answered HTTP ${response.status}.`);
          return;
        }
        setFilters(readFilters((await response.json()) as SavedFilters));
        setError(undefined);
        setLoaded(true);
      },
      () => current && setError('Caduceus did not answer.'),
    );
    return () => {
      current = false;
    };
  }, []);

  const save = useCallback(async (name: string, definition: FilterDefinition) => {
    const saved = (await (await call('POST', ROUTE, { name, definition })).json()) as SavedFilter;
    setFilters((previous) => [...previous, saved]);
    return saved;
  }, []);
  const rename = useCallback(async (id: string, name: string) => {
    const saved = (await (await call('PUT', `${ROUTE}/${encodeURIComponent(id)}`, { name })).json()) as SavedFilter;
    setFilters((previous) => previous.map((filter) => (filter.id === id ? saved : filter)));
  }, []);
  const remove = useCallback(async (id: string) => {
    await call('DELETE', `${ROUTE}/${encodeURIComponent(id)}`);
    setFilters((previous) => previous.filter((filter) => filter.id !== id));
  }, []);

  return { filters, loaded, error, save, rename, remove };
}
