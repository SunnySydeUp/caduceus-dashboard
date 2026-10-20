import type { ModuleHelp } from '../../help.ts';

export const keysHelp: ModuleHelp = {
  pages: [
    {
      id: 'keys',
      title: 'Keys and sign-ins',
      summary: 'Provider keys, account sign-ins, pooled credentials, custom endpoints and the Nous Portal account of one profile.',
      route: '/system/keys',
      keywords: 'keys api key provider env .env secret token reveal replace remove test connection validate oauth sign in login device code connect disconnect credential pool custom endpoint openai-compatible vllm lm studio ollama nous portal subscription billing missing key openrouter anthropic',
      body: [
        { p: 'This page holds the credentials of [[hermes]] for the [[profile-scope|profile]] this tab works on, named under the title. Each profile has its own keys, its own sign-ins and its own pools. Everything is read from Hermes each time you look; Caduceus keeps no copy. A key is never sent to your browser, not even in part: the page is only told whether it is set.' },
        { h: 'Provider keys' },
        {
          ul: [
            'The list shows the keys that are set, grouped by what they are for. Add key opens a search over every key Hermes knows how to use, and lets you name one of your own.',
            'Reveal shows one key for 30 seconds and then hides it again. It is a Tier 3 action ([[risk-tiers|risk tiers]]): you confirm with a [[passkey|passkey]] and type the name of the variable. The answer is kept by no cache, and Caduceus records the reveal with the name of the key and never its value. Copy on a revealed key puts it on the clipboard, which Caduceus clears after 60 seconds where the browser allows it.',
            'Replace and Remove are Tier 2 actions: you confirm, then use a passkey. Remove also clears every copy Hermes keeps of the key, such as the pooled credential it was read into.',
            'Test connection asks Hermes to check the key it holds. Hermes sends the key to its provider and reports whether it was accepted, was refused, or could not be checked. For some providers Hermes has no live check: the page says so, and does not call the key good. Replace can test a new key before it is saved.',
            'In [[read-only-mode|read-only mode]] nothing here can change, and no key can be revealed. Test connection still works, because it changes nothing.',
          ],
        },
        { h: 'Signing in with an account' },
        {
          ul: [
            'Some providers use an account instead of a key. For those Hermes can run a sign-in itself: Connect shows a [[device-code|device code]] and a link. Open the link on any device where you are signed in to the provider, enter the code, and approve. The page follows Hermes until it is done and says if the code ran out or the sign-in failed.',
            'Cancel stops waiting and Hermes saves nothing. Disconnect signs the account out for this profile, and is a Tier 2 action.',
            'A provider whose login belongs to another program (a CLI) shows the command to run on the Mac that runs Hermes. Caduceus cannot sign it in.',
          ],
        },
        { h: 'Credential pools' },
        {
          ul: [
            'A [[credential-pool|credential pool]] holds several credentials for one provider. Hermes rotates between them and rests one that the provider rejects or limits. Each entry shows how it last fared, where it came from and how often it was used.',
            'Add credential pools another API key for a provider (Tier 2). Remove takes one out (Tier 2) and names the provider, the profile and the entry. An entry Hermes made from a variable in the profile’s environment is removed together with that variable.',
          ],
        },
        { h: 'Custom endpoints' },
        {
          ul: [
            'A [[custom-endpoint|custom endpoint]] is a model server of your own: vLLM, LM Studio, Ollama or any OpenAI-compatible address. Add, edit and delete are Tier 2 actions. The key, if there is one, is kept by Hermes in the profile’s environment, and an edit that types no key keeps it.',
            'Test asks Hermes to look at the address in the form, which sends the key you typed to that address. Use makes the endpoint the profile’s chat model.',
          ],
        },
        { h: 'Nous Portal' },
        { p: 'The Nous Portal card shows whether the profile is signed in to Nous, which tier the account is on and how the tool gateway is routed. It is read-only. Subscribing, changing a plan and billing are not available through Caduceus: Manage subscription opens Nous’s own site.' },
        { h: 'A missing key' },
        { p: 'When Hermes has no credentials for the provider of the chat model, Health shows a Repair that links here. Add the key, or sign in, and the Repair clears.' },
      ],
      related: ['models', 'config', 'risk-tiers', 'read-only-mode', 'health'],
    },
  ],
  glossary: [
    {
      id: 'credential-pool',
      term: 'Credential pool',
      definition: 'Several credentials Hermes holds for one provider. It rotates between them and rests one that the provider limits or rejects, so one bad key does not stop the agent.',
      page: 'keys',
    },
    {
      id: 'device-code',
      term: 'Device code',
      definition: 'A short code for signing in on a device that has no browser of its own: you open the provider’s page on any device, enter the code and approve, while Hermes waits and then saves the login.',
      page: 'keys',
    },
    {
      id: 'custom-endpoint',
      term: 'Custom endpoint',
      definition: 'A model server of your own, such as vLLM or LM Studio, that speaks the OpenAI API. Hermes treats it as a provider with the address, model and key you give it.',
      page: 'keys',
    },
  ],
};
