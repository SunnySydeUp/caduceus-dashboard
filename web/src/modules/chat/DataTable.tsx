// A Markdown table the owner can sort (a press on a header) and filter (a search box over every cell), inside a container of its
// own that scrolls sideways, so that a wide table never makes the page scroll sideways. What to show is `table-model.ts`.
import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Inlines } from './RichInline.tsx';
import type { Block } from './markdown.ts';
import { nextSort, visibleRows, type TableSort } from './table-model.ts';

type Table = Extract<Block, { t: 'table' }>;

/** A table with more rows than this gets a filter box: for fewer it is only in the way. */
const FILTER_FROM_ROWS = 4;

export function DataTable({ table }: { table: Table }) {
  const [sort, setSort] = useState<TableSort>();
  const [filter, setFilter] = useState('');
  const filterId = useId();
  const order = useMemo(() => visibleRows(table, { sort, filter }), [table, sort, filter]);
  const filterable = table.rows.length >= FILTER_FROM_ROWS;

  return (
    <div className="rich__table">
      {filterable && (
        <div className="rich__table-tools">
          <label className="sr-only" htmlFor={filterId}>
            Filter rows
          </label>
          <input id={filterId} type="search" className="input rich__filter" placeholder="Filter rows" value={filter} onChange={(event) => setFilter(event.target.value)} />
          {filter !== '' && (
            <span className="subtle rich__count" role="status">
              {order.length} of {table.rows.length} rows
            </span>
          )}
        </div>
      )}
      <div className="rich__table-scroll" role="group" aria-label="Table" tabIndex={0}>
        <table>
          <thead>
            <tr>
              {table.head.map((cell, column) => {
                const sorted = sort?.column === column ? sort.direction : undefined;
                return (
                  <th key={column} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'} style={{ textAlign: table.align[column] }}>
                    <button type="button" className="rich__sort" onClick={() => setSort(nextSort(sort, column))}>
                      <span>
                        <Inlines nodes={cell} />
                      </span>
                      <Icon name={sorted === 'desc' ? 'chev-d' : sorted === 'asc' ? 'chev-u' : 'rows'} small />
                      <span className="sr-only">{sorted === 'asc' ? ', sorted ascending' : sorted === 'desc' ? ', sorted descending' : ', press to sort'}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.map((row) => (
              <tr key={row}>
                {table.rows[row]!.map((cell, column) => (
                  <td key={column} style={{ textAlign: table.align[column] }}>
                    <Inlines nodes={cell} />
                  </td>
                ))}
              </tr>
            ))}
            {order.length === 0 && (
              <tr>
                <td colSpan={table.head.length} className="subtle">
                  No rows match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
