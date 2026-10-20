# M1 — Chat (spec)

**Goal:** a native chat with Hermes that replaces the Hermes WebUI and the Dash TUI chat for daily use, on the phone and on the desktop, plus the two prefactors (internationalisation and contextual help) every later module builds on.

**Done when:** on the owner's phone, `https://<mac>.ts.net:9443/chat`:
- starts a chat in the scoped profile and streams the reply with reasoning, tool and subagent cards;
- answers an approval and a clarify question from a bottom sheet, with step-up for "Allow always";
- steers, queues and stops a busy turn;
- survives locking the phone mid-turn: on return the turn has continued and the transcript catches up without loss;
- finds an old CLI or Telegram session by full-text search, opens it and continues it.

On the desktop the same session is open side by side, with the sessions pane, the context panel (Todo / Run) and optional terminal mode. Every Caduceus string is in the catalogues, and `?` opens help for every screen.

## Design sources (approved)
- `docs/design/README.md`: D1 (Hermes is the source of truth), D3 (native chat by default, terminal optional), D6 (profile scope), D10 (step-up), M1 row.
- `docs/design/architecture.md`:
  - §2 data ownership: drafts, saved prompts and preferences are Caduceus-owned (R1, R5); sessions, messages, projects, pins and titles are Hermes's;
  - §4 realtime: resume sequence, PWA resume storms, upstream grace hold, live relays (R12) for sessions owned by other processes;
  - §5 security tiers.
- `docs/design/information-architecture.md`: §4 chat screen anatomy, §6 profile scope, §7 URLs (`/chat`, `/chat/:id`, `/chat/new?prompt=&profile=`), §8 palette.
- `docs/design/mobile-and-interaction.md`: §1 keyboard inset, §3 gestures, §4 Chat phone pattern, §5 sheets and tiers, §7 resume and outbox, §8 keyboard.
- `docs/design/feature-traceability.md`: Chat module rows, toast stack, 2.12.4 and behaviour toggles.
- `docs/design/prototype/`: Chat (sessions pane, transcript, composer chips, approval cards, context panel).
- Research: `docs/research/hermes-protocol.md` §0–§2.5 (events, resume, turn markers), §6 coverage, §7 gaps; `docs/research/hermes-api-coverage.md` §2.2 sessions, §3 R1/R5/R12.

## Vocabulary
| Term | Meaning |
|---|---|
| **Message catalogue** | The per-locale ICU message files every UI string comes from |
| **Pseudo-locale** | A generated locale with accented, lengthened strings that makes hard-coded or truncated text visible |
| **Help page** | A module's bundled help, opened by `?` for the current screen |
| **Glossary term** | A defined word that opens a pop-up explanation wherever it appears |
| **Turn** | One prompt and everything Hermes does until the reply completes, fails or is interrupted |
| **Grace hold** | Caduceus keeping a dropped browser's upstream socket open (default 10 min) so the session stays hosted |
| **Activity mode** | How agent work shows in the transcript: Worklog, Stream or Final only |
| **Approval** | A Hermes server request asking whether a tool call may run (once / session / always / deny) |
| **Clarify** | A Hermes server request asking the user a question, with choices, free text and a deadline |
| **Steer / Queue / Interrupt** | What sending does while a turn is busy: redirect the running turn, run after it, or stop it |
| **Side task** | A `/btw` or `/background` prompt that runs beside the main turn |
| **Composer chips** | Profile, model, reasoning, workspace, toolsets and context controls under the composer |
| **Context ring** | The composer's context-usage indicator with cost, cache and Compress |
| **Config sheet** | The phone's single sheet holding all composer chips |
| **Draft** | Unsent composer text, stored by Caduceus per session and shared across devices |
| **Fast chat** | One-shot raw-model replies without tools, not saved in Hermes history |
| **Terminal mode** | The Hermes TUI in a desktop terminal pane over Hermes's PTY socket |
| **Foreign session** | A session owned by another process or tool (CLI, messaging gateway, cron, Kanban worker, Claude Code) |

## Coverage

Every feature-traceability row whose milestone is M1, plus rows the plan reassigned to M1. Refs: `2.x.n` matrix row; `+` inventory row (named).

