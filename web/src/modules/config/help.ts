import type { ModuleHelp } from '../../help.ts';

export const configHelp: ModuleHelp = {
  pages: [
    {
      id: 'config',
      title: 'Config',
      summary: 'Hermes’s settings as a form: search them, see what differs from the defaults, review your edits and save.',
      route: '/system/config',
      keywords: 'config configuration settings export import reset migrate yaml config.yaml form search modified profile restart required default reset diff review save unsaved changes deep link yaml section jump to key value',
      body: [
        { p: 'This page shows the settings of [[hermes]] for the [[profile-scope|profile]] this tab is working on. The form is made from what Hermes says it has: its list of settings, their kinds and sections, their defaults and the values saved now. When a new Hermes version adds a setting, it appears here with no update to Caduceus. Caduceus keeps nothing of its own.' },
        { h: 'Finding a setting' },
        {
          ul: [
            'On a wide screen one section is open, and Jump to changes it. On a phone the sections are a list: choose one to open its settings, and All sections takes you back.',
            'The search box looks in the name of the key, its label, Hermes’s sentence about it and its choices. Every word you type has to match. It searches every section at once.',
            'Three filters narrow the list: @modified (the value differs from the [[default-value|default value]], or you are editing it), @profile (this profile’s own config sets it, instead of leaving it to Hermes) and @restart-required (a change waits for a gateway restart, see [[restart-required|restart required]]). You can press the filter or type it in the search box. They combine with each other and with the words.',
            'The address of the page holds the search, the filters and the section, so a link opens the same view.',
            'Copy link on a setting copies a link that opens the page at that setting and highlights it.',
          ],
        },
        { h: 'Editing' },
        {
          ul: [
            'Each setting has the control its kind needs: a switch, a choice, a number, a text or a list with one item on each line. Nothing is written when you change a control: the edit is only staged, and the setting says Unsaved.',
            'Undo takes one edit back. Reset to default stages Hermes’s default value for the setting; it is saved with the other edits. A setting already at its default has no Reset.',
            'A credential, such as an API key, is never shown. The box says whether one is set; type to replace it, or choose Clear to remove it. Caduceus does not receive the old value either.',
            'A few settings hold something that is not a plain value, or have a name with a dot in it. They are shown but not editable here; the [[raw-yaml|raw YAML]] editor is the way to change them.',
          ],
        },
        { h: 'Review and save' },
        {
          ul: [
            'While you have edits, a bar at the bottom says how many. Review lists every changed setting with what it was and what it becomes, and which of them need a restart. Credentials show only that they are set, replaced or cleared.',
            'Save is a Tier 3 action ([[risk-tiers|risk tiers]]): config can switch on ways to run commands. You confirm with a [[passkey|passkey]] and type the name of the profile. It is not allowed in [[read-only-mode|read-only mode]] or while you are offline, and Caduceus records it with the names of the keys it changed, never their values.',
            'Discard drops every edit. If you try to leave the page with edits, Caduceus asks first, and the browser asks before the tab is closed.',
          ],
        },
        { h: 'Export, import, reset and migrate' },
        {
          ul: [
            'Form and YAML switch between the two ways to edit the same config. The toolbar under the title is the same on both.',
            'Export downloads the config as a file named for the profile and the day. A credential is never in it: a set one is written as a mask (********), and a value that only refers to one, such as ${OPENAI_API_KEY}, stays as it is.',
            'Import reads a file you choose, checks it and shows what it would change: this is a [[staged-import|staged import]]. Nothing is written until you apply it, which is a Tier 3 action. The import replaces the whole config, so a setting the file leaves out goes back to its default. A mask in the file keeps the credential the profile has; a mask for a credential the profile does not have is a problem, and the file is not applied.',
            'Reset puts one section, or the whole config, back to Hermes’s defaults, after showing which settings change. It is a Tier 3 action. It never clears a credential.',
            'Migrate runs Hermes’s own [[config-migrate|config migrate]] for the profile (Tier 1), shows what it printed and reads the settings again.',
          ],
        },
        { h: 'After a save' },
        { p: 'A setting that is [[restart-required|restart required]] is read by the gateway once, when it starts. After the save a [[restart-to-apply|restart-to-apply]] notice names the profile and offers the restart in place. Hermes does not say which settings need a restart, so Caduceus keeps its own list: the gateway’s own settings, the chat platforms, the scheduler, sessions, logging and the database. Everything else is read again for each new turn.' },
      ],
      related: ['config-yaml', 'gateway', 'channels', 'risk-tiers', 'profile-scope'],
    },
    {
      id: 'config-yaml',
      title: 'Config YAML',
      summary: 'Hermes’s config file as text: edit it with its mistakes pointed out by line, review the change and save.',
      route: '/system/config/yaml',
      keywords: 'yaml raw config.yaml editor text syntax schema line error problem validate save review read-only phone larger screen handoff export import reset migrate mask credential',
      body: [
        { p: 'This is the [[raw-yaml|raw YAML]] of the profile’s config file, the text Hermes keeps on disk. It reaches the same settings as the form, plus the few the form cannot edit. Use it when you want to change many settings at once, paste a block, or repair a file.' },
        { h: 'Checks before saving' },
        {
          ul: [
            'The text is checked as you type. A syntax error, a text that is not a mapping, or a value of the wrong kind for a setting (a word where Hermes expects a number, a choice it does not list) shows as a problem with its line. A problem opens the line when you choose it.',
            'While there is a problem, Save is switched off and says so. Hermes would refuse some of these texts, and would silently keep others that do not mean what you intended.',
            'A credential is shown as ********. Leave it as it is to keep the credential; type a value in its place to replace it. A ******** on a line where the profile has no credential is a problem.',
          ],
        },
        { h: 'Saving' },
        {
          ul: [
            'Review and save shows each setting that changes. Hermes replaces the whole file, so deleting a line puts that setting back to its default. Comments are not kept by Hermes.',
            'Save is a Tier 3 action ([[risk-tiers|risk tiers]]): you confirm with a [[passkey|passkey]] and type the profile’s name. It is not allowed in [[read-only-mode|read-only mode]] or while you are offline, and Caduceus records it without the text.',
            'If Hermes’s file changes while you are editing, a notice says so. Your text replaces it when you save.',
          ],
        },
        { h: 'On a phone' },
        { p: 'Below the tablet size the text is read-only, with no way to edit it. Continue on a larger screen gives a link to open on a tablet or desktop, and Copy link copies it. Export, Import, Reset and Migrate still work.' },
      ],
      related: ['config'],
    },
    {
      id: 'config-section',
      title: 'Config section',
      summary: 'One section of Hermes’s settings, such as Agent or Display: its settings and how to move between sections.',
      route: '/system/config/:category',
      keywords: 'config section category agent display terminal jump to all sections drill phone list',
      body: [
        { p: 'Hermes groups its settings into sections, and the name of the section is in the address of the page. A wide screen shows the section you chose with every setting in it, and Jump to switches to another. On a phone the sections are a list, and All sections goes back to it.' },
        { p: 'Searching or turning on a filter looks through every section at once, and the page lists what matches under each section’s name. Clear the search to come back to the section. Edits you have not saved stay while you move between sections. Everything else about the page, including how to save, is in the help for the Config page.' },
      ],
      related: ['config'],
    },
  ],
  glossary: [
    {
      id: 'restart-required',
      term: 'Restart required',
      definition: 'A setting that Hermes’s gateway reads only when it starts. A change to it is saved at once but takes effect after the gateway restarts. Caduceus raises a notice that offers the restart.',
      page: 'config',
    },
    {
      id: 'modified',
      term: 'Modified',
      definition: 'A setting whose value is not Hermes’s default. The @modified filter lists them, and also any setting you are editing.',
      page: 'config',
    },
    {
      id: 'default-value',
      term: 'Default value',
      definition: 'What Hermes uses for a setting when the profile’s config does not set it. Reset to default puts this value back.',
      page: 'config',
    },
    {
      id: 'raw-yaml',
      term: 'Raw YAML',
      definition: 'The text of a profile’s config file, as Hermes keeps it on disk. Editing it changes the same settings as the form, all at once. Credentials in it are shown as a mask.',
      page: 'config-yaml',
    },
    {
      id: 'staged-import',
      term: 'Staged import',
      definition: 'An import that is read, checked and shown as a list of changes before anything is written. Caduceus saves it only when you apply it, with the same confirmation as any config save.',
      page: 'config',
    },
    {
      id: 'config-migrate',
      term: 'Config migrate',
      definition: 'Hermes’s own command that brings a profile’s config up to date with a newer Hermes: it adds the settings the new version introduced and moves ones that were renamed.',
      page: 'config',
    },
  ],
};
