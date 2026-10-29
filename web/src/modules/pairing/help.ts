import type { ModuleHelp } from '../../help.ts';

export const pairingHelp: ModuleHelp = {
  pages: [
    {
      id: 'pairing',
      title: 'Pairing',
      summary: 'Approve the people who message your bots, and revoke the ones who should not.',
      route: '/connect/pairing',
      keywords: 'connect pairing approve revoke pending request direct message dm stranger code allowlist allowed users telegram discord whatsapp clear',
      body: [
        { p: 'A bot that answers anyone would answer strangers. So [[hermes]] does not answer a person it does not know. It keeps their request, and gives them a short code to relay. This page is where those requests wait for you, so you never type a code: you see who asked, and where, and you decide. That process is [[pairing|pairing]].' },
        { h: 'Waiting for you' },
        {
          ul: [
            'Each card is one person on one platform, with how long ago they asked. Hermes keeps a request for an hour and lets one person ask once every ten minutes. Hermes has no way to refuse a single request: if you do nothing, the request goes away by itself when the hour is up, and each card says when.',
            'Approve adds them to that platform’s allowed users for this [[profile]], and the bot answers them from then on. It is a Tier 2 action ([[risk-tiers|risk tiers]]): the dialog names the person, the platform and the profile, then asks for a [[passkey|passkey]].',
            'Clear pending drops every waiting request of this profile. The people are not told. It is a Tier 1 action: you confirm.',
            'On a phone every card has a ⋮ button that opens the same actions in a sheet. Nothing needs a swipe.',
          ],
        },
        { h: 'Approved' },
        {
          ul: [
            'The people the bot answers because you approved them. A person who is only on a platform’s allowed-users list, set up by hand, is not listed here.',
            'Revoke stops the bot answering them and takes them off the allowed users. It is a Tier 2 action. They can ask to be paired again.',
          ],
        },
        { h: 'Kept live' },
        { p: 'The lists update by themselves when Hermes says pairing changed, and when you come back to the tab. A request that arrives while you look at the page appears at once. Each profile has its own gateway and its own lists, so switch the profile to see another’s. None of this is allowed in [[read-only-mode|read-only mode]].' },
      ],
      related: ['channels', 'gateway', 'risk-tiers', 'profile-scope'],
    },
  ],
  glossary: [
    {
      id: 'pairing',
      term: 'Pairing',
      definition: 'How Hermes lets a new person use a bot: they message it, Hermes keeps their request instead of answering, and you approve them. Approved people are remembered per profile and per platform.',
      page: 'pairing',
    },
  ],
};
