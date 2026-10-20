# 01: Sigils, crew state and the Desk skin

**What to build:** The shared base of the Desk redesign (design: `docs/design/mocks/desk/`).
- **Sigil:** a component that draws an agent as a 2x2 geometric mark from its profile name (stable pattern and hue per name, so a profile keeps its look everywhere, as `Avatar` does now). Sizes xs, sm, md, lg, xl. The state shows as a ring and a corner badge (waiting, working, done, blocked) and never by colour alone. Motion stops under reduced motion. `Avatar` callers move to `Sigil`; `all` keeps its scope icon.
- **Crew state (pure domain module):** for each profile, one of `waiting | working | done | blocked | idle`, a live line (one short sentence of what it is doing or asking), and a time. Derived from Hermes data only: pending approvals and clarify questions (waiting), live runs from `session.active_list` (working), the last finished run not yet opened (done), a failed run (blocked). It stores nothing.
- **Desk skin:** a new default skin in `tokens.css` following the Desk rules: ink and neutrals carry the UI, amber only for "a person is needed", green and red only for outcomes, primary buttons in ink. The other skins stay. Contrast tests stay green for every skin.
- **Typeface:** adopt Geist and Geist Mono only if one variable woff2 each, `font-display: swap`, keeps the JS and LCP budgets (measure with `npm run perf`). Otherwise keep the system stack and record the measured numbers.

**Blocked by:** none

**Status:** resolved

- [x] Sigil pattern and hue come from the name alone; the same name gives the same sigil on every screen. Test: stable, distinct for the five owner profiles, and no two of them share a pattern and hue.
- [x] Every state has a ring, a badge and an accessible text label. Test the state-to-label table and that no state is only colour.
  - Deviation: `idle` has a label ("Idle") but no ring and no badge: it is the absence of a state. The four states that show (waiting, working, done, blocked) each have a ring of their own shape (pulse, arc, solid, dashed) and a badge icon of their own. The sigil is `aria-hidden` (decorative, as the contract says), so the label is the text a screen shows beside it (`crewStateLabel`).
- [x] The crew-state module is pure and tested for each state, for precedence (waiting beats working beats done), and for the live line. It makes no Caduceus-store writes.
- [x] The Desk skin passes the existing contrast test for light and dark, and `lint:ui` (tokens only, no raw colours).
- [x] Geist is adopted or rejected with measured numbers recorded in the ticket.
  - Rejected: LCP 3.01 s against the 2.5 s budget (2.28 s without the fonts). The system stack stays. Numbers below.
- [x] No screen changes yet except `Avatar` callers rendering `Sigil`. Phone 390, 320, tablet 820 and desktop 1440 show no overflow; axe clean.
  - Deviation: the browser smoke ran at 390 and 1440 only, as the assignment asked (320 and 820 not run).

## Comments

### Evidence (M8 #01)

