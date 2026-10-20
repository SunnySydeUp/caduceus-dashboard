# Caduceus Dashboard — agent guide

Mobile-first dashboard for Hermes Agent. Hermes is the source of truth. Caduceus launches its own private `hermes serve` on loopback and talks to it only through Hermes's interfaces: REST, the `/api/ws` JSON-RPC gateway, and a few WebSockets. The product is built (milestones M0–M7). Long explanations are in `docs/design/architecture.md`; this file says where things are and what the rules are.

## Layout
- `server/`: the Caduceus server (Node 22, Hono, TypeScript run by tsx, `node:sqlite`). Code in `server/src/`, tests in `server/test/`. File roles are in architecture §10.
- `web/`: the PWA (React 19, Vite, TanStack Router). Built to `web/dist`, which the server serves.
  - `web/src/modules/<name>/`: one folder per feature module. A module is declared in its `index.ts` and added to `builtInModules` in `web/src/modules/index.ts`. The shell is never edited to add one. Module list and routes: architecture §10. Every module names a Desk placement (`desk: 'today' | 'talk' | 'work' | 'control'`); a module in Control also names its `group`.
  - **The Desk.** The product has three places and Control. **Today** (`modules/today/`, `/today`) is the opening screen: Needs you, Ready for review, crew tiles (phone), the day's schedule, While you were away. **Talk** (`modules/chat/`, `/chat`) is an agent's thread with its sessions, Details, the composer intents (Ask, Delegate, Repeat) and the decide-anywhere tray. **Work** (`modules/work/`, `/work`) shows everything with a lifecycle by state (Waiting on you, Running, Ready for review, Scheduled), with Board, Tasks, Schedules, Playbooks and Projects as views. The **crew** is one row per profile (sigil, name, live line, time). **Control** (`/control`; More on a phone) lists every other module in groups: Main (Notices), Agents, Connect, Workspace, Observe, System, Settings. `/`, `/home`, `/inbox` and `/inbox/:itemId` redirect to `/today`; push and notification links open Today.
  - **Notices** (`modules/notices/`, `/notices`, Control › Main) holds what is not a decision: failed and FYI notices and decision-less items with their actions, snooze and dismiss, and the Activity feed. Decisions (approvals, questions, task reviews) live on Today (Needs you) and in the Talk tray.
  - **The Inbox data layer** stays in `modules/inbox/` (`inbox-feed.ts` the live stream, `inbox-model.ts`, `InboxDecision.tsx`, `inbox-actions.ts`) and `server/src/inbox*.ts`. It has no screen of its own. Today, the tray, Work and the crew read it. Do not copy its decision code: render `InboxDecision` (Today and the tray share `today/DecisionCard.tsx`).
  - `web/src/shell/`: the adaptive shell (app bar, tab bar, rail, sidebar, crew, sigils, banners, toasts, profile chip, command palette, help panel, keyboard host). It reads only the module registry (`web/src/module-registry.ts`, `app-registry.ts`) and the crew (`modules/crew/`). Navigation is `deskNavigation` in `shell/nav-order.ts`. Under 600 px: a tab bar (Today, Talk, Work, More). 600 to 1199 px: a rail with one sigil per agent. From 1200 px: a sidebar (Today, Talk, Work, the crew, Search, Control). `shell/Sigil.tsx` and `sigil-model.ts` draw an agent from its name; there are no avatar tokens.
  - `web/src/overlays/`: the layer stack (sheets, dialogs, drawers).
  - `web/src/gateway.ts`: the page's one live Hermes connection. Live data goes through `useLiveLoad` and `useGatewayEvent`, never a poll (bounded polls exist only where Hermes has no event; each says why).
  - `web/pwa/`, `web/src/sw/`: build-time manifest and precache, and the service worker's pure rules. The manifest `id` `/` must never change.
