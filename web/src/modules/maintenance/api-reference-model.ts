// Narrowing the API reference (M5 #13), as pure functions: search by words, by tier and by REST or gateway, and grouping what is left.
import type { ApiReferenceEntry } from '@caduceus/contracts/caduceus-api';

export interface ReferenceFilter {
  query: string;
  tier: 'all' | ApiReferenceEntry['tier'];
  kind: 'all' | ApiReferenceEntry['kind'];
}

/** The entries that match every word typed (in the name, method, summary, group or a parameter), the tier and the kind. */
export function filterReference(entries: readonly ApiReferenceEntry[], { query, tier, kind }: ReferenceFilter): ApiReferenceEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (tier !== 'all' && entry.tier !== tier) return false;
    if (kind !== 'all' && entry.kind !== kind) return false;
    const haystack = `${entry.method} ${entry.name} ${entry.summary} ${entry.group} ${(entry.params ?? []).join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The entries under their groups, the groups in order. */
export function referenceGroups(entries: readonly ApiReferenceEntry[]): { group: string; entries: ApiReferenceEntry[] }[] {
  const groups = new Map<string, ApiReferenceEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, grouped]) => ({ group, entries: grouped }));
}
