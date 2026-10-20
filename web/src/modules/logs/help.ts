import type { ModuleHelp } from '../../help.ts';

export const logsHelp: ModuleHelp = {
  pages: [
    {
      id: 'logs',
      title: 'Logs',
      summary: 'Read what Hermes wrote to its log files, filter it, search it and follow it live.',
      route: '/observe/logs',
      keywords: 'logs log file tail follow live stream errors warnings agent gateway filter level component search download copy truncate empty clear delete debug',
      body: [
        { p: '[[hermes]] writes what it does to log files on the Mac it runs on. This page reads them from Hermes, so it shows what Hermes shows: nothing is copied or kept by Caduceus. Logs belong to a [[profile-scope|profile]], so switch the profile to read another’s.' },
        { h: 'Files, levels and components' },
        {
          ul: [
            'File: Agent, Errors, Gateway, Dashboard, Desktop or MCP. Each is its own file. Errors holds the warnings and errors of everything.',
            'Level: a floor, not a match. Warning and above shows warnings, errors and critical lines. See [[log-level|log level]].',
            'Component: the part of Hermes that wrote the line, such as gateway or cron. See [[log-component|component]].',
            'Lines: how many of the last lines of the file to show, up to 500.',
          ],
        },
        { h: 'Search' },
        { p: 'The search box is Hermes’s own search: it keeps the lines that contain your words, ignoring case, and the words are marked in each line. You can type the filters in the same box: level:error, component:gateway and file:errors become filters, and the rest is the search. The address of the page holds the whole view, so a link to it opens the same view.' },
        { h: 'Live tail' },
        {
          ul: [
            'The page follows the end of the log by itself: this is the [[live-tail|live tail]]. Caduceus asks Hermes for new lines once for everyone watching the same view, and sends them to each page.',
            'Pause stops the page where it is, and the new lines wait. Scrolling up does the same, so a line does not move under your eyes. The button then says how many lines are waiting.',
            'Jump to live shows the lines that waited and goes back to the end.',
            'If Hermes stops answering, the lines already read stay, and the page says so. It starts again by itself.',
          ],
        },
        { h: 'Copy and download' },
        {
          ul: [
            'Each line has its number on its left. Press the number to select the line, press more numbers to select more, then Copy. Nothing needs a swipe or a long press.',
            'Download saves every line of the view as it is now, with the filters and the day in the file name.',
          ],
        },
        { h: 'Truncate file' },
        { p: 'Truncate file empties the file you are looking at, on the Mac that runs Hermes. Hermes has no way to do this, so Caduceus does it itself, and only for Hermes’s own log files in a profile’s logs folder. It is a Tier 3 action ([[risk-tiers|risk tiers]]): you confirm with a [[passkey|passkey]] and type the file’s name. It cannot be undone. It is not allowed in [[read-only-mode|read-only mode]] or while you are offline, and Caduceus records it.' },
      ],
      related: ['health', 'gateway', 'risk-tiers', 'profile-scope'],
    },
  ],
  glossary: [
    {
      id: 'log-level',
      term: 'Log level',
      definition: 'How serious a log line is: Debug, Info, Warning, Error or Critical. Filtering by a level shows that level and everything more serious.',
      page: 'logs',
    },
    {
      id: 'log-component',
      term: 'Component',
      definition: 'The part of Hermes that wrote a log line, such as the gateway, the agent, its tools or the scheduler. Hermes groups its loggers into these components so you can show one part only.',
      page: 'logs',
    },
    {
      id: 'live-tail',
      term: 'Live tail',
      definition: 'A log that keeps adding new lines at its end as they are written. Pausing it, or scrolling up, holds the page still while new lines wait for you.',
      page: 'logs',
    },
  ],
};
