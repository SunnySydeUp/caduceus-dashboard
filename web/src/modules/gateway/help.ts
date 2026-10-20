import type { ModuleHelp } from '../../help.ts';

export const gatewayHelp: ModuleHelp = {
  pages: [
    {
      id: 'gateway',
      title: 'Gateway',
      summary: 'Whether each profile’s messaging gateway is running, and starting, stopping or restarting it.',
      route: '/connect/gateway',
      keywords: 'connect gateway start stop restart drain messaging platforms status process restart to apply banner',
      body: [
        { p: 'The [[gateway]] is the part of [[hermes]] that connects it to chat platforms such as Telegram. Scheduled jobs and Kanban dispatch run inside it too, so when it is stopped they wait. Each [[profile]] has a row here with its status dot, the same dot the profile cards show.' },
        { h: 'Keeping up to date' },
        { p: 'Everything on this page is read from Hermes each time you look; Caduceus keeps no copy. The page asks again when Hermes reconnects, when its gateway or channels change and when you come back to the tab, so stopping a gateway from the command line shows up without a reload. If you stop a gateway of a profile other than the one Hermes itself runs under, the dot may take until the next of those moments to change.' },
        { h: 'What you can do' },
        {
          ul: [
            'Start brings a stopped gateway up. It is a Tier 1 action: you confirm.',
            'Stop and Restart are Tier 2 actions ([[risk-tiers|risk tiers]]): you confirm, then use a [[passkey|passkey]]. Both say who is affected, including other profiles that share a [[multiplexed-gateway|multiplexed gateway]].',
            'Drain is also Tier 2. It makes the gateway stop taking new turns and lets work in progress finish; the gateway stays up. Cancel drain lets it take turns again. A [[drain|drain]] applies to the gateway of the root profile, the one Hermes runs under.',
            'None of these is allowed in [[read-only-mode|read-only mode]].',
          ],
        },
        { p: 'On a phone each gateway is a card, and its actions are in the Actions button of the card. Nothing is hidden behind a swipe.' },
        { h: 'Restart to apply' },
        { p: 'When something you saved elsewhere in Caduceus only takes effect after a gateway restart, a [[restart-to-apply|restart-to-apply]] notice appears under the app bar. It names the profile and what changed, and lets you restart in place. It goes away by itself once that gateway has started after the change.' },
        { h: 'Running gateway processes' },
        { p: 'The list under the profiles shows each running gateway process: its process id, when it started, the ports it listens on and the profiles it serves. When one multiplexed gateway serves several profiles they share a process.' },
        { h: 'No gateway yet' },
        { p: 'When no gateway is running and no channel is set up, the page offers to start a gateway, or to set up a channel first.' },
      ],
      related: ['gateway-migrate', 'profiles', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'gateway-migrate',
      title: 'Migrate to one gateway',
      summary: 'Move from one gateway for every profile to a single multiplexed gateway.',
      route: '/connect/gateway/migrate',
      keywords: 'migrate multiplex multiplexed single gateway blockers plan one gateway per profile',
      body: [
        { p: 'A host that runs one gateway for every profile can run a single [[multiplexed-gateway|multiplexed gateway]] instead, which serves every profile from one process. Hermes works out a plan first and lists anything that blocks it.' },
        {
          ul: [
            'The plan comes from Hermes each time you open the page. It lists each profile’s own gateway today, any notices, and the blockers.',
            'While any blocker remains, Migrate is switched off. Fix what the blocker says, and the page updates when Hermes reports a change.',
            'Migrate is a Tier 2 action ([[risk-tiers|risk tiers]]): you confirm, then use a [[passkey|passkey]]. Hermes stops each profile’s own gateway and starts the one gateway, so chat platforms disconnect for a moment.',
            'A host that already runs one gateway, or has one profile, has nothing to migrate, and the page says so.',
          ],
        },
        { p: 'The command Hermes runs is shown on the page, for anyone who prefers to run it in a terminal.' },
      ],
      related: ['gateway'],
    },
  ],
  glossary: [
    {
      id: 'gateway',
      term: 'Gateway',
      definition: 'The part of Hermes that connects it to chat platforms such as Telegram, so it can answer you there. It is not the connection between this page and Caduceus.',
      page: 'gateway',
    },
    {
      id: 'drain',
      term: 'Drain',
      definition: 'Asking the gateway to stop taking new turns and let the work in progress finish, before a restart or an update. It stays up, and cancelling the drain lets it take turns again.',
      page: 'gateway',
    },
    {
      id: 'multiplexed-gateway',
      term: 'Multiplexed gateway',
      definition: 'One Hermes gateway process that serves every profile, instead of one gateway for each profile. Gateway › Migrate moves a host to it.',
      page: 'gateway-migrate',
    },
    {
      id: 'restart-to-apply',
      term: 'Restart to apply',
      definition: 'A notice that something you saved only takes effect once a gateway restarts. It names the profile and clears itself when that gateway has started after the change.',
      page: 'gateway',
    },
  ],
};