- `contracts/`: pinned Hermes contracts (`hermes/openapi.json`, `hermes/pin.json`), generated types, vendored `@hermes/shared`, the Caduceus API types, and the policy map `contracts/policy/`.
- `e2e/`: the few Playwright checks: the shell loads on Today, the Reconnecting-to-Hermes banner, a secret never reaches the page. Kept; no new browser tests.
- `docs/design/`: decisions, architecture, information architecture, work model, mobile spec, design system, `tokens.css`, prototype.
- `.scratch/`: the ticket tracker (one folder per milestone, one file per ticket) and the throwaway browser smoke scripts (`.scratch/m0-foundation/m0-05-smoke/ui-gates.mjs`).

## Commands
- `npm test`: vitest over `server/test/**/*.test.ts` and `web/test/**/*.test.ts`.
- Typecheck: `npx tsc -p server --noEmit && npx tsc -p web --noEmit`.
- `npm run lint:ui`: design lint over `web/src` and `web/index.html` (no raw colours, no `vh`, named icon buttons, zoom never locked, reduced motion respected). Run it before every UI change.
- `npm run test:e2e`: builds the web app, then runs the Playwright checks in `e2e/`. It rebuilds `web/dist`: see the rule below.
- `npm run smoke:real`: opt-in check against the installed `hermes`.
- `npm run contracts:regenerate`: re-pins `contracts/` from the installed `hermes`. Hermes types come only from there; never hand-write them. Afterwards classify anything new in `contracts/policy/` (a test fails until you do).
- `npm run perf`: Lighthouse mobile budgets on Today, the opening screen (initial JS ≤ 170 KB gzip, LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms). If the JS budget fails, code-split; never raise it.
  - What keeps Today's first screen inside the LCP and CLS budgets (M8 #08): Today's small modules sit in the `landing` chunk group of `web/vite.config.ts` (every extra file in front of the first paint is another round trip); the document of `/` and `/today` carries a `Link: rel=preload` for Today's first read (`server/src/web-app.ts`), so the read is in flight while the scripts download; `useBlock` shows the first answer even when a newer ask is out (`web/src/block-asks.ts`); a Today block holds the room of its usual answer while it loads and when it fails; and what is below the first screen asks Hermes only after the first answer or the first paint (`useJobs(enabled)`, `usePainted`), because Hermes answers one thing at a time. Measure a change in a git worktree, never in `web/dist`.
- **Nobody builds `web/dist` while the live service runs.** The live service serves `web/dist`. `npm run build -w web`, `npm run perf` and `npm run test:e2e` all overwrite it. An agent never runs them. The owner, or the parent agent after asking, builds and then restarts the service (`npm run caduceus -- restart`). To check a build in a smoke script, write it to a temp folder (`cd web && npx vite build --outDir <folder>`), not `web/dist`. The Playwright checks can run against such a build: `E2E_PORT=<port> E2E_WEB_ROOT=<folder> npx playwright test`.
- `npm run dev`: builds the web app and starts Caduceus on `http://127.0.0.1:9130` with a private Hermes that uses the owner's real `~/.hermes`. Manual smoke checks only; stop it afterwards.
- `npm run caduceus -- <setup|uninstall|restart|status>`: the background service and its Tailscale Serve entry (`server/src/service-cli.ts`, pure planning in `service-plan.ts`; tests use fake `launchctl`, `tailscale`, `hermes` from `fixtures/fake-system.ts`).

## After Hermes is updated (first done for 0.22.2)
Caduceus goes read-only on its own when the running Hermes differs from the pinned contracts. To bring it back: `npm run contracts:regenerate`, then `npm test`; classify what is new in `contracts/policy/` (the policy-map test names it), fix what a changed shape broke (the failing tests name it), and read `docs/design/architecture.md` §6 ("Hermes 0.22.2") for the kind of thing to look for. Then `npm run build -w web && npm run caduceus -- restart` (ask the owner first).
- Test and agent runs use a temp `HERMES_HOME` only. Never run `hermes` (above all `hermes pm repair`) without one: it rewrites the owner's dependency environment.
- A temp home needs a dependency environment: `launchTestHermes` links `installs` to the shared repaired root (`server/test/fixtures/hermes-installs.ts`); a script that imports Hermes's Python uses `hermesPython()` (`fixtures/seed-session.ts`), never `<install>/venv/bin/python`.
- A test that pins Hermes's own data (a catalogue, a default model, a count) is wrong: read the expected value from Hermes, or assert what Caduceus is responsible for.

