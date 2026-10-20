# M4 — Agents (spec)

**Goal:** the owner configures every Hermes agent from Caduceus: profiles and their behaviour files, models, skills, memory, tools and MCP.

**Done when:** on the owner's phone and desktop, the owner can:
- build a new profile from a persona in the 5-step builder, then export it;
- edit its SOUL and MEMORY with a snapshot restorable afterwards;
- set its main and auxiliary models and a fallback chain;
- install a hub skill after seeing its security verdict;
- add an MCP server, test it and see its tools;
- switch its memory provider and browse the learning graph.

Every change shows up in Hermes (CLI or stock dashboard) without a Caduceus copy.

## Design sources (approved)
- `docs/design/README.md`: D1 (Hermes is the source of truth), D6 (per-tab profile scope), D8 (dropped gamification).
- `docs/design/architecture.md`: §2 data ownership (R1 snapshots), the R11 guarded-ops exception, §5 risk tiers and proxy mitigations (`fs/write-text` guard).
- `docs/design/information-architecture.md`: §1 Agents modules, §5 profile detail tabs, §6 profile scope (Make default is the only sticky write), §7 URLs `/agents/*`.
- `docs/design/mobile-and-interaction.md`: §4 Agents and Models rows (full-screen editors with Preview/Edit, list → detail sheet with security verdict), §5 sheets and confirmations.
- `docs/design/feature-traceability.md`: Agents › Profiles, Skills, Memory, Models, Tools & MCP; the remote-workspaces row; the Hermes free wins marked M4.
- `docs/design/prototype/`: Profiles.
- Research: `hermes-api-coverage.md` §2.3–§2.6, §3 (R1, R10, R11), §7; `hermes-protocol.md` (`model.options`, `tools.configure`, `mcp.servers.status`, `tools.list/show`, `project.facts`, `projects.*`).

## Vocabulary
| Term | Meaning |
|---|---|
| **Behaviour files** | A profile's SOUL.md, AGENTS.md / HERMES.md, MEMORY.md, USER.md and config.yaml |
| **Snapshot** | Caduceus's copy of a behaviour file's previous text, taken before each write (R1) so it can be restored |
| **Auxiliary slot** | A Hermes model slot for a side task (vision, compression, titles, …) separate from the main model |
| **Fallback chain** | The ordered `fallback_providers` Hermes tries when the main model fails |
| **Security scan** | Hermes's verdict on a hub skill, shown before install |
| **Curator** | Hermes's background skill maintainer |
| **Persona** | A seeded starting identity in the profile builder; static app content |
| **Caduceus MCP server** | The stdio MCP server that lets agents manage projects and sessions through Caduceus's policy layer |

## Coverage
| Ref | Feature | Ticket(s) |
|---|---|---|
| 2.3.1 | Profile cards with gateway status | 01 |
| 2.3.2 | Create / clone + 5-step builder | 12 |
| 2.3.3 | SOUL.md editor | 02 |
| 2.3.4 | All behaviour files + R1 snapshots | 02 |
| 2.3.5 | LLM auto-describe | 01 |
| 2.3.7 | Profile export / import | 12 |
| 2.3.8 | DB ↔ disk push/pull | Replaced (D1: one copy, no drift layer) |
| 2.3.9 | Seed persona catalogue + restore | 12 |
| 2.3.10 | Per-agent performance | 01 |
| + | Set active / Make default, rename, delete, copy CLI | 01 |
| + | Edit profile model | 03 |
| + | Isolated single-profile mode | Replaced (D6 per-tab scope + read-only mode, M0) |
| + | Assistant display name | 01 |
| + | Agent XP / levels / Growth | Dropped (D8) |
| 2.5.1 | Skills browse / search / toggle / categories | 04 |
| 2.5.2 | Create / edit SKILL.md | 04 |
| 2.5.3 | Delete / uninstall | 04 |
| 2.5.4 | Skills hub + security scan (incl. official list) | 05 |
| 2.5.5 | Learn-a-skill, curator | 05 |
| 2.5.6 | Skill usage stats | 04 |
| + | Skill detail (rendered, linked files) | 04 |
| + | PS seeded skills / import | Replaced (D1: hub replaces seeds) |
| 2.6.1 | Edit MEMORY.md / USER.md | 02 |
| 2.6.2 | Memory provider + dynamic config (+ provider OAuth) | 09 |
| 2.6.3 | Hindsight browser (R10) | 10 |
| 2.6.4 | Project context, LLM Wiki; external notes (R11) | 09 (context, Wiki), 10 (notes) |
| 2.6.5 | Context-engine selection | 09 |
| 2.6.6 | Learning graph (+ chunk editing) | 09 |
| + | Memory reset and sizes | 02, 09 |
| 2.4.1 | Auxiliary slots | 03 |
| 2.4.2 | Mixture-of-Agents presets | 13 |
| 2.4.3 | Fallback chain editor | 13 |
| 2.4.7 | Per-model usage cards with Use as… | 13 |
| 2.4.9 | Live model catalogue refresh | 03 |
| + | Main / default model | 03 |
| + | Max output tokens | 03 |
| + | PS model registry / drift | Replaced (D1: Hermes config is the registry) |
| 2.5.7 | Toolset config (+ per-toolset model picker) | 06 |
| 2.5.8 | MCP servers CRUD + OAuth + test + edit | 07 |
| 2.5.9 | MCP catalogue | 07 |
| 2.5.10 | MCP tool inventory | 07 |
| 2.5.11 | Shell hooks | 08 |
| 2.5.14 | Dashboard as an MCP server | 11 |
| + | Tool gateway routing | 06 |
| + | Per-platform toolsets + advanced JSON | 06 |
| + | Remote workspaces (ssh/docker backend) | 08 |
| free win | Terminal backends | 08 |
| free win | Computer-use permissions | 06 |
| free win | Local models (llama.cpp, 16 `/api/local-models/*`) | 14 |
