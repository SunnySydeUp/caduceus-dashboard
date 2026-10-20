# M7 — Workspace & media (spec)

**Goal:** the owner can work directly on the files, repositories and shell behind their agents, share a session, talk to Caduceus by voice and use it in their own language.

**Done when:** on the owner's phone and desktop, over the tailnet:
- Files previews and edits a workspace file; a rename and a move are audited;
- the Git panel shows a diff, commits with an AI message and pushes after T3 confirmation;
- a checkpoint is diffed and restored (T3);
- the desktop opens a shell after passkey step-up;
- a session share link opens on another tailnet device and stops working once revoked;
- a reply is dictated on the phone with hold-to-talk and read aloud;
- Caduceus runs in Arabic, right to left.

## Design sources (approved)
- `docs/design/README.md`: D1 (Hermes is the source of truth), D2, D9 (tailnet-only HTTPS on `:9443`), D10, milestone M7.
- `docs/design/architecture.md`:
  - §2 data ownership, including the **R11 guarded file operations** exception (move, rename, Office save, log truncate; only inside the roots Hermes's file API exposes; never `.env`, `auth.json`, `caduceus/`; tier-gated and audited);
  - §3 Hermes interfaces (voice uses REST audio, not RPC `voice.*`);
  - §5 risk tiers (`fs/write-text`, git push/revert, `rollback.restore` are T3; the interactive terminal is the T2 home for shell access).
- `docs/design/information-architecture.md` §7 URLs: `/workspace/files/*path`, `/workspace/git`, `/workspace/checkpoints`, `/workspace/terminal`.
- `docs/design/mobile-and-interaction.md`: Files/Git card list and unified/split diff; hold-to-talk gesture.
- `docs/research/hermes-api-coverage.md` §2.10 (files, git, checkpoints, terminal), §3 R4 (share links), R11.
- `docs/research/hermes-protocol.md` §0, §6 (voice host-side; `file.attach`, `llm.oneshot`, `rollback.*`).
- `docs/design/prototype/`: shell and transcript rendering reused by Files previews and the share renderer.

## Vocabulary
| Term | Meaning |
|---|---|
| **Managed root** | A folder Hermes's own file API exposes: the managed files root or the scoped profile's workspace |
| **Protected area** | Profile home, config and behaviour files; text saves there are T3 |
| **Guarded file operation** | One of the R11 operations the Caduceus server performs on disk itself, inside managed roots only |
| **Checkpoint** | An agent's automatic snapshot of a workspace, restorable through `rollback.restore` |
| **Terminal shell** | A real `$SHELL` PTY run by the Caduceus server, behind T2 step-up (distinct from M1 #19 terminal mode, which runs the Hermes TUI) |
| **Share link** | A tokenised, read-only, tailnet-only link to a frozen session snapshot |

## Coverage
| Row | Feature | Status | Ticket(s) |
|---|---|---|---|
| 2.10.1 | File browser: tree, preview/editor, upload, mkdir, delete, move, rename | PARTIAL | 01 (browse, previews, text edit, upload, mkdir, delete, download); 02 (move, rename, Office save via R11) |
| 2.10.4 | Git (diff, stage, commit, push, AI commit message, branches) | UNUSED | 03 |
| 2.10.3 | Checkpoint rollback (diff / restore, count / prune) | PARTIAL | 04 (list, diff, restore); storage count and prune in M5 #14 |
| 2.10.6 | Terminal (real PTY shell) | PARTIAL | 05 |
| 2.2.9 | Public share links | Caduceus-owned (R4) | 06 — delivered tailnet-only per D9, not public |
| 2.1.9 | Voice: dictation, hands-free, TTS | UNUSED | 07 |
| + | Raw audio messages | UNUSED | 07 |
| 2.12.2 | Locales (union 17+15, RTL) — reassigned from M0 | CLIENT | M1 #01 (pipeline, English + pseudo-locale); 08 (all locales, Arabic RTL, untranslated report) |

## Constraints
- Every R11 operation is canonicalised and checked against the managed roots on the server, tier-gated and audited; nothing else in this milestone writes Hermes files outside Hermes's APIs.
- No route in this milestone is exposed through Funnel or any public listener.