## Talk keeps sessions (owner decision)
Sessions stay visible. Selecting an agent in Talk opens its latest session (never one of its delegated background runs, the `bg_` sessions) and lists the agent's sessions beside the thread, with search, pin, archive and fork. On a phone a Sessions button opens the list as a sheet; on a tablet and a desktop it is a column. The list shows the agent's own sessions; All profiles in its filters widens it. Never replace the list with one endless thread per agent and never hide it behind Details. Talk also marks a run as opened (`POST /_caduceus/api/today/ready/opened`) when its chat is open, also when the run finishes while the chat is open, so the run leaves Ready for review.

## Tests (TDD, binding)
Work red → green, one vertical slice at a time. Write tests only at these seams:
1. **The Caduceus server HTTP/WS API**, black-box: start a real server and call it as the browser does.
2. **Pure domain modules**, at their exported functions, for logic too complex to check through the API (contract diff, risk classifier, redaction, registry, scope resolution, schedule maths, playbook planning). Web modules are tested in `web/test/`.
3. **The Hermes backend launcher.**

No new Playwright tests. Check UI with a throwaway browser smoke at widths 390, 320, 820 and 1440 (no overflow, no console errors, axe, touch targets).

**Fixtures (`server/test/fixtures/`).**
- Tests run against a real `hermes serve` with a throwaway `HERMES_HOME`, launched through the real launcher by `launchTestHermes()` (`real-hermes.ts`). Seed it through Hermes's own APIs or CLI.
- `TestHermes.cli(...args)` is async and returns what the CLI printed. Never block the event loop on a child process: use it, or `run-program.ts`, not `execFileSync`.
- `HERMES_WORK_TIMEOUT_MS` (`real-hermes.ts`) is the limit for waits on a real Hermes doing work. Waits are on events, not sleeps.
- `stub-llm.ts` is the local OpenAI-compatible model (`startStubLlm()`, `connect(hermes)`, `nextReply({ chunks, pauseAfter })`). Other stubs: `stub-speech.ts`, `stub-telegram-setup.ts`, `stub-oidc.ts`, `push-stub.ts`, `hindsight-stub.ts`.
- `launchTestHermes()` removes its own temp home if the launch throws or is abandoned. A hook that times out before the launch returns never gets the handle, so the fixture registers an `afterAll` (`endLaunches`) that makes such a launch clean up after itself and stops any Hermes nobody stopped. `server/test/real-hermes-fixture.test.ts` covers it.
- `fake-hermes.mjs` / `fake-hermes.ts` only for faults real Hermes cannot produce (crashes, stalls, floods, echoed secrets).
- Helpers: `owner.ts` and `step-up.ts` (sign in, step up), `software-authenticator.ts` (passkeys), `browser-socket.ts`, `gateway-client.ts`, `grace-clock.ts`, `seed-session.ts`, `seed-logs.ts`, `fake-system.ts`.
- **Per-run TMPDIR.** `run-temp-root.ts` (vitest `globalSetup`) points `TMPDIR` at a directory made for the run. A test must remove every `caduceus-*` or `fake-hermes-*` directory it makes under `os.tmpdir()`; if one is left, the run fails and names it. A killed run's directory is swept by the next run.
- **Worker cap.** `vitest.config.ts` sets `maxWorkers: 5`, `testTimeout` 15 s, `hookTimeout` 60 s. Over half the files start their own Hermes; more workers starve each other. Do not raise the cap.
- Never touch the owner's `~/.hermes`, the stock dashboard (`:9119`), WebUI (`:8787`) or the gateway from a test or tool.
- Good tests assert behaviour through the seam, take expected values from an independent source, mock only system boundaries, and use no wall-clock sleeps and no `new Promise`.

