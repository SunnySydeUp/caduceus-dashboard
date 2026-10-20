import type { RegisteredSettingsPanel, SettingField } from '../../module-registry.ts';

/** One setting as Settings search knows it: what it is called, where it lives, and the words that find it. */
export interface SettingEntry {
  panelId: string;
  moduleId: string;
  fieldId: string;
  label: string;
  panelTitle: string;
  /** The address that opens the panel at the setting: the panel's path with `?field=`. */
  path: string;
  description: string;
  keywords: string[];
}

export type SettingResult = Pick<SettingEntry, 'panelId' | 'moduleId' | 'fieldId' | 'label' | 'panelTitle' | 'path'>;

type PanelLike = Pick<RegisteredSettingsPanel, 'id' | 'moduleId' | 'title' | 'path'> & { fields: SettingField[] };

/** Every setting of every panel, in panel then field order. */
export function indexSettings(panels: readonly PanelLike[]): SettingEntry[] {
  return panels.flatMap((panel) =>
    panel.fields.map((field) => ({
      panelId: panel.id,
      moduleId: panel.moduleId,
      fieldId: field.id,
      label: field.label,
      panelTitle: panel.title,
      path: `${panel.path}?field=${encodeURIComponent(field.id)}`,
      description: field.description,
      keywords: field.keywords,
    })),
  );
}

const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The settings whose label, keywords or description have a word starting with each word of the query (case does not
 * matter). A label hit ranks before a keyword hit, and that before a description hit; ties keep the index's order.
 */
export function searchSettings(index: readonly SettingEntry[], query: string): SettingResult[] {
  const queryWords = wordsOf(query);
  if (queryWords.length === 0) return [];
  const scored = index.flatMap((entry, order) => {
    const tiers = [wordsOf(entry.label), entry.keywords.flatMap(wordsOf), wordsOf(entry.description)];
    let score = 0;
    for (const word of queryWords) {
      const tier = tiers.findIndex((words) => words.some((candidate) => candidate.startsWith(word)));
      if (tier < 0) return [];
      score += tier;
    }
    return [{ entry, score, order }];
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map(({ entry: { panelId, moduleId, fieldId, label, panelTitle, path } }) => ({ panelId, moduleId, fieldId, label, panelTitle, path }));
}
