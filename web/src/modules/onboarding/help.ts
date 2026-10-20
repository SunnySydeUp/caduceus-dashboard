import type { ModuleHelp } from '../../help.ts';

export const onboardingHelp: ModuleHelp = {
  pages: [
    {
      id: 'onboarding',
      title: 'Setup guide',
      summary: 'The first-time setup: checks, a provider, a default workspace and notifications. Stop at any point and carry on later.',
      route: '/onboarding',
      keywords: 'onboarding setup wizard first run getting started welcome checks provider model recommended workspace folder notifications skip reopen passkey https install',
      body: [
        { p: 'The [[onboarding|setup guide]] walks you through the things Caduceus needs to be useful. It shows one step at a time. Continue moves on, Back goes back, and nothing stops you: every step can be left as it is. Skip setup closes the guide for now, and Settings › Setup guide opens it again where you left off.' },
        { p: 'Where you are is kept by Caduceus for you, not for this device. Start on your laptop and carry on on your phone, and it opens at the same step.' },
        { h: '1. Checks' },
        {
          ul: [
            'Hermes answers: Caduceus is connected to [[hermes]].',
            'A provider is set up: Hermes’s own [[provider-check|provider check]]. It says in Hermes’s words what is missing.',
            'The gateway is running: the messaging gateway that Telegram and other channels need. Chat works without it.',
            'Reached over HTTPS: browsers install the app and allow notifications only over HTTPS. On the Mac itself, localhost counts.',
            'Installed as an app: whether you are using the installed app on this device.',
            'A passkey is enrolled: a [[passkey|passkey]] confirms the changes that need more than a click.',
          ],
        },
        { p: 'Each check shows Pass or Fail and, when it fails, a button to the screen that fixes it. Check again looks again; the checks also look again when you come back to the tab. Only the first two are needed for Caduceus to work. The rest are advice.' },
        { h: '2. Provider' },
        { p: 'This step uses the same flows as System › Keys. Add a provider key opens the list of keys Hermes knows how to use. You can check a key with Hermes before it is saved, and saving it is a Tier 2 action ([[risk-tiers|risk tiers]]): you confirm and use a passkey. Providers that sign in with an account show Connect and a [[device-code|device code]]. After a key is saved, Hermes checks that provider on its own, so another provider cannot hide a connection that failed.' },
        { p: 'When no model is chosen, Hermes’s [[recommended-model|recommended model]] for a provider it can use is offered. Use it makes it the [[main-model|main model]] of the profile (Tier 1). The key itself is never shown, not even in part.' },
        { h: '3. Workspace' },
        { p: 'Choose the folder your agent starts in from your [[workspace|workspaces]], or add one. Hermes keeps the default for the profile, so saving it is a Tier 3 action: you use a passkey and type the profile’s name. The same setting is in Agents › Tools.' },
        { h: '4. Notifications' },
        { p: 'An optional [[push-subscription|push notification]] for this device. Your browser asks for permission only when you choose Turn on notifications. On iPhone and iPad the page must be on the Home Screen first, so the guide shows how to add it; come back here after, your place is saved. A browser that cannot receive push, or that you told no, says so, and you can finish without it.' },
        { h: 'Finishing' },
        { p: 'Finish setup tells Hermes that onboarding is done and what was agreed, which is the default folder if you chose one: Hermes adds it to the user memory of its default profile. If Hermes cannot save it, you can try again or finish without recording it. Today stops offering the guide once you finish or skip it.' },
      ],
      related: ['keys', 'models', 'settings-notifications', 'settings-install', 'work-projects', 'today'],
    },
  ],
  glossary: [
    {
      id: 'onboarding',
      term: 'Onboarding',
      definition: 'The first-time setup guide: checks of Hermes and this device, a provider, a default workspace and notifications. Your progress is kept by Caduceus, so you can carry on from any device.',
      page: 'onboarding',
    },
    {
      id: 'recommended-model',
      term: 'Recommended model',
      definition: 'The model Hermes suggests for a provider that works, when the profile has no model yet. It is Hermes’s own suggestion; you can choose another at any time in Models.',
      page: 'onboarding',
    },
    {
      id: 'provider-check',
      term: 'Provider check',
      definition: 'Hermes’s own test of whether it could serve a model for this profile right now. It resolves the provider and its credentials the way a new chat would, and says what is missing when it fails.',
      page: 'onboarding',
    },
  ],
};
