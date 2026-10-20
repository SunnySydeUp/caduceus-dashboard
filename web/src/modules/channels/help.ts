import type { ModuleHelp } from '../../help.ts';

export const channelsHelp: ModuleHelp = {
  pages: [
    {
      id: 'channels',
      title: 'Channels',
      summary: 'The chat platforms Hermes answers you on: set them up, test them, switch them on and off.',
      route: '/connect/channels',
      keywords: 'connect channels platforms telegram discord slack whatsapp matrix signal email bot token configure test enable disable behaviour settings auto thread streaming human delay',
      body: [
        { p: 'A [[channel]] is a chat [[platform]] that [[hermes]] answers you on, such as Telegram, Discord or Slack. Hermes supports more than twenty. This page lists every one of them with its status, for the [[profile]] this tab is working on: each profile has its own credentials and its own channels.' },
        { h: 'Reading the cards' },
        {
          ul: [
            'The status is Hermes’s own: Connected, Disabled, Not set up, Waiting for a gateway restart, Gateway stopped, Reconnecting or Failed. A failure shows the reason Hermes gives.',
            'The list updates by itself when Hermes says a channel changed, and when you come back to the tab.',
            'A channel with nothing set up has Configure as its main button. One that is set up has Edit.',
            'The switch on a card enables or disables the platform without touching its credentials.',
          ],
        },
        { h: 'Configuring a channel' },
        { p: 'Configure opens a panel with the fields Hermes lists for that platform. A phone shows it as a full-height sheet, and Save stays at the bottom while you scroll. Required fields are checked before anything is sent, with the same wording Hermes uses.' },
        {
          ul: [
            'Hermes never sends a saved credential back. A saved one shows only as a hint such as 1234…6789, and an empty field keeps it. Type a new value to replace it, or choose Remove the saved value.',
            'Saving a channel is a Tier 2 action ([[risk-tiers|risk tiers]]): you confirm, then use a [[passkey|passkey]]. The audit trail records the platform and the profile, never a value.',
            'None of this is allowed in [[read-only-mode|read-only mode]].',
          ],
        },
        { h: 'Create or pair with a QR' },
        {
          ul: [
            'Telegram has Create with QR and WhatsApp has Pair with QR. Caduceus asks Hermes to start the setup, shows the [[qr-pairing|QR]] Hermes makes, and keeps asking Hermes until it reports the bot made or the phone linked. Starting is a Tier 1 action: you confirm.',
            'The QR is drawn large so another device can scan it. If you are on the phone you want to use, copy the link (Telegram) or the code (WhatsApp) instead; Telegram’s link also opens the app directly. A countdown shows when the QR expires, and an expired one says so and offers Start again.',
            'Once it is linked you choose the [[allowed-users|allowed users]]: numeric Telegram user ids (yours is filled in from the scan), or WhatsApp phone numbers. Saving them writes the credentials and turns the platform on. It is a Tier 2 action: a passkey, and the audit trail records it.',
            'Cancelling leaves nothing half-configured: a Telegram setup saved no token, and a WhatsApp phone that linked stays linked in Hermes’s session folder without the platform being enabled, which the page says.',
            'Telegram’s QR comes from Nous’s setup service, so it needs the internet. WhatsApp needs Node.js, which Hermes uses for its bridge, and a phone with WhatsApp.',
          ],
        },
        { h: 'Test' },
        { p: 'Test asks Hermes whether the platform is enabled, has what it needs and is connected, and shows Hermes’s own answer, word for word. See [[test-message|test message]] for what it does and does not do. It is a Tier 1 action: you confirm.' },
        { h: 'Behaviour settings' },
        { p: 'The Behaviour tab of the panel holds how a platform acts once connected, such as Discord’s auto-thread, streaming a reply as it is written and the pause that imitates typing. They live in the profile’s config.yaml, each as the type Hermes’s config schema says, and saving them is a Tier 3 action: you type the profile’s name to confirm.' },
        { h: 'Restart to apply' },
        { p: 'A saved channel or setting takes effect when the profile’s gateway restarts. After a save a [[restart-to-apply|restart-to-apply]] notice names the profile and offers the restart in place. If Hermes says a running multiplexed gateway has already picked the change up, no notice appears.' },
      ],
      related: ['gateway', 'risk-tiers', 'profile-scope'],
    },
  ],
  glossary: [
    {
      id: 'channel',
      term: 'Channel',
      definition: 'A chat platform that Hermes answers you on, such as Telegram or Slack, set up for one profile with its own credentials.',
      page: 'channels',
    },
    {
      id: 'platform',
      term: 'Platform',
      definition: 'A messaging service Hermes knows how to connect to. A platform becomes a channel once it has been set up, enabled and connected by the gateway.',
      page: 'channels',
    },
    {
      id: 'qr-pairing',
      term: 'QR pairing',
      definition: 'Setting up Telegram or WhatsApp by scanning a QR code with your phone instead of copying tokens. Hermes makes the QR and Caduceus waits until it reports the bot made or the device linked.',
      page: 'channels',
    },
    {
      id: 'allowed-users',
      term: 'Allowed users',
      definition: 'The people the agent will answer on a platform: Telegram user ids or WhatsApp phone numbers. Anyone else who messages the bot gets no answer.',
      page: 'channels',
    },
    {
      id: 'test-message',
      term: 'Test message',
      definition: 'Hermes’s check of a channel: whether the platform is enabled, set up and connected. In this version of Hermes it reads the platform’s state and reports it; it does not send a message to your chat.',
      page: 'channels',
    },
  ],
};
