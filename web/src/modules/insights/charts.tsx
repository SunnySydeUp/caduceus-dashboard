import { useId, type ReactNode } from 'react';
import type { HeatCell } from './insights-model.ts';

/** The numbers behind a chart, for the table that is its accessible alternative. */
export interface ChartTable {
  head: string[];
  rows: (string | number)[][];
}

/**
 * A chart and its table (M5 #05): the drawing is for the eye and is hidden from assistive technology, whose reading is the summary line and a table of every
 * number the chart is drawn from, which anyone may open.
 */
export function ChartFigure({ title, summary, table, children, wide, actions }: { title: string; summary: string; table: ChartTable; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  const heading = useId();
  return (
    <figure className="panel panel--pad ins-chart" data-wide={wide ? '' : undefined} aria-labelledby={heading}>
      <figcaption>
        <h2 id={heading}>{title}</h2>
        <p className="subtle ins-chart__summary">{summary}</p>
        {actions}
      </figcaption>
      <div className="ins-chart__draw" aria-hidden="true">
        {children}
      </div>
      <details className="ins-table">
        <summary>Show {title.toLowerCase()} as a table</summary>
        <div className="ins-table__scroll" tabIndex={0} role="region" aria-label={`${title}, table`}>
          <table>
            <thead>
              <tr>
                {table.head.map((cell) => (
                  <th key={cell} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={index} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={index}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Vertical bars, one per slot, scaled to the largest. `labels` names the first and last slot under the bars. */
export function Bars({ values, first, last, tone }: { values: readonly number[]; first: string; last: string; tone?: 'muted' }) {
  const top = Math.max(...values, 0);
  return (
    <div className="ins-bars" data-tone={tone}>
      <div className="ins-bars__row" style={{ gridTemplateColumns: `repeat(${Math.max(values.length, 1)}, minmax(0, 1fr))` }}>
        {values.map((value, index) => (
          <i key={index} style={{ blockSize: top > 0 ? `${Math.max(value > 0 ? 3 : 0, (value / top) * 100)}%` : '0%' }} />
        ))}
      </div>
      <div className="ins-bars__axis">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

/** Horizontal bars with a label and a figure each, scaled to the largest. */
export function HBars({ rows }: { rows: readonly { label: string; value: number; text: string }[] }) {
  const top = Math.max(...rows.map((row) => row.value), 0);
  return (
    <ul className="ins-hbars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="ins-hbars__label mono">{row.label}</span>
          <span className="ins-hbars__bar">
            <i style={{ inlineSize: top > 0 ? `${Math.max(row.value > 0 ? 2 : 0, (row.value / top) * 100)}%` : '0%' }} />
          </span>
          <span className="ins-hbars__text">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

const WEEKDAYS = ['Mon', 'Wed', 'Fri'];

/** The activity heatmap: a column a week, a row a weekday, a cell a day. */
export function Heatmap({ weeks }: { weeks: readonly (HeatCell | undefined)[][] }) {
  return (
    <div className="ins-heat">
      <div className="ins-heat__days">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="ins-heat__grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, ['--weeks' as string]: weeks.length }}>
        {weeks.map((week, column) => (
          <div key={column} className="ins-heat__week">
            {week.map((cell, row) => (cell ? <i key={row} data-level={cell.level} title={`${cell.day}: ${cell.sessions} ${cell.sessions === 1 ? 'session' : 'sessions'}`} /> : <i key={row} data-level="none" />))}
          </div>
        ))}
      </div>
    </div>
  );
}
