import { describe, expect, test } from 'vitest';
import { stageTag } from '@caduceus/contracts/playbook-runs';
import { filterTasks, parseBoard, readView, viewSearch } from '../src/modules/work/board-model.ts';
import { matchesPlaybook, playbookLabel, playbookOfTask, playbookOptions, playbookTagText, type PlaybookFields } from '../src/modules/work/task-playbook.ts';
import { selectTasks, sortTasks } from '../src/modules/work/tasks-model.ts';

const tagged = (playbook: string, version: number, stage: string, run = 'root-0123456789ab'): string => stageTag({ playbook, version, run, stage, attempt: 1 });
const fields = (over: Partial<PlaybookFields> = {}): PlaybookFields => ({ workflowTemplateId: null, currentStepKey: null, idempotencyKey: null, ...over });

describe('which playbook a task came from', () => {
  test('the tag in the idempotency key names the playbook, its version and the stage', () => {
    expect(playbookOfTask(fields({ idempotencyKey: tagged('release', 2, 'review') }))).toEqual({ id: 'release', version: 2, stage: 'review', key: 'release@2' });
  });

  test('a task no playbook made, and a key that is not a tag, have none', () => {
    expect(playbookOfTask(fields())).toBeUndefined();
    expect(playbookOfTask(fields({ idempotencyKey: 'my-own-key' }))).toBeUndefined();
  });

  test('the native fields win once Hermes fills them, and an old saved filter on a native id still matches', () => {
    const native = fields({ workflowTemplateId: 'release@3', currentStepKey: 'ship', idempotencyKey: tagged('release', 2, 'review') });
    expect(playbookOfTask(native)).toEqual({ id: 'release', version: 3, stage: 'ship', key: 'release@3' });
    expect(playbookOfTask(fields({ workflowTemplateId: 'release' }))).toEqual({ id: 'release', key: 'release' });
    expect(matchesPlaybook(fields({ workflowTemplateId: 'release' }), 'release')).toBe(true);
    expect(matchesPlaybook(fields({ idempotencyKey: tagged('release', 2, 'build') }), 'release@2')).toBe(true);
    expect(matchesPlaybook(fields({ idempotencyKey: tagged('release', 2, 'build') }), 'release@3')).toBe(false);
  });
});

describe('what the filter shows', () => {
  test('a playbook is labelled by its name and version, or its id when the library does not know it', () => {
    expect(playbookLabel('release@2', { release: 'Release train' })).toBe('Release train v2');
    expect(playbookLabel('release@2')).toBe('release v2');
    expect(playbookLabel('old-id')).toBe('old-id');
  });

  test('the options are the playbooks that have tasks, counted, by name; versions of one playbook are separate', () => {
    const tasks = [
      fields({ idempotencyKey: tagged('release', 2, 'build') }),
      fields({ idempotencyKey: tagged('release', 2, 'review') }),
      fields({ idempotencyKey: tagged('release', 1, 'build', 'T1') }),
      fields({ workflowTemplateId: 'audit@1' }),
      fields(),
    ];
    expect(playbookOptions(tasks, { release: 'Release train' })).toEqual([
      { value: 'audit@1', label: 'audit v1', count: 1 },
      { value: 'release@1', label: 'Release train v1', count: 1 },
      { value: 'release@2', label: 'Release train v2', count: 2 },
    ]);
    expect(playbookOptions([fields()])).toEqual([]);
  });

  test('the tag on a card says Playbook and the stage', () => {
    expect(playbookTagText(fields({ idempotencyKey: tagged('release', 2, 'review') }))).toBe('Playbook · review');
    expect(playbookTagText(fields({ workflowTemplateId: 'release@2' }))).toBe('Playbook');
    expect(playbookTagText(fields())).toBeUndefined();
  });
});

describe('the board and the task list filter by playbook', () => {
  const board = parseBoard({
    columns: [
      {
        name: 'ready',
        tasks: [
          { id: 'a', title: 'Build', idempotency_key: tagged('release', 2, 'build') },
          { id: 'b', title: 'Plain' },
          { id: 'c', title: 'Native', workflow_template_id: 'audit@1', current_step_key: 'scan' },
        ],
      },
    ],
  });

  test('the board reads the tag fields from a task, null when they are absent', () => {
    expect(board.tasks.map((task) => [task.id, task.idempotencyKey === null ? null : 'tag', task.currentStepKey])).toEqual([['a', 'tag', null], ['b', null, null], ['c', null, 'scan']]);
  });

  test('both filters select the tasks of one playbook version, from the tag or from the native field', () => {
    expect(filterTasks(board.tasks, { playbook: 'release@2' }).map((task) => task.id)).toEqual(['a']);
    expect(selectTasks(board.tasks, { playbook: 'audit@1' }).map((task) => task.id)).toEqual(['c']);
    expect(selectTasks(board.tasks, { playbook: 'release@9' })).toEqual([]);
  });

  test('the board keeps the filter in its address, and an address without it reads as before', () => {
    expect(readView({ playbook: 'release@2', assignee: 'coder' }).filters).toEqual({ assignee: 'coder', playbook: 'release@2' });
    expect(viewSearch({ lanes: 'status', filters: { playbook: 'release@2' } })).toEqual({ playbook: 'release@2' });
    expect(readView({ project: 'p1' }).filters).toEqual({ project: 'p1' });
  });

  test('the Playbook column sorts by the playbook, with a task that has none last', () => {
    const ordered = sortTasks(board.tasks, { column: 'template', direction: 'asc' }).map((task) => task.id);
    expect(ordered).toEqual(['c', 'a', 'b']);
  });
});
