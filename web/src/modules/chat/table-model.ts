// Sorting and filtering a Markdown table (M1 #04): pure. A screen keeps the table as the message wrote it and asks which rows to
// show, and in what order; nothing here changes the table.
import { inlineText, type Inline } from './markdown.ts';

export interface SortableTable {
  rows: Inline[][][];
}
export interface TableSort {
  column: number;
  direction: 'asc' | 'desc';
}
export interface TableView {
  sort: TableSort | undefined;
  filter: string;
}

/** What a header press does: ascending, then descending, then the table's own order; another column starts ascending. */
export function nextSort(current: TableSort | undefined, column: number): TableSort | undefined {
  if (current?.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : undefined;
}

/** A cell's number, when it is one: thousands separators, a currency sign or a percent sign do not stop it. */
function numberOf(text: string): number | undefined {
  const cleaned = text.replace(/[\s,$€£¥%]/g, '');
  return cleaned !== '' && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(cleaned) ? Number(cleaned) : undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The indexes of the rows to show, filtered then sorted. A row stays where it was among rows that compare equal. */
export function visibleRows(table: SortableTable, { sort, filter }: TableView): number[] {
  const cells = table.rows.map((row) => row.map((cell) => inlineText(cell)));
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = cells.flatMap((row, index) => {
    const haystack = row.join('\n').toLowerCase();
    return words.every((word) => haystack.includes(word)) ? [index] : [];
  });
  if (!sort) return shown;

  const column = cells.map((row) => row[sort.column] ?? '');
  const numbers = column.map(numberOf);
  const numeric = column.every((text, index) => text.trim() === '' || numbers[index] !== undefined);
  const sign = sort.direction === 'asc' ? 1 : -1;
  return shown.toSorted((a, b) => {
    const emptyA = column[a]!.trim() === '';
    const emptyB = column[b]!.trim() === '';
    if (emptyA || emptyB) return Number(emptyA) - Number(emptyB);
    const order = numeric ? numbers[a]! - numbers[b]! : collator.compare(column[a]!, column[b]!);
    return order * sign || a - b;
  });
}
