import type { ModuleHelp } from '../../help.ts';

export const noticesHelp: ModuleHelp = {
  pages: [
    {
      id: 'notices',
      title: 'Notices',
      summary: 'What failed or needs a look, from every profile, and the runs that finished.',
      route: '/notices',
      keywords: 'notices inbox failed fyi job failed overdue gateway down provider key update waiting pairing snooze dismiss activity finished runs category filter notification link',
      body: [
        { p: 'Notices are the things Hermes and Caduceus tell you that are not a question for you. Each one is a [[notice]]. The ones that need an answer, such as a command to approve, a question from an agent or a task to review, are on Today and in the Talk tray instead. Notices is in Control, in the Main group.' },
        { h: 'What is here' },
        {
          ul: [
            'Failed: a scheduled job whose last run failed or that is overdue, a gateway that is down, a missing provider key, resource pressure, a budget that was reached, a playbook run that stopped, and a task that [[gave-up|gave up]]. A task that gave up has Retry, which sends it back to Ready, and Reassign, which hands it to another profile.',
            'FYI: a Hermes update that is waiting, and other news that needs no answer.',
            'Each card has the one or two things you can do at once, such as Run now or Pause a job, or Restart a stuck gateway. They name the job or profile in their confirmation. Details shows the whole notice and where to look next.',
            'The category chips and the profile chip filter the list. The category stays in the address, so a filtered view can be bookmarked.',
          ],
        },
        { h: 'Putting a notice aside' },
        { p: 'A [[snooze|snooze]] hides a notice on this device until a time you pick: an hour, tonight, tomorrow, or a time of your own. Dismiss hides one until the thing it is about happens again. Both are kept for this device only. Hermes is untouched. A snoozed item is listed under the list, so you can bring it back. On a phone, swipe right to dismiss and left to snooze. The ⋮ button does the same, and a toast offers Undo.' },
        { h: 'Activity' },
        { p: 'The [[activity-feed|Activity]] view lists the runs that finished while Caduceus was watching, newest first, and a toast tells you when one finishes while you are looking. Each device remembers what it has seen, and the number on the Activity chip is what is new.' },
        { h: 'It keeps itself right' },
        { p: 'Nothing here is saved. The list is what Hermes and Caduceus report now. When the job runs well again, or the gateway is back, the notice goes by itself.' },
        { h: 'Keyboard' },
        { p: 'j and k (or the arrow keys) move through the list. On a wide screen the notice opens beside the list.' },
      ],
      related: ['today', 'health', 'work-schedules', 'profile-scope'],
    },
    {
      id: 'notice-item',
      title: 'A notice',
      summary: 'One notice, opened straight from a link or a notification.',
      route: '/notices/:itemId',
      keywords: 'notice link notification deep link gone closed',
      body: [
        { p: 'This is one [[notice]] opened by its own link, which is how a notification brings you here. It works as it does in the list: see the Notices page for what each button does.' },
        { p: 'If the notice is gone, the page says so. That is not an error: the thing it was about is over, or you put it aside. Nothing is lost.' },
      ],
      related: ['notices'],
    },
  ],
  glossary: [
    {
      id: 'notice',
      term: 'Notice',
      definition: 'Something Hermes or Caduceus says that is not a question for you: a job that failed, a gateway that is down, an update that is waiting. It is worked out from what they report, never stored, so it lasts exactly as long as that is true.',
      page: 'notices',
    },
    {
      id: 'gave-up',
      term: 'Gave up',
      definition: 'A Kanban task that Hermes stopped retrying after its attempts failed. Retry sends it back to Ready; Reassign gives it to another profile.',
      page: 'notices',
    },
    {
      id: 'snooze',
      term: 'Snooze',
      definition: 'Hiding a notice on this device until a time you pick. It is kept per device, nothing changes in Hermes, and the notice comes back by itself, or at once if the thing it is about changes again.',
      page: 'notices',
    },
    {
      id: 'activity-feed',
      term: 'Activity feed',
      definition: 'The list of chat runs that finished while Caduceus was watching, newest first. Each device remembers the last one it has seen, so it can tell you how many are new.',
      page: 'notices',
    },
  ],
};
