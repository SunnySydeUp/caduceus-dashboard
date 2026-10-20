import { describe, expect, test } from 'vitest';
import { createAppRegistry } from '../src/modules/index.ts';
import { indexSettings, searchSettings } from '../src/modules/settings/settings-search.ts';

const panels = [
  {
    id: 'appearance',
    moduleId: 'settings',
    title: 'Appearance',
    path: '/settings/appearance',
    fields: [
      { id: 'theme', label: 'Theme', description: 'Light, dark or follow the device', keywords: ['dark mode'] },
      { id: 'text-size', label: 'Text size', description: 'Make everything larger', keywords: ['font', 'theme'] },
    ],
  },
  {
    id: 'security',
    moduleId: 'settings',
    title: 'Security',
    path: '/system/security',
    fields: [{ id: 'password', label: 'Password', description: 'Change the theme of your sign-in', keywords: ['login'] }],
  },
];
const index = indexSettings(panels);

describe('settings search', () => {
  test('every field is indexed with its panel and a path that opens it', () => {
    expect(index.map(({ panelId, fieldId, path }) => [panelId, fieldId, path])).toEqual([
      ['appearance', 'theme', '/settings/appearance?field=theme'],
      ['appearance', 'text-size', '/settings/appearance?field=text-size'],
      ['security', 'password', '/system/security?field=password'],
    ]);
    expect(searchSettings(index, 'password')).toEqual([
      { panelId: 'security', moduleId: 'settings', fieldId: 'password', label: 'Password', panelTitle: 'Security', path: '/system/security?field=password' },
    ]);
  });

  test('matches word prefixes without regard to case, in label, keywords and description', () => {
    expect(searchSettings(index, 'TEX').map((r) => r.fieldId)).toEqual(['text-size']);
    expect(searchSettings(index, 'font').map((r) => r.fieldId)).toEqual(['text-size']);
    expect(searchSettings(index, 'larg').map((r) => r.fieldId)).toEqual(['text-size']);
    expect(searchSettings(index, 'size text').map((r) => r.fieldId)).toEqual(['text-size']);
    // A prefix of a word, not any substring.
    expect(searchSettings(index, 'ssword')).toEqual([]);
  });

  test('label hits come before keyword hits, and those before description hits', () => {
    expect(searchSettings(index, 'theme').map((r) => r.fieldId)).toEqual(['theme', 'text-size', 'password']);
  });

  test('gibberish and an empty query find nothing', () => {
    expect(searchSettings(index, 'zzqxj')).toEqual([]);
    expect(searchSettings(index, '   ')).toEqual([]);
  });
});

describe('settings metadata of the registered modules', () => {
  const registered = createAppRegistry().settingsPanels();

  test('every panel declares fields, each with a label, a description and a keyword', () => {
    expect(registered.length).toBeGreaterThan(0);
    const problems = registered.flatMap((panel) => [
      ...(panel.fields.length === 0 ? [`panel "${panel.id}" has no fields`] : []),
      ...panel.fields.flatMap((field) => [
        ...(field.label.trim() === '' ? [`${panel.id}/${field.id} has no label`] : []),
        ...(field.description.trim() === '' ? [`${panel.id}/${field.id} has no description`] : []),
        ...(field.keywords.length === 0 || field.keywords.some((word) => word.trim() === '') ? [`${panel.id}/${field.id} has no keyword`] : []),
      ]),
    ]);
    expect(problems).toEqual([]);
  });

  test('field ids are unique within a panel, and each field is found by its own label', () => {
    const everything = indexSettings(registered);
    for (const panel of registered) expect(new Set(panel.fields.map((field) => field.id)).size).toBe(panel.fields.length);
    for (const entry of everything) expect(searchSettings(everything, entry.label).map((r) => `${r.panelId}/${r.fieldId}`)).toContain(`${entry.panelId}/${entry.fieldId}`);
  });
});
