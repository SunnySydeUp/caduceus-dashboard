import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { OutputLines, RunOutput, WHOLE_BELOW_LINES } from '../src/modules/work/RunOutput.tsx';
import { rowWindow } from '../src/modules/work/tasks-model.ts';

describe('the output of a run', () => {
  const lines = Array.from({ length: 50_000 }, (_, n) => `line ${n + 1} of the log`);
  const draw = (scrollTop: number) => {
    const shown = rowWindow({ count: lines.length, rowHeight: 22, scrollTop, viewport: 400, overscan: 20 });
    const markup = renderToStaticMarkup(createElement(OutputLines, { lines, shown }));
    return { shown, markup, drawn: markup.split('class="jlog__line"').length - 1 };
  };

  test('a log of 50,000 lines draws only the lines near the screen, between two spacers that hold the rest of the height', () => {
    const { shown, markup, drawn } = draw(22 * 25_000);
    expect(drawn).toBe(shown.end - shown.start);
    expect(drawn).toBeLessThan(80);
    expect(markup).toContain('line 25001 of the log');
    expect(markup).not.toContain('line 1 of the log<');
    expect(markup.match(/class="jlog__spacer"/g)).toHaveLength(2);
    expect(markup).toContain(`block-size:${shown.before}px`);
    expect(markup).toContain(`block-size:${shown.after}px`);
  });

  test('at the top there is no spacer before, and at the end none after, so the whole log can be reached', () => {
    expect(draw(0).markup.match(/class="jlog__spacer"/g)).toHaveLength(1);
    const end = draw(22 * 50_000);
    expect(end.markup.match(/class="jlog__spacer"/g)).toHaveLength(1);
    expect(end.markup).toContain('line 50000 of the log');
  });

  test('a short output is shown whole, as text, and says when Hermes cut it', () => {
    const short = renderToStaticMarkup(createElement(RunOutput, { text: 'all clear\nsecond line', truncated: true }));
    expect(short).toContain('all clear\nsecond line');
    expect(short).not.toContain('jlog__line');
    expect(short).toContain('only the start');
    const long = renderToStaticMarkup(createElement(RunOutput, { text: Array.from({ length: WHOLE_BELOW_LINES + 1 }, (_, n) => `row ${n}`).join('\n') }));
    expect(long).toContain('class="jlog"');
    expect(long).toContain('201 lines');
  });
});
