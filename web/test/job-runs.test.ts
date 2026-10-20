import { describe, expect, test } from 'vitest';
import { outputDirectory, parseFileOutput, parseOutputFiles, parseRuns, parseSessionOutput } from '../src/modules/work/job-runs.ts';

describe('the runs of an agent job', () => {
  const session = (id: string, started: number, fields: Record<string, unknown> = {}) => ({ id, started_at: started, ended_at: started + 5, end_reason: 'cron_complete', is_active: false, ...fields });

  test('are listed newest first whatever order Hermes gives them in, each with its status and how long it took', () => {
    const runs = parseRuns({
      runs: [
        session('old', 1000),
        session('now', 3000, { ended_at: null, is_active: true, end_reason: null }),
        session('lost', 2500, { ended_at: null, is_active: false, end_reason: null }),
        session('quiet', 2000, { end_reason: 'cron_incomplete_no_output', ended_at: 2002.5 }),
      ],
    });
    expect(runs.map((run) => [run.id, run.status, run.statusLabel, run.durationMs])).toEqual([
      ['now', 'running', 'Running', undefined],
      ['lost', 'incomplete', 'Did not finish', undefined],
      ['quiet', 'incomplete', 'Did not finish', 2500],
      ['old', 'ok', 'Finished', 5000],
    ]);
    expect(runs[3].startedAt).toBe(1_000_000);
  });

  test('a row that is not a session is left out, and an answer that is not a list is no runs', () => {
    expect(parseRuns({ runs: [{ id: 'no-start' }, null, 'x', session('fine', 5)] }).map((run) => run.id)).toEqual(['fine']);
    expect(parseRuns(undefined)).toEqual([]);
    expect(parseRuns({ runs: 'many' })).toEqual([]);
  });

  test('what a run produced is the last thing the agent said', () => {
    const messages = [
      { role: 'user', content: 'the prompt' },
      { role: 'assistant', content: 'thinking out loud' },
      { role: 'tool', content: 'a tool result' },
      { role: 'assistant', content: 'The final answer.' },
      { role: 'assistant', content: '   ' },
    ];
    expect(parseSessionOutput({ messages })).toBe('The final answer.');
    expect(parseSessionOutput({ messages: [{ role: 'user', content: 'only the prompt' }] })).toBeUndefined();
    expect(parseSessionOutput(null)).toBeUndefined();
  });
});

describe('the runs of a script job, from the files Hermes saves', () => {
  test('only files named for a time are runs, newest first, and the folder is the profile’s own', () => {
    const files = parseOutputFiles({
      entries: [
        { name: '2026-10-18_09-00-00.md', path: '/h/cron/output/j/2026-10-18_09-00-00.md', isDirectory: false },
        { name: 'notes.txt', path: '/h/cron/output/j/notes.txt', isDirectory: false },
        { name: '2026-10-19_09-00-00.md', path: '/h/cron/output/j/2026-10-19_09-00-00.md', isDirectory: false },
        { name: '2026-10-20_09-00-00.md', path: '/h/cron/output/j/2026-10-20_09-00-00.md', isDirectory: true },
      ],
    });
    expect(files.map((file) => file.name)).toEqual(['2026-10-19_09-00-00.md', '2026-10-18_09-00-00.md']);
    expect(files[0].startedAt).toBe(new Date(2026, 9, 19, 9, 0, 0).getTime());
    expect(outputDirectory({ id: 'abc123', config: { hermes_home: '/Users/me/.hermes/profiles/coder/' } })).toBe('/Users/me/.hermes/profiles/coder/cron/output/abc123');
    expect(outputDirectory({ id: 'abc123', config: {} })).toBeUndefined();
  });

  test('the header Hermes writes is not output, a failure is named in it, and a long file says it was cut', () => {
    const ok = parseFileOutput({ text: '# Cron Job: Disk check\n\n**Job ID:** abc\n**Run Time:** 2026-10-18 09:00:00\n**Mode:** no_agent (script)\n\n---\n\nall clear\n\n- item\n', truncated: false });
    expect(ok).toEqual({ failed: false, text: 'all clear\n\n- item', truncated: false });
    const failed = parseFileOutput({ text: '# Cron Job: Disk check\n\n**Job ID:** abc\n**Status:** script failed\n\nScript exited with code 3\n', truncated: true });
    expect(failed).toEqual({ failed: true, text: 'Script exited with code 3', truncated: true });
    expect(parseFileOutput(undefined)).toEqual({ failed: false, text: '', truncated: false });
  });
});
