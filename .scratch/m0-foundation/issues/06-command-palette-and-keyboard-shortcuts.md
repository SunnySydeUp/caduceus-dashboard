# 06: Command palette and keyboard shortcuts

**What to build:** ⌘K or Ctrl+K, and the search button on phones, opens the command palette. On phones it is a full-screen sheet.

It offers:
- **Navigate:** every registered route.
- **Actions:** contributed by modules through the registry. The current screen's actions are listed first.

Matching is fuzzy, uses Hermes's shared fuzzy helper, and highlights the matched characters. Each entry shows its shortcut.

Keyboard navigation:
- `g` then a letter jumps to a destination;
- `?` opens the shortcut sheet.

Shortcuts can be remapped, and single-key shortcuts can be turned off entirely (WCAG 2.1.4). Both settings are stored per device. ⇧⌘O stays reserved for "New chat", which the Chat module registers in M1.

**Blocked by:** 05 (adaptive app shell, module registry, profile scope and quality gates).

**Status:** resolved

- [x] The palette lists every registered route and module action, ranked by fuzzy match. ↑ ↓ ↵ and Esc work, and the results count is announced to screen readers.
- [x] The current module's actions appear first. Actions that need a tier go through the same confirmation path as everywhere else.
- [x] `g` + letter and the `?` sheet work. Settings › Keyboard can remap shortcuts and disable single-key shortcuts, per device.
- [x] On phones the palette is a full-screen sheet opened from the app bar.
- [x] Ranking, keyboard flow and the shortcut-disable setting have tests. All routes still pass the ticket 05 gates.

## Comments

**2026-10-07: resolved (TDD at the pure-module seam; the UI is verified by browser smoke checks).**

