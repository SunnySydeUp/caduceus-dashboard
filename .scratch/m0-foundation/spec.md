# M0 — Foundation (spec)

**Goal:** the base every later Caduceus Dashboard milestone plugs into.

**Done when:** on the owner's phone, `https://<mac>.ts.net:9443`:
- signs in with a passkey;
- shows Home with live health from Hermes;
- can be added to the Home Screen.

The existing Hermes dashboard (`:9119`), Hermes WebUI (`:8787`) and the public Funnel on `:443` keep working unchanged.

## Design sources (approved)
- `docs/design/README.md`: decisions D1–D10 and milestones.
- `docs/design/architecture.md`:
  - §1 shape: Caduceus server, private `hermes serve`, Tailscale Serve;
  - §2 data ownership;
  - §3 Hermes interfaces;
  - §4 realtime and resume;
  - §5 security tiers;
  - §6 contract stability;
  - §7 stack;
  - §8 operations;
  - §9 risks.
- `docs/design/information-architecture.md`: §2 navigation by window size, §3 chrome, §6 profile scope, §7 URLs, §8 palette.
- `docs/design/mobile-and-interaction.md`: §1 viewport, §2 targets, §5 tiers UI, §6 install, §7 offline, §9 accessibility gate, §10 performance budget, §11 test gates.
- `docs/design/design-system.md` + `tokens.css`: visual system.
- `docs/design/prototype/`: reference rendering of the shell, palette, profile switcher and tier dialogs.

## Vocabulary
| Term | Meaning |
|---|---|
| **Hermes** | The source of truth |
| **Caduceus server** | The TypeScript BFF |
| **Hermes backend** | The private `hermes serve` the Caduceus server launches on loopback with a per-launch secret |
| **Policy proxy** | Classifies every forwarded REST operation or gateway method into risk tiers |
| **Risk tiers** | T0 undo · T1 confirm · T2 passkey step-up · T3 step-up + typed confirmation · Denied |
| **Step-up** | Fresh passkey confirmation for sensitive actions |
| **Module registry** | Where each feature area declares its nav entry, routes, palette commands, settings and policy |
| **Profile scope** | The Hermes profile a tab is working on, carried in the URL as `?profile=` |
| **Repairs** | Health problems shown with severity, cause and fix |

## Constraints
- Node 22 is installed and pnpm is not, so use npm workspaces.
- Never change Tailscale configuration or install background services without the owner's confirmation at that moment.
- Never touch the existing `:443` Funnel, the Hermes dashboard launchd job or the WebUI daemon.
