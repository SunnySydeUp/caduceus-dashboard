import type { ModuleHelp } from '../../help.ts';

export const insightsHelp: ModuleHelp = {
  pages: [
    {
      id: 'insights',
      title: 'Insights and budgets',
      summary: 'What your agents used and cost, by model, source and profile, and the spending limits you set.',
      route: '/observe/insights',
      keywords: 'usage tokens cost analytics charts heatmap hours skills quota provider limits budget spend alert',
      body: [
        { p: 'Insights turns the usage that [[hermes]] keeps into charts. Caduceus asks Hermes again whenever the period changes or sessions start or stop, and keeps none of it. The numbers are Hermes’s own.' },
        { h: 'The period' },
        { p: 'Pick 7, 30, 90 or 365 days, or type any number from 1 to 365. On a phone the period is in a sheet. Days are counted in UTC, as Hermes counts them, so “today” may begin at an odd hour for you.' },
        { h: 'Tokens and cost' },
        { p: 'The cards show tokens in and out, [[cache-tokens|cache tokens]], reasoning tokens and [[cost|cost]]. Both the estimate and the provider’s bill are shown where Hermes has them. The stock dashboard hides the estimate when a bill exists.' },
        { h: 'The charts' },
        {
          ul: [
            'Per day: tokens or cost for each day of the period.',
            'By model, by profile and by source: where the tokens and money went. Source is where a session started, such as the terminal, Telegram or Caduceus.',
            'Activity: one cell per day, darker for more sessions.',
            'Hour of day: when sessions start, on this device’s clock.',
            'Top skills: the skills agents loaded or edited most.',
          ],
        },
        { p: 'Every chart has a table with the same numbers. Open “Show … as a table” under the chart. Sources and hours come from the session list, so with a very long period they describe the newest sessions, and the chart says so.' },
        { h: 'Provider quota' },
        { p: 'The quota card shows the limits some providers report for your account, such as a session or weekly window, and when each resets. Caduceus opens a session without sending a prompt to ask Hermes, and closes it. A provider that reports no limits shows “Not available”.' },
        { h: 'Budgets' },
        { p: 'A [[budget|budget]] is an amount of money for a day, a week or a month, for every profile or for one. The bar shows what is spent so far and the [[spend-pace|spend pace]]: what the period comes to if you go on as you have. Making, changing or deleting a budget is a Tier 1 action ([[risk-tiers|risk tiers]]) that you confirm.' },
        { p: 'When spending reaches 80% and again at 100%, a notice goes to Control › Notices and, if you allow Budget notifications in Settings, a push is sent. Each happens once per period. The 100% alert is also when the [[budget-guard|budget guard]] acts, below.' },
        { h: 'Budget guard' },
        { p: 'At 100% of a budget the [[budget-guard|budget guard]] stops [[unattended-work|unattended work]]: Hermes’s Kanban dispatcher stops claiming tasks, and every scheduled job is paused except the ones you exempt on their Schedules page. Chats and their tool runs are never paused. It also raises one notice, with a push, with Open spend, Raise budget and Undo guard actions.' },
        {
          ul: [
            'The section shows the guard as Armed, Tripped or Off, when it last looked at spending, and how far spending can run past a budget before it acts: it reads spend at a set interval, so the overshoot is that interval times the rate you are spending at. Workers already running finish.',
            'It records only what it paused itself. Undo guard actions resumes exactly that and asks you first, naming what will resume. Anything you changed since (a job you resumed or paused again, a claim list you edited) is left alone and listed as left alone.',
            'If you allow it, the guard lifts its own pauses when a new budget period starts. Otherwise you undo them.',
            'After you undo, the same budget in the same period does not trip again. Raising the budget, or a new period, arms it again.',
            'Turning the guard off needs your passkey ([[risk-tiers|Tier 2]]). Pauses it already made stay until you undo them.',
          ],
        },
      ],
      related: ['today', 'settings-notifications', 'notices', 'risk-tiers'],
    },
  ],
  glossary: [
    {
      id: 'cost',
      term: 'Cost',
      definition: 'What usage cost in US dollars. Hermes gives the provider’s bill when the provider reports one and its own estimate from a price table otherwise. Models on your own machine cost nothing.',
      page: 'insights',
    },
    {
      id: 'cache-tokens',
      term: 'Cache tokens',
      definition: 'Tokens of a prompt that the provider had already seen and read from its cache instead of processing again. They are cheaper and faster, so a high share is good.',
      page: 'insights',
    },
    {
      id: 'budget',
      term: 'Budget',
      definition: 'A spending limit Caduceus keeps for a day, week or month, for every profile or one. It tells you at 80% and 100%, and at 100% the budget guard stops unattended work.',
      page: 'insights',
    },
    {
      id: 'spend-pace',
      term: 'Spend pace',
      definition: 'Where this period’s spending is heading: what it will come to by the end if you go on at the rate so far.',
      page: 'insights',
    },
    {
      id: 'budget-guard',
      term: 'Budget guard',
      definition: 'The Caduceus worker that stops unattended work when a budget is used up: the Kanban dispatcher stops claiming tasks and scheduled jobs are paused, except the ones you exempt. It records what it paused and undoes only that.',
      page: 'insights',
    },
    {
      id: 'unattended-work',
      term: 'Unattended work',
      definition: 'Work that runs without you in front of it: Kanban dispatcher runs and scheduled jobs. A chat you are in, and the tools it runs, are never unattended.',
      page: 'insights',
    },
  ],
};