| Ref | Feature | Ticket(s) |
|---|---|---|
| 2.12.2 | Locales (union 17+15, RTL) — reassigned from M0 | #01 (pipeline, English + pseudo-locale, RTL via logical CSS); remaining locales M7 #08 |
| 2.12.5 | In-app help (per-screen `?`, glossary, docs) — reassigned from M0 | #02 |
| 2.1.14 | Durable / resumable streams — reassigned from M0 | #03 (resume, grace hold); #06 (pending requests restored); #12 (interrupted-turn recovery) |
| + | Pull-to-refresh (standalone PWA) — reassigned from M0 | #13 (the theme-color hooks half of the row stays with M0) |
| 2.1.1 | Native message UI (bubbles, markdown, tool cards) | #03 (bubbles, streaming), #04 (markdown), #05 (tool cards) |
| 2.1.2 | Terminal / TUI chat mode | #19 |
| 2.1.3 | Streamed reasoning / thinking | #05 |
| 2.1.4 | Tool approvals (once/session/always/deny, YOLO) | #06 |
| 2.1.5 | Clarify prompts (choices, free text, countdown) | #06 |
| 2.1.6 | Queue / Interrupt / Steer, `/btw`, `/background`, `/goal` | #07 (stop of a single turn first in #03) |
| 2.1.7 | Activity display modes | #05 |
| 2.1.8 | Attachments (20 files: docs, PDF, archives) | #10 |
| 2.1.10 | Message actions: edit, fork, regenerate, copy | #12 |
| 2.1.11 | Model + reasoning-effort pickers | #08 |
| 2.1.12 | Context ring: usage, cost, cache %, Compress | #08 |
| 2.1.13 | Rich rendering (KaTeX, Mermaid, tables, PDF, HTML) | #04 |
| 2.1.15 | Drafts saved server-side, across devices | #11 |
| 2.1.16 | Saved prompts | #11 |
| 2.1.17 | Image paste / drag-drop | #10 |
| 2.1.18 | Fast (raw-model) chat | #18 |
| 2.8.6 | Agent todo list, subagent cards, goals | #05 (todos, subagents), #07 (goals) |
| + | Toast stack (memory/skill-saved toasts, success/error) | #05 |
| + | Slash commands | #09 |
| + | Retry / undo | #12 (also reachable from the slash menu, #09) |
| + | Interrupted-turn recovery, failed-turn bubble | #12 |
| + | Personalities (`/personality`) | #09 |
| + | Large paste → .md attachment | #10 |
| + | `@path` references and `~/` path autocomplete | #09 |
| + | Selection actions (Reply with selection, Refine chips) | #09 |
| + | Tokens/sec and per-reply usage | #05 |
| + | Conversation outline, jump/auto-follow, load earlier, virtualisation | #04 |
| + | Deep links (`/chat/new?prompt=&profile=`) | #17 |
| + | Credential warning (Add key / Switch model) | #08 |
| + | Workspace / cwd picker for a chat | #08 |
| + | Session toolsets chip | #08 |
| + | Mobile composer config sheet | #08 |
| + | PTY keep-alive reattach, persistent terminal, shortcuts, copy-last, theme-aware xterm | #19 |
| + | Auto-title / regenerate title | #12 |
| 2.2.1 | Full-text search of message bodies | #15 |
| 2.2.2 | Cross-source sessions | #13 (source filters), #16 (open, live refresh via R12) |
| 2.2.3 | Resume / continue external sessions | #16 |
| 2.2.4 | Handoff summary for messaging sessions | #16 |
| 2.2.5 | Rename / delete / bulk select, prune, delete empty | #14 |
| 2.2.6 | Projects, pins, archive | #14 |
| 2.2.7 | Fork / branch / duplicate / git-worktree sessions | #12 (fork from a message), #17 (duplicate, worktree) |
| 2.2.8 | Export / import (MD / JSON / themed HTML) | #17 |
| 2.2.10 | Transcript viewer with tool-call accordions, role filters, search, copy | #05 (tool-call accordions), #15 (role filters, search, copy) |
| 2.2.12 | Touch gestures (swipe archive/delete, long-press) | #14 |
| + | Sessions stats strip / insights donut | #13 |
| + | Date groups, unread dots, density, live indicator, failed badge | #13 |
| + | Live session-list updates | #13 |
| + | Filters: failed-only, hide API noise, category tabs | #13 |
| + | Previous messaging segments / continuation lineage | #16 |
| 2.12.4 | Customisable nav / composer chips | #08 (chip order), #20 (nav order) |
| + | Behaviour toggles + settings search | #20 |

Unused Hermes capabilities listed for M1 ("free wins" table in feature-traceability): session pins/hidden/unread → #14 (unread marker #13); cross-profile aggregate → #13; Claude Code / Codex import → #16; jump-to-message / timeline → #15 (load-around in #04); handoff → #16; fork at tip, undo → #12; goals / subagent tree / todos → #05, #07; context breakdown → #08; multi-device attach → #03 (first answer wins in #06).

Chat-module rows deliberately not in M1: 2.1.9 Voice and raw audio messages → M7 #07; 2.2.9 public share links → M7 #06; 2.2.11 session ↔ mission linkage → M3 (task detail runs). Session recovery (`.bak`, repair) and sync-on-read / orphan sweep are **Replaced** by D1: sessions live only in Hermes, so there is no Caduceus store to repair or sync. Session list/revoke and read-only mode (2.12.9) are already delivered by M0 #04/#08.

## Constraints
- Sessions, messages, titles, pins, projects and archive flags are Hermes's; Caduceus stores only drafts, saved prompts and preferences.
- Every gateway method and REST call goes through the policy proxy with its tier; deletes, prune and YOLO name their tier in their ticket.
- Every screen passes the M0 #05 gates and, from #02 on, registers help and glossary terms.
