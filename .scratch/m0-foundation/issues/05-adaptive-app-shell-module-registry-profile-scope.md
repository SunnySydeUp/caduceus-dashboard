# 05: Adaptive app shell, module registry, profile scope and quality gates

**What to build:** The web app gets its real shell, ported from the approved prototype and design system.

**Navigation by window width:**
- under 600 px: a bottom tab bar;
- 600–1199 px: a navigation rail;
- 1200 px and up: a grouped sidebar.

**Chrome:**
- an app bar with the profile chip, the connection dot (a placeholder until ticket 09) and search;
- a banner stack;
- a toast region.

**Module registry.** Navigation comes from an internal registry. In M0 only Home, Health and Settings register, and More lists whatever is registered. A future module plugs in without changing the shell.

**Profile chip.** It lists the real Hermes profiles. Choosing one scopes this browser tab through the URL, falling back first to this device's last choice and then to Hermes's default. It never changes Hermes's default profile. Screens marked cross-profile offer "All profiles".

**Quality gates.** From this ticket on, every route is held to the mobile and accessibility test gates.

**Blocked by:** 01 (walking skeleton).

**Status:** resolved

- [x] Navigation switches strictly by window width at the token breakpoints (600 and 1200), never by device detection.
- [x] Layout uses dynamic viewport units and all four safe-area insets. Zoom is not locked. The tab bar hides on scroll-down and while the keyboard is open.
- [x] A module declares its nav entry, routes, palette commands, settings panel and policy hooks. A test module proves that adding one needs no shell change.
- [x] The profile chip lists Hermes profiles through the proxy. The tab's profile is kept across navigation and does not affect other tabs. Hermes's default profile is never written (test).
- [x] Accessibility:
  - landmarks and a skip link;
  - focus moves to the page heading on navigation;
  - sheets and dialogs trap focus over an inert background;
  - Escape and back close the top layer first.
- [x] Playwright projects run every route:
  - projects: phone 390×844 with touch, small phone 320, tablet 820, desktop 1440;
  - every route has no horizontal overflow and no serious or critical axe violations;
  - targets are at least 44 px on coarse pointers and 24 px on fine pointers.
- [x] Lint bans raw colours and `vh` and requires named icon buttons.
- [x] The shell matches the prototype in screenshot review at 390, 820 and 1440.

## Comments

**2026-10-07: resolved (TDD at the pure-module seam; the UI is verified by browser smoke checks).**

