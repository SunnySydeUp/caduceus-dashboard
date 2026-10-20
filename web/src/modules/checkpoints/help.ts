import type { ModuleHelp } from '../../help.ts';

export const checkpointsHelp: ModuleHelp = {
  pages: [
    {
      id: 'workspace-checkpoints',
      title: 'Checkpoints',
      summary: 'See the snapshots the agent took of a workspace, compare one with the files now, and restore it.',
      route: '/workspace/checkpoints',
      keywords: 'checkpoints checkpoint snapshot rollback restore diff undo agent workspace storage prune',
      body: [
        { p: 'Before an agent changes files in a turn, [[hermes]] can take a [[checkpoint|checkpoint]] of the workspace. This page lists them for the workspace you pick, newest first. Hermes keeps them; Caduceus only shows what Hermes lists.' },
        { p: 'Caduceus turns checkpoints on for the Hermes it runs. If you started Hermes yourself, set HERMES_TUI_CHECKPOINTS=1 in its environment.' },
        { h: 'Reading and comparing' },
        {
          ul: [
            'Hermes can only read checkpoints through a live session on the workspace, so Caduceus attaches one through Hermes when you open the page. No message is sent and no file is touched, and the session is closed when you leave.',
            'Press a checkpoint to see what differs between it and the files now: one column on a phone, two columns on a window 1024 pixels wide or more. Hermes cuts the diff at 4000 characters.',
            'The size shown is the whole checkpoint store. Pruning old checkpoints is done in System › Maintenance, not here.',
          ],
        },
        { h: 'Restore' },
        { p: '[[checkpoint-restore|Restore]] puts the workspace back as it was at that checkpoint: files changed since are overwritten and files created since are removed. It is a Tier 3 action ([[risk-tiers|risk tiers]]): your passkey and the workspace’s name typed. Only restoring another checkpoint can reverse it. It is blocked in [[read-only-mode|read-only mode]] and while you are offline, and Caduceus records it.' },
      ],
      related: ['risk-tiers', 'read-only-mode', 'workspace-git'],
    },
  ],
  glossary: [
    { id: 'checkpoint', term: 'Checkpoint', definition: 'A snapshot of a workspace that Hermes’s agent takes before it changes files in a turn, kept in a shared store so the workspace can be compared with it or put back.', page: 'workspace-checkpoints' },
    { id: 'checkpoint-restore', term: 'Restore', definition: 'To put a workspace’s files back as they were at a checkpoint. Newer changes are overwritten and newer files removed; only another checkpoint can undo it.', page: 'workspace-checkpoints' },
  ],
};
