# M2 — Inbox + Push (spec)

**Goal:** everything that needs the owner reaches them in one place, the Inbox, and reaches their phone as a notification when Caduceus is closed. Home becomes the at-a-glance overview.

**Done when:** on the owner's installed phone app, with Caduceus closed:
- an agent in any profile asks for a tool approval, and a push notification arrives naming the command and profile;
- tapping it opens the decision in the Inbox, and Allow once lets the run continue;
- answering the same approval from Telegram or the TUI instead makes the Inbox item disappear by itself;
- the app badge and the Inbox tab badge count only items that need a decision;
- Home shows what is waiting, what is running (with Steer and Stop), health, spend and recent sessions.

## Design sources (approved)
- `docs/design/work-model.md` §2.5: Inbox sources, inline actions and which ones push; the Inbox is a view over Hermes state, and only dismissals and snoozes are stored, per device.
- `docs/design/architecture.md`:
  - §2 data ownership (`caduceus.db` push subscriptions and dedupe log, `vapid.json`);
  - §3 global change signals on the observer connection;
  - §4 push watcher (R2), delivery rules, and the open item "the observer must never answer server requests";
  - §5 tiers (pairing approve T2; Allow always step-up).
- `docs/design/mobile-and-interaction.md`: Inbox and Home rows of the screen table, swipe table (§ gestures), push and install rules, badging, `↵ on an approval card` = Allow once.
- `docs/design/information-architecture.md`: §1 Home and Inbox, §6 cross-profile by default, §7 `/inbox`, `/inbox/:itemId`, `/home`.
- `docs/research/hermes-protocol.md`: server requests `approval` / `clarify`, `request.cancel`, `approval.respond`, `request.answer`, `approval.pending`, `session.active_list.status`, change broadcasts (§6 coverage, §7 push GAP).
- `docs/research/hermes-api-coverage.md` §3: R2 (Web Push) and R8 (completion feed cursors).
- `docs/design/prototype/`: `inbox.js` and `home.js` screens.

## Vocabulary
| Term | Meaning |
|---|---|
| **Inbox item** | A derived view of one Hermes state that needs or concerns the owner (pending approval, clarify, cron failure, pairing request…). Never stored; recomputed from Hermes |
| **Needs decision** | An item with an inline decision. Only these count towards the badges |
| **Observer connection** | The Caduceus server's own standing gateway connection that watches every session and the change broadcasts. It never answers server requests |
| **Snooze / dismiss** | Per-device, Caduceus-owned hiding of an item; the Hermes state is untouched |
| **Push subscription** | One device's Web Push endpoint, its categories, quiet hours and per-source overrides |
| **Presence** | Whether any Caduceus client for the owner is currently visible; suppresses push |
| **Activity feed** | The FYI stream of finished runs and other non-decision events, with per-device last-seen cursors (R8) |

## Constraints
- No Inbox table: an item exists exactly as long as its Hermes state does (D1). Only snoozes, dismissals, push subscriptions, the dedupe log and feed cursors are stored.
- The observer connection must not answer, lock or time-start any server request (no `approval.received`, `clarify.lock` or `request.answer` from it). Verifying this is part of 01.
- Asking for notification permission only from a tap; on iOS only after Home Screen install.

## Coverage
Every `feature-traceability.md` row with M = M2, plus the M2 interface row.

| Ref | Feature | Status | Ticket(s) |
|---|---|---|---|
| + | Overview: connected platforms, 5 recent sessions, stat pills (scheduler heartbeat, spend, processes) | USED | 04 |
| 2.7.7 | Run-completion toasts / badges | PARTIAL | 02 (activity feed, finished-run items, toasts, nav badges), 03 (push while closed) |
| + | Background notifications (response done, approval needed) | Caduceus-owned (R2) | 03 (sources from 01 and 02) |
| + | Per-job badge notifications toggle | Caduceus-owned (R1/R2) | 03 (per-source overrides, including per cron job) |
| Interfaces | Global change signals for live lists and push (`cron.changed`, `sessions.changed`, `pairing.changed`, `platforms.changed`) | UNUSED | 01 (observer connection), 02 (cron/pairing/platform sources) |

Related rows owned elsewhere, consumed here: 2.1.4 / 2.1.5 approvals and clarify (M1 #06, mirrored by 01); review gates and `needs_input` (M3 #09 adds them as Inbox sources and push categories); 2.9.4 DM pairing (M5 #04 owns the Pairing screen; 02 adds the Inbox item); host stats and resource pressure (M5 #07 completes the Health side; 02 raises the Inbox item).
