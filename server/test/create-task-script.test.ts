import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskScript, readCreateTaskScript, scriptFileName, type TaskFields } from '../../web/src/modules/work/create-task-script.ts';
import { CREATE_TASK_SCRIPT_PREFIX } from '../../web/src/modules/work/schedules-model.ts';

// The script a Create-task job runs, as bash runs it. A stand-in `hermes` on the PATH writes down exactly the arguments and the standard
// input it was called with, so what Hermes's own CLI would receive is checked byte for byte, whatever the owner typed. Real Hermes runs the
// script in schedule-builder-hermes.test.ts.
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-script-'));
  fs.writeFileSync(path.join(dir, 'hermes'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\0" "$a"; done > "$CALLED/args"\ncat > "$CALLED/stdin"\necho "Created task t_abc123"\n', { mode: 0o755 });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const blank: TaskFields = { title: 'Weekly review', brief: '', assignee: '', triage: false, skills: [], model: '', workspace: { kind: 'scratch' } };

function run(fields: TaskFields, env: Record<string, string> = {}) {
  const file = path.join(dir, 'job.sh');
  fs.writeFileSync(file, createTaskScript(fields));
  const result = spawnSync('bash', [file], { encoding: 'utf8', env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, CALLED: dir, ...env } });
  const args = fs.existsSync(path.join(dir, 'args')) ? fs.readFileSync(path.join(dir, 'args'), 'utf8').split('\0').slice(0, -1) : undefined;
  const stdin = fs.existsSync(path.join(dir, 'stdin')) ? fs.readFileSync(path.join(dir, 'stdin'), 'utf8') : undefined;
  return { ...result, args, stdin };
}

describe('the script of a Create-task job', () => {
  test('calls `hermes kanban create` with the fields, and nothing else', () => {
    const fields: TaskFields = {
      title: 'Review the week',
      brief: '## Goal\nSummarise what shipped.',
      assignee: 'coder',
      triage: false,
      priority: 2,
      skills: ['github-code-review', 'translation'],
      model: 'gpt-5',
      workspace: { kind: 'dir', path: '/Users/me/work/site' },
      maxRuntime: '2h',
      maxRetries: 3,
    };

    const { status, args, stdin, stdout } = run(fields);

    expect(status).toBe(0);
    expect(args).toEqual([
      'kanban', 'create', 'Review the week',
      '--assignee', 'coder',
      '--priority', '2',
      '--workspace', 'dir:/Users/me/work/site',
      '--max-runtime', '2h',
      '--max-retries', '3',
      '--model', 'gpt-5',
      '--skill', 'github-code-review',
      '--skill', 'translation',
      '--created-by', 'caduceus-schedule',
      '--body-file', '-',
    ]);
    expect(stdin).toBe('## Goal\nSummarise what shipped.');
    // What Hermes prints is the job's output.
    expect(stdout).toBe('Created task t_abc123\n');
  });

  test('the Brief’s other fields (provider, project, goal loop, completion contract) are flags of the same command, and read back', () => {
    const fields: TaskFields = {
      ...blank,
      model: 'gpt-5',
      provider: 'openai',
      workspace: { kind: 'worktree', branch: 'wt/export' },
      project: 'site',
      goalMode: true,
      goalMaxTurns: 9,
      completionContract: 'acme/widgets',
    };

    const { args } = run(fields);

    expect(args).toEqual(['kanban', 'create', 'Weekly review', '--workspace', 'worktree', '--branch', 'wt/export', '--project', 'site', '--model', 'gpt-5', '--provider', 'openai', '--completion-contract', 'acme/widgets', '--goal', '--goal-max-turns', '9', '--created-by', 'caduceus-schedule']);
    expect(readCreateTaskScript(createTaskScript(fields))).toEqual(fields);
  });

  test('a title and a brief full of quotes, dollars and backticks reach Hermes as they were typed', () => {
    const title = `Don't "quote" me: $HOME \`date\` $(whoami) \\n ; rm -rf /`;
    const brief = `echo $PATH\n'single' "double" \`tick\`\nCADUCEUS_BRIEF\nEOF\n\n  indented\n`;

    const { args, stdin } = run({ ...blank, title, brief });

    expect(args?.[2]).toBe(title);
    expect(stdin).toBe(brief);
  });

  test('a task with no brief sends no body, and a draft goes to triage', () => {
    const { args, stdin } = run({ ...blank, triage: true });

    expect(args).toEqual(['kanban', 'create', 'Weekly review', '--triage', '--created-by', 'caduceus-schedule']);
    expect(stdin).toBe('');
  });

  test('the fields come back out of the script for the editor', () => {
    const fields: TaskFields = { ...blank, title: 'Quarterly “plan”', brief: 'Line 1\nLine 2', assignee: 'coder', skills: ['a'], priority: 1, workspace: { kind: 'worktree', path: '/r', branch: 'wt/x' }, maxRuntime: '30m', maxRetries: 1 };

    expect(readCreateTaskScript(createTaskScript(fields))).toEqual(fields);
    expect(readCreateTaskScript('#!/bin/sh\nhermes kanban create "x"\n')).toBeUndefined();
  });

  test('says so, and fails, when Hermes is not installed where the job runs', () => {
    const { status, stderr } = run(blank, { PATH: '/usr/bin:/bin' });

    expect(status).toBe(127);
    expect(stderr).toContain('hermes was not found');
  });
});

describe('the script file name', () => {
  test('carries the prefix the list recognises, a readable name, and something that keeps two jobs apart', () => {
    const name = scriptFileName('Weekly “review” of the Q3 plan — résumé!', 'a1b2c3');

    expect(name).toBe(`${CREATE_TASK_SCRIPT_PREFIX}weekly-review-of-the-q3-plan-r-sum-a1b2c3.sh`);
    expect(scriptFileName('!!!', 'ff00ff')).toBe(`${CREATE_TASK_SCRIPT_PREFIX}ff00ff.sh`);
  });
});
