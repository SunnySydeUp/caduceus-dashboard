import type { ModuleHelp } from '../../help.ts';

export const skillsHelp: ModuleHelp = {
  pages: [
    {
      id: 'skills',
      title: 'Skills: installed',
      summary: 'The skills of one profile: search them, switch them on or off, read them, and remove them.',
      route: '/agents/skills',
      keywords: 'skills installed search category enabled disabled switch toggle usage count uninstall delete hub bundled local SKILL.md linked files',
      body: [
        { p: 'Skills works on one [[profile|profile]]: the one this tab is scoped to ([[profile-scope|profile scope]]), named under the title. The list is what [[hermes]] says that profile has, each time you look. Caduceus keeps no copy, so a reload, or the command line, shows the same list. The Skills tab of a profile shows the same list.' },
        { p: 'A [[skill|skill]] is a written procedure the agent loads when a task needs it. Each one is a [[skill-md|SKILL.md]] file in the profile’s skills folder. Do not confuse it with a [[toolset-vs-skill|toolset]], which gives the agent tools to call.' },
        { h: 'Finding a skill' },
        {
          ul: [
            'Search matches a skill’s name, its description and its category.',
            'The category menu lists every category in the profile, with how many skills each holds. “No category” is the skills that sit in no folder.',
            'On, Off and All keep the skills that are switched on or off.',
            'The search, category and state are in the address, so a link or a reload shows the same list. The skill whose details are open is in it too.',
          ],
        },
        { h: 'On and off' },
        { p: 'The switch asks Hermes to switch a skill off for this profile or on again. Hermes keeps the list of switched-off skills in the profile’s config, and the list shows what Hermes says afterwards. It does not need a confirmation (Tier 0): a message offers Undo for a few seconds. It is not allowed in [[read-only-mode|read-only mode]]. A skill that is off is still there to read and edit; the agent just does not use it in new sessions.' },
        { h: 'Where a skill came from' },
        {
          ul: [
            'Installed from the hub: put there by Hermes’s skills hub. Uninstall removes its folder and its record from this profile. It is a Tier 1 action (see [[risk-tiers|risk tiers]]): you confirm it, and the confirmation names the skill and the profile.',
            'Local skill: made by hand, or written by the agent. Delete asks Hermes to archive it. It is a Tier 1 action too. Hermes’s command line can bring it back (hermes curator restore). Hermes refuses to delete a pinned skill, and says so.',
            'Bundled with Hermes: ships with Hermes. It can be switched off, edited and read, but not removed here.',
          ],
        },
        { h: 'Usage count' },
        { p: 'Each skill shows Hermes’s own usage count: how many times Hermes counts that the skill was used. That is the only number Hermes gives, so it is the only one shown. Caduceus does not invent views or patches counts.' },
        { h: 'Details' },
        { p: 'Opening a skill reads its SKILL.md and draws it. The [[frontmatter|frontmatter]] is kept apart, folded away above the text. Under it are the files linked from the skill: the references, templates, scripts and assets that sit beside SKILL.md. You can open each one to read it. Caduceus never writes a linked file.' },
        { p: 'On a phone the list is a searchable page, the details open as a sheet, and the ⋮ button of each skill opens a menu with the same actions: switch, edit, and uninstall or delete.' },
        { p: 'With no skills at all, the page offers Create skill and Browse hub. The links above the list go to the hub, to Learn a skill and to the curator.' },
      ],
      related: ['skills-hub', 'skills-learn', 'skills-curator', 'skills-editor', 'profile-scope', 'read-only-mode', 'risk-tiers', 'profile-tabs'],
    },
    {
      id: 'skills-editor',
      title: 'Skills: edit SKILL.md',
      summary: 'Change the SKILL.md of a skill, with its frontmatter kept as it is.',
      route: '/agents/skills/:name',
      keywords: 'edit SKILL.md frontmatter yaml name description preview save invalid version metadata unknown keys',
      body: [
        { p: 'A [[skill-md|SKILL.md]] is a text file: [[frontmatter|frontmatter]] between two --- lines, then the instructions in Markdown. Hermes needs the frontmatter to have a name and a description. Other keys, such as version or metadata, are the author’s own, and Hermes keeps them.' },
        { h: 'Editing' },
        {
          ul: [
            'The frontmatter and the instructions are two fields. Caduceus does not read the frontmatter and write it again. It joins the two fields back into the file you started with, so a key it does not know, a comment and the order of the keys all stay exactly as they were.',
            'Preview shows the file as it reads, and Edit goes back to the fields.',
            'Save asks you to confirm (Tier 1, see [[risk-tiers|risk tiers]]) and then Hermes replaces the file with the text. It is not allowed in [[read-only-mode|read-only mode]].',
            'If the file changed in Hermes after you opened it, nothing is saved, and the page says so. Your text stays on the screen.',
          ],
        },
        { h: 'When the frontmatter is not valid' },
        { p: 'Before it saves, the page runs the checks Hermes runs and shows the first reason, in Hermes’s words: the text must start with frontmatter that is closed, it must be YAML key: value pairs with a name and a description, and the instructions must not be empty. While there is a reason, Save stays off.' },
      ],
      related: ['skills', 'skills-new', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'skills-new',
      title: 'Skills: create a skill',
      summary: 'Write a new skill: a name, a short description and its instructions.',
      route: '/agents/skills/new',
      keywords: 'create new skill name category description 60 characters frontmatter extra keys instructions preview',
      body: [
        { p: 'A new [[skill|skill]] is a [[skill-md|SKILL.md]] in the folder of the profile this tab is scoped to ([[profile-scope|profile scope]]). Hermes writes it, and the agent can use it from the next session.' },
        { h: 'The fields' },
        {
          ul: [
            'Name: lowercase letters, numbers, dots, hyphens and underscores. It is the skill’s folder.',
            'Category (optional): one folder name that groups skills, such as writing.',
            'Description: at most 60 characters, so that Hermes’s skill index does not cut it. One sentence, with when to use the skill first.',
            'More frontmatter (optional): other [[frontmatter|frontmatter]] keys, one per line, such as version or metadata. They are written after name and description exactly as you type them.',
            'Instructions: the Markdown the agent reads.',
          ],
        },
        { p: 'Preview shows the file as it will read. While the page’s checks, which are the checks Hermes makes, find a reason, it shows the reason and Create skill stays off. Creating is a Tier 1 action (see [[risk-tiers|risk tiers]]): you confirm it. It is not allowed in [[read-only-mode|read-only mode]].' },
      ],
      related: ['skills', 'skills-editor', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'skills-hub',
      title: 'Skills: the hub',
      summary: 'Search the skills other people published, read the security scan, install, and update.',
      route: '/agents/skills/hub',
      keywords: 'skills hub search source official featured install update all security scan verdict install anyway override github skills.sh clawhub lobehub well-known browse.sh log pages',
      body: [
        { p: 'The [[skills-hub|skills hub]] is how [[hermes]] finds skills that are not on your machine yet. It works on one [[profile|profile]]: the one this tab is scoped to ([[profile-scope|profile scope]]). Everything on the page comes from Hermes each time you look, and Caduceus keeps no copy.' },
        { h: 'Finding a skill' },
        {
          ul: [
            'Type what you want and press Search. Hermes asks its sources and can take up to half a minute, so the page says it is waiting. Sources that do not answer in time are named, and their results are missing.',
            'The Source menu lists every source Hermes has: its official list, its own index, skills.sh, well-known sites, a direct link, GitHub, ClawHub, LobeHub and browse.sh. Choosing one searches only that source (the official list is always matched too).',
            'The official list is every optional skill that ships with Hermes. Hermes keeps it on disk, so it is there even when a search is not. With no query, choosing it shows the whole list.',
            'With no query and all sources, the page shows Featured: the skills Hermes’s index puts first.',
            'Results come ten to a page. The query, the source and the page are in the address, so a link or a reload shows the same results.',
          ],
        },
        { h: 'The security scan comes first' },
        { p: 'Opening a result shows its description, where it comes from and how far Hermes trusts that source, and the [[security-scan|security scan]] Hermes runs on a quarantined copy of it. The scan, with every finding, is above the Install button. Install stays off until the scan has finished, and stays off if Hermes could not scan the skill.' },
        {
          ul: [
            'A safe verdict that Hermes allows opens Install.',
            'A verdict that is not safe, which Hermes still allows for that source, opens Install anyway. The confirmation asks you to type override and the skill’s name, which is your explicit override.',
            'A verdict Hermes’s policy refuses keeps Install off and says why. Hermes’s install endpoint has no force option, so Caduceus cannot override it either. For a verdict that Hermes lets you force, the page shows the command to run in a terminal. For a dangerous skill from a community or trusted source, Hermes does not allow it at all.',
          ],
        },
        { h: 'Installing and updating' },
        { p: 'Install and Update all are Tier 3 (see [[risk-tiers|risk tiers]]): a passkey, then typing a name. They are not allowed in [[read-only-mode|read-only mode]] or while you are offline. After you confirm, Hermes runs the install in a process of its own, and a log sheet shows what it prints as it goes: a full-screen sheet on a phone. Closing the sheet does not stop Hermes. When it ends, the page checks the profile’s skills to see whether the skill is there, because Hermes can print “Not installed” and still end without an error. The Installed list shows the skill straight away.' },
        { p: 'Update all asks Hermes to install newer versions of the skills you installed from the hub. A skill whose files you changed is skipped, and the log names it.' },
      ],
      related: ['skills', 'skills-learn', 'skills-curator', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'skills-learn',
      title: 'Skills: learn a skill',
      summary: 'Ask the agent to study something and write what it learns as a skill, in Chat.',
      route: '/agents/skills/learn',
      keywords: 'learn skill learn-a-skill /learn topic chat passkey new chat folders links notes',
      body: [
        { p: '[[learn-a-skill|Learn a skill]] runs [[hermes]]’s own /learn command. You name what to study: folders, files, links, pasted notes, and what to focus on or leave out. Hermes turns that into a task for the agent, which reads the sources and saves a skill.' },
        { h: 'What happens' },
        {
          ol: [
            'You write the topic and press Start learning in a new chat.',
            'Caduceus opens a new chat in the profile this tab is scoped to ([[profile-scope|profile scope]]).',
            'The chat asks Hermes to run /learn with your topic. This is a Tier 2 action (see [[risk-tiers|risk tiers]]): it asks for a passkey, because the agent then reads files and links on its own. It is not allowed in [[read-only-mode|read-only mode]].',
            'Hermes answers with the prompt it built, and the chat sends it as the first message. You watch the agent work in Chat, and the new skill appears in the Installed list when it is saved.',
          ],
        },
        { p: 'The topic goes to the chat from memory. It is not put in the address or kept anywhere, so pasted notes stay out of your history.' },
      ],
      related: ['skills', 'skills-hub', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'skills-curator',
      title: 'Skills: the curator',
      summary: 'Hermes’s background skill keeper: its status, Pause and Resume, and Run now.',
      route: '/agents/skills/curator',
      keywords: 'curator pause resume run now review stale archive interval idle last run restore',
      body: [
        { p: 'The [[curator|curator]] is how [[hermes]] keeps a profile’s skills tidy. When the agent has been idle and the last review is older than the interval, it reviews the skills it manages: a skill that goes unused is marked stale, then archived. It never deletes one, and pinned skills are left alone. An archived skill comes back with hermes curator restore.' },
        { h: 'The status' },
        { p: 'The page shows what Hermes says for the profile this tab is scoped to ([[profile-scope|profile scope]]): whether the curator is on in the config, whether it is paused, when it last ran, how often it reviews, and the days after which a skill goes stale and is archived. After each action the page reads Hermes again, so it shows Hermes’s state and not a guess.' },
        {
          ul: [
            'Pause and Resume are Tier 1 (see [[risk-tiers|risk tiers]]): you confirm. A paused curator starts no reviews by itself; Run now still works.',
            'Run now is Tier 2: it asks for a passkey, because a review archives skills. Hermes runs it in a process of its own, and a log sheet shows what it prints. By default the review only marks and archives unused skills; it merges skills with a model only if its curator.consolidate setting is on.',
            'Both are blocked in [[read-only-mode|read-only mode]], and Run now while you are offline.',
          ],
        },
      ],
      related: ['skills', 'skills-hub', 'risk-tiers', 'read-only-mode'],
    },
  ],
  glossary: [
    {
      id: 'skill',
      term: 'Skill',
      definition: 'A written procedure the agent loads when a task needs it, kept as a SKILL.md file in a profile’s skills folder. Hermes lists, switches and loads skills per profile.',
      page: 'skills',
    },
    {
      id: 'skill-md',
      term: 'SKILL.md',
      definition: 'The file that is a skill: YAML frontmatter with its name and description, then the instructions in Markdown. A skill folder may hold more files beside it.',
      page: 'skills-editor',
    },
    {
      id: 'frontmatter',
      term: 'Frontmatter',
      definition: 'The YAML block between two --- lines at the top of a SKILL.md. Hermes needs its name and description; the other keys are the author’s own and are kept as written.',
      page: 'skills-editor',
    },
    {
      id: 'toolset-vs-skill',
      term: 'Toolset vs skill',
      definition: 'A toolset is a group of tools the agent can call, such as the terminal or the web. A skill is a written procedure the agent reads. Skills guide the agent; toolsets give it abilities.',
      page: 'skills',
    },
    {
      id: 'skills-hub',
      term: 'Skills hub',
      definition: 'The places Hermes searches for skills that other people published: its official list, its own index, and registries such as skills.sh and GitHub. Hermes scans a skill before it installs it.',
      page: 'skills-hub',
    },
    {
      id: 'security-scan',
      term: 'Security scan',
      definition: 'The check Hermes runs on a hub skill’s files before it installs it: it looks for things like commands piped to a shell, secrets read and sent away, and instructions that tell the agent to ignore its rules. The verdict is safe, caution or dangerous.',
      page: 'skills-hub',
    },
    {
      id: 'learn-a-skill',
      term: 'Learn a skill',
      definition: 'Hermes’s /learn command: you name something to study, and the agent reads it in a chat and saves what it learns as a new skill.',
      page: 'skills-learn',
    },
    {
      id: 'curator',
      term: 'Curator',
      definition: 'Hermes’s background keeper of its skills. It reviews them when the agent is idle, marks the ones nobody uses as stale and archives the oldest. It never deletes a skill.',
      page: 'skills-curator',
    },
  ],
};
