// Capturing deliverables into the Artifacts store (M6 #05): when the task of a playbook stage marked `deliverable` is done, the files attached to it are kept as
// artifacts that name the run, the stage's task and the playbook. Nothing of the task itself is copied. The playbook engine tells this worker after each pass over a
// board (a Kanban event or the sweep); it reads the board's done deliverable tasks, asks Hermes for their attachments and keeps the ones it has not kept (or the
// owner has not deleted: `ArtifactStore.knows`). Under its own single-writer lease, so two Caduceus processes never both keep a file.
import { isRootNonce, parseStageTag } from '@caduceus/contracts/playbook-runs';
import type { ArtifactStore } from './artifacts.ts';
import type { PlaybookSource } from './playbook-engine.ts';
import type { Lease } from './playbook-lease.ts';
import type { KanbanPort } from './playbook-kanban.ts';

export interface ArtifactCapture {
  /** Keeps what a board's finished deliverable tasks have attached. Resolves with how many files it kept. Passes run one after another. */
  pass(board: string): Promise<number>;
  /** Lets a pass under way finish and gives the lease up, so the next process to start captures at once. */
  stop(): Promise<void>;
}

export function createArtifactCapture({ kanban, source, artifacts, lease, onFailure }: { kanban: KanbanPort; source: PlaybookSource; artifacts: ArtifactStore; lease: Lease; onFailure(error: Error): void }): ArtifactCapture {
  /** Done deliverable tasks whose files are all kept. Memory only: a restart asks Hermes once more, and `knows` keeps it from keeping anything twice. */
  const finished = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();

  async function read(board: string): Promise<number> {
    if (!lease.acquire()) return 0;
    let kept = 0;
    const { tasks } = await kanban.tasks(board);
    for (const task of tasks) {
      const tag = parseStageTag(task.idempotencyKey);
      if (tag === undefined || task.status !== 'done' || finished.has(`${board}:${task.id}`)) continue;
      const playbook = source.get(tag.playbook, tag.version);
      if (playbook?.stages.find((stage) => stage.key === tag.stage)?.deliverable !== true) continue;
      const root = isRootNonce(tag.run) ? task.id : tag.run;
      for (const attachment of await kanban.attachments(board, task.id)) {
        const origin = `kanban:${board}:${attachment.id}`;
        if (artifacts.knows(origin) !== undefined) continue;
        const bytes = await kanban.download(board, attachment.id);
        if (bytes === undefined) continue;
        if (artifacts.add({ name: attachment.filename, bytes, mime: attachment.contentType, origin, source: { type: 'run', id: root, board, playbook: playbook.id, taskId: task.id, label: playbook.name } }) !== undefined) kept += 1;
      }
      finished.add(`${board}:${task.id}`);
    }
    return kept;
  }

  return {
    pass(board) {
      const result = tail.then(() => read(board)).catch((error: unknown) => {
        onFailure(error instanceof Error ? error : new Error(String(error)));
        return 0;
      });
      tail = result;
      return result;
    },
    async stop() {
      await tail;
      lease.release();
    },
  };
}