- **What was built:**
  - **Shell** (`web/src/shell/`), ported from the prototype's `components.css` over `--cd-*` tokens, with the prototype's icon set:
    - bottom tab bar under 600 px, navigation rail from 600 px (its menu button opens the grouped drawer), grouped sidebar from 1200 px (collapses to the rail, remembered per device);
    - app bar (breadcrumb on medium/large, back button and scroll-in title on phones, profile chip, connection dot, search);
    - banner stack, toast region, Work sub-navigation chips, More (grouped, searchable), Page not found;
    - skip link and landmarks; focus moves to the page `h1` after navigation (never on first load); the tab bar hides on scroll down and while the soft keyboard is open.
  - **Module registry** (`web/src/module-registry.ts`, pure, generic over the screen type). A module declares its nav entry, routes, palette commands, settings panels and a policy hook (`tierOf`), plus `crossProfile` / `profileScoped`. The shell reads only the registry: tabs, rail, sidebar, More, sub-nav, route table, redirects, search, Settings list. Home, Health and Settings are the three built-in modules (`web/src/modules/`). Duplicate ids or routes are refused.
  - **Profile scope** (`web/src/profile-scope.ts`): the URL, then this device's last choice (as it was when the tab loaded), then Hermes's sticky default (`GET /api/profiles/active`). Profiles load through the proxy with GETs only. Choosing a profile sets `?profile=` for the tab and remembers it on the device; links carry it along. Home is cross-profile (offers All profiles).
  - **Layers** (`web/src/overlays/`): sheets (draggable bottom sheet on phones, centred dialog elsewhere), drawers and the search palette. The page behind is `inert`, Tab wraps inside, Escape and back close the top layer first (one history entry per layer), focus returns to the invoker.
  - **Folded in from ticket 04:** Security lives at `/system/security` as a Settings panel (Settings › Security); `StepUpDialog` is mounted by the shell, now a T2 sheet; Home's temporary Security link is gone.
  - **Chrome:** the 1 s backend poll moved from Home to `web/src/backend-status.ts`; the connection dot and its offline / reconnecting / stopped banners use it plus the browser's network state (M0 #09 swaps in the gateway connection). The app-bar search is a quick search over the registry (modules, settings panels, module commands); M0 #06 replaces it with the ranked palette.
  - **Health** shows what Caduceus already knows (server, Hermes backend lifecycle, contract compatibility from `/_caduceus/api/compatibility`); M0 #11 grows it.
  - **Lint:** `npm run lint:ui` (`server/scripts/lint-ui.ts`, parses TSX with rolldown's oxc parser): raw colours (CSS and TS/TSX), `vh`, unnamed icon buttons, locked zoom. Run against throwaway files with each violation, it reported all of them; the real sources pass.
  - **Docs:** AGENTS.md (layout, commands, seams, workflow), README, `.scratch/README.md`, architecture §7 "App shell as built".
- **Tests** (16 new; pure-module seam, one against real Hermes):
  - `web/test/size-class.test.ts` (2): the class switches exactly at the token breakpoints (the test reads `--breakpoint-rail` / `--breakpoint-sidebar` from `tokens.css`, expecting 600 and 1200); nav mode per class and collapse.
  - `web/test/module-registry.test.ts` (7): a registered module appears in More and contributes routes (a test module with nothing the shell knows); primary destinations (top modules + one Work entry); tab highlighting; palette commands, settings panels (also routes) and the policy hook; duplicate id/route refused; redirects; grouped sidebar.
  - `web/test/profile-scope.test.ts` (6): URL > device > Hermes default; unknown profiles ignored; cross-profile scope; choosing a profile (URL + device, All profiles); links keep `?profile=`.
  - `server/test/profile-scope.test.ts` (1, real Hermes in a temp `HERMES_HOME` through the Caduceus proxy, profiles seeded with `hermes profile create … --no-alias`): the list is Hermes's, with its sticky default (`coder`); two tabs choosing different profiles do not affect each other; Hermes's default (API and the `active_profile` file) is unchanged.
  - Red first: `size-class`, `module-registry` (duplicates, redirects, sidebar, commands…), `profile-scope` and the real-Hermes test failed for the expected reason before code. Tests that passed on first run were mutation-checked: unknown-profile handling (`profiles.includes` → `true`), `destinationOf` (Work → More), the panel `parent` field, and the Hermes default (`loadProfiles` always `default`).
- **Verification:**
  - `npm test`: 66 pass, 1 opt-in skipped; both typechecks clean; `npm run lint:ui` clean; `npm run test:e2e`: 6 pass.
  - **Browser gates** (`m0-05-smoke/ui-gates.mjs`; Caduceus on `127.0.0.1:9150` in front of real Hermes 0.21.4 in a temp `HERMES_HOME`, headless Chromium): every route (`/home`, `/observe/health`, `/settings`, `/system/security`, `/more`, an unknown path, `/sign-in`) at 390 and 320 (touch), 820 (touch) and 1440 (mouse), dark and light: no horizontal overflow, nothing outside the viewport, axe (WCAG 2.2 AA + best practice) has no serious or critical violation, targets ≥ 44 px coarse / ≥ 24 px fine, no console errors. Also with the profile sheet, search palette and (820) nav drawer open. Screenshots in `m0-05-smoke/`.
  - Fixed during the check: `label-content-name-mismatch` (profile chip, wordmark, search field), a 20 px breadcrumb link, text-zoom overflow (Health, Security at 200 % text and 320 px, now 0 on every route).
  - **Behaviour:** breakpoints 599/600/1199/1200 switch bar → rail → sidebar without reload; sidebar collapse persists across reload; Android-style and iOS-style soft keyboard (viewport shrink with a focused field) hides the tab bar; scroll down hides it and scroll up returns it; with all four safe-area insets emulated (47/34/44/44) the app bar, tab bar, rail/sidebar and page padding respect them; profile choice sets `?profile=` on the tab, persists across nav, writes the device choice and leaves Hermes's default (`coder`) alone; sheet over sheet: Escape and back each close only the top layer, focus returns to the invoker, Tab never leaves the layer; step-up with a virtual authenticator registers a passkey, the dialog opens as an `alertdialog` and the retried password change succeeds; browser-offline emulation shows the banner and the dashed dot, then clears.
  - **Registry proof in the browser:** a throwaway module (nav entry, two routes, a palette command, a settings panel, a policy hook) added with one registry entry and no shell change appeared in the tab bar / rail / sidebar, More, the Work sub-navigation, search and the Settings list. It was removed afterwards.
  - **Screenshot review** against the prototype (`m0-05-smoke/prototype-reference/`): app bar, tab bar, rail, sidebar, drawer, profile switcher and tokens match; the prototype's mock-data screens differ by design.
- **Deviations:**
  - **No Playwright tests** (AGENTS.md): the "Playwright projects run every route" criterion is the repeatable browser check `m0-05-smoke/ui-gates.mjs` (the four projects, every route, overflow / axe / targets). Not part of `npm test`.
  - **e2e:** the Home test that loaded `/some/client-side/route` and expected Home now loads `/home`: an unknown address is now "Page not found" inside the shell.
  - **TanStack Query not adopted** (architecture §7 names it): two small fetches exist; it arrives with the first list-heavy screen. Tailwind, Radix and the Tabler package are also not used (prototype CSS over tokens; own layers). Recorded in architecture §7.
  - **Layers are not native `<dialog>`s**, so toasts stay usable above them and one history entry per layer lets back close the top layer.
  - **Search** is a basic quick search, not the palette (M0 #06). The connection dot is driven by the backend poll and browser state, not the gateway (M0 #09).
  - **Security is a Settings panel** (not a separate nav module), so only Home, Health and Settings are registered.
  - Vitest needs `css.include` for `tokens.css` so tests can read the real tokens; `web/tsconfig.json` now includes `test/`.
- **Follow-ups:**
  - **M0 #06:** replace `QuickSearch` with the palette (it already reads `registry.paletteCommands()`), bind ⌘K, `g` + letter and `?`; tiered commands use the registry's `tierOf`.
  - **M0 #07:** appearance in the shell's per-device prefs (`caduceus.shell` is layout only); the theme must apply before first paint.
  - **M0 #08:** the tiered dialog should build on `Sheet`; `setBanner` for read-only and contract-mismatch banners; add "Make default" to the profile switcher only through Profiles (M4 #01).
  - **M0 #09:** feed `useConnection` / `useConnectionBanners` from the gateway connection and drop the poll.
  - **Later modules:** register through `web/src/modules/index.ts`; new screens use `PageHeader`; rerun `ui-gates.mjs` and `npm run lint:ui`. At 200 % text on a phone the profile chip shows only its avatar (label truncated).

### Evidence (documentation pass)
- **Commit(s):** `b6c98ae` feat: adaptive app shell, module registry, profile scope and quality gates (M0 #05).
- **Tests added:**
  - `web/test/module-registry.test.ts` (7), `web/test/profile-scope.test.ts` (6), `web/test/size-class.test.ts` (2): pure modules.
  - `server/test/profile-scope.test.ts` (1): Caduceus HTTP API seam over real Hermes with seeded profiles.
  - Modified: `e2e/home.spec.ts` (3, was 3; the unknown-address case now loads `/home`).
- **Verification recorded:** `npm test` 66 pass, 1 opt-in skipped; both typechecks, `npm run lint:ui` clean; `npm run test:e2e` 6 pass. Browser gates (`m0-05-smoke/ui-gates.mjs`) on every route at 390 and 320 (touch), 820 (touch) and 1440 (mouse), dark and light, also with the profile sheet, palette and drawer open: no overflow, nothing outside the viewport, no serious/critical axe, targets ≥44/24 px, no console errors. Behaviour checks: breakpoints 599/600/1199/1200, sidebar collapse persists, soft-keyboard hiding of the tab bar, four safe-area insets, sheet-over-sheet Escape/back, offline banner. A throwaway module appeared in tab bar, rail, sidebar, More, Work sub-nav, search and Settings with one registry entry. Screenshots reviewed against the prototype.
- **Deviations:**
  - No Playwright tests: the per-route project criterion is the repeatable `ui-gates.mjs` (not part of `npm test`).
  - The e2e Home test that loaded `/some/client-side/route` now loads `/home`.
  - TanStack Query, Tailwind, Radix and the Tabler package are not adopted (recorded in architecture §7).
  - Layers are not native `<dialog>`s (toasts stay usable above them; one history entry per layer).
  - Search is a basic quick search until M0 #06; the connection dot follows the backend poll until M0 #09.
  - Security is a Settings panel, so only Home, Health and Settings are registered.
- **Follow-ups / open items:** M0 #06 palette, #07 appearance, #08 tiered dialog and banners, #09 gateway-driven dot. At 200% text on a phone the profile chip shows only its avatar. Status: resolved.
