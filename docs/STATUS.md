# Status: open decisions and known limits

Caduceus is a personal project. It is built and used daily against Hermes Agent 0.22.2 (see `contracts/hermes/pin.json`). This file lists the design choices that are still open and the limits of the current implementation. Cross-references point to the build tickets in `.scratch/<milestone>-<name>/issues/<number>-<title>.md`.

## First-run steps only you can do

Caduceus has no delegation. Each of these is a Tier 2 or Tier 3 action, or a step on your own device.

- **Set the owner password** (M0 #03): open `http://localhost:9130` on the Mac that runs Caduceus. This works only from that Mac, and only once.
- **Add a passkey** (M0 #04): on the phone, **Settings › Security › Add passkey**. It needs the password or an existing passkey. Once a passkey works, you can turn the password off or keep both. Caduceus always keeps at least one way to sign in.
- **Install to Home Screen** (M1 #12): use the browser menu on your device. On an iPhone: Safari, **Share › Add to Home Screen**.
- **Turn on push notifications** (M2 #03): on the phone, **Settings › Notifications › Push notifications**.
- **Pair Telegram or WhatsApp** (M5 #03): on the phone, **Channels**, then the QR code step.
- **PDF attachments**: `brew install poppler` on the Mac. Caduceus shows the attachment button only when it finds poppler.
- **Checkpoints**: set `HERMES_TUI_CHECKPOINTS` before `npm run caduceus -- setup` if you do not want checkpoints saved to `~/.hermes/caduceus/checkpoints/`. The default is 1 (save).

## Decisions still open

Each one is described in the **Comments** section of its ticket.

- **Remote images in replies** (M1 #09): Hermes can attach images from the web, and Caduceus loads them in the reply. The alternative is to show a link and not load them.
- **Slash-command allow-list or deny-list** (M3 #05): the current implementation uses a deny-list (a snapshot of Hermes 0.21.4). A command that Hermes adds later defaults to T0.
- **Write roots not narrowed to workspaces** (M6 #01): an agent can write anywhere Hermes can reach on the Mac. The file guard and the registered workspaces are the gate for actions taken through Caduceus.
- **Tailscale identity through loopback headers** (M0 #13): Caduceus trusts the `Tailscale-User-Login` header because it listens only on 127.0.0.1 and is reached only through Tailscale Serve. Sign-in and a passkey are still needed on top.
- **`approval.respond` once is Tier 0** (M3 #06): a single approval needs no confirmation. A denial asks for a reason.

## Known limits

- **macOS only.** `npm run caduceus -- setup` installs a LaunchAgent, and Caduceus is built and tested on macOS. `npm run dev` may run on Linux, but that is untested, and there is no Linux or Windows service.
- **Pinned to one Hermes version.** When the running Hermes differs from `contracts/hermes/`, Caduceus goes read-only until it is re-pinned (`AGENTS.md`, "After Hermes is updated").
- **Hands-free voice is chained speech** (M7 #07): hold-to-talk records and then sends. It is not a full-duplex live voice mode.
- **Hermes OAuth start returns no URL** (M4 #06): the OAuth provider button in **Keys** cannot finish, because Hermes returns no redirect URL after `oauth start`.
- **Not tested against a real Hindsight or real providers** (M4 #10, M4 #02): the memory browser and the skill tools are tested against stand-ins.
- **Hermes 0.22.2 parts not run for real**: a paused model download, a memory-provider plugin from the catalogue, and SSH workspaces are tested with stand-ins only. A profile with no chats yet shows Hermes's "Session store is not initialized" message when the list is narrowed to that profile.
- **No internationalisation.** The UI is English only. The parked work is on the branch `wip/m1-01-i18n` (not published).

## After you update Hermes

Caduceus turns read-only and shows "Hermes no longer matches what Caduceus was built for" until it is re-pinned to the new Hermes. That is by design: a changed Hermes can break a screen. Follow `AGENTS.md`, "After Hermes is updated", then run `npm run build -w web && npm run caduceus -- restart`.

Caduceus never restarts your Hermes gateway. If Hermes says a previous `hermes update` did not restart running gateways, run `hermes gateway restart` yourself.
