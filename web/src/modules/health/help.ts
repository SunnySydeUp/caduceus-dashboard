import type { ModuleHelp } from '../../help.ts';

export const healthHelp: ModuleHelp = {
  pages: [
    {
      id: 'health',
      title: 'Health and Repairs',
      summary: 'Is everything Hermes needs running? What is wrong, and how to fix it.',
      route: '/observe/health',
      keywords: 'status problems fix restart subsystems check now pressure memory disk egress recurring errors',
      body: [
        { p: 'Health checks the parts that [[hermes]] depends on and lists what needs attention. It asks again every time it looks and keeps no copy of what Hermes says.' },
        { h: 'Repairs' },
        { p: 'A [[repairs|Repair]] is a problem Caduceus found, with its cause. The worst come first: Critical, then Warning, then Info. When nothing is wrong the panel says Nothing to repair.' },
        { p: 'Some Repairs have a fix button, such as Restart Hermes backend. A fix is a Tier 2 action ([[risk-tiers|risk tiers]]): you confirm in a dialog, then with a [[passkey|passkey]] ([[step-up|step-up]]), and Caduceus records it. This one is allowed even while [[read-only-mode|read-only mode]] is on.' },
        { h: 'Failures that come back' },
        { p: 'A Repair that goes away and then returns within a day is flagged as a [[recurring-failure|recurring failure]], with how many separate times it has appeared. A problem that simply stays is one failure, however long it lasts. A flag points at a cause that fixing the symptom does not remove, such as a platform that keeps dropping or a Hermes that keeps crashing. Caduceus remembers only when each Repair appeared, and forgets it when Caduceus restarts.' },
        { h: 'Subsystems' },
        {
          ul: [
            'Caduceus server: this app’s own server.',
            'Hermes backend: the private Hermes that Caduceus runs and talks to. It is checked against its own health check, against who answers on its port (it must be the headless server Caduceus started), and against its own component report (its session database and web server).',
            'Messaging gateway: the [[gateway|gateway]] that connects Hermes to chat platforms.',
            'Cron scheduler: runs Hermes’s scheduled jobs.',
            'Kanban dispatcher: hands tasks to workers.',
            'Work in progress: whether Hermes is idle, busy with chats, jobs or subagents, or waiting for you. Busy is not a fault. If Hermes cannot tell, treat it as busy before you restart or update it.',
            'Providers: the AI services Hermes uses, and whether Hermes can use them.',
            'Egress proxy: Hermes’s optional [[egress|egress]] guard for Docker sandboxes. Off is healthy; it only matters when it is on.',
            'Host resources: CPU, memory and disk space on the Mac that runs Hermes, and Hermes’s own [[resource-pressure|resource pressure]] warning.',
          ],
        },
        { p: 'Each one is Healthy, Degraded (it works, but needs a look), Down, or Unknown (it could not be checked). The word is always shown, not only the colour. Under the reason, Suggested fix says what to do, and the time shows when it was last checked. A row with readings opens to show them, and one that is Degraded or Down opens by itself. On a phone each subsystem is a card.' },
        { h: 'Resource pressure' },
        { p: 'When Hermes reports that memory or disk is running out ([[resource-pressure|resource pressure]]), a banner appears at the top of every screen and leads here. Close it with its Dismiss button: it stays closed for as long as that stretch of pressure lasts, and comes back when the pressure returns after it eased, when it gets worse, or when Hermes’s gateway restarts under pressure. It also goes by itself when Hermes says the pressure is over. The banner follows what Hermes says; Caduceus adds no thresholds of its own for it. Where Hermes gives no reading (memory on a Mac, say), Host resources falls back on how full memory and disk are.' },
        { h: 'Staying up to date' },
        { p: 'Health refreshes itself when Hermes reconnects, when platforms or jobs change, when the backend restarts and when you come back to the tab. Check now asks again at once. When you open Health again it shows the last report at once while the new check runs. If there is no report yet, each subsystem shows a placeholder; after a few seconds the page says the check is taking longer than usual and offers Retry.' },
        { h: 'When Caduceus cannot be reached' },
        { p: 'A banner says so, and Health keeps showing its last report with the time it was made. It updates by itself when the connection is back. Until then the Caduceus server row reads Down, because this page cannot reach it.' },
      ],
      related: ['today', 'logs', 'read-only-mode', 'risk-tiers'],
    },
  ],
  glossary: [
    {
      id: 'repairs',
      term: 'Repairs',
      definition: 'Problems Caduceus has found with Hermes or with itself, each with its cause and, where there is one, a button that fixes it.',
      page: 'health',
    },
    {
      id: 'resource-pressure',
      term: 'Resource pressure',
      definition: 'Hermes’s own warning that the Mac it runs on is short of memory or disk space. Elevated means it is getting tight; critical means agents may fail. Caduceus shows a banner while it lasts.',
      page: 'health',
    },
    {
      id: 'recurring-failure',
      term: 'Recurring failure',
      definition: 'A problem that went away and came back within a day. Each separate return counts once; a problem that never left is one failure.',
      page: 'health',
    },
    {
      id: 'egress',
      term: 'Egress proxy',
      definition: 'An optional proxy Hermes can run so that Docker sandboxes reach AI providers through it instead of holding the real credentials. When it is off, Health treats that as fine.',
      page: 'health',
    },
  ],
};
