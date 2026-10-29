import type { ModuleHelp } from '../../help.ts';

export const memoryHelp: ModuleHelp = {
  pages: [
    {
      id: 'memory',
      title: 'Memory: provider',
      summary: 'The memory providers of one profile: choose one, fill in its settings, install what it needs and sign in to it.',
      route: '/agents/memory',
      keywords: 'memory provider providers honcho hindsight mem0 holographic supermemory retaindb byterover openviking api key settings oauth sign in connect setup install built-in',
      body: [
        { p: 'Memory works on one [[profile|profile]]: the one this tab is scoped to ([[profile-scope|profile scope]]), named under the title. Everything on the screen is read from [[hermes]] each time you look. Caduceus keeps no copy, so a reload, or the command line, shows the same values.' },
        { p: 'A [[memory-provider|memory provider]] remembers things across sessions, besides the built-in [[memory-md|MEMORY.md]] and [[user-md|USER.md]]. Only one provider is active for a profile. The list is Hermes’s, with its own status for each: Ready, Needs settings, or Not installed. Hermes comes with only a few providers (ByteRover and RetainDB). The others, such as Hindsight, Honcho, Mem0 and Holographic, are plugins: install one from the catalogue under System › Plugins, in the profile that will use it, and it appears in this list.' },
        { h: 'Choosing and configuring' },
        {
          ul: [
            'Use makes a ready provider the profile’s. It is a Tier 1 action ([[risk-tiers|risk tiers]]): you confirm. Use built-in memory goes back to MEMORY.md and USER.md alone. New sessions use the choice; a chat that is already open keeps the provider it started with.',
            'Settings opens a full-screen sheet on a phone and a dialog elsewhere. Its fields are the ones Hermes gives for that provider: Caduceus has no list of its own, so a provider Hermes learns tomorrow has a form tomorrow. Fields are grouped as Hermes groups them, and a field that depends on another appears when that one has its value.',
            'A key or token is masked. Hermes never sends a saved key back: it says only whether one is set, and an empty field keeps it. The button is Save and use this provider, because saving also makes the provider the profile’s. It is a Tier 2 action: you confirm, then use a [[passkey|passkey]]. It stays switched off until the provider is installed; run its setup first. Choices that are plainly true or false read Yes and No.',
            'Set up shows what a provider needs installed (Python packages and commands) and runs it through Hermes. It is a Tier 3 action: the confirmation lists what will run on this computer, and you type the provider’s name.',
          ],
        },
        { h: 'Signing in' },
        { p: 'A provider that has its own sign-in (Honcho) shows a Sign in box. Connect asks Hermes to start the sign-in. Hermes opens the provider’s page in the browser of the computer it runs on and waits there for you to sign in and allow access, so do it at that computer, not on a phone. The box then shows Connected, or the reason Hermes gives when the sign-in fails. Starting it is a Tier 1 action. None of this is allowed in [[read-only-mode|read-only mode]] except reading.' },
      ],
      related: ['memory-engine', 'memory-built-in', 'memory-hindsight', 'profile-scope', 'risk-tiers'],
    },
    {
      id: 'memory-engine',
      title: 'Memory: context engine',
      summary: 'Choose the context engine of a profile, which decides how a long chat is compacted.',
      route: '/agents/memory/engine',
      keywords: 'context engine compressor compaction compress summarise context window plugin lcm',
      body: [
        { p: 'The [[context-engine|context engine]] decides how a long chat is compacted when its context fills up. Hermes’s own compressor is the default. A plugin can provide others, and plugins are installed on this computer, so the same engines are on offer for every profile.' },
        {
          ul: [
            'The list is Hermes’s: its built-in compressor and every engine a plugin registers. The engine in use is marked.',
            'An engine the profile’s config names that no plugin provides is still shown, marked Not installed, so you can switch away from it.',
            'Save context engine is a Tier 2 action ([[risk-tiers|risk tiers]]): you confirm, then use a [[passkey|passkey]]. New sessions use it; a chat that is already open keeps its engine.',
          ],
        },
        { p: 'A reload shows what Hermes keeps in the profile’s config, so a change made on the command line shows here too. Nothing is allowed in [[read-only-mode|read-only mode]] except reading.' },
      ],
      related: ['memory', 'profile-scope', 'risk-tiers'],
    },
    {
      id: 'memory-built-in',
      title: 'Memory: built-in memory',
      summary: 'How full MEMORY.md and USER.md are, and how to reset them.',
      route: '/agents/memory/built-in',
      keywords: 'built-in memory memory.md user.md size limit characters reset delete clear snapshot history editors',
      body: [
        { p: 'The built-in memory is [[memory-md|MEMORY.md]], what the agent has learned, and [[user-md|USER.md]], what it knows about you. Hermes limits the size of each. The meters show the characters in each file against the limit, and the size on disk.' },
        {
          ul: [
            'Open the editors takes you to the profile’s Memory tab, where each file can be read, edited and restored from History.',
            'Reset deletes MEMORY.md, USER.md or both in Hermes. It is a Tier 3 action ([[risk-tiers|risk tiers]]): you type the profile’s name. Caduceus keeps the text as a [[snapshot|snapshot]] first, so History can put it back.',
          ],
        },
        { p: 'Nothing here is allowed in [[read-only-mode|read-only mode]] except reading.' },
      ],
      related: ['memory', 'memory-graph', 'risk-tiers'],
    },
    {
      id: 'memory-graph',
      title: 'Memory: learning graph',
      summary: 'What the profile has learned, as a graph of skills and memory chunks, with a list for the keyboard and phones.',
      route: '/agents/memory/graph',
      keywords: 'learning graph learned skills memory chunks nodes edges links edit delete archive agent made curator journey',
      body: [
        { p: 'The [[learning-graph|learning graph]] is Hermes’s picture of what the profile has learned. Its nodes are skills the agent made, was taught with /learn or has used, and each chunk of [[memory-md|MEMORY.md]] and [[user-md|USER.md]]. A line joins two skills when one names the other, and a memory chunk to the skills it shares words with.' },
        {
          ul: [
            'On a wide screen you can choose Graph or List. Under 600 pixels only the list is shown. The list has every node, grouped by category, with what it is linked to, and it works with the keyboard and a screen reader. The drawing is for the eye.',
            'Search narrows the list by a node’s name or category.',
            'Open a node to read it. A skill shows its whole SKILL.md and a memory chunk its text.',
            'Save changes rewrites the node in Hermes. Archive skill removes a skill from the profile’s skills (Hermes keeps it, and hermes curator restore brings it back); Delete chunk takes a chunk out of its file. Both are Tier 1 actions ([[risk-tiers|risk tiers]]): you confirm. For a memory chunk Caduceus keeps the file’s old text as a [[snapshot|snapshot]].',
            'Hermes refuses some changes and says why: a pinned skill cannot be archived, and a chunk cannot be saved empty. Its reason is shown.',
          ],
        },
        { p: 'Nothing here can be changed in [[read-only-mode|read-only mode]]. With nothing learned yet the screen says how to begin.' },
      ],
      related: ['memory-built-in', 'memory', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'memory-context',
      title: 'Memory: project context',
      summary: 'What Hermes detects in a folder: manifests, package managers, check commands and the context files it reads.',
      route: '/agents/memory/context',
      keywords: 'project context facts folder workspace manifest package manager verify commands agents.md context files project.facts',
      body: [
        { p: 'Project context is what Hermes finds in a folder the agent works in. Pick a folder (it starts at the folder Hermes starts in) and the screen asks Hermes for the project’s facts: its root, its manifests such as package.json, its package managers, the commands that check the work, and the context files such as AGENTS.md that go into the agent’s prompt. The text of each context file is shown below.' },
        { p: 'It is read-only: change a project’s context by editing its files. A folder that is no project says how a folder becomes one.' },
      ],
      related: ['memory', 'memory-wiki'],
    },
    {
      id: 'memory-wiki',
      title: 'Memory: LLM Wiki',
      summary: 'Read the pages of the profile’s LLM Wiki.',
      route: '/agents/memory/wiki',
      keywords: 'llm wiki karpathy pages markdown knowledge base index schema wiki path llm-wiki skill',
      body: [
        { p: 'The [[llm-wiki|LLM Wiki]] is a folder of linked Markdown pages that the agent writes and keeps as it learns. This screen is a read-only view of it, read through Hermes’s file listing. The folder is the profile’s skills.config.wiki.path, or ~/wiki when that is not set; you can also type another folder.' },
        { p: 'Folders and pages are listed, with index.md first. Choose a page to read it. When there is no wiki yet the screen says how to start one: ask the agent to create a wiki with the llm-wiki skill.' },
      ],
      related: ['memory', 'memory-context'],
    },
    {
      id: 'memory-hindsight',
      title: 'Memory: Hindsight',
      summary: 'Browse a Hindsight memory bank (memories, directives, mental models), ask it with recall and reflect, and add a memory.',
      route: '/agents/memory/hindsight',
      keywords: 'hindsight memory bank memories directives mental models recall reflect retain add facts observations vectorize cloud local external api key budget not connected',
      body: [
        { p: '[[hindsight|Hindsight]] is a memory service Hermes can use as its [[memory-provider|memory provider]]. This tab is there while Hindsight is the provider of the profile this tab is scoped to ([[profile-scope|profile scope]]). Its address also opens when it is not, and then says how to turn Hindsight on: choose it on the Provider tab and save its settings.' },
        { p: 'Hermes keeps only Hindsight’s settings and its key. Caduceus reads both from Hermes, asks Hindsight itself, and shows what it says. The key is read through Hermes’s audited key reveal, stays in the Caduceus server, and is never sent to the browser. Caduceus keeps nothing of what Hindsight says except the list of banks, which it shows when Hindsight cannot be reached.' },
        { h: 'When it is not connected' },
        { p: 'The tab says so in words instead of failing: Hindsight is not the provider, it runs inside Hermes where only Hermes can reach it (the local_embedded mode), its plugin is not installed in this profile (Hermes names Hindsight but has no code for it: install it from the catalogue under System › Plugins), it did not answer (the address in the settings may be wrong, or the server is stopped), or it refused the key. Try again asks once more; Provider settings opens the form.' },
        { h: 'Browsing' },
        {
          ul: [
            'Choose a bank at the top. A profile writes to one bank (named in its settings, or built from a template), and the list shows every bank Hindsight has.',
            'Memories lists what the bank holds, as facts, experiences and observations. Search first, then open one for its context, time and tags. On a phone the list opens a sheet.',
            'A [[directive|directive]] is a rule the bank always applies. A [[mental-model|mental model]] is a summary Hindsight keeps up to date. Both are shown as Hindsight holds them; change them in Hindsight itself.',
          ],
        },
        { h: 'Asking and adding' },
        {
          ul: [
            'Recall lists the memories that match a question, best first. Reflect asks Hindsight to write an answer from the bank, with the memories, directives and mental models it used. Both only read, so they work in [[read-only-mode|read-only mode]]. How hard to look sets Hindsight’s budget: low is quick, high is thorough.',
            'Add a memory writes to the bank. It is a Tier 1 action ([[risk-tiers|risk tiers]]): you confirm. Hindsight takes the text in and extracts facts from it in the background, so it may take a moment to show in Memories.',
            'Every call is recorded in the audit log by what it was and the bank, never by the question or the memory.',
          ],
        },
      ],
      related: ['memory', 'memory-notes', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'memory-notes',
      title: 'Memory: Notes',
      summary: 'Search and read notes kept in other apps through their MCP servers, read-only.',
      route: '/agents/memory/notes',
      keywords: 'external notes mcp server source search preview obsidian notion note snippets read-only approve command stdio http',
      body: [
        { p: '[[external-notes|External notes]] are notes kept in another app that has an [[mcp-server|MCP server]]. The list shows the MCP servers in the profile’s Hermes settings ([[profile-scope|profile scope]]). To use one, mark it with Use for notes. Hermes’s own copy of the settings is never changed by this.' },
        { p: 'Caduceus acts as an MCP client for the search and the preview. It only calls tools that read or search: a tool whose name says it creates, changes, deletes or runs something is never called, however the page asks, and a server’s own claim that a tool is read-only does not make one allowed.' },
        {
          ul: [
            'A server that runs a command on this computer needs your approval the first time (and again if its command in Hermes’s settings changes). Approve command is a Tier 3 action ([[risk-tiers|risk tiers]]): you confirm with a [[passkey|passkey]] and type the server’s name. The command line is shown so you can read it first.',
            'A server with a web address needs no approval; Caduceus sends it the headers Hermes holds for it. A server that signs in with OAuth, or whose settings use ${NAME} variables, cannot be used here.',
            'Search shows snippets. Choose one to open the note read-only; nothing can be edited. On a phone the search box comes first and a note opens in a sheet.',
            'Stop using takes the server off the list of notes sources and forgets the approval. Searching and opening work in [[read-only-mode|read-only mode]]; marking and approving do not.',
            'Each search and each opened note is recorded in the audit log by server and tool, never by what was searched for. Nothing a note said is kept.',
          ],
        },
      ],
      related: ['memory', 'memory-hindsight', 'tools-mcp', 'risk-tiers'],
    },
  ],
  glossary: [
    {
      id: 'memory-provider',
      term: 'Memory provider',
      definition: 'A service or plugin that remembers things across sessions, besides the built-in MEMORY.md and USER.md. One provider is active per profile; its settings are the form Hermes gives for it.',
      page: 'memory',
    },
    {
      id: 'context-engine',
      term: 'Context engine',
      definition: 'The part of Hermes that decides how a long chat is compacted when the context window fills up. Hermes’s own compressor is the default, and a plugin can provide another.',
      page: 'memory-engine',
    },
    {
      id: 'learning-graph',
      term: 'Learning graph',
      definition: 'Hermes’s picture of what a profile has learned: the skills its agent made or used and the chunks of its memory files, joined by what they share.',
      page: 'memory-graph',
    },
    {
      id: 'llm-wiki',
      term: 'LLM Wiki',
      definition: 'A folder of linked Markdown pages the agent builds and maintains as a knowledge base, using Hermes’s llm-wiki skill. Caduceus shows it read-only.',
      page: 'memory-wiki',
    },
    {
      id: 'hindsight',
      term: 'Hindsight',
      definition: 'A memory service that stores what an agent learns as facts in a bank, with entity links and several ways of recalling them. Hermes can use it as its memory provider; Caduceus can browse its bank.',
      page: 'memory-hindsight',
    },
    {
      id: 'directive',
      term: 'Directive',
      definition: 'A rule a Hindsight bank always applies when it reflects on a question, such as “answer in two sentences”. It has a priority and can be switched off.',
      page: 'memory-hindsight',
    },
    {
      id: 'mental-model',
      term: 'Mental model',
      definition: 'A summary Hindsight keeps up to date about a topic by asking a question of the bank again as it learns more.',
      page: 'memory-hindsight',
    },
    {
      id: 'external-notes',
      term: 'External notes',
      definition: 'Notes kept in another app, reached through that app’s MCP server. Caduceus can search them and open a note, read-only, with the server’s read and search tools.',
      page: 'memory-notes',
    },
  ],
};
