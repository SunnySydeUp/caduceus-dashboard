# Caduceus user guide

This guide is for the person who runs Caduceus. It does not need any programming knowledge. For the developer's view, see [`AGENTS.md`](../AGENTS.md) and [`design/architecture.md`](design/architecture.md). For open decisions and known limits, see [`STATUS.md`](STATUS.md).

## What Caduceus is

Caduceus is a dashboard for [Hermes Agent](https://github.com/NousResearch/hermes-agent). You use it on your phone or in a browser to talk to Hermes, to approve what it asks, to plan its work and to look after it.

Hermes keeps all the agent data: chats, tasks, schedules, skills, memory, settings. Caduceus only shows and changes that data through Hermes. Caduceus keeps a small store of its own (see "Where your data lives").

Caduceus runs on your Mac as a background service. It starts when you log in. It starts again if it stops.

## Open Caduceus

**On the Mac.** Open `http://localhost:9130` in a browser.

**On your phone.** Turn Tailscale on. Open `https://<your-mac>.<your-tailnet>.ts.net:9443` (the address `npm run caduceus -- setup` printed). This address works only on your tailnet. It is not on the public internet.

### The first time
1. On the Mac, open `http://localhost:9130`. Set the owner password. It needs at least 12 characters. You can set the password only from the Mac, and only once.
2. On the phone, open the `https://` address and sign in with the password.
3. Go to **Settings › Security** and add a **passkey** (Face ID, Touch ID or a security key). Then you can sign in with the passkey and skip the password. You may turn the password off once a passkey works. Caduceus always keeps at least one way to sign in.
4. Add Caduceus to the Home Screen. Settings › **Install app** shows the steps for your device. On an iPhone: open the address in Safari, tap **Share**, then **Add to Home Screen**. Open Caduceus from the new icon from then on.

A sign-in lasts up to 30 days, or 7 days without use. After five wrong passwords the sign-in locks for a minute, and the lock grows with each further failure.

If the setup guide is not finished, Today offers it until you finish or skip it, and **Settings › Setup guide** (`/onboarding`) opens it again. It checks Hermes and this device and helps you set up a provider, a default folder and notifications.

## A tour of the app

The navigation has these areas. On a phone, the bottom bar shows Today, Talk, Work and More. More opens Control, which lists the rest. On a large screen the sidebar shows Today, Talk and Work, then your crew of agents, then Search and Control. The search button, or `⌘K` / `Ctrl+K`, opens the command palette: type a screen name or an action.

The profile chip in the top bar chooses which Hermes profile you look at. "All profiles" is available on screens that can show every profile.

Every screen has a help button, or press `?`. The help is written in plain words and works offline.

### Today (`/today`)
The opening screen: what needs you, and what is ready.
1. **Needs you**: answer approvals and questions in place. "Allow always" asks for your passkey.
2. **Ready for review**: work that finished and you have not opened yet. Open it and it leaves the list.
3. **Schedule**: a 24-hour bar with a Now marker, then the next and past runs of your routines.
4. **While you were away**: runs and routine results since you last opened Today.
The old addresses `/home` and `/inbox` open Today.

### Talk (`/chat`)
Talk to an agent. Pick an agent from the crew (a sigil, its name, and one line about what it is doing). Its latest conversation opens, and its sessions stay listed: the **Sessions** button on a phone, a column on a larger screen. The same chat can be picked up on any device.
1. Start a chat with **New chat** (`⇧⌘O`) and send a message. While the agent answers, you can steer it, queue a message or stop it.
2. Under the message box choose what the message does: **Ask** sends it, **Delegate** starts it as a background run and tells you when it needs you or finishes, **Repeat** opens the schedule builder with your words filled in.
3. When another agent, or another session of this agent, needs you, a tray above the message box says so. Open it to answer in place.
4. **Details** shows what the agent is doing right now, its workspace, its work and its model, folder and cost.
5. Attach photos and files, or use the microphone to dictate (see Settings › Voice). Find old chats with search, pin or archive them, and share a read-only link to one (Settings › Security shows your share links).

Chat settings are in **Settings › Chat** (`/settings/chat`). **Take over** in Details can show the chat as Hermes's own terminal (Terminal mode).

### Notices (`/notices`)
In Control, group Main. What waits for you that is not a decision: failed schedules, notes for your information and the Activity feed of runs that finished. Snooze or dismiss what can wait. Approvals, questions and task reviews are on Today and in the Talk tray.

### Work (`/work`)
Work uses Hermes Kanban and Hermes cron. Its opening view, **Overview**, lists everything in flight by state: Waiting on you, Running, Ready for review, Scheduled. Choose an agent to narrow it. Five more screens are one tap away: **Board**, **Tasks**, **Schedules**, **Playbooks** and **Projects**.
1. **Board** and **Tasks**: create a task with a brief, set how it is dispatched, and follow its runs. Open a run to see the steps and the live worker log.
2. **Schedules** (`/work/schedules`): create a recurring job or script job, and see the next and last run.
3. **Playbooks** (`/work/playbooks`): start a multi-stage playbook, such as Software Delivery or Deep Research. Gates ask you to approve. **Projects** (`/work/projects`) holds your registered workspaces (folders).

### Agents (`/agents/profiles`)
The agents themselves. Each part belongs to one profile.
1. **Profiles**: create a profile with the builder, edit its soul and instruction files, make one the default.
2. **Models** (`/agents/models`): choose the main model, the fallback chain, side-task models and local models.
3. **Skills**, **Memory** and **Tools & MCP**: switch skills on or off, find skills in the hub, choose the memory provider, switch toolsets and add MCP servers.

### Connect (`/connect/gateway`)
How Hermes talks to chat platforms.
1. **Gateway**: see whether each profile's gateway runs, and start, stop or restart it.
2. **Channels** (`/connect/channels`): set up Telegram, WhatsApp and the other platforms, with a QR code where Hermes supports it.
3. **Pairing** and **Webhooks**: approve or revoke the people who write to your bots, and create webhook addresses for outside services.

### Observe (`/observe/health`)
1. **Health**: every part of the system and its Repairs (see "Troubleshooting").
2. **Insights** (`/observe/insights`): tokens, cost and activity by model and profile, and your **budgets**. A budget can pause unattended work when it is used up.
3. **Logs** (`/observe/logs`): Hermes's log files with filters, search and a live tail.

### System (`/system/config`)
Hermes's own settings and upkeep.
1. **Config**: Hermes's settings as a form, or as YAML text (`/system/config/yaml`). You review each change before you save it.
2. **Keys** (`/system/keys`): provider keys and account sign-ins. Keys are masked. Showing one needs your passkey and a typed confirmation.
3. **Maintenance** (`/system/maintenance`): update Hermes and Caduceus, run diagnostics, back up and restore. **Plugins** (`/system/plugins`) turns Hermes plugins on or off.

### Workspace (`/workspace/files`)
The files Hermes works on.
1. **Files**: browse, preview, edit text and Office files, upload, rename and move.
2. **Git** (`/workspace/git`): see changes, commit and push.
3. **Checkpoints**, **Terminal** and **Artifacts**: restore a snapshot the agent took, open a real shell on the Mac (behind your passkey), and read the reports that runs handed in.

### Settings (`/settings`)
Settings are for this device and for you.
1. **Security** (`/system/security`): passkeys, password, read-only mode, signed-in devices, and **Sign out every other device**. The **Audit log** (`/system/security/audit`) lists everything Caduceus recorded.
2. **Notifications**: turn on push for this device, choose what to be told of, set quiet hours and a digest.
3. **Appearance**, **Keyboard**, **Voice**, **Install app** and **Navigation** (order and hide entries).

## Risk tiers in plain words

Caduceus sorts every action by how much harm it can do. The tier decides how much it asks of you.

| Tier | What it means | What you do |
|---|---|---|
| Tier 0 | Small and easy to undo, such as a rename or a pin | Nothing. An undo toast appears. |
| Tier 1 | Worth a second look, such as starting a run or committing in a workspace | Confirm in a dialog. It names the object and the profile. |
| Tier 2 | Changes how things run or what can sign in, such as restarting the gateway or writing a key | Confirm, then prove it is you with a **step-up**. |
| Tier 3 | Can lose data or give access to secrets, such as deleting a profile, changing raw config, restoring a backup or writing a file outside a workspace | Step-up, then a **typed confirmation**. The dialog says whether the change can be undone. |

The dialogs do not show the tier number. They show what you have to do: **Confirm** (Tier 1), **Needs your passkey** (Tier 2) or **Needs your passkey and the name** (Tier 3). If you have no passkey yet, the dialog says so before you start and links to **Add a passkey** in Settings › Security.

**Step-up** means you use your passkey again, even though you are signed in. It lasts 5 minutes, for that device only. Then the next Tier 2 or 3 action asks again.

**Typed confirmation** means you type the name of the thing you change, for example the profile name. This stops a slip of the finger. Your confirmation works for one action, and only for 60 seconds.

Some things are **denied** and never run from Caduceus, for example running a raw shell command through the agent's gateway. The terminal is the place for shell access, and it needs your passkey.

Tier 3 actions are not available in read-only mode, and not while the phone is offline.

## Read-only mode

Read-only mode lets you look but not change. Go to **Settings › Security › Read-only mode** and turn it on or off. Both need a step-up. A banner shows while it is on. Reads still work. Reading secrets, such as showing a key or downloading a backup, is blocked too.

Caduceus can turn it on by itself. It does this when the Hermes it runs no longer matches the version Caduceus was built for. A banner and a Repair in Health say so. Caduceus never turns it off again by itself. You do, in Settings › Security, once you have fixed the cause.

## Keyboard shortcuts

On a Mac, `mod` below means `⌘`. Elsewhere it means `Ctrl`. Settings › **Keyboard** lists every shortcut and lets you change them. You can also turn off all single-key shortcuts there. `?` opens the help panel, which has a Shortcuts tab.

| Keys | What happens |
|---|---|
| `mod+K` | Open the command palette |
| `?` | Show help for this screen |
| `mod+Shift+O` | New chat |
| `g` then `h` | Go to Today |
| `g` then `c` | Go to Talk |
| `g` then `w` | Go to Work |
| `g` then `b` | Go to Board |
| `g` then `t` | Go to Tasks |
| `g` then `s` | Go to Schedules |
| `g` then `p` | Go to Profiles |
| `g` then `n` | Go to Gateway |
| `g` then `k` | Go to Channels |
| `g` then `e` | Go to Health |
| `g` then `l` | Go to Logs |
| `g` then `o` | Go to Config |
| `g` then `,` | Go to Settings |

In the chat list, `j` / `k` or the arrow keys move up and down. Single-key shortcuts do not work while you type in a text field or while a sheet is open.

## Where your data lives

- **Hermes owns the agent data**: profiles, chats, tasks, schedules, skills, memory, config and keys. It lives in `~/.hermes` (and in each profile's folder).
- **Caduceus keeps only its own store** in `~/.hermes/caduceus/`. This folder is readable only by you. It holds:
  - the password hash, passkeys and sign-in sessions;
  - the audit log;
  - your preferences, saved prompts, saved filters, chat drafts, workspaces, budgets and push subscriptions;
  - share links, playbook definitions, artifacts and the push keys;
  - the service settings (`config.json`) and its log (`logs/caduceus.log`).

Caduceus keeps no copy of Hermes data. If you delete `~/.hermes/caduceus/`, Hermes keeps everything, and Caduceus starts fresh and asks you to set a password again.

## Backup and restore

Go to **System › Maintenance › Backup** (`/system/maintenance/backup`).
- **Make a backup.** Hermes zips its whole home folder. Caduceus's folder is inside it, so the backup holds your passkeys, saved prompts and audit log too. Making and downloading a backup are Tier 3.
- **Keep it private.** A backup contains secrets: provider keys, the password hash and sign-in sessions. Treat it like a password file. Sessions are stored only as hashes, so a backup cannot be replayed as a signed-in session.
- **Restore.** Choose a file or a path on the Mac. Caduceus pauses new turns, Hermes imports the backup, and Caduceus restarts itself. A restore replaces your current data. It works only when Caduceus runs as the background service. It is Tier 3.
- A backup uploaded through the page can be up to 100 MB. Restore a bigger one from its path on the Mac.
- `hermes backup --quick` from a terminal saves only Hermes's key files, not Caduceus's store.

## Updating

Go to **System › Maintenance** (`/system/maintenance`). Two cards, one for Hermes and one for Caduceus, say whether a newer version exists. Press **Check now** to ask again.

- **Update Hermes.** It is Tier 2. Caduceus first pauses new turns and waits a little for running turns to end. Hermes updates itself with a live log. Caduceus restarts the Hermes it runs, and your chats reconnect. A turn that was still running is interrupted. Caduceus then checks the new Hermes against what it was built for. If they do not match, it turns on read-only mode and tells you.
- **Update Caduceus.** Caduceus fast-forwards its own checkout, installs what changed and builds the web app, then restarts itself. It refuses if the checkout has uncommitted changes. It can restart itself only when it runs as the background service.
- If a restart did not happen, run this on the Mac: `npm run caduceus -- restart --yes`.

## Troubleshooting

**Is the service running?** On the Mac, in the project folder:

```sh
npm run caduceus -- status
```

It exits with 0 when the service is installed, running, answering, and served through Tailscale. Otherwise it says what is wrong. `npm run caduceus -- restart --yes` restarts it.

**Where is the log?** `~/.hermes/caduceus/logs/caduceus.log`. It grows without limit (there is no log rotation yet). Hermes's own logs are in **Observe › Logs**.

**I cannot reach Caduceus from the phone.**
1. Check that Tailscale is on, on the phone and on the Mac.
2. Run `npm run caduceus -- status` on the Mac.
3. A `403` with `tailnet-identity` means your Tailscale login is not in the owner list. Run setup again with `--owner <your login>`.

**What does a red Repair mean?** Open **Observe › Health** (`/observe/health`). A Repair is a problem Caduceus found, with its cause. The worst come first: Critical, then Warning, then Info. Some Repairs have a fix button. For example **Restart Hermes backend** is a Tier 2 action, and it works even in read-only mode. A Repair that clears and returns within a day is marked as a recurring failure: the cause is still there. **Check now** asks again.

Common Repairs: the Hermes backend restarted three times in an hour, the Hermes contract no longer matches, the messaging gateway is not running, the scheduler heartbeat is stale, a provider key is missing, or the Mac is short on memory or disk. Some of these show the command to run.

**A passkey is lost.** Sign in with the password and remove the passkey in Settings › Security. If you turned the password off and lost the only passkey, you cannot sign in from a device. The way back is to edit the Caduceus store on the Mac. Keep the password until you have two passkeys.

**Everything is "Read-only".** Look for the banner. Read Health for the Repair that caused it, fix it, then turn read-only mode off in Settings › Security.
