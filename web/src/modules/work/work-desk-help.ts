import type { ModuleHelp } from '../../help.ts';

export const workDeskHelp: ModuleHelp = {
  pages: [
    {
      id: 'work-overview',
      title: 'Work',
      summary: 'Everything with a lifecycle, by state: waiting on you, running, ready for review and scheduled.',
      route: '/work',
      keywords: 'work overview desk waiting running review scheduled agents filter decide open review pause resume tasks runs schedules',
      body: [
        { p: 'Work puts every Kanban task, every run an agent has going and every schedule in one place, in the group that says what you can do about it now. Each one is in exactly one group. Hermes keeps all of it; Caduceus reads it each time and keeps no copy.' },
        { h: 'The four groups' },
        {
          ul: [
            '[[work-waiting|Waiting on you]]: work that cannot go on until you answer. A task in review, a task that asked a question or that no worker can take, and a run stopped on an approval or a question. The button is Decide.',
            'Running: a worker has a task, or an agent is answering now. The button is Open.',
            '[[work-ready|Ready for review]]: work that finished and that you have not opened yet: a task that reached Done, or a chat that answered. The button is Review. Opening it, by the title or the button, takes it off this list. Work that finished before Caduceus began keeping this, or more than two weeks ago, is not offered.',
            '[[work-scheduled|Scheduled]]: work that has not started and begins by itself. A schedule waiting for its time, a task waiting for a free worker, a task waiting on another task, and a task Hermes will retry. The button on a schedule is Pause, or Resume while it is paused.',
          ],
        },
        { h: 'What a row shows' },
        { p: 'The sigil of the agent, the title, one line on what it is doing or why it waits, and when: when you were asked, when it started, finished or was added, or when a schedule is next due. On a phone the time sits under the title. The title opens the same place as the button. A task nobody is assigned to has an empty mark and shows only under All agents.' },
        { h: 'Filtering by agent' },
        { p: 'The chips under the title narrow every group to one agent. The address holds the choice, so a reload or a link shows the same view. Every group updates as Hermes changes: nothing needs a reload.' },
        { h: 'The other views' },
        { p: 'The chips at the top of the page lead to the Board, Tasks, Playbooks, Schedules and Projects. They show the same work in the shape each one is for: the Board by Hermes’s columns, Tasks as a list with saved filters, Schedules as every cron job. Finished work that is no longer news is in none of the groups here: find it on the Board or in Tasks.' },
        { h: 'Pausing a schedule' },
        { p: 'Pause and Resume ask you to confirm, and then Hermes stops or restarts the job. Its history stays. The schedule’s own page has Run now, Edit and the rest.' },
      ],
      related: ['work-board', 'work-schedules'],
    },
  ],
  glossary: [
    { id: 'work-waiting', term: 'Waiting on you', definition: 'Work that cannot go on until you decide: a task in review, a question or an approval.', page: 'work-overview' },
    { id: 'work-ready', term: 'Ready for review', definition: 'Work that finished and that you have not opened yet.', page: 'work-overview' },
    { id: 'work-scheduled', term: 'Scheduled', definition: 'Work that has not started and begins by itself: a schedule’s next run, or a task waiting for a worker, another task or a retry.', page: 'work-overview' },
  ],
};
