# M5 — Operate (spec)

**Goal:** run and maintain Hermes entirely from Caduceus: messaging connections, observability, configuration, credentials, plugins and maintenance. After this milestone the owner no longer needs the stock dashboard or the CLI for day-to-day operation.

**Done when:** on the owner's phone, signed in to Caduceus:
- a Telegram bot is created with QR, a DM pairing request is approved (T2), and the gateway is restarted to apply it;
- Insights shows the week's cost by model, and a budget alert arrives as a push;
- Logs live-tails an error that also appears in the Home errors panel;
- a config change is saved (T3) and prompts for a restart;
- a backup is created, and a Hermes update runs with a drain and resume.

All T2/T3 actions go through the shared dialog and are audited.

## Design sources (approved)
- `docs/design/README.md`: D1 (Hermes is source of truth), D6 (profile scope), D8, D10 (denied areas) and milestone M5.
- `docs/design/architecture.md`:
  - §2 Caduceus store (budgets, wizard progress);
  - §4 realtime, resume and push (log relay R12, drain and resume);
  - §5 policy proxy tiers;
  - §8 operations (backend and Caduceus restarts, self-update).
- `docs/design/information-architecture.md`: Connect, Observe and System groups; URLs; Settings.
- `docs/design/mobile-and-interaction.md`: phone layouts, sheets, tier UI (no T2/T3 behind gestures), handoff to larger screens.
- `docs/design/feature-traceability.md`: rows with milestone M5 (table below).
- `docs/design/prototype/`: Config, Keys, Health.
- `docs/research/hermes-api-coverage.md`: §2.4, §2.9, §2.11, §2.12, §2.x free wins, §3 R1/R3/R9/R11/R12, §7 friction tiers.

## Vocabulary
| Term | Meaning |
|---|---|
| **Drain** | Pause new turns and let in-flight work settle before a restart, update or restore; clients resume afterwards |
| **Restart-to-apply banner** | A shared banner raised when a saved change needs a gateway or backend restart |
| **Multiplexed gateway** | Hermes's single gateway serving every profile; Gateway › Migrate moves to it |
| **Budget** | A Caduceus-owned spend limit per period, optionally per profile. M5 alerts at 80% and 100%; M6 #06 adds the hard stop |
| **Log relay** | The Caduceus server's single upstream log tail, fanned out to subscribed clients (R12) |
| **One-time secret** | A webhook secret shown once at creation and never stored by Caduceus |

## Coverage
| Ref | Feature | Status | Ticket(s) |
|---|---|---|---|
| 2.9.1 | Gateway start / stop / restart (+ drain) | USED | 01 |
| 2.9.6 | Per-profile gateway status dot | USED | 01 |
| 2.3.11 | Multiplexed-gateway migration | USED | 01 |
| + | Running gateway processes, gateway health badge | USED | 01 |
| 2.9.2 | Channel configuration (23+ platforms, Test) | USED | 02 |
| + | Platform behaviour settings | USED | 02 |
| 2.9.3 | QR onboarding (Telegram, WhatsApp) | USED | 03 |
| 2.9.4 | DM pairing approvals | USED | 04 (Inbox item via M2 #02) |
| 2.9.5 | Webhook subscriptions (one-time secret) | USED | 04 |
| 2.4.8 | Quota, spend, budget | PARTIAL | 05 (hard stop is M6 #06) |
| 2.11.6 | Token / cost analytics | USED | 05 |
| + | Provider usage card (commandcode-usage plugin) | Replaced | 05: replaced by the built-in provider quota card |
| 2.11.5 | Logs viewer with search and streaming (R12) | USED | 06 |
| + | Logs delete-all (truncate, R11) | Caduceus-owned | 06 |
| + | Errors panel (ERROR/CRITICAL dedupe) | USED | 07 |
| 2.11.8 | Subsystems health panel with actionable reasons | PARTIAL | 07 |
| 2.11.7 | Host stats + resource-pressure banner (reassigned from M0) | USED | 07 |
| 2.11.1 | Schema-driven config form + search | USED | 08 |
| 2.11.2 | Raw YAML editor | USED | 09 |
| 2.11.3 | Config import / export / reset | USED | 09 |
| 2.4.4 | Provider keys (audited reveal, test, rotate) | USED | 10 |
| 2.4.5 | OAuth device-code logins | USED | 10 |
| 2.4.6 | Credential pool | USED | 10 |
| + | Custom endpoint providers | UNUSED | 10 |
| + | Nous Portal subscription card | USED | 10 (read-only; billing Denied) |
| 2.5.12 | Hermes plugin install / update / remove + catalogue | USED | 11 |
| 2.11.11 | Update Hermes (+ Caduceus self-update, What's New) | USED | 12 |
| 2.11.9 | Doctor, security audit, debug share, support dump | USED | 13 |
| + | Restricted `hermes>` console | USED | 13 |
| + | Install facts + Copy for bug report | USED | 13 |
| + | WebUI Stop server / hot reload | Replaced | 13: replaced by drained Restart Hermes backend / Restart Caduceus (T2) |
| + | Swagger / OpenAPI pages | Replaced | 13: replaced by the API reference rendered from the pinned contracts |
| 2.11.10 | Backup / restore | USED | 14 |
| 2.12.8 | Auth methods: OIDC, proxy/Tailscale identity SSO (reassigned from M0) | Caduceus-owned | 15 |
| 2.12.9 | Session list / revoke, read-only mode | Caduceus-owned | Already delivered by M0 #04 / #08; audit viewer in 15 |
| 2.11.4 | Onboarding wizard | PARTIAL | 16 (quests half dropped, D8) |

Free wins assigned to M5 (traceability "UNUSED" table):

| Free win | Ticket(s) |
|---|---|
| Custom endpoints, providers validate, recommended default model | 10, 16 |
| Log server-side search | 06 |
| Hidden cost data (estimated/actual cost, cache and reasoning tokens) | 05 |
| Update check + receipt; gateway drain | 12; 01 |
| Egress status, host identity, idle/retirement health | 07 |

## Constraints
- Never send a secret (key values, webhook secrets, backup archives) to the browser except through its T3 path, and never cache one in the service worker.
- Billing and subscription actions, `diagnostics.share_nous`, and shell/CLI execution outside the restricted `hermes>` console stay Denied (D10, M0 #08).
