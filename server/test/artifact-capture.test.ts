import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageTag } from '@caduceus/contracts/playbook-runs';
import { createArtifactCapture } from '../src/artifact-capture.ts';
import { createArtifactStore } from '../src/artifacts.ts';
import { openCaduceusStore, type CaduceusStore } from '../src/caduceus-store.ts';
import { createLease } from '../src/playbook-lease.ts';
import type { BoardTask, KanbanPort } from '../src/playbook-kanban.ts';
import { SEED_PLAYBOOKS } from '../src/playbook-seeds.ts';

// The capture worker's single-writer lease (M6 #05; architecture §1): two Caduceus processes on one folder never both keep the files of one finished deliverable.
// The Kanban side is a stub that counts what is downloaded; the store and the lease are the real ones, in a temp folder.
const dirs: string[] = [];
const stores: CaduceusStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const research = SEED_PLAYBOOKS.find((playbook) => playbook.id === 'deep-research')!;

describe('capturing under the lease', () => {
  test('of two workers on one folder, only the one holding the lease keeps the report, and once the first lets go the second takes over without keeping it twice', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-capture-'));
    dirs.push(dir);
    const store = openCaduceusStore(dir);
    stores.push(store);
    const clock = { now: 1_000_000 };
    const artifacts = createArtifactStore({ store, now: () => clock.now });
    const task: BoardTask = { id: 't_final', status: 'done', title: 'Write the report: tides', assignee: null, idempotencyKey: stageTag({ playbook: 'deep-research', version: 1, run: 't_root', stage: 'synthesise', attempt: 1 }), body: null, result: null, blockKind: null, failures: 0, lastFailure: null, createdAt: 1, completedAt: 2 };
    const downloads: number[] = [];
    const kanban = {
      tasks: async () => ({ tasks: [task], latestEvent: 0 }),
      attachments: async () => [{ id: 7, filename: 'report.md', contentType: 'text/markdown', size: 8 }],
      download: async (_board: string, id: number) => (downloads.push(id), new TextEncoder().encode('# Tides\n')),
    } as unknown as KanbanPort;
    const worker = (owner: string) => createArtifactCapture({ kanban, source: { get: () => research }, artifacts, lease: createLease({ file: path.join(store.dir, 'capture.lease'), owner, ttlMs: 30_000, now: () => clock.now }), onFailure: (error) => { throw error; } });
    const a = worker('process-a');
    const b = worker('process-b');

    expect(await Promise.all([a.pass('default'), b.pass('default')])).toEqual([1, 0]);
    expect(downloads).toEqual([7]);
    expect(artifacts.list().artifacts).toMatchObject([{ name: 'report.md', title: 'Tides', source: { type: 'run', id: 't_root', playbook: 'deep-research', taskId: 't_final', label: 'Deep Research' } }]);

    await a.stop();
    expect(await b.pass('default')).toBe(0);
    expect(downloads).toEqual([7]);
    expect(artifacts.list().artifacts).toHaveLength(1);
  });
});
