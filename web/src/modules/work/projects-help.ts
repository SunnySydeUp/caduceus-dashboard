import type { ModuleHelp } from '../../help.ts';

export const projectsHelp: ModuleHelp = {
  pages: [
    {
      id: 'work-projects',
      title: 'Projects and workspaces',
      summary: 'Hermes’s projects across profiles, discovering repositories, and your list of workspaces.',
      route: '/work/projects',
      keywords: 'work projects project workspace workspaces spaces folder repo repository repos discover tree active rename create registry add remove reorder allowed roots files untouched',
      body: [
        { p: 'A [[project]] is a named set of folders that Hermes groups sessions and Kanban boards by. Hermes keeps projects and builds this tree from the sessions of every profile, so the page shows what Hermes has and keeps nothing of its own.' },
        { h: 'The tree' },
        {
          ul: [
            'Projects you made come first, then the repositories Hermes found by looking at the folders your sessions worked in. Nobody made those: they cannot be renamed.',
            'On a wide window each project shows its repositories under it. On a phone, tap a project to open its page, where they are listed.',
            'New project makes a project of a name and a folder. Rename and Make active work on the projects of the profile in use. Each asks you to confirm, because it changes Hermes.',
            'Hermes builds the tree from each profile’s sessions, so a profile that has none shows no projects here yet.',
          ],
        },
        { h: 'Discover repos' },
        {
          ul: [
            'Discover repos lists the repositories Hermes knows: those your sessions worked in, and those in the folders its desktop.repo_scan_roots setting names (empty unless you set it).',
            'Look in a folder checks the folders directly inside one you choose, and adds the repositories among them to the list.',
            'Tick the ones you want and choose Add: Hermes makes a project of each, named after its folder. A repository that is already a project cannot be ticked.',
          ],
        },
        { h: 'Workspaces' },
        {
          ul: [
            'A [[workspace]] is a folder you give a name here. The composer’s workspace chip and the Brief editor’s Workspace field offer your workspaces, in the order of this list.',
            'Add workspace checks that the folder is inside the folders Caduceus lets Hermes work in and that Hermes can see it. You confirm adding one: a file Hermes’s file tools write inside a workspace needs only a confirmation, not a passkey.',
            'Rename changes the name only. Move up and Move down (or drag) change the order. Remove forgets the name: the folder and its files are never touched.',
          ],
        },
        { p: 'Caduceus keeps only the workspace list, in its own store. Projects, repositories, branches and documents are read from Hermes each time.' },
      ],
      related: ['work-project', 'work-brief'],
    },
    {
      id: 'work-project',
      title: 'A project',
      summary: 'The repository’s branch and status, recent commits, README and docs, and the boards and tasks linked to the project.',
      route: '/work/projects/:projectId',
      keywords: 'project overview repository repo git branch ahead behind changed files dirty commits readme docs markdown preview boards tasks linked',
      body: [
        { p: 'This page reads a [[project]]’s repository from Hermes and changes nothing.' },
        {
          ul: [
            'Repository shows the folder, its branch, how many commits it is ahead of or behind its upstream, and how many files have changes. A project with several folders has a chooser.',
            'Recent commits are the subjects of the latest commits. Hermes gives the ten most recent and no more.',
            'Documents lists the README and the Markdown files in the docs folder. Choose one to read it, drawn as Markdown.',
            'Boards and tasks lists the Kanban boards Hermes links to the project and the tasks that name it. Open one to go to its Work screen. A repository Hermes only found has none: make it a project with Discover repos.',
          ],
        },
      ],
      related: ['work-projects', 'work-board'],
    },
  ],
  glossary: [
    {
      id: 'project',
      term: 'Project',
      definition: 'A named set of folders in Hermes. Sessions are grouped by the project whose folder they work in, and a Kanban board can be linked to one. Hermes keeps projects; Caduceus only reads and changes them through Hermes.',
      page: 'work-projects',
    },
    {
      id: 'workspace',
      term: 'Workspace',
      definition: 'A folder you named in Caduceus. The composer’s workspace chip and the Brief editor offer your workspaces in the order you set. Removing one never deletes the folder.',
      page: 'work-projects',
    },
  ],
};
