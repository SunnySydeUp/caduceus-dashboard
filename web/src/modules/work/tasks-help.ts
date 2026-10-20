import type { ModuleHelp } from '../../help.ts';

export const tasksHelp: ModuleHelp = {
  pages: [
    {
      id: 'work-tasks',
      title: 'Tasks',
      summary: 'Every task on the board in one list you can sort and filter.',
      route: '/work/tasks',
      keywords: 'work tasks list table cards filter saved mine waiting failed playbook project search sort live',
      body: [
        { p: 'Tasks is the Hermes [[board]] as a list. On a wide screen it is a table with a column for the title, status, assignee, priority, project, playbook, when it last changed and how its last [[kanban-run|run]] ended. On a phone every row becomes a card with its status, its assignee and its age. A row opens the task.' },
        { h: 'Sorting' },
        {
          ul: [
            'Press a column heading to sort by it, and press it again to turn the order round. A heading works from the keyboard like any button.',
            'On a phone a Sort menu and an order button above the list do the same.',
            'Updated is when something last happened to the task: it was made, a worker started it or kept going, or it finished.',
          ],
        },
        { h: 'Saved filters' },
        { p: 'The chips above the list are [[saved-filter|saved filters]]. They read the tasks Hermes holds; they never copy them.' },
        {
          ul: [
            'Mine: the tasks assigned to the profile you are working as.',
            '[[waiting-for-me|Waiting for me]]: tasks in review, and blocked tasks that asked a question.',
            'Failed: tasks whose latest run failed, or that Hermes gave up on after repeated failures. A task that finishes leaves this list.',
            'By playbook: the tasks that came from one [[playbook-run|playbook run]], listed as the playbook’s name and version. Caduceus finds them from the tag its [[playbook-engine|engine]] puts on each stage’s task, and a task Hermes marks as a playbook’s own is found too. The Playbook column shows each task’s playbook and stage.',
            'By project: the tasks of one Hermes project.',
          ],
        },
        { p: 'The number on a chip is how many tasks it holds on the whole board. Hermes can narrow only by tenant, so while a tenant is chosen the other chips show no number.' },
        { h: 'Your own filters' },
        {
          ul: [
            'Choose a filter, or type in the search box, and Save filter appears. Give it a name and it joins the chips.',
            'Choose one of your filters to Rename it or Delete it. A deleted filter can be brought back for a few seconds.',
            'A saved filter is only its conditions, such as “assigned to coder and failed”. Caduceus keeps those, and nothing else about your tasks.',
          ],
        },
        { h: 'Links and live updates' },
        { p: 'The address holds the filter, the sort and the search words. A reload, the Back and Forward buttons, a bookmark or a link from Today or Notices open the same view. For example, /work/tasks?filter=waiting is the list of what waits for you.' },
        { p: 'The list follows Hermes through a live connection. A task that arrives, changes status or leaves appears or goes at once, and it respects the filter that is on. If Hermes does not answer, the page says so and tries again by itself.' },
        { h: 'A long list' },
        { p: 'Only the rows near the screen are drawn, so a board with thousands of tasks stays quick to scroll and to search.' },
      ],
      related: ['work-board', 'work-task'],
    },
    {
      id: 'work-brief',
      title: 'New task',
      summary: 'Write a task as a Brief, and queue it, run it now, save it as a draft or schedule it.',
      route: '/work/tasks/new',
      keywords: 'new task create brief editor goal context references constraints expected output scope safety dispatch mode draft queue run now schedule model reasoning skills workspace worktree branch project retries time limit goal mode completion contract attachments toolsets duplicate chat make this a task',
      body: [
        { p: 'The [[brief]] is the guided editor for a [[task]]. What you write in its sections becomes plain Markdown headings in the task’s body, which a worker reads as it is. Open Preview to see exactly that text.' },
        { h: 'The sections' },
        {
          ul: [
            'Goal: what done looks like. Context: what the worker should know first. References: links and files to read. Constraints: limits and rules. Expected output: what comes back. Scope and safety: what the worker may touch and what it must ask about first.',
            'A section you leave empty is not written. A body that is not made of these sections (a worker or the command line wrote it) opens as one free text, kept exactly as it is.',
          ],
        },
        { h: 'The settings' },
        {
          ul: [
            'Assign to: the profile whose worker does the task. Its model, skills and toolsets are the ones that count.',
            'Model and reasoning effort: pin the worker to a model from Hermes’s catalogue, and say how hard it thinks. Empty uses the profile’s own.',
            'Skills, time limit and retries: skills the worker loads first, how long a run may take before Hermes stops it and queues the task again, and how many failures in a row block it.',
            'Workspace: a fresh scratch folder, a folder on this Mac (pick it with Browse; Hermes checks that it exists), or a git worktree with an optional branch from the repository’s own branches and an optional project. Your [[workspace|workspaces]] from Work › Projects are offered above the folder: tap one to fill it in.',
            'Done when: [[goal-mode|goal mode]] keeps the worker going until a judge agrees the task is done, and a [[completion-contract|completion contract]] makes a pull request and its checks the finish line.',
            'Attachments: files you choose are attached once the task exists. Waits for tasks lists tasks that must be done first.',
            'Tools: Hermes keeps toolsets per profile and cannot set them per task, so the page shows the assignee’s, read only, with a link to edit them on the profile.',
          ],
        },
        { h: 'How it starts' },
        { p: 'The four [[dispatch-mode|dispatch modes]] decide what Hermes does with the task: Save draft, Queue, Run now and Schedule. Each one asks you to confirm once, because it changes Hermes.' },
        { h: 'On a phone' },
        { p: 'The editor fills the screen, each group folds away, and the Save button stays above the keyboard. If you leave with something unsaved, you are asked first.' },
        { h: 'From a chat, or a copy' },
        { p: 'Make this a task on a chat message, or on the whole chat, opens this page with Goal and Context filled from the conversation and a reference to the chat session. Duplicate with changes on a task opens it with that task’s settings, for the ones Hermes cannot change after a task is made.' },
        { h: 'From a template' },
        { p: 'At the top of the page, pick a category and a [[template]] card. If the template has questions it asks them first, then fills the Brief for you. Nothing is sent to Hermes until you choose how the task starts. Save as template on any task makes a new template from its brief and settings.' },
      ],
      related: ['work-task', 'work-task-edit', 'work-board', 'work-playbooks', 'read-only-mode'],
    },
  ],
  glossary: [
    {
      id: 'saved-filter',
      term: 'Saved filter',
      definition: 'A named view of the task list: only the conditions a task must meet, such as assigned to coder and failed. The tasks always come from Hermes. Caduceus stores the filter, not the tasks.',
      page: 'work-tasks',
    },
    {
      id: 'waiting-for-me',
      term: 'Waiting for me',
      definition: 'Tasks that need your answer: a worker finished and asked for a review, or a blocked task asked you a question.',
      page: 'work-tasks',
    },
    {
      id: 'brief',
      term: 'Brief',
      definition: 'The guided editor for a task. Its sections (Goal, Context, References, Constraints, Expected output, Scope and safety) are written into the task body as plain Markdown headings, which a worker reads as they are.',
      page: 'work-brief',
    },
    {
      id: 'dispatch-mode',
      term: 'Dispatch mode',
      definition: 'What happens to a new task. Save draft keeps it in Triage or Todo. Queue makes it Ready for the dispatcher. Run now makes it Ready and nudges the dispatcher to start a worker at once. Schedule makes a Create-task job that puts the task on the board once or on a timer.',
      page: 'work-brief',
    },
    {
      id: 'goal-mode',
      term: 'Goal mode',
      definition: 'A worker that keeps going: after each turn a judge checks the reply against the task, and the worker carries on in the same session until the judge agrees or the turns run out, which blocks the task for review.',
      page: 'work-brief',
    },
    {
      id: 'completion-contract',
      term: 'Completion contract',
      definition: 'How a task proves it is done. local-only is the default. OWNER/REPO, or the exact URL of a GitHub pull request, makes the task done only when its pull request’s required checks pass.',
      page: 'work-brief',
    },
  ],
};
