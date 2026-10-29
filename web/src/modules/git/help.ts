import type { ModuleHelp } from '../../help.ts';

export const gitHelp: ModuleHelp = {
  pages: [
    {
      id: 'workspace-git',
      title: 'Git',
      summary: 'See what changed in a repository, stage files, write a commit message (or have one drafted), commit, push, and manage branches and worktrees.',
      route: '/workspace/git',
      keywords: 'git repository status diff stage unstage commit push discard branch switch worktree conflict ai commit message workspace',
      body: [
        { p: 'Git shows the repository behind one of your workspaces (Work › Projects) or the repositories of Hermes’s projects. [[hermes]] runs git on the Mac; Caduceus shows what it answers and keeps no copy of any git state, so the page asks again after every change and when you come back to it.' },
        { h: 'Changes and diffs' },
        {
          ul: [
            'Changes lists the files that are [[git-stage|staged]] and the ones that are not. Press a file to see its diff: one column on a phone, two columns (before and after) on a window 1024 pixels wide or more.',
            'Stage and Unstage move a file in or out of the next commit. They change nothing on disk and need no confirmation.',
            'A folder that is not in a git repository shows why there is nothing to see, with a link to it in Files.',
          ],
        },
        { h: 'Commit and push' },
        {
          ul: [
            'Write a message and press Commit. It commits the staged files, or everything when nothing is staged. A commit asks you to confirm ([[risk-tiers|Tier 1]]).',
            'Write a message with AI sends the diff and the latest commit subjects to Hermes’s model, after you confirm, and puts the answer in the message field. It never commits: you read it, change it and press Commit yourself.',
            'A repository with no remote says No remote at the top and Push is off, with the reason beside it: add a remote in a terminal on the Mac (git remote add origin <url>, then git fetch).',
            'Push sends your commits to the remote. It needs your passkey and the repository’s name typed ([[risk-tiers|Tier 3]]), because other people can see what is pushed.',
            'Caduceus does not fetch or pull: Hermes has no route for them. When a push is rejected because the remote moved on, pull in a terminal on the Mac.',
          ],
        },
        { h: 'Discard' },
        { p: '[[git-discard|Discard]] puts a file back to the last commit, and deletes it if it is new. It needs your passkey and the file’s name typed, and it cannot be undone: neither git nor Caduceus keeps the changes.' },
        { h: 'Branches and worktrees' },
        {
          ul: [
            'Branches lists them. Switch changes the folder to that branch; git refuses when it would overwrite your changes. A branch can also be opened in its own [[worktree|worktree]].',
            'Worktrees lists the extra working folders and adds one on a new branch, which is how you start a new branch here: Hermes has no plain create-branch route.',
            'Removing a worktree is refused while it has changes that are not committed; you can then remove it anyway, which needs your passkey and loses those changes.',
          ],
        },
        { h: 'When git says no' },
        { p: 'A conflict, a sign-in failure or a rejected push is shown in words with what to do next. Read-only mode and being offline stop every change on this page; reading still works.' },
      ],
      related: ['risk-tiers', 'read-only-mode', 'workspace-files'],
    },
  ],
  glossary: [
    {
      id: 'git-stage',
      term: 'Stage',
      definition: 'To choose a changed file for the next commit. A staged file goes into the commit; one that is not staged stays out of it.',
      page: 'workspace-git',
    },
    {
      id: 'worktree',
      term: 'Worktree',
      definition: 'Another working folder of the same repository, on its own branch, so two branches can be open at the same time without switching. Hermes puts them in the repository’s .worktrees folder.',
      page: 'workspace-git',
    },
    {
      id: 'git-discard',
      term: 'Discard',
      definition: 'To throw away uncommitted changes: files go back to the last commit and new files are deleted. Nothing keeps a copy, so it cannot be undone.',
      page: 'workspace-git',
    },
  ],
};
