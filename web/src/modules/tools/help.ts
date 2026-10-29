import type { ModuleHelp } from '../../help.ts';

export const toolsHelp: ModuleHelp = {
  pages: [
    {
      id: 'tools',
      title: 'Tools & MCP: toolsets',
      summary: 'The toolsets of one profile: switch them, choose their provider and model, add their keys and run their setup.',
      route: '/agents/tools',
      keywords: 'tools toolsets toolset web browser terminal image video generation vision tts provider model keys api key setup post-setup switch enable disable configure needs keys ready',
      body: [
        { p: 'Tools & MCP works on one [[profile|profile]]: the one this tab is scoped to ([[profile-scope|profile scope]]), named under the title. Everything on the screen is read from [[hermes]] for that profile each time you look. Caduceus keeps no copy, so a reload, or the command line, shows the same values.' },
        { h: 'The grid' },
        { p: 'A [[toolset]] is a group of tools an agent can call, such as web search, the terminal or image generation. The grid lists every toolset Hermes reports for the profile. A phone shows the same toolsets as a list.' },
        {
          ul: [
            'The switch turns a toolset on or off for the profile. New sessions get its tools; a chat that is already open keeps the tools it has. It is a Tier 1 action ([[risk-tiers|risk tiers]]): you confirm.',
            'Ready means Hermes has what the toolset needs. Needs keys means a key or a sign-in is missing: open Configure.',
            'A toolset that belongs to one platform (Discord’s own) says so on its card.',
            'Switching Computer Use on when its driver is not installed makes Hermes start the install, and a log shows how it goes.',
            'Search matches a toolset’s name, description and tools. On, Off and Needs keys narrow the list.',
          ],
        },
        { h: 'Configure' },
        { p: 'Configure opens a panel: a full-screen sheet on a phone, a drawer elsewhere. It asks Hermes again each time, so it shows the state Hermes has now. A toolset with nothing to choose says so.' },
        {
          ul: [
            'Provider: the list is Hermes’s own, each with its readiness. Choosing one is a Tier 1 action and changes only the provider. The keys of the other providers stay.',
            'Keys: the fields are the ones the provider names, and are masked. Hermes never sends a saved key back: it says only whether one is set, and an empty field keeps it. Saving keys is a Tier 2 action: you confirm, then use a [[passkey|passkey]]. The audit trail names the variables, never a value.',
            'Setup: some providers need an install or a sign-in. Run setup is a Tier 3 action: you type the toolset’s name. Hermes runs the step as a process of its own and the log shows live. It ends as done or as failed with Hermes’s last line. You may close the log, and Hermes keeps going.',
            'Model: image and video generation have a model catalogue for the provider. Choosing one is a Tier 1 action.',
          ],
        },
        { p: 'A provider that needs the Nous Portal says so. Hermes saves the choice but it cannot work until you sign in; the panel gives the command to run on this computer. None of this is allowed in [[read-only-mode|read-only mode]] except reading.' },
      ],
      related: ['tools-mcp', 'tools-platforms', 'tools-routing', 'profile-scope', 'risk-tiers'],
    },
    {
      id: 'tools-mcp',
      title: 'Tools & MCP: MCP servers',
      summary: 'Add, edit, sign in to, test, switch and delete the MCP servers of a profile, and see the tools each one gives.',
      route: '/agents/tools/mcp',
      keywords: 'caduceus mcp server projects sessions register add to this profile mcp server servers model context protocol stdio http sse transport oauth sign in bearer token test tools inventory add edit delete enable disable env variables command arguments',
      body: [
        { p: 'An [[mcp-server|MCP server]] gives agents more tools. The list shows the servers in the [[profile|profile]]’s config, each with its status, its [[mcp-transport|transport]] and a switch. Everything is read from [[hermes]] each time you look. A server loads when a session starts, so a change reaches new sessions; a chat that is already open keeps the tools it has.' },
        { h: 'Add and edit' },
        {
          ul: [
            'A server is reached over a web address (HTTP or SSE) or by a program Hermes starts (a command, “stdio”). The form asks for what the choice needs and says what is wrong with each field.',
            'Adding an HTTP or SSE server is a Tier 2 action ([[risk-tiers|risk tiers]]): you confirm with your [[passkey|passkey]]. A Bearer token goes to Hermes, which keeps it in the profile’s .env file and never sends it back.',
            'Adding or saving a server that runs a command is a Tier 3 action: the confirmation shows the exact command and arguments, and you type the server’s name. The program runs on this computer with the access of your account, so read it.',
            'Hermes saves an edit by replacing the whole list of servers. Caduceus sends back every field the form does not show (timeouts, tool filters, headers, OAuth settings, the other servers) exactly as Hermes had it. A saved variable’s value is never shown: leave it blank to keep it.',
          ],
        },
        { h: 'Test, tools and sign-in' },
        {
          ul: [
            'Test connects to the server, asks for its tools and disconnects. For a command server Hermes starts the program for that moment. It shows success or the reason it failed, and the full [[mcp-tool-inventory|tool inventory]]: each tool’s name and description.',
            'The status on a card is what Hermes has without connecting: connected, not started yet, failed, or off.',
            'Sign in runs Hermes’s own OAuth flow for a server that uses it: open the provider’s page, sign in and allow access. Hermes finishes by itself when the provider sends the browser back to it. That address is Hermes’s own on the computer it runs on, so from a phone paste the address the browser ended at into the box under the link. If the flow fails, the reason shows.',
          ],
        },
        { h: 'Caduceus as an MCP server' },
        {
          ul: [
            'The card above the list is the [[caduceus-mcp-server|Caduceus MCP server]]: a server that lets an agent of the profile manage Hermes projects and sessions through Caduceus. Its tools list, create, rename and delete projects, and list, rename and move sessions.',
            'The card shows the exact command that registers it with Hermes, and Add to this profile makes the same registration. It is a command server, so adding it is a Tier 3 action: the confirmation shows the command and you type the name.',
            'Every call an agent makes goes through Caduceus’s own checks: [[risk-tiers|risk tiers]], [[read-only-mode|read-only mode]] and the audit log, with the agent named as the one who acted. It cannot give a passkey, so deleting a project is refused with the reason, and you delete it yourself.',
            'The server holds nothing: projects and sessions are Hermes’s. It reads a token from a file only you can read, in Caduceus’s folder, and Caduceus accepts that token only from this computer and only for these tools.',
          ],
        },
        { h: 'Switch and delete' },
        { p: 'The switch turns a server on or off without removing it (Tier 0, with an undo). Delete removes it from the profile’s config (Tier 1: the dialog names the server and the profile). Nothing here is allowed in [[read-only-mode|read-only mode]] except reading.' },
      ],
      related: ['tools-catalogue', 'tools', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'tools-catalogue',
      title: 'Tools & MCP: the catalogue',
      summary: 'Hermes’s curated list of MCP servers: search it and install an entry for a profile.',
      route: '/agents/tools/catalogue',
      keywords: 'mcp catalogue catalog install search entry server curated nous approved values env secret key oauth installed',
      body: [
        { p: 'The catalogue is Hermes’s curated list of [[mcp-server|MCP servers]]. Search matches an entry’s name, description and transport. Not installed and Installed narrow the list, and an entry the profile already has is marked.' },
        {
          ul: [
            'Install shows what the entry runs or reaches (its command and arguments, or its web address, and any build steps) before you commit to it, and asks for each value it needs in a masked field.',
            'Install is a Tier 3 action: you type the entry’s name. Hermes keeps secret values in the profile’s .env file and never sends them back; Caduceus shows them nowhere.',
            'The server then appears in MCP servers. An entry that signs in with OAuth needs a sign-in there; an entry that must be built runs as a background action and a log shows how it goes.',
          ],
        },
      ],
      related: ['tools-mcp', 'risk-tiers'],
    },
    {
      id: 'tools-platforms',
      title: 'Tools & MCP: per platform',
      summary: 'Edit which toolsets each platform gets, as a grid or as JSON.',
      route: '/agents/tools/platforms',
      keywords: 'platform toolsets platform_toolsets grid json advanced telegram discord slack cli default save config',
      body: [
        { p: '[[per-platform-toolsets|Per-platform toolsets]] are the lists Hermes keeps in the profile’s config under platform_toolsets: which toolsets the command line, Telegram, Discord and every other platform get. This tab edits that one value two ways, and both show the same draft.' },
        {
          ul: [
            'The grid has a row for each toolset and a column for each platform that has a list. The CLI is always there. A box is a toolset the platform gets.',
            'A platform with no list of its own gets Hermes’s default for it, and its column says so. The first box you change on it saves a list that starts from what Hermes showed. Add platform gives another platform a list of its own, starting from what the CLI has. Use default removes a list.',
            'A toolset that belongs to one platform is a dash on the others. Speech-to-text and the context engine have their own switches in the config, so they are not columns.',
            'A list may also name a bundle such as hermes-cli, or an MCP server. The grid keeps those as they are and says so under it; a bundle may switch on more than the boxes show.',
          ],
        },
        { h: 'Advanced: JSON' },
        { p: 'The Advanced section holds the same value as JSON: an object with a list of toolset names for each platform. Typing valid JSON changes the grid and the grid changes the text. While the JSON is invalid the page says why and Save is off. A phone shows the JSON read-only: edit it on a larger screen.' },
        { h: 'Saving' },
        { p: 'Save is a config write, so it is a Tier 3 action: you type the profile’s name and confirm with your [[passkey|passkey]]. It is not allowed in [[read-only-mode|read-only mode]]. Only the platforms that changed are sent. New sessions use the lists; a chat that is already open keeps the tools it has.' },
      ],
      related: ['tools', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'tools-routing',
      title: 'Tools & MCP: Tool routing and Computer use',
      summary: 'How tools are routed through the Nous Portal, and the permissions Computer use needs.',
      route: '/agents/tools/routing',
      keywords: 'tool routing tool gateway nous portal routing subscription computer use permissions accessibility screen recording macos driver grant',
      body: [
        { p: 'The [[tool-gateway|Tool routing]] card shows where Hermes gets each kind of tool for the profile: through the Nous Portal’s backends (“via Nous Portal”), or from a provider set up in the toolset. Hermes reports it and Caduceus only reads it. To change a route, choose a provider in the toolset.' },
        { h: 'Computer use' },
        { p: 'Computer use lets an agent see and drive this computer’s screen. The card shows whether the driver is installed, and on a Mac whether Accessibility and Screen recording are granted, as Hermes reports them.' },
        {
          ul: [
            'Grant permissions asks Hermes to request them from macOS. Only you can approve, in the dialogs macOS shows on this computer. It is a Tier 3 action: you type the profile’s name. A log shows Hermes’s part.',
            'Caduceus cannot take a permission back. Do that in System Settings › Privacy & Security.',
            'With no driver, switch Computer Use on in Toolsets: Hermes then installs it.',
          ],
        },
      ],
      related: ['tools', 'risk-tiers'],
    },
    {
      id: 'tools-hooks',
      title: 'Tools & MCP: shell hooks',
      summary: 'The commands Hermes runs when an event happens in a session of a profile: list, create and remove them.',
      route: '/agents/tools/hooks',
      keywords: 'hook hooks shell hook event command script matcher timeout consent allowlist approve pre_tool_call on_session_start create remove run command',
      body: [
        { p: 'A [[shell-hook|shell hook]] is a command Hermes runs on this computer when an event happens in a session, such as before a tool is used or when a session starts. The list shows the hooks in the [[profile|profile]]’s config, as [[hermes]] reports them: the event, the whole command, the profile, and whether Hermes has your consent on record for that command. Without consent a hook does not run. New sessions run the hooks; a chat that is already open keeps the hooks it started with.' },
        { h: 'Create a hook' },
        {
          ul: [
            'Choose the event from Hermes’s list and give the command: the path of a script, or a program and its arguments, on one line. Hermes sends the event’s details to it as JSON on its standard input. A matcher narrows a tool event to some tool calls, and a timeout limits how long the command may run (Hermes uses 60 seconds).',
            'Creating a hook is a Tier 3 action ([[risk-tiers|risk tiers]]): the command runs with the access of your account, so the confirmation shows it whole and you type it. Hermes then writes the hook to the config and records your consent for that exact command.',
            'A hook marked “Hermes cannot run it as written” points at a script Hermes cannot find or run. Fix the script’s path or its permissions on this computer.',
          ],
        },
        { h: 'Remove a hook' },
        { p: 'Remove is a Tier 2 action: you confirm with your [[passkey|passkey]]. Hermes takes the hook out of the profile’s config and withdraws its consent, so adding the same command again asks for consent again. On a phone, Remove is in the ⋮ menu of the hook. Creating and removing are not allowed in [[read-only-mode|read-only mode]] or while you are offline; the list can still be read.' },
      ],
      related: ['tools', 'tools-terminal', 'risk-tiers', 'read-only-mode'],
    },
    {
      id: 'tools-terminal',
      title: 'Tools & MCP: terminal backend',
      summary: 'Where the commands and files of a profile’s agent live: this Mac, an SSH host, a container or a cloud sandbox, and the folder it starts in.',
      route: '/agents/tools/terminal',
      keywords: 'terminal backend local ssh docker podman singularity modal daytona remote workspace working directory cwd folder restart ready needs setup',
      body: [
        { p: 'The [[terminal-backend|terminal backend]] decides where the terminal tool of a [[profile|profile]]’s agent runs: on the Mac that runs [[hermes]] (Local), on another machine over SSH, or in a Docker, Podman, Singularity, Modal or Daytona environment. The choices, and what each one still needs, are what Hermes reports. A change reaches new sessions.' },
        {
          ul: [
            'Ready means Hermes found what the backend needs. Needs setup says in Hermes’s words what is missing, such as an SSH host and user in the config. You can still choose such a backend; it does not work until the setting is made, in System › Config.',
            'Choosing a backend is a Tier 3 action ([[risk-tiers|risk tiers]]): you type the backend’s name. It is not allowed in [[read-only-mode|read-only mode]]. If Hermes reports that the change needs a restart, a note says so.',
          ],
        },
        { h: 'Working directory' },
        { p: 'The folder the terminal starts in, kept as terminal.cwd in the profile’s config. Saving it is a Tier 3 action: you type the profile’s name. Under the Local backend Hermes checks that the folder exists. Under any other backend the path is on the other machine, which Hermes cannot look at from here, so it is saved as you type it.' },
        { h: 'Remote workspaces' },
        { p: 'When the backend is not Local, the workspace chip in a chat and the workspace of a task are labelled Remote: the path is a [[remote-workspace|remote workspace]]. Under SSH, Hermes does not check the workspace you pick for a chat: it takes the path as you type it. Under the other backends Hermes still checks a workspace you pick for a chat or a task on its own Mac, so a path that exists only on the remote machine is refused with Hermes’s own message. Caduceus shows that message and says why; it does not hide it.' },
      ],
      related: ['tools', 'tools-hooks', 'risk-tiers', 'read-only-mode'],
    },
  ],
  glossary: [
    {
      id: 'mcp-server',
      term: 'MCP server',
      definition: 'A program or web service that gives agents more tools through the Model Context Protocol. Hermes loads the servers in a profile’s config when a session starts.',
      page: 'tools-mcp',
    },
    {
      id: 'caduceus-mcp-server',
      term: 'Caduceus MCP server',
      definition: 'An MCP server that Caduceus provides, so that agents can manage Hermes projects and sessions. Each call passes Caduceus’s tiers, read-only mode and audit log; an action that needs your passkey is refused.',
      page: 'tools-mcp',
    },
    {
      id: 'mcp-transport',
      term: 'Transport (stdio, HTTP, SSE)',
      definition: 'How Hermes reaches an MCP server. Stdio starts a program on this computer and talks to it directly; HTTP and SSE connect to a web address. A stdio server runs code with the access of your account, so it needs a stricter confirmation.',
      page: 'tools-mcp',
    },
    {
      id: 'mcp-tool-inventory',
      term: 'Tool inventory',
      definition: 'The list of tools an MCP server offers, with each tool’s name and description. A test of the server asks for it.',
      page: 'tools-mcp',
    },
    {
      id: 'toolset',
      term: 'Toolset',
      definition: 'A group of tools an agent can call, such as web search, the terminal or image generation. Hermes switches them on and off per platform, and some need a provider or a key.',
      page: 'tools',
    },
    {
      id: 'per-platform-toolsets',
      term: 'Per-platform toolsets',
      definition: 'The lists in a profile’s config that say which toolsets each platform gets: the command line, Telegram, Discord and so on. A platform with no list gets Hermes’s default for it.',
      page: 'tools-platforms',
    },
    {
      id: 'tool-gateway',
      term: 'Tool routing',
      definition: 'The Nous Portal’s hosted backends for tools such as web search, image generation and the browser. When a tool is routed through it, Hermes uses your Portal subscription instead of a key of your own.',
      page: 'tools-routing',
    },
    {
      id: 'shell-hook',
      term: 'Shell hook',
      definition: 'A command Hermes runs on this computer when an event happens in a session, such as before a tool is used. Hermes runs it only for a command you consented to, with the access of your account.',
      page: 'tools-hooks',
    },
    {
      id: 'terminal-backend',
      term: 'Terminal backend',
      definition: 'Where the terminal tool of an agent runs its commands: on the Mac that runs Hermes (local), over SSH on another machine, or in a Docker, Podman, Singularity, Modal or Daytona environment.',
      page: 'tools-terminal',
    },
    {
      id: 'remote-workspace',
      term: 'Remote workspace',
      definition: 'A workspace path on the machine of a remote terminal backend rather than on the Mac that runs Hermes. Under SSH, Hermes takes the path of a chat as typed; under the other backends it checks a workspace on its own Mac, so it can refuse a path that only exists remotely.',
      page: 'tools-terminal',
    },
  ],
};