- **What was built:**
  - **Palette** (`web/src/shell/Palette.tsx`, replaces `QuickSearch`): ⌘K / Ctrl+K and the app-bar search open it; a full-screen sheet on phones, a card near the top elsewhere. Groups **This screen** (the current module's commands) · **Actions** (other modules' commands and the shell's own "Keyboard shortcuts") · **Navigate** (every route without a parameter: module landings, other static routes, settings panels). Fuzzy ranking uses Hermes's vendored `fuzzy.ts` (new export `@caduceus/contracts/hermes/shared/fuzzy`); the label's matched characters are highlighted; words outside the label (group, address, summary) match as whole substrings, after the label matches. Each entry shows its shortcut (none while that shortcut is switched off). The count is announced through a polite `role="status"`.
  - **Keyboard** (`web/src/shortcuts.ts`, `keyboard-flow.ts`, `shell/ShellActions.tsx`): a module declares `key` (the letter after `g`), a command may declare `shortcut`. `stepOf` turns a key press into a step (`mod` is ⌘ on a Mac and Ctrl elsewhere; Option chords use the physical key); `buildKeymap` applies this device's remaps and the single-key switch and refuses clashes, `g`-prefix clashes and the reserved ⇧⌘O (owner: command `new-chat` of module `chat`, M1); `keyFlow` is the pure step function. Single-key shortcuts (`g` + key, `?`) ignore text fields, open sheets and ⌘/Ctrl-held keys; ⌘K works everywhere. The `g` hint (`role="status"`) shows while a jump is pending (1.5 s).
  - **`?` sheet** (`ShortcutSheet`) lists every shortcut as bound on this device, with the single-key switch; **Settings › Keyboard** (`modules/settings/Keyboard.tsx`, `/settings/keyboard`) has the switch, a Change / Reset button per shortcut (press the new keys; Esc cancels; Tab is never captured, so no keyboard trap) and Reset all. Built-in keys: `g h` Home, `g e` Health, `g ,` Settings (prototype keys).
  - **Per-device storage:** `localStorage` key `caduceus.keyboard` (`singleKey`, `remaps`), by design device-local. A later ticket (the Caduceus prefs store, with M0 #07 appearance or M1 #20 behaviour settings) may mirror it if the owner wants it shared; nothing needs it yet.
  - **Tiers:** the entry's tier is the owning module policy's `tierOf(commandId)`, else the command's own `tier`; T1+ is asked through `shell/tier-confirmation.ts` (`setTierConfirmer`) and runs only on a yes; T0 runs at once. A key press runs the same entry the palette runs, so the path is one.
  - Also: `hasOpenLayer()` on the layer stack; `.overlay__body` rows keep their content height (`grid-auto-rows: max-content`: a sheet row with an explicit `min-block-size` was squeezed over its neighbour in a half-height sheet); `QuickSearch.tsx` removed; docs (AGENTS.md, architecture §7).
- **Tests** (33 new, pure-module seam, `web/test/`; red first for each new behaviour):
  - `palette.test.ts` (13): entries (routes with parameters left out, current module first, shortcut shown / switched off / remapped, action names), ranking (fuzzy + highlight positions, fixed group order whatever the scores, whole-word fallback), running (tier from policy or declaration, T0 straight through, confirm yes / no / no dialog, route, shell entry), highlight segments, ↑ ↓ ↵ flow and the results announcement.
  - `shortcuts.test.ts` (12): key press to step; defaults from the registry; **single-key switch off** (and ⌘ shortcuts stay on); remap; reserved ⇧⌘O and clashing remaps; `check` (invalid, reserved, taken, prefix, `g ⌘K`); stored-settings parsing; key caps per platform; heading groups; the three built-in shortcuts have no clash.
  - `keyboard-flow.test.ts` (8): `g` + key, ⌘K anywhere, `?`, single keys stay out of fields / sheets / ⌘-held keys, switched off, remapped keys, pending `g` (timeout, other key, bare Shift), capture / repeat / IME.
  - Mutation checks: the ranking, T0, single-key switch, remap, every `check` rule and every `keyFlow` guard were mutated and each mutation failed a test.
- **Verification:**
  - `npm test`: 99 pass, 1 opt-in skipped; both typechecks clean; `npm run lint:ui` clean; `npm run test:e2e`: 6 pass.
  - **Browser checks** (`.scratch/m0-foundation/m0-06-smoke/`: `serve.ts` starts Caduceus on :9160 in front of real Hermes 0.21.4 in a temp `HERMES_HOME`; `keyboard-checks.mjs` drives the keyboard and touch UI): 48 steps pass at 1440 (mouse, hardware keyboard) and 390 (touch): ⌘K, focus in the field, count announced, fuzzy `hlth`, highlight, ↑ ↓ wrap, ↵ opens and focus goes to the heading, Esc closes and returns focus, ⌘K again closes, `g` hint, `g h` / `g e` / `g ,`, `?` sheet, `?` typed into the palette is text, the single-key switch (stored, survives reload; with it off `g h` and `?` do nothing, ⌘K works), remap (taken key, reserved ⇧⌘O, `g ⌘K` refused, `g x` works and `g h` does not, Reset, Esc cancels, Tab leaves), phone palette fills the viewport and tapping a result opens it, no console errors.
  - A throwaway module (nav entry, `key`, three commands: untiered, T2 by policy, T3 by declaration, two with shortcuts), added with one registry entry and removed afterwards, showed in the browser: its commands under **This screen** on its own route and **Actions** elsewhere with Tier badges; the untiered one runs from Enter and from ⇧⌘D; the T2 and T3 ones do **not** run (from Enter or ⇧⌘T) and a toast says why; `g d` goes to the module and the `?` sheet lists its commands.
  - **Gates** (`m0-05-smoke/ui-gates.mjs`, cache disabled): `/home`, `/observe/health`, `/settings`, `/settings/keyboard`, `/system/security`, `/more` and an unknown path, at 390 / 320 / 820 touch and 1440 mouse, dark (also with the palette, the `?` sheet, the profile sheet and, at 820, the drawer open) and light (palette and sheet open): 0 failures in 188 runs, 21 skipped where a size has no such opener (overflow, outside-viewport, axe serious/critical, 44 / 24 px targets, console). An earlier pass on cached assets (224 runs) was also clean. 200 % text at 320 px: no overflow on Settings › Keyboard (also while choosing keys), the palette and the sheet. Screenshots in `m0-06-smoke/`.
  - `/sign-in` (outside the shell, untouched) was not re-run.
  - Processes: the throwaway server stopped (its temp home deleted); none left.
- **Deviations:**
  - **No Playwright tests** (AGENTS.md); the behaviour is the repeatable `keyboard-checks.mjs` plus `ui-gates.mjs`.
  - **The tiered dialog is M0 #08.** Until it installs a confirmer, a tiered command is refused with a toast ("needs a confirmation (Tier N) that cannot be asked for yet, so it was not run"), never run unconfirmed. M0 built-in modules register no commands, so nothing is refused today.
  - **`ui-gates.mjs` changed:** openers are a table (`palette` = the search button, new `shortcuts` opener presses `?`), and it leaves for `about:blank` before changing touch emulation (the reload hung while a sheet from the previous run was open).
  - **`/` does not open the palette** (the prototype binds it): the ticket and information architecture §8 give `/` to the composer's slash commands (M1).
  - A first batch of three palette run tests and three keyboard-flow tests was written together rather than one at a time; each was still seen failing for its expected reason, or mutation-checked.
- **Follow-ups:**
  - **M0 #08:** call `setTierConfirmer(request => …)` from the tiered dialog (the request carries tier, module, action id and label); the palette and every shortcut then use it.
  - **M1 Chat:** register command `new-chat` in module `chat` with `shortcut: 'mod+shift+o'` (reserved in `shortcuts.ts`), and `key: 'c'`; the Inbox `key: 'i'`, Work etc. use the prototype letters. `j` / `k` list movement and `/` in the composer are theirs.
  - **M1 #01 (i18n):** the palette, sheet and Settings › Keyboard strings (`describe`, `resultsAnnouncement`, `keycaps`' words) move to the catalogues; **M1 #02:** `?` for the current screen's help can extend the sheet.
  - **Palette search sources** (sessions, tasks, skills, config keys, docs, "Ask Hermes") and the footer's profile scope are not part of this ticket; later modules add sources through the registry's palette commands or a future provider.

### Evidence (documentation pass)
- **Commit(s):** `7cec299` feat: command palette and keyboard shortcuts (M0 #06).
- **Tests added** (pure-module seam, `web/test/`): `palette.test.ts` (13), `shortcuts.test.ts` (12), `keyboard-flow.test.ts` (8).
- **Verification recorded:** `npm test` 99 pass, 1 opt-in skipped; both typechecks, `lint:ui` clean; `npm run test:e2e` 6 pass. `keyboard-checks.mjs` 48 steps pass at 1440 (mouse) and 390 (touch). Gates (`ui-gates.mjs`): 0 failures in 188 runs over the M0 routes at 390/320/820/1440, dark with palette, `?` sheet, profile sheet and drawer open, and light with palette and sheet open; 21 skipped where a size has no opener. 200% text at 320 px: no overflow. A throwaway module with T2/T3 commands showed they are refused with a toast. `/sign-in` was not re-run. Mutation checks on ranking, T0, switch, remap, `check` rules and `keyFlow` guards.
- **Deviations:**
  - No Playwright tests; `keyboard-checks.mjs` plus `ui-gates.mjs` are the browser checks.
  - Until M0 #08 installs a confirmer, a tiered command is refused with a toast, never run unconfirmed.
  - `ui-gates.mjs` changed (openers table, `shortcuts` opener, leaves for `about:blank` before changing touch emulation).
  - `/` does not open the palette (the ticket and IA §8 give `/` to the composer's slash commands).
  - A first batch of three palette run tests and three keyboard-flow tests was written together, not one at a time (each was seen failing or mutation-checked).
- **Follow-ups / open items:** M0 #08 calls `setTierConfirmer`; M1 chat registers `new-chat` (⇧⌘O reserved) and key `c`; strings move to catalogues with M1 #01 (deferred); palette sources for sessions, tasks, skills, config keys and docs belong to later modules. Status: resolved.
