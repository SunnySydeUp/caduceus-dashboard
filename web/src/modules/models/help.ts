import type { ModuleHelp } from '../../help.ts';

export const modelsHelp: ModuleHelp = {
  pages: [
    {
      id: 'models',
      title: 'Models: the main model',
      summary: 'Choose the main model and the reasoning default of one profile.',
      route: '/agents/models',
      keywords: 'models main model default reasoning effort provider catalogue refresh recommended max output tokens expensive',
      body: [
        { p: 'Models works on one [[profile|profile]]: the one this tab is scoped to ([[profile-scope|profile scope]]), named under the title. Change it with the profile switcher (at the top of the side card, or in the app bar on a phone). Everything on the screen is read from [[hermes]] for that profile each time you look. Caduceus keeps no copy, so a reload, or the command line, shows the same values.' },
        { h: 'The main model' },
        { p: 'The [[main-model|main model]] is the model a profile’s agent uses for its own work. Change model opens the picker. Hermes writes the choice to that profile’s config. New sessions use it; a chat that is already open keeps the model it has. You confirm first (Tier 1, see [[risk-tiers|risk tiers]]).' },
        { p: 'A profile with no model shows the one Hermes recommends for the first provider the profile can use, with a button to take it.' },
        { p: 'Under the model, the tags are what Hermes knows about it: whether it uses tools, sees images and reasons, how large its context window is and how much it can write in one reply.' },
        { h: 'The model picker' },
        {
          ul: [
            'It lists Hermes’s live catalogue for the profile, grouped by provider, with tags for the capabilities Hermes reports and the price when Hermes knows it.',
            'Search matches a model’s name or its provider’s.',
            'Refresh asks Hermes to check every provider again. If Hermes does not answer, the last list it gave stays, and the picker says so.',
            'A provider is never hidden for being broken. One with no models says so, one that is only a list saved in the profile’s config (your own endpoint) says it was not checked live, and one the profile has no credential for sits under “Not set up”, with what it needs.',
            'When Hermes judges a model very expensive it asks again before it assigns it, and shows its own warning. Nothing is set until you confirm that too.',
          ],
        },
        { h: 'Reasoning default' },
        { p: 'How hard the main model thinks before it answers, for models that can reason. It is a config write, so it is a Tier 3 action: you type the profile’s name and confirm with your [[passkey|passkey]], and it is not allowed in [[read-only-mode|read-only mode]].' },
        { h: 'Max output tokens' },
        { p: 'Hermes 0.21 removed its setting for how long one reply may be: it uses each provider’s own default. The screen says so, and shows the most the model can write, as the model catalogue gives it, for information.' },
      ],
      related: ['models-auxiliary', 'profile-scope', 'read-only-mode'],
    },
    {
      id: 'models-auxiliary',
      title: 'Models: auxiliary slots',
      summary: 'Give each side task its own model, or leave it on auto.',
      route: '/agents/models/:tab',
      keywords: 'auxiliary slots vision compression title generation approval curator reset all auto side tasks',
      body: [
        { p: 'An [[auxiliary-slot|auxiliary slot]] is a model for one of Hermes’s side tasks, such as reading images, shortening a long chat, naming sessions or judging risky commands. The screen lists every slot Hermes reports for the profile, and it lists no others: a slot a newer Hermes adds appears by itself.' },
        {
          ul: [
            'Auto means Hermes chooses: it uses the main model, or its own pick where that suits the task.',
            'Change opens the same model picker as the main model, with Auto first. Only that slot changes. Each change is a Tier 1 action: you confirm it.',
            'The Auto button on a pinned slot puts it back on auto.',
            'Reset all to auto puts every slot back on auto, and clears the endpoint and reasoning effort pinned to it. The main model is not touched. It is a Tier 1 action.',
          ],
        },
        { p: 'A fast, cheap model suits most side tasks. The approval slot in particular only has to classify a command.' },
      ],
      related: ['models', 'models-fallback', 'models-usage', 'read-only-mode'],
    },
    {
      id: 'models-fallback',
      title: 'Models: fallback chain',
      summary: 'The models Hermes tries, in order, when the main model fails.',
      route: '/agents/models/fallback',
      keywords: 'fallback chain failover backup models fallback_providers retries endpoint base url reorder rate limit turn off',
      body: [
        { p: 'The [[fallback-chain|fallback chain]] is the ordered list of models [[hermes]] switches to when the [[main-model|main model]] fails or is rate limited. It is the profile’s own `fallback_providers` in its config. The screen reads it from Hermes each time you look and keeps no copy.' },
        {
          ul: [
            'Add from the catalogue opens the model picker; Add a custom provider takes a provider name, a model id and, if you like, an endpoint of your own.',
            'Move up and Move down put an entry earlier or later. On a mouse you can drag a row too; on a phone only the buttons are offered. The first entry is tried first.',
            'Set the endpoint overrides the address Hermes calls for that one entry. Leave it empty for the provider’s usual address.',
            'Turn off takes an entry out of the chain without losing it. Hermes 0.21 has no switch for this, so the entry moves to a list the file keeps and Hermes never reads (`fallback_providers_disabled`). Turn on puts it back at the end of the chain.',
            'Remove drops an entry for good.',
          ],
        },
        { p: 'Your changes are a draft until you press Save chain. Saving is a config write, so it is a Tier 3 action: you type the profile’s name and confirm with your [[passkey|passkey]] (see [[risk-tiers|risk tiers]]), and it is not allowed in [[read-only-mode|read-only mode]].' },
        { h: 'Failing over' },
        {
          ul: [
            'Retries before failing over: how often Hermes retries an API error before it moves to the next entry.',
            'Waiting cycles when everything is down: after the whole chain is spent on an outage, how many more times Hermes waits and tries again.',
            'Stay on a rate-limited main model if it resets within: when the main model says it will be back sooner than this many seconds, Hermes waits for it instead of switching. 0 turns this off.',
          ],
        },
        { p: 'Hermes has no setting for going back to the main model. It tries the main model again at the start of every turn.' },
        { p: 'An older config can hold a single `fallback_model` as well. Hermes still tries it after the chain, and the screen shows it without editing it.' },
      ],
      related: ['models', 'models-moa', 'read-only-mode'],
    },
    {
      id: 'models-moa',
      title: 'Models: Mixture of Agents',
      summary: 'Presets that ask several models and let one aggregator write the reply.',
      route: '/agents/models/moa',
      keywords: 'mixture of agents moa presets reference models aggregator default preset fanout temperature timeout delete',
      body: [
        { p: 'A [[mixture-of-agents|Mixture-of-Agents]] preset asks several reference models the same question, then lets one [[aggregator|aggregator]] model read their answers and write the reply. The screen lists the presets [[hermes]] holds in the profile’s config and edits them there.' },
        {
          ul: [
            'A preset has reference models (each can be turned off without losing it) and one aggregator. A model that is itself a Mixture-of-Agents preset is not allowed.',
            'The default preset is the one /moa runs a prompt through. Make default changes it.',
            'When the reference models run: once per message (cheapest), at every tool step, or every Nth step.',
            'Temperatures and the timeout are optional. Empty means the provider’s own, or the timeout Hermes sets for its reference slot.',
            'Hermes refuses a preset with an incomplete model instead of repairing it. The form says what is missing before it asks.',
          ],
        },
        { p: 'Saving a preset, making one the default and deleting one each ask you to confirm first (Tier 1, see [[risk-tiers|risk tiers]]).' },
        { h: 'Delete' },
        { p: 'Delete removes the preset from the profile’s config. If it was the default, the next preset that is on becomes the default. The last preset, and the last one that is on, cannot be deleted.' },
      ],
      related: ['models', 'models-fallback', 'read-only-mode'],
    },
    {
      id: 'models-local',
      title: 'Models: local models',
      summary: 'Download, start and use models that run on this Mac.',
      route: '/agents/models/local',
      keywords: 'local models llama.cpp runtime gguf download hugging face sideload quick start activate eject server delete disk memory hardware fit',
      body: [
        { p: 'A [[local-model|local model]] runs on this Mac. [[hermes]] runs it with a managed [[local-runtime|runtime]] (llama.cpp) and keeps the files in its own models folder, shown on the screen. The screen reads everything from Hermes each time you look, and a download that is running is found again after you reload the page or open it on your phone.' },
        {
          ul: [
            'Status says in plain words whether the runtime is installed and the local server is running, and how much memory models can use on this Mac. Installing the runtime asks you to confirm (Tier 1, see [[risk-tiers|risk tiers]]).',
            'On this Mac lists the models on disk with their size. Activate makes one the profile’s main model and starts the server; Eject frees the memory a loaded model uses; Delete removes its files and says how much space it freed. A model you added from a file on your Mac is only unlinked: the original stays. Each is a Tier 1 action.',
            'The catalogue is Hermes’s own list, priced for this Mac before you download: its size, whether it fits and how it would run. Quick start installs the runtime if needed, downloads the recommended model and makes it the main model.',
            'Search Hugging Face finds other [[gguf|GGUF]] models. Open a repo to see its builds with their size and a verdict for this Mac. The download comes from Hugging Face as it is.',
            'Add a file registers a .gguf file already on this Mac without copying it.',
          ],
        },
        { p: 'Starting a download shows the disk space it needs and asks you to confirm. Downloads can be large and slow, so they run in Hermes: leave the page and come back, and the Jobs list shows their progress. A download can be paused in the Jobs list (Hermes keeps the files it has) and carried on from where it stopped.' },
        { h: 'On a phone' },
        { p: 'A phone shows the status, the main model and the progress of jobs, and the small actions (start or stop the server, activate, eject, delete). Downloading, searching, adding a file and installing the runtime are offered on a tablet or a desktop.' },
        { p: 'Once a model is on disk it appears in the model picker under Local, so it can be the main model or any auxiliary slot. Hermes assigns it only while the local server is running.' },
      ],
      related: ['models', 'models-usage', 'read-only-mode'],
    },
    {
      id: 'models-usage',
      title: 'Models: usage',
      summary: 'What each model did in the last 7, 30 or 90 days, and Use as….',
      route: '/agents/models/usage',
      keywords: 'usage analytics cost tokens requests context window capabilities use as 7 30 90 days estimated billed',
      body: [
        { p: 'One card for each model the profile used in the period, in the order [[hermes]] counts them (most tokens first). The numbers are Hermes’s own model analytics for this profile; nothing is added up or kept here.' },
        {
          ul: [
            'Requests are the model calls Hermes counted. Tokens are what was sent and what came back.',
            'Cost is shown only when Hermes has one. A cost the provider billed is shown as it is; one Hermes worked out from its price table is marked estimated. A local model, or a provider Hermes has no prices for, shows no cost.',
            'The context window and the tags (tools, vision, reasoning) come from the model catalogue Hermes keeps. A model it does not know has none.',
          ],
        },
        { p: 'Use as… puts the model in the main slot or in any auxiliary slot of the profile ([[main-model|main model]], [[auxiliary-slot|auxiliary slot]]). You confirm first (Tier 1, see [[risk-tiers|risk tiers]]); the confirmation names the slot and the profile. A model Hermes recorded without a provider cannot be used from here.' },
      ],
      related: ['models', 'models-auxiliary'],
    },
  ],
  glossary: [
    {
      id: 'local-model',
      term: 'Local model',
      definition: 'A model that runs on this Mac instead of at a provider. Hermes keeps its file in its own models folder and serves it with its llama.cpp runtime.',
      page: 'models-local',
    },
    {
      id: 'local-runtime',
      term: 'Runtime',
      definition: 'The program that runs local models: Hermes’s managed copy of llama.cpp. Hermes downloads it once, a few hundred megabytes, and runs it as a local server.',
      page: 'models-local',
    },
    {
      id: 'gguf',
      term: 'GGUF',
      definition: 'The file format llama.cpp loads: one model, compressed (quantised) to a size that fits in memory. A large model may be split into several files that belong together.',
      page: 'models-local',
    },
    {
      id: 'fallback-chain',
      term: 'Fallback chain',
      definition: 'The ordered list of models Hermes switches to, one after the other, when a profile’s main model fails or is rate limited. Hermes keeps it in the profile’s config.',
      page: 'models-fallback',
    },
    {
      id: 'mixture-of-agents',
      term: 'Mixture-of-Agents',
      definition: 'A way of answering in which several reference models each give an answer and one aggregator model reads them and writes the reply. A preset names the models and how they are used.',
      page: 'models-moa',
    },
    {
      id: 'aggregator',
      term: 'Aggregator',
      definition: 'The model of a Mixture-of-Agents preset that reads the reference models’ answers and writes the final reply.',
      page: 'models-moa',
    },
    {
      id: 'main-model',
      term: 'Main model',
      definition: 'The model a profile’s agent uses for its own work in a chat. Each profile has its own; Hermes keeps it in the profile’s config.',
      page: 'models',
    },
    {
      id: 'auxiliary-slot',
      term: 'Auxiliary slot',
      definition: 'A model for one of Hermes’s side tasks (vision, compression, session titles, approvals and others), separate from the main model. On auto, Hermes chooses.',
      page: 'models-auxiliary',
    },
  ],
};