## Code rules
- `Promise.withResolvers()`, never `new Promise(executor)`.
- No one-expression helpers unless the name is a durable contract (exported domain concept, three or more lockstep call sites, test seam, type guard).
- TypeScript strict. `.ts`/`.tsx` import extensions.
- CSS uses only `--cd-*` tokens from `docs/design/tokens.css`: no raw colours, no `vh`. Logical properties. Touch targets 44 px on coarse pointers.
- **Internationalisation is deferred** (owner decision 2026-10-08). Write plain English UI strings. Do not build message catalogues or locale handling; treat catalogue wording in old ticket criteria as not applicable. The parked work is on the branch `wip/m1-01-i18n`.
- **Help and glossary.** Every module registers help for each of its routes and the glossary terms it uses, in `modules/<name>/help.ts` (`help` on the module definition). Help that belongs to no module is `shell/shell-help.ts`. Plain English; `[[term-id]]` or `[[term-id|words]]` marks a glossary term in a paragraph or list, never in a heading, title or summary. In the UI use `<Term id="risk-tiers">…</Term>`. `web/test/help-contract.test.ts` fails when a route has no help page or a marker names an unknown term or page.
- New screens use `PageHeader` (`web/src/shell/PageHeader.tsx`). Run `npm run lint:ui` and the browser smoke after adding one.

## Security rules (do not weaken)
- Secrets never reach the browser, logs, share snapshots or the repo. Credential reads from Hermes are masked (`credential-guard.ts`, `config-raw.ts`, `channel-secrets.ts`, `webhook-secrets.ts`).
- **Policy proxy.** `contracts/policy/` gives every Hermes REST operation, gateway method, server request and event a tier. Anything not in the map is denied. From the web app call every Hermes route that is not a plain read through `fetchTiered` (`web/src/tiered.ts`). Server side: `server/src/policy.ts` (REST), `gateway-policy.ts` (frames), `policy-gate.ts` (Caduceus-owned routes, listed in `contracts/policy/owned.ts`). New route: add it to the map with its tier and a test.
- **Tiers.** T0 undo toast; T1 confirm; T2 passkey step-up + confirm; T3 step-up + typed name (never in read-only mode, never offline). Denied never reaches Hermes. Order of checks: denied → file guard → read-only → step-up → typed confirmation → audit → forward.
- **File guard** (`file-guard.ts`). Paths are resolved as Hermes resolves them (symlinks, `~`). Deny-lists: `.env*`, `auth.json`, `caduceus/`, Hermes credential files and folders, SSH/cloud/browser/Keychain folders under the owner's home, private keys, archives and backups on file routes (`protected-path`, `secret-path`), and places that run code later (shell startup files, Hermes `hooks`, `scripts`, `skills`, `plugins`: `persistence-path`). Uploads, new folders, deletes, renames and moves are **T1 inside a registered workspace and T3 outside one**. A backup is written only to a `backups` folder.
- **CSP** (`content-security-policy.ts`) is on every answer; the inline pre-paint script is allowed by hash. Answers also carry nosniff, no-referrer and same-origin framing. `img-src` allows `https:` (see architecture §10 on remote images).
- **Push.** Adding or replacing a push subscription (`PUT /_caduceus/api/push/subscription`) is **T2**, audited, accepts only the push services' hosts over HTTPS, and ends with its session.
- **Share links** (`contracts/share-links.ts`) freeze a transcript and redact secrets in text (tokens, keys, private keys, bearer headers, passwords in addresses and assignments) and by tool-argument name.
- **Slash commands** are judged the way Hermes reads them (leading slashes, Python white space, aliases by real name). The deny-list is a snapshot of Hermes 0.21.4; a name Hermes adds later defaults to T0.
- **Hindsight key** goes only to the address it was first used with (`hindsight_key_urls`).

## Safety
- Never run `tailscale`, `launchctl` or system-service changes without asking the owner at that moment.
- Never print or record secrets.
- Never run destructive git commands.
