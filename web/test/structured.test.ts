import { describe, expect, test } from 'vitest';
import { parseStructured, treeRows } from '../src/modules/chat/structured.ts';

describe('parsing JSON and YAML', () => {
  test('JSON parses to a value', async () => {
    expect(await parseStructured('json', '{"a": [1, {"b": null}], "c": "d"}')).toEqual({ ok: true, value: { a: [1, { b: null }], c: 'd' } });
  });

  test('half-streamed JSON is not an error to show: it is "not ready", and the code view stands in', async () => {
    expect(await parseStructured('json', '{"a": [1, {"b": nu')).toEqual({ ok: false });
  });

  test('YAML parses to a value; anchors and multi-line scalars resolve', async () => {
    expect(await parseStructured('yaml', 'name: caduceus\nports:\n  - 9130\n  - 9443\nnote: |\n  two\n  lines\n')).toEqual({ ok: true, value: { name: 'caduceus', ports: [9130, 9443], note: 'two\nlines\n' } });
  });

  test('YAML that is not valid is not ready; a text that is only a scalar is not a tree', async () => {
    expect(await parseStructured('yaml', 'a: [1, 2')).toEqual({ ok: false });
    expect(await parseStructured('json', '42')).toEqual({ ok: false });
    expect(await parseStructured('yaml', 'just words')).toEqual({ ok: false });
  });

  test('a YAML document with an alias flood is refused, not expanded', async () => {
    const flood = `a: &a [x]\nb: [${Array.from({ length: 60 }, () => '*a').join(', ')}]`;
    expect(await parseStructured('yaml', flood)).toEqual({ ok: false });
    expect(await parseStructured('yaml', 'a: &a [x]\nb: [*a, *a]')).toEqual({ ok: true, value: { a: ['x'], b: [['x'], ['x']] } });
  });
});

describe('the tree, as rows', () => {
  const value = { name: 'x', list: [1, 'two', { deep: true }], empty: {}, none: null };

  test('everything open: one row per value, with depth, key, and a summary for containers', () => {
    const rows = treeRows(value, new Set());
    expect(rows.map((row) => [row.depth, row.key, row.kind, row.preview])).toEqual([
      [0, undefined, 'object', '{4}'],
      [1, 'name', 'string', '"x"'],
      [1, 'list', 'array', '[3]'],
      [2, '0', 'number', '1'],
      [2, '1', 'string', '"two"'],
      [2, '2', 'object', '{1}'],
      [3, 'deep', 'boolean', 'true'],
      [1, 'empty', 'object', '{}'],
      [1, 'none', 'null', 'null'],
    ]);
  });

  test('collapsing a path hides what is under it, and only that', () => {
    const rows = treeRows(value, new Set(['$.list']));
    expect(rows.map((row) => row.key)).toEqual([undefined, 'name', 'list', 'empty', 'none']);
    expect(rows.find((row) => row.key === 'list')).toMatchObject({ expandable: true, collapsed: true, path: '$.list' });
  });

  test('only containers with content can be collapsed; paths are unique per row', () => {
    const rows = treeRows(value, new Set());
    expect(rows.filter((row) => row.expandable).map((row) => row.path)).toEqual(['$', '$.list', '$.list[2]']);
    expect(new Set(rows.map((row) => row.path)).size).toBe(rows.length);
  });

  test('a long string is shortened in the preview and kept whole in the value', () => {
    const [, row] = treeRows({ s: 'x'.repeat(500) }, new Set());
    expect(row!.preview.length).toBeLessThan(200);
    expect(row!.value).toBe('x'.repeat(500));
  });

  test('a very large array is capped, with a row that says how many were left out', () => {
    const rows = treeRows(Array.from({ length: 1500 }, (_, index) => index), new Set());
    expect(rows.length).toBeLessThan(1100);
    expect(rows.at(-1)).toMatchObject({ kind: 'more', preview: '… 500 more' });
  });
});
