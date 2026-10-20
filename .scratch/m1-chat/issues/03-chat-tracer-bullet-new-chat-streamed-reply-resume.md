# 03: Chat tracer bullet: new chat, streamed reply, resume

**What to build:** The Chat module end to end. The owner starts a new chat in the scoped profile, types a prompt and watches the reply stream in as plain message bubbles. A Stop button interrupts the running turn. A minimal session list shows this profile's sessions with titles; selecting one opens its transcript from Hermes history. On a phone, the list and transcript use push navigation; on desktop, the list is a left pane.

The chat uses Hermes's gateway over the M0 #09 connection: the gateway's session.create (with the source value verified by M0 #10), prompt.submit, the message.start / message.delta / message.complete events, session.interrupt, session.history for the transcript and session.list for the list.

Resume is the core of this ticket. Reloading the page, locking the phone or dropping the network mid-turn and coming back continues where it left off: the client runs session.activate (falling back to session.resume), then session.events.since from the last seen event, refetching the transcript if the reply is truncated or the epoch changed. The Caduceus server holds the upstream socket for a 10-minute grace period after a browser socket drops and re-binds the device's next socket to it, so the turn keeps running in Hermes. A second device can attach to the same session and sees the same stream.

**Blocked by:** 02 (Contextual help framework), M0 #09 (Live gateway connection with reconnect and epoch detection), M0 #10 (Spike — Caduceus sessions get Hermes's normal toolset)

**Status:** resolved

- [x] New chat creates a session in the tab's profile scope, streams the reply token by token and shows it in the session list with its Hermes title (end-to-end against a stub and once against real Hermes).
- [x] Stop interrupts the running turn; the partial reply stays and is marked stopped.
- [x] Reloading mid-turn resumes the stream with no missing or duplicated text; a truncated replay or new epoch triggers a transcript refetch (tests).
- [x] Dropping the browser socket for up to 10 minutes keeps the upstream open and the turn running; reconnecting re-binds to it. After the grace period the upstream closes (tests with a fake clock).
- [x] The same session open on two devices streams to both.
- [x] Nothing about sessions or messages is stored by Caduceus; list and transcript come from Hermes.
- [x] "Catching up…" shows only when replay takes longer than 300 ms; the composer stays above the soft keyboard on phones.
- [x] Empty session list offers "New chat"; `/chat` and `/chat/:id` deep-link correctly with `?profile=`.
- [x] Passes the M0 #05 gates; strings via catalogues (catalogue part deferred (owner)); Chat help page and glossary terms (turn, grace hold).
- [x] From M0 #10 (architecture §3 and §6):
  - Every `session.create` and `session.resume` carries `source: "caduceus"` from one exported constant (a test pins the value) and the chosen workspace as `cwd`.
  - The first `desktop_contract` the server relays (a `session.create` / `session.resume` / `session.activate` result or a `session.info` event) is set on the compatibility report's live markers and compared with the pin. A different number makes Hermes incompatible (test; M0 #11 turns that into read-only plus a Repair).
  - Reading a session's tools (`tools.show`, `toolsets.list`) waits for the built agent; a build that fails for want of a provider shows Hermes's `error` message in the chat.

## Comments

### M1 #03 implementation (agent)
- **Server.** `gateway-proxy.ts` now holds a dropped tab's upstream for 10 minutes (`DEFAULT_GRACE_MS`; option `gatewayGrace` with injectable timers) and re-binds the same sign-in's same tab (`/api/ws?tab=`, `web/src/tab-id.ts`), re-sending the cached `gateway.ready`. A socket naming no tab is never held. `desktop_contract` is read from relayed frames (`desktopContractIn`) and put on the live markers by `withDesktopContract`; a different number is drift (incompatible, read-only). `CADUCEUS_SESSION_SOURCE = 'caduceus'` lives in `contracts/caduceus-api.ts`.
- **Engine.** `web/src/modules/chat/chat-session.ts` (`createChat`, `createChatList`, `transcriptOf`). Resume = activate, falling back to resume, then `events.since`; a truncated replay or a changed epoch takes the snapshot Hermes just gave; live events are held during catch-up and applied seq-gated. "Catching up…" after `CATCH_UP_DELAY_MS` (300).
- **UI.** Module `chat` (`/chat`, `/chat/new`, `/chat/:id`, key `c`, command `new-chat` bound to ⇧⌘O), help pages and glossary terms `turn`, `grace-hold`, `<Term id="turn">` in the screen. A new chat creates its session at the first send (no empty live session left behind) and the address is replaced by the stored id.
- **Tests** (all against a real `hermes serve` in a temp HERMES_HOME with the stub LLM, which now streams: `nextReply`, `pauseAfter`): `server/test/chat.test.ts` (new chat in a scoped profile streams, lists with Hermes's title and `source: caduceus`; Stop keeps the partial, marked stopped; page opened mid-turn; drop + catch-up; truncated replay (700 chunks > 512-event ring) shows Hermes's snapshot; Hermes restart (new epoch); stale runtime id retried; "Catching up…" only past 300 ms; two devices; grace hold with a real turn, same upstream, closed after the grace), `chat-provider.test.ts` (tools read after the build, no Desktop bridges; no-provider error shown), `gateway-proxy.test.ts` "grace hold" (fake Hermes: ten minutes, take-over, expiry, other tab/sign-in/no tab never take it, sign-out ends it, desktop-contract mismatch -> incompatible + read-only), `hermes-compatibility.test.ts` (live number 7 -> compatible), `web/test/tab-id.test.ts`. The pin of the source value is the `source: caduceus` row assertion and the exported constant.
  Mutation checks run (each made the named test fail): no append of deltas, no message.start reset (reload), truncation ignored, retry removed, tools not awaiting the build, take-over disabled, hold disabled, desktop contract not fed.
- **Browser smoke** (temp HERMES_HOME, stub LLM, `ui-gates.mjs` at 390/320/820/1440 on `/chat`, `/chat/new`, `/chat/:id`): no overflow, console errors, serious axe or small targets after fixing the app-bar crumb link (35 px wide at 820; `min-inline-size` in `shell.css`). Reload mid-turn resumed, Stop marked the reply. Screenshots: `.scratch/m1-chat/m1-03-smoke/`. The soft keyboard cannot be exercised headless; the composer is sticky above `--kb-inset` (the existing `useKeyboardOpen`) - to confirm on the owner's phone.
- **Perf.** Chat's shared shell modules split into three extra eager chunks (LCP 2.6 s > 2.5 s); `web/vite.config.ts` now groups them into one `shell-state` chunk: 128.5 KB gzip over 18 scripts, LCP 2.44 s.
- **Deviations.** "Against a stub and once against real Hermes": every test runs the real `hermes serve`, with the stub LLM as its only model; a real model needs the owner's provider keys, which a temp HERMES_HOME never has (not run). Which replies were stopped is not in Hermes's transcript, so the "Stopped" mark lasts while the page is open (an opened-later transcript shows the partial text unmarked). Strings are plain English (catalogue part deferred (owner)). `session.create` happens at the first send rather than on opening `/chat/new`.
- **Follow-ups.** Running the live service needs `npm run caduceus -- restart` (owner). Message markdown (#04), tool cards (#05), approvals (#06), steer/queue (#07), model chips (#08) build on the engine.

### Evidence (documentation pass)
- **Commit(s):** `01e86be` feat: chat tracer bullet with streamed reply, resume and grace hold (M1 #03).
- **Tests added:**
  - `server/test/chat.test.ts` (11): Caduceus WS seam over a real `hermes serve` with the stub LLM (new chat, Stop, mid-turn open, drop and catch-up, truncated replay, restart epoch, stale runtime id, "Catching up…" delay, two devices, grace hold).
  - `server/test/chat-provider.test.ts` (2): same seam (tools read after the build; no-provider error).
  - Modified: `gateway-proxy.test.ts` (23, was 17; grace hold with the fake Hermes), `hermes-compatibility.test.ts` (3, was 2), `web/test/shortcuts.test.ts` (12, was 12).
  - `web/test/tab-id.test.ts` (2): pure module.
  - Fixtures: `grace-clock.ts` (new), `stub-llm.ts` (streaming: `nextReply`, `pauseAfter`), `gateway-client.ts`, `fake-hermes.mjs`.
- **Verification recorded:** Eight mutation checks each failed the named test. Browser smoke (`ui-gates.mjs` at 390/320/820/1440 on `/chat`, `/chat/new`, `/chat/:id`): no overflow, console errors, serious axe or small targets after fixing the app-bar crumb link (35 px at 820); reload mid-turn resumed and Stop marked the reply; screenshots in `m1-03-smoke/`. Perf: the shared shell modules were grouped into one `shell-state` chunk; initial JS 128.5 KB gzip over 18 scripts, LCP 2.44 s (it was 2.6 s before). The soft keyboard cannot be exercised headless: not verified; the composer is sticky above `--kb-inset`.
- **Deviations:**
  - "Against a stub and once against real Hermes": every test runs the real `hermes serve` with the stub LLM as its only model; a real model needs the owner's provider keys, so it was not run.
  - Which replies were stopped is not in Hermes's transcript, so the "Stopped" mark lasts only while the page is open.
  - Strings are plain English (catalogue part deferred (owner)).
  - `session.create` happens at the first send, not on opening `/chat/new`.
- **Follow-ups / open items:** Soft-keyboard placement needs a check on the owner's phone. The live service needs `npm run caduceus -- restart` (owner). #04 to #08 build on the engine. Status: resolved.
