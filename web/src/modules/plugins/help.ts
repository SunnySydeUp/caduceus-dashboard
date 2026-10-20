import type { ModuleHelp } from '../../help.ts';

export const pluginsHelp: ModuleHelp = {
  pages: [
    {
      id: 'plugins',
      title: 'Plugins',
      summary: 'The agent plugins Hermes has: turn them on or off, install one from git or the catalogue, update it, remove it.',
      route: '/system/plugins',
      keywords: 'plugin plugins extension add-on install uninstall remove update git github url address repository enable disable turn on off tools hooks integration third-party code restart gateway log',
      body: [
        { p: 'A [[plugin]] adds tools, hooks or integrations to [[hermes]]. This page lists the plugins Hermes has, and whether each is on. Hermes keeps both; Caduceus asks it every time you look and keeps no copy. The list has the plugins you installed first, then the ones that ship with Hermes.' },
        { h: 'Turning a plugin on or off, and removing it' },
        {
          ul: [
            'Turn on and Turn off ask you to confirm ([[risk-tiers|Tier 1]]). Turning off keeps the plugin installed. The confirmation names the plugin.',
            'Remove deletes the plugin’s folder from this Mac and asks you to confirm (Tier 1). A plugin that ships with Hermes can be turned off but not removed.',
            'Hermes loads its plugins when a gateway starts. After any change, a [[restart-to-apply|restart-to-apply]] notice names the gateway and offers the restart.',
          ],
        },
        { h: 'Installing and updating' },
        {
          ul: [
            'Install plugin takes a git address (`https://github.com/owner/repo`, a short `owner/repo`, or an `ssh` address) or the name of a catalogue plugin. A git address is not reviewed by Hermes. The plugin is Python code, and it runs on this Mac with the permissions of Hermes.',
            'Because of that, install and update are Tier 3 actions ([[risk-tiers|risk tiers]]): you confirm with a [[passkey|passkey]] and then type the address or the plugin’s name. They are not available in [[read-only-mode|read-only mode]] or while you are offline, and each one is written to the audit log with the address or name.',
            'Hermes does the work while the log streams to a sheet: the download, the scan, the Python packages the plugin needs, and Hermes’s own words about what it did. The log ends with a clear success or failure. Closing the sheet does not stop Hermes; the list reads Hermes again when the command ends.',
            'Update is for a plugin that came from git. Hermes pulls the newest code, or, for a catalogue plugin, moves it to the commit the [[catalogue|catalogue]] now pins. A plugin you pinned to one commit does not move.',
            'Only one install or update runs at a time. A second one waits until the first ends.',
            'An address with a token in it is never kept: Caduceus removes it from the log and the audit log. Prefer a token Hermes already holds, such as GITHUB_TOKEN in Keys.',
          ],
        },
        { h: 'When it fails' },
        { p: 'The log shows Hermes’s own sentence, such as the address could not be reached, the plugin failed Hermes’s security scan, or the plugin is already installed (use “Replace it if it is already installed”). Nothing is left half installed: Hermes moves a plugin into place only after its checks pass.' },
      ],
      related: ['plugins-catalogue', 'keys', 'risk-tiers'],
    },
    {
      id: 'plugins-catalogue',
      title: 'Plugin catalogue',
      summary: 'The plugins Hermes has checked, with what each does, adds and asks for.',
      route: '/system/plugins/catalogue',
      keywords: 'catalogue catalog plugin plugins browse search category official community install pinned commit tools hooks environment variables',
      body: [
        { p: 'The [[catalogue]] is a list Hermes keeps of plugins it has checked. Each entry says what the plugin does, who maintains it, what it adds (tools, hooks, middleware) and which variables it needs. Search narrows the list by name, description, maintainer or tool; the category and the installed filter narrow it further.' },
        {
          ul: [
            'Official entries are maintained by Nous Research. Community entries are written by others and reviewed by Nous Research.',
            'Install opens a sheet that shows the entry’s facts first: the commit it is pinned to, the code’s address, what it adds and what it needs. It then asks for a Tier 3 confirmation: a passkey, and the plugin’s name typed ([[risk-tiers|risk tiers]]).',
            'Hermes installs a catalogue plugin at the exact commit the catalogue pins. A plugin that is installed shows as Installed; manage it on the Installed tab.',
            'Hermes asks the internet for the newest catalogue and falls back to the one that ships with it when it cannot. The catalogue still lists plugins that Hermes has withdrawn: Hermes refuses to install them.',
          ],
        },
        { p: 'Variables a plugin needs, such as an API key, are added in Keys. They are not part of the install.' },
      ],
      related: ['plugins', 'keys', 'risk-tiers'],
    },
  ],
  glossary: [
    {
      id: 'plugin',
      term: 'Plugin',
      definition: 'A package of code that adds tools, hooks or integrations to Hermes. Plugins are Python that runs on the Mac that runs Hermes, which is why installing or updating one needs a passkey and a typed name.',
      page: 'plugins',
    },
    {
      id: 'catalogue',
      term: 'Catalogue',
      definition: 'The list of plugins Hermes has checked. Each entry is pinned to one commit, and Hermes installs exactly that commit.',
      page: 'plugins-catalogue',
    },
  ],
};