- **Commit:** `1bc62f4` feat: sigils, crew state and the Desk skin (M8 #01).
- **Tests added** (all web pure modules or renders, in `web/test/`):
  - `sigil-model.test.ts`, 6 tests: the sigil of a name is stable (pinned for the owner's five); a 2 x 2 pattern of known cells, never blank, one of 7 hues; coder, general, homeassistant, librarian and property differ in both pattern and hue (red first: the first hash gave two the same hue, so the hue salt was chosen to separate them); every cell shape and hue is reached across 400 names; the state-to-label table; every state that shows has its own ring shape and its own badge icon (red first: done and blocked shared a ring, so blocked is dashed).
  - `crew-state.test.ts`, 24 tests: idle; waiting (approval, question, how many more, long command cut to one line, a live run stopped on the owner, items with no profile or an unlisted profile ignored); working (oldest run, count of others, untitled run); blocked; done (only runs the device has not opened); precedence waiting > working > blocked > done > idle; no leak between profiles; the input is not changed.
  - `sigil-render.test.ts`, 6 tests: `Sigil` markup (four cells of the name's pattern, hue, `aria-hidden`, no text, no ring or badge without a state, a badge and ring per state, idle shows none, `all` shows the scope icon, `UnassignedSigil`). Mutation check: removing `aria-hidden` and the idle guard failed two tests.
  - Changed: `contrast.test.ts` (Desk joins the skins, 7 skins in the sweep, recorded ratios for Desk and for the sigil hues on their tiles, first visit equals `desk`), `appearance.test.ts` (default skin `desk`), `pwa-manifest.test.ts` (the manifest and the two `index.html` theme-color tags equal Desk's canvas, light and dark).
- **Crew state input:** `deriveCrew({ profiles, items, running, activity, unseen })` reuses `InboxItem`, `HomeRun` and `ActivityEvent` from `contracts/inbox.ts`: approvals and questions (waiting), `HomeRun`s (the server's reading of `session.active_list`, with the profile) for working and for a run stopped on the owner, failed-group notices (blocked) and the first `unseen` events of the activity feed (done). Items with no profile belong to nobody.
- **Desk skin:** `desk` is the first skin and the default (`contracts/appearance.ts`, `web/index.html` pre-paint script, Settings › Appearance card, help). In `tokens.css`, Desk is `:root:not([data-skin]), [data-skin="desk"]`: ink and grey neutrals, ink accent (ink primary buttons), info, running, paused and stale tones in grey; success, warning and danger keep their green, amber and red. Nous stays as the base the other skins start from; the base colour block now also applies to a Hermes Teal subtree so a card of any skin is self-contained on a Desk page. `--cd-avatar-*` and `--cd-on-avatar` are replaced by `--cd-sigil-1…7` and derived `--cd-sigil-tile-1…7`; the contrast pairs check every hue at 3:1 on its own tile (lowest 3.92 light, 5.21 dark in Desk, Nous and the accent skins; 3.85 in Hermes Teal). Desk's `fg-subtle` is `#5a616c` / `#969ca5` (darker than the mock's `#626973` / `#8a9099`) so fg-subtle stays at 4.83:1 or more on a selected row and 4.5:1 on a diff line. The PWA manifest and `index.html` theme colours follow Desk's canvas (`#f5f6f7`, dark `#0c0d0f`).
- **Avatar cutover:** `Avatar.tsx` and every `.avatar*` rule are gone. Sizes: `xs` where it was the small avatar, `sm` in the profile switcher rows and Pairing, `md` on the profile, gateway and channel cards and the builder name. The unassigned dashed circle of Work is now `UnassignedSigil`. Nothing sets a `state` yet (tickets 02 to 07).
- **Typeface (Geist): rejected.** `npm run perf` (Lighthouse mobile, slow 4G, 4x CPU), same machine, other agents running:

  | Run | Initial JS (gzip) | LCP | CLS | INP |
  |---|---|---|---|---|
  | HEAD before this ticket (system stack) | 149.6 KB | 2.75 s | 0.022 | 262 ms |
  | This ticket, system stack | 150.5 KB | 2.28 s | 0.003 | 74 ms |
  | This ticket + Geist and Geist Mono (one variable woff2 each, `font-display: swap`), run 1 | 150.5 KB | 3.01 s | 0.003 | 73 ms |
  | Same, run 2 | 150.5 KB | 3.01 s | 0.003 | 76 ms |

  The JS budget (170 KB) holds, but the two fonts (69 KB + 71 KB) push LCP over 2.5 s twice in a row (3.01 s both times), against 2.28 s without them. The HEAD run's LCP and INP were over budget on a busy machine (a load effect; the system-stack run on the same tree right after was 2.28 s and 74 ms). The system stack is kept; the font files were not added to the repo.
- **Browser smoke** (throwaway; Caduceus in front of a real Hermes in a temp `HERMES_HOME` with the owner's five profile names; `ui-gates.mjs` checks): Desk, light and dark, at 390 (touch) and 1440, on Home, Home with the profile switcher open, Profiles and Gateway. No horizontal overflow, nothing outside the viewport, targets at 44 px (touch) and 24 px (mouse), no serious or critical axe violations. The only console errors were Home's `503` for `/api/analytics/usage?profile=<name>` on the five freshly created profiles (a profile with no sessions yet; not from this change). A gallery of the real markup showed every state at every size. The script, server and temp directories were deleted afterwards.
- **Checks run:** `npx tsc -p server --noEmit && npx tsc -p web --noEmit`, `npm run lint:ui`, and vitest on `sigil-model`, `sigil-render`, `crew-state`, `contrast`, `appearance`, `pwa-manifest`, `help-contract`, `help`, `settings-search`, `sw-cache-rules`, `palette`, `module-registry`, `server/test/device-preferences` and `server/test/web-app-serving`: all green.
- **Follow-ups (docs pass):** `docs/design/design-system.md` still names `--cd-avatar-*` and the avatar (lines about identity, the profile chip, the Tailwind bridge sample) and says Nous is the default skin; §4.4's contrast evidence needs the Desk rows and the sigil pairs. `web/dist` was rebuilt (by `npm run perf` and a final build). The live service reads the hash of `index.html`'s inline pre-paint script once at start (`server/src/caduceus-server.ts`, `inlineScriptHashes`), and this ticket changed that script (the skin list and default), so the live service needs `npm run caduceus -- restart` (ask the owner first) before its pages run it; until then the browser blocks that one script and the page falls back to applying the look when the app starts.
