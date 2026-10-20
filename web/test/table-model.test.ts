import { describe, expect, test } from 'vitest';
import { parseMarkdown } from '../src/modules/chat/markdown.ts';
import { nextSort, visibleRows, type TableSort } from '../src/modules/chat/table-model.ts';

/** A table as the owner would get it from a reply. */
function tableOf(markdown: string) {
  const block = parseMarkdown(markdown).blocks[0]!;
  if (block.t !== 'table') throw new Error('not a table');
  return block;
}
const fruit = tableOf('| Fruit | Qty | Price |\n|---|---:|---:|\n| pear | 12 | $1.50 |\n| apple | 3 | $10.00 |\n| Banana | 100 | $0.25 |\n| fig |  | $2 |');
const names = (order: number[]) => order.map((index) => ['pear', 'apple', 'Banana', 'fig'][index]);

describe('table sort', () => {
  test('numbers sort as numbers, not as text (3 before 12 before 100)', () => {
    expect(names(visibleRows(fruit, { sort: { column: 1, direction: 'asc' }, filter: '' }))).toEqual(['apple', 'pear', 'Banana', 'fig']);
    expect(names(visibleRows(fruit, { sort: { column: 1, direction: 'desc' }, filter: '' }))).toEqual(['Banana', 'pear', 'apple', 'fig']);
  });

  test('currency cells sort by value', () => {
    expect(names(visibleRows(fruit, { sort: { column: 2, direction: 'asc' }, filter: '' }))).toEqual(['Banana', 'pear', 'fig', 'apple']);
  });

  test('thousands separators, percent signs and decimals are read as numbers (1,000 is more than 9.5)', () => {
    const values = tableOf('| v |\n|---|\n| 1,000 |\n| 9.5 |\n| 20% |\n| -3 |');
    expect(visibleRows(values, { sort: { column: 0, direction: 'asc' }, filter: '' })).toEqual([3, 1, 2, 0]);
  });

  test('text sorts without regard to case; an empty cell is last whichever way it goes', () => {
    expect(names(visibleRows(fruit, { sort: { column: 0, direction: 'asc' }, filter: '' }))).toEqual(['apple', 'Banana', 'fig', 'pear']);
    expect(names(visibleRows(fruit, { sort: { column: 0, direction: 'desc' }, filter: '' }))).toEqual(['pear', 'fig', 'Banana', 'apple']);
  });

  test('with no sort the rows keep their order, and equal cells keep theirs', () => {
    expect(visibleRows(fruit, { sort: undefined, filter: '' })).toEqual([0, 1, 2, 3]);
    const ties = tableOf('| k | v |\n|---|---|\n| a | 1 |\n| b | 1 |\n| c | 0 |');
    expect(visibleRows(ties, { sort: { column: 1, direction: 'asc' }, filter: '' })).toEqual([2, 0, 1]);
  });

  test('a header press goes none → ascending → descending → none, and a new column starts ascending', () => {
    let sort: TableSort | undefined;
    sort = nextSort(sort, 1);
    expect(sort).toEqual({ column: 1, direction: 'asc' });
    sort = nextSort(sort, 1);
    expect(sort).toEqual({ column: 1, direction: 'desc' });
    expect(nextSort(sort, 1)).toBeUndefined();
    expect(nextSort(sort, 0)).toEqual({ column: 0, direction: 'asc' });
  });
});

describe('table filter', () => {
  test('every word must be found, in any cell, whatever the case', () => {
    expect(names(visibleRows(fruit, { sort: undefined, filter: 'AN 100' }))).toEqual(['Banana']);
    expect(names(visibleRows(fruit, { sort: undefined, filter: 'p' }))).toEqual(['pear', 'apple']);
    expect(visibleRows(fruit, { sort: undefined, filter: 'zzz' })).toEqual([]);
  });

  test('a filter and a sort work together; the markup of a cell is not searched', () => {
    expect(names(visibleRows(fruit, { sort: { column: 1, direction: 'desc' }, filter: 'p' }))).toEqual(['pear', 'apple']);
    const marked = tableOf('| a |\n|---|\n| **bold** |\n| plain |');
    expect(visibleRows(marked, { sort: undefined, filter: '**' })).toEqual([]);
    expect(visibleRows(marked, { sort: undefined, filter: 'bold' })).toEqual([0]);
  });
});
