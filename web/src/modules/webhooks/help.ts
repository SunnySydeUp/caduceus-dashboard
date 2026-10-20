import type { ModuleHelp } from '../../help.ts';

export const webhooksHelp: ModuleHelp = {
  pages: [
    {
      id: 'webhooks',
      title: 'Webhooks',
      summary: 'Addresses that outside services post events to, each with a secret shown once.',
      route: '/connect/webhooks',
      keywords: 'connect webhooks webhook subscription receiver secret hmac github stripe event payload deliver endpoint url enable disable delete',
      body: [
        { p: 'A [[webhook]] is an address that an outside service, such as GitHub or Stripe, posts an event to. [[hermes]] checks the event, then runs the agent on it or forwards it as a message. This page manages the receiver that listens for them and the subscriptions it knows, for the [[profile]] this tab works on. Each profile has its own.' },
        { h: 'The receiver' },
        {
          ul: [
            'The receiver is the webhook platform of the profile’s [[gateway]]. While it is off nothing can be created. Switch it on from this page: it is a Tier 2 action ([[risk-tiers|risk tiers]]) and Hermes restarts the gateway to apply it, which interrupts that gateway’s chats for a moment.',
            'The address it shows is on this machine. An outside service reaches it only if you expose that port yourself, with a tunnel or a reverse proxy. Caduceus does not do that for you.',
          ],
        },
        { h: 'Creating a webhook' },
        {
          ul: [
            'Give it a name, which becomes the end of its address, and say which events it accepts and what the agent is asked. An empty list of events accepts them all.',
            'Create is a Tier 2 action: you confirm, then use a [[passkey|passkey]]. A webhook with a script runs code on this machine, so it is Tier 3 and you also type its name.',
            'When it is created, its [[one-time-secret|one-time secret]] is shown in a dialog that a stray tap or Escape cannot close. Copy it there. Nothing in Caduceus keeps it, and Hermes does not list it again.',
          ],
        },
        { h: 'Managing webhooks' },
        {
          ul: [
            'The switch on a card turns a subscription off without losing it: Hermes refuses its events until you turn it back on. Hermes reloads its file, so no restart is needed.',
            'Delete removes a subscription and its secret. It is a Tier 1 action: you confirm. A new webhook with the same name gets a new secret.',
            'On a phone every card has a ⋮ button that opens the same actions in a sheet. None of this is allowed in [[read-only-mode|read-only mode]].',
          ],
        },
      ],
      related: ['gateway', 'channels', 'risk-tiers', 'profile-scope'],
    },
  ],
  glossary: [
    {
      id: 'webhook',
      term: 'Webhook',
      definition: 'An address that an outside service posts events to. Hermes verifies each event with the webhook’s secret, then runs the agent on it or forwards it as a message.',
      page: 'webhooks',
    },
    {
      id: 'one-time-secret',
      term: 'One-time secret',
      definition: 'The secret of a webhook, made by Hermes and shown once when the webhook is created. Caduceus never stores or caches it, and Hermes does not list it again, so copy it then. If it is lost, delete the webhook and create it again.',
      page: 'webhooks',
    },
  ],
};
