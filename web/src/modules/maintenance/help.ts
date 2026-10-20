import type { ModuleHelp } from '../../help.ts';

export const maintenanceHelp: ModuleHelp = {
  pages: [
    {
      id: 'maintenance',
      title: 'Maintenance and updates',
      summary: 'Check for a newer Hermes or Caduceus, update either with a live log, and read what changed.',
      route: '/system/maintenance',
      keywords: 'maintenance update updates upgrade hermes caduceus check version new release changelog what is new whats new drain restart receipt self-update install latest behind',
      body: [
        { p: 'This screen keeps [[hermes]] and Caduceus current. Each has a card that says whether a newer version is out, what is in it, and an Update button.' },
        { h: 'Checking' },
        {
          ul: [
            'Hermes answers the check itself. It remembers the answer for a day, so Check now asks again.',
            'Caduceus checks the copy it runs from against its upstream branch. It cannot reach the source? The card says it could not check; it never says up to date when it does not know.',
            'When an update is available, a notice under the top bar says so on every screen, and links here. It goes when the update is done, or when you dismiss it for this visit.',
            'A Hermes that was installed by a package manager, or runs in a container, is updated there, not here. The card shows the command to run.',
          ],
        },
        { h: 'Updating Hermes' },
        {
          ul: [
            'Update is a [[risk-tiers|Tier 2]] action: you confirm with a [[passkey|passkey]]. It is not available in [[read-only-mode|read-only mode]].',
            'Caduceus first starts a [[update-drain|drain]]: it takes no new turns and waits a short while for the turns in progress to end. Every open page shows a notice that new turns are paused.',
            'Hermes then updates itself while the log streams to a full-screen sheet on a phone. Close the sheet when you like: the update keeps going and the Show the log button brings it back.',
            'Caduceus restarts the Hermes it runs so that the new code is used, and open chats reconnect by themselves. A turn that was still running is interrupted.',
            'The result is read from Hermes’s [[update-receipt|update receipt]], not from Hermes being up. An update with no receipt, or whose receipt says it only partly finished, is shown as not finished.',
            'Caduceus then checks the new Hermes against the contracts it was built for. If they no longer match, it turns read-only mode on by itself and says so: see Health.',
            'Turns start again when the update is over, whether it worked or not.',
          ],
        },
        { h: 'Updating Caduceus' },
        {
          ul: [
            'Caduceus updates its own copy the way you would by hand: it fast-forwards to the upstream branch, installs what the lockfile changed, and builds the web app. It refuses when the copy has changes that are not committed.',
            'It then restarts itself. That is only possible when it runs as the background service, which starts it again; a Caduceus started by hand cannot, and the card says so.',
            'Every open page loses its connection while it restarts and reconnects by itself, and the Hermes it runs restarts too, so the drain matters most here.',
          ],
        },
        { h: 'What’s New' },
        { p: '[[whats-new|What’s New]] lists each update, newest first, with the versions it went between and the changes it brought. Caduceus keeps this list itself: Hermes’s receipt holds only the latest update and does not say what changed.' },
      ],
      related: ['health', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'maintenance-diagnostics',
      title: 'Diagnostics',
      summary: 'Hermes’s own checks with live output, the debug share, install facts for a bug report, and the drained restarts.',
      route: '/system/maintenance/diagnostics',
      keywords: 'diagnostics doctor security audit prompt size support dump config migrate debug share upload paste install facts bug report copy restart backend caduceus drain console version',
      body: [
        { p: 'Hermes runs its own checks on this Mac and Caduceus shows what they print, line by line, in a full-screen sheet on a phone. Close the sheet when you like: Hermes keeps going. Run one again to read its newest result.' },
        { h: 'The checks' },
        {
          ul: [
            'The [[doctor]] looks over Hermes’s install: Python, dependencies, keys, the config and the services it needs. It can take a minute.',
            'The security audit looks for weak spots such as loose permissions or keys left in the open. Hermes does not change anything.',
            'Prompt size reads how many tokens the standing parts of a prompt take. It only reads, so it asks for nothing.',
            'A [[support-dump]] is a summary of this Hermes setup for a bug report. Secrets are not in it, and nothing is uploaded.',
            'Config migrate brings the config file up to the shape this Hermes expects. It rewrites the file, so take a backup first if you want to be able to go back.',
            'Doctor, the audit, the support dump and config migrate ask you to confirm ([[risk-tiers|Tier 1]]).',
          ],
        },
        { h: 'Debug share' },
        { p: 'A [[debug-share]] uploads a report and the newest log lines to Hermes’s paste service and gives you links. Hermes removes the keys and tokens it recognises first, and the page says whether it did. The links are public to anyone who has them. It is a Tier 3 action: a [[passkey|passkey]], and you type “debug share”. The other share Hermes has, which sends diagnostics to Nous Research, is never allowed through Caduceus.' },
        { h: 'Install facts' },
        { p: 'The versions of Caduceus, Node and Hermes, whether Hermes matches the contracts Caduceus was built for, and what Hermes says about its host. Copy for bug report puts them on the clipboard as a short block. It holds no paths, names or keys, and anything that looks like one is removed before it is copied.' },
        { h: 'Restarting' },
        {
          ul: [
            'Restart Hermes backend and Restart Caduceus are [[risk-tiers|Tier 2]]: you confirm with a passkey. Read-only mode does not stop them, since they change nothing in Hermes’s data.',
            'Each starts with a [[update-drain|drain]]: no new turns, and a short wait for the ones in progress. A turn still running at the end of the wait is interrupted.',
            'Every open page reconnects by itself, and a notice says new turns are paused until it is back.',
            'Caduceus can restart itself only when it runs as the background service, which starts it again.',
          ],
        },
      ],
      related: ['maintenance', 'maintenance-console', 'risk-tiers'],
    },
    {
      id: 'maintenance-backup',
      title: 'Backup and restore',
      summary: 'Make a backup of Hermes and Caduceus, download it, restore one, and prune checkpoints.',
      route: '/system/maintenance/backup',
      keywords: 'backup restore import export archive zip download upload checkpoints prune disaster recovery passkeys vapid keys secrets save copy migrate move',
      body: [
        { p: 'A [[backup]] is a zip that Hermes makes of its whole home folder: settings, keys, sessions, memory, skills and jobs. Caduceus’s own folder is inside Hermes’s home, so the backup holds Caduceus’s passkeys, saved prompts, saved filters, preferences and audit log too. A restore brings all of it back.' },
        { h: 'Making and downloading' },
        {
          ul: [
            'Make backup is a [[risk-tiers|Tier 3]] action, like downloading it, because the archive holds every key Hermes has: a passkey, and you type the name. Hermes writes the file to its backups folder on the Mac that runs it, and its output shows as it goes. No file screen can open the archive.',
            'The file holds your keys, tokens and sessions, so downloading it is a Tier 3 action: a [[passkey|passkey]], and you type “backup”. Caduceus never caches it, on the device or in the browser.',
            'A backup leaves out what Hermes can rebuild: its own code, caches, and the checkpoints below.',
          ],
        },
        { h: 'Restoring' },
        {
          ul: [
            'A [[backup-restore|restore]] copies the backup over Hermes’s home folder. Anything made after the backup is lost, so make a backup of now first if you might want it back.',
            'Restore is a Tier 3 action: a passkey, and you type “restore”. It is not available in [[read-only-mode|read-only mode]] or offline, and every restore is audited.',
            'You can restore from a file on this device (the file picker of your phone or computer; up to 100 MB) or from a path on the Mac that runs Hermes, which has no size limit.',
            'Caduceus first starts a [[update-drain|drain]]: it takes no new turns and waits a short while for the ones in progress to end. Hermes then restores the backup while its log streams.',
            'Caduceus then restarts the Hermes it runs and itself, so that both open the restored files. This needs Caduceus to run as the background service; started by hand it cannot restart itself, and it refuses the restore before changing anything.',
            'This page reconnects by itself. It then shows the result of the contract check of the restored Hermes: an older or newer Hermes than Caduceus expects turns on read-only mode, and Health says why.',
            'A restore that fails changes nothing that needs a restart, and new turns are allowed again.',
          ],
        },
        { h: 'Checkpoints' },
        { p: 'Hermes keeps [[checkpoint|checkpoints]] so that a session can roll back the files an agent changed. The page shows how many sessions hold some and how much space they take, all read from Hermes. Prune is a Tier 2 action: a passkey, and the confirmation names the count. Hermes asks before it deletes the checkpoints of a folder it cannot find (the folder may be on a disk that is not mounted) and it cannot ask here, so then it deletes nothing and says so; run `hermes checkpoints prune` in a terminal to answer it.' },
      ],
      related: ['maintenance', 'maintenance-diagnostics', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'maintenance-console',
      title: 'Console',
      summary: 'Hermes’s restricted hermes> prompt: its own commands only, never a shell.',
      route: '/system/maintenance/console',
      keywords: 'console terminal hermes prompt command line cli shell restricted allow list audit',
      body: [
        { p: 'The [[hermes-console]] is Hermes’s own prompt. It runs only the commands Hermes lists (type `help` to see them), never a shell, and asks before one that changes something. A command outside the list is refused with Hermes’s own words.' },
        {
          ul: [
            'Opening it is a [[risk-tiers|Tier 2]] action: you confirm with a [[passkey|passkey]]. It is not offered in [[read-only-mode|read-only mode]].',
            'Caduceus audits the session: when it opened, every command you ran and when it ended.',
            'A command that changes something shows what it will do and waits for Confirm or Cancel. Stop interrupts a command that is running.',
            'A terminal is hard to use on a phone, so the Console tab is hidden there. Diagnostics has an Open anyway button.',
            'The console ends when Hermes or Caduceus restarts. Open it again.',
          ],
        },
      ],
      related: ['maintenance-diagnostics', 'risk-tiers'],
    },
    {
      id: 'maintenance-api',
      title: 'API reference',
      summary: 'Every REST operation and gateway method Caduceus was built against, with its risk tier.',
      route: '/system/maintenance/api',
      keywords: 'api reference openapi swagger rest gateway rpc methods operations endpoints tier contract pinned documentation',
      body: [
        { p: 'This is the list of everything Caduceus can ask Hermes, read from the contracts it was pinned to and not from Hermes’s own documentation pages (which Caduceus never serves). Each entry shows its [[risk-tiers|tier]]. An operation that is not in the list is denied.' },
        {
          ul: [
            'Search matches the path, the method, the summary, the group and a method’s parameter names. Every word you type must match.',
            'Filter by REST or gateway, and by tier. Denied entries are the ones Caduceus never lets through, such as running a shell or sharing diagnostics with Nous Research.',
            'A “read” mark means the operation only reads, so read-only mode lets it through.',
            'The version shown is the Hermes the contracts were pinned from. Health says if the Hermes you run no longer matches.',
          ],
        },
      ],
      related: ['maintenance-diagnostics', 'risk-tiers', 'read-only-mode'],
    },
  ],
  glossary: [
    {
      id: 'update-drain',
      term: 'Drain',
      definition: 'Before an update or a restart, Caduceus takes no new turns and waits a short while for the turns in progress to finish. Every open page says so, and turns start again afterwards.',
      page: 'maintenance',
    },
    {
      id: 'update-receipt',
      term: 'Update receipt',
      definition: 'The record Hermes writes of every update it runs: its steps, what it skipped and whether it worked. Caduceus reads it to confirm the result, instead of guessing from Hermes being up.',
      page: 'maintenance',
    },
    {
      id: 'backup',
      term: 'Backup',
      definition: 'A zip of Hermes’s home folder that Hermes makes: its settings, keys, sessions, memory and skills, and Caduceus’s own folder with it. It holds secrets, so downloading it needs a typed confirmation.',
      page: 'maintenance-backup',
    },
    {
      id: 'backup-restore',
      term: 'Restore',
      definition: 'To copy a backup over Hermes’s home folder, and Caduceus’s own folder with it. Caduceus pauses new turns first and restarts Hermes and itself afterwards. Anything made after the backup is lost.',
      page: 'maintenance-backup',
    },
    {
      id: 'doctor',
      term: 'Doctor',
      definition: 'Hermes’s own check of its install: Python, dependencies, keys, the config and the services it needs.',
      page: 'maintenance-diagnostics',
    },
    {
      id: 'security-audit',
      term: 'Security audit',
      definition: 'Hermes looks for weak spots in its own setup, such as loose file permissions, keys left in the open and risky settings, and reports them. It changes nothing.',
      page: 'maintenance-diagnostics',
    },
    {
      id: 'support-dump',
      term: 'Support dump',
      definition: 'A summary of this Hermes setup for a bug report: versions, platform and which providers and tools are on. Secrets are not in it, and nothing is uploaded.',
      page: 'maintenance-diagnostics',
    },
    {
      id: 'debug-share',
      term: 'Debug share',
      definition: 'Hermes uploads a redacted report and the newest log lines to its paste service and gives you links. The links are public to anyone who has them.',
      page: 'maintenance-diagnostics',
    },
    {
      id: 'hermes-console',
      term: 'Console',
      definition: 'Hermes’s restricted hermes> prompt. It runs only Hermes’s own commands, never a shell, and asks before one that changes something.',
      page: 'maintenance-console',
    },
    {
      id: 'whats-new',
      term: 'What’s New',
      definition: 'The list of what each update changed, newest first, kept by Caduceus.',
      page: 'maintenance',
    },
  ],
};
