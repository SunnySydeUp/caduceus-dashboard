import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { parseBoard } from '../src/modules/work/board-model.ts';
import { rowWindow, sortTasks } from '../src/modules/work/tasks-model.ts';

// The overlay layer stack is loaded with the shell's pieces; there is neither a window nor a document here. The stubs must exist
// before the module is evaluated, which a static import (hoisted above them) cannot do, so the table is imported after them.
vi.stubGlobal('window', { addEventListener: () => undefined });
vi.stubGlobal('document', { addEventListener: () => undefined });
// The router is a system boundary: a link is an anchor here, and following one goes nowhere.
vi.mock('../src/shell/navigation.tsx', () => ({
  AppLink: ({ to, ...rest }: { to: string }) => createElement('a', { ...rest, href: to }),
  useAppNavigate: () => () => Promise.resolve(),
}));
const { TaskRows } = await import('../src/modules/work/TaskTable.tsx');

// A stub of Hermes's board endpoint with 2,000 tasks.
const stub = {
  columns: [
    {
      name: 'ready',
      tasks: Array.from({ length: 2000 }, (_, n) => ({ id: `t_${n.toString(16).padStart(6, '0')}`, title: `Task ${n}`, assignee: n % 2 ? 'coder' : null, priority: n % 3, created_at: 1_700_000_000 + n, workflow_template_id: n % 4 === 0 ? 'release' : null })),
    },
  ],
};

describe('the task table’s rows, drawn for 2,000 tasks', () => {
  const tasks = sortTasks(parseBoard(stub).tasks, { column: 'updated', direction: 'desc' });
  const draw = (scrollTop: number) => {
    const shown = rowWindow({ count: tasks.length, rowHeight: 60, scrollTop, viewport: 700, overscan: 8 });
    const markup = renderToStaticMarkup(createElement(TaskRows, { tasks, shown, projects: {}, board: undefined, now: 1_700_100_000, onOpen: () => undefined }));
    return { shown, markup, rows: markup.split('class="tt__row').length - 1 };
  };

  test('in the middle of the list only the rows near the screen exist, between two spacers that hold the rest of the height', () => {
    const { shown, markup, rows } = draw(60 * 1000);
    expect(rows).toBe(shown.end - shown.start);
    expect(rows).toBeLessThan(30);
    // The first row drawn is the one the window starts at, numbered as it is in the whole list (the header is row 1).
    expect(markup).toContain(`aria-rowindex="${shown.start + 2}"`);
    expect(markup).toContain(tasks[shown.start]!.title);
    expect(markup).not.toContain(tasks[0]!.title + '<');
    expect(markup.match(/class="tt__spacer"/g)).toHaveLength(2);
    expect(markup).toContain(`block-size:${shown.before}px`);
    expect(markup).toContain(`block-size:${shown.after}px`);
  });

  test('at the top there is no spacer before, and a row says its status, its assignee, its age and how its last run ended', () => {
    const { markup, rows } = draw(0);
    expect(rows).toBeLessThan(30);
    expect(markup.match(/class="tt__spacer"/g)).toHaveLength(1);
    const first = markup.split('class="tt__row')[1]!;
    expect(first).toMatch(/Ready/);
    expect(first).toMatch(/Unassigned|coder/);
    expect(first).toMatch(/(just now|\d+[mhdwy])/);
    expect(first).toMatch(/Not run yet/);
    expect(first).toContain('href="/work/tasks/');
  });
});
