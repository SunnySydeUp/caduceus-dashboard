# Mobile & Interaction Spec

**Principle:** the phone is a **control surface**. It is for monitoring, answering, approving, steering, reviewing and quick admin, and every screen must be reachable and usable on it. Heavy authoring stays possible on a phone, but it is optimised for larger screens, where the graph editor, raw YAML and multi-pane chat live (`../research/industry-patterns.md` §0).

Citations: `ip §n` = industry-patterns.md; `R §3` = research README mobile table.

## 1. Viewport, safe areas, keyboard
- **Viewport meta:** `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`.
  - **Never** `user-scalable=no` or `maximum-scale`. WebUI's zoom lock fails WCAG 1.4.4 (`hermes-webui.md` §7).
- **Heights:** use `dvh` for the shell and `svh` for sheets that must not jump. `vh` is banned by lint.
- **All four `env(safe-area-inset-*)`** are applied: app bar (top), tab bar and composer (bottom), rail and drawer (left/right in landscape), and toasts and banners.
  - Each of the three existing dashboards misses at least one of these (R §3).
- **Soft keyboard:**
  - A `visualViewport` listener sets `--kb-inset`. The composer, approval sheets and focused form fields stay above the keyboard (the Dash and WebUI technique).
  - The tab bar hides while the keyboard is open.
- **Inputs:** 16 px or larger, so iOS does not zoom on focus.

## 2. Touch targets & pointer
- **Target size:**
  - `pointer: coarse`: at least 44×44 px with 8 px spacing.
  - `pointer: fine`: at least 24×24 px (the WCAG 2.5.8 floor).
  - Density tokens switch automatically; users can override this in Settings.
- **No hover-only affordances:** every hover action also exists in a ⋮ menu or long-press menu. This fixes Dash's Skills edit button, which only appears on hover (`hermes-dashboard.md` §7).
- **No 300 ms tap delay:**
  - set `touch-action: manipulation` globally;
  - no double-tap handlers; WebUI's double-tap-to-rename is replaced by a menu action (`hermes-webui.md` §7).
- **Press feedback within 100 ms**, through a state-layer token. Reduced motion falls back to a colour change only.

## 3. Gestures (each has a visible alternative, WCAG 2.5.7)

| Gesture | Where | Alternative | Rule |
|---|---|---|---|
| Swipe row → | Sessions: archive · Notices: resolve/done | ⋮ menu | Only T0 (undoable) actions; an undo toast follows |
| Swipe row ← | Sessions: pin · Notices: snooze | ⋮ menu | Never T2/T3 (`hermes-api-coverage.md` §7) |
| Long-press | Any row/card: context menu; Board card: "Move to… / Assign… / Priority…" sheet | ⋮ button | Haptic tick where supported |
| Drag | Board cards, nav and chip reordering (desktop, plus touch with a long-press-to-lift) | "Move to…" sheet; ↑/↓ buttons in reorder mode | Drag is only ever an enhancement |
| Pull to refresh | Standalone PWA lists | Refresh button in the app bar | Lists are realtime anyway; this is a confidence gesture |
| Edge swipe back | Native browser / OS | Back button | Never hijacked |
| Hold to talk | Composer mic (phone) | Tap to toggle dictation | Release sends or cancels; slide away cancels |

## 4. Screen patterns on a phone

| Module | Phone pattern |
|---|---|
| **Talk** | Opens the agent's latest session, full-width transcript; a **Sessions** button opens that agent's session list as a sheet (sessions are kept), and **Details** opens a sheet (Right now, workspace preview, Work, About). A bridge row of sigils switches agent. The composer collapses to attach, mic, a **config ring** (profile / model / reasoning / workspace / toolsets / context in one sheet, the WebUI pattern) and send, plus the intent control (Ask · Delegate · Repeat) with a hint. Approval and clarify of the open session arrive as bottom sheets with typed decisions; "Allow always" and YOLO require step-up. A tray above the composer lists decisions of other agents and other sessions. Busy turn: the send button becomes a split **Steer ▾ / Queue / Stop** control. A cancelled queued item returns its text to the composer (ip §12 #5). Terminal mode opens only through Details › Take over (T2) |
| **Today** | Single column: Needs you (one card per approval, question or choice, answered in place) → Ready for review → Crew tiles (a swipeable row) → Schedule (a 24-hour bar with a Now marker) → While you were away. Each block fails and retries on its own. The Today tab badge counts only items that need the owner (ip §1.2) |
| **Notices** (Control › Main) | Failed, FYI and decision-less notices with their actions, snooze and dismiss, and the Activity feed. Decisions are not here: they are on Today and in the Talk tray |
| **Board** | A segmented control for status (Triage · Ready · Running · Review · Blocked · Done) above a vertical card list, or snap columns at 82 vw as an option. Multi-select mode + bulk sheet. The "Move to…" sheet replaces drag (ip §12 #18) |
| **Task / Run** | Tabs as a scrollable segmented header. Runs show a **stage/step list** with live status; tapping a step opens its transcript sheet. The worklog density toggle (Stream / Worklog / Raw) is shared with Chat (ip §12 #7) |
| **Playbooks** | The library is a card list. Runs use a **vertical stage list** with gate badges; the graph is offered only at 1024 px or wider (ip §12 #17). The run form is generated from the inputs schema as a full-screen sheet |
| **Schedules** | Job cards (type badge, next fire, last result). The builder is a stepped sheet with a "next 3 fire times" preview; run history is an expandable output list |
| **Agents** | Profile cards → profile detail with tabs. Editors (SOUL, AGENTS, MEMORY) are full-screen with Preview/Edit. Skills and Hub are a searchable list → detail sheet with the security-scan verdict before Install |
| **Models / Keys** | Search-first. Keys are masked; Reveal requires step-up and auto-hides after 30 s; copying clears the clipboard after 60 s where the API allows it. OAuth device-code flows open in a sheet with a copyable code |
| **Config** | **Search-first settings** with `@modified`, `@profile` and `@restart-required` filters, per-field deep links and reset-to-default (ip §12 #15). Categories appear as a "Jump to" select. Raw YAML is offered on phone as read-only plus a "Edit on a larger screen" handoff (QR / link) |
| **Logs** | Live tail (virtualized; pauses on scroll; "Jump to live" pill), with structured query chips (`level:`, `component:`, `@profile:`) and server-side search (ip §12 #19) |
| **Files / Git** | Card list (name, size, modified, ⋮), full-screen preview; the diff view uses unified mode on phone and split mode at 1024 px or wider |
| **Tables everywhere** | `DataList`: a table at 840 px or wider, labelled cards below (the PatterStage pattern). No horizontal page scroll at 320 px |

## 5. Sheets, dialogs, confirmations
- **Bottom sheets** have detents (peek / half / full) and a drag handle plus a close button. **Forms** with more than 3 fields use full-screen sheets on a phone and centred dialogs or side drawers at 840 px or wider.
- All overlays:
  - trap focus and set the background `inert`;
  - close with Escape, browser back or a scrim tap, except T2/T3 confirmations, where a scrim tap does nothing;
  - return focus to the invoker;
  - stack correctly (sheet over sheet).
- **Confirmations by tier** (`architecture.md` §5):

| Tier | Confirmation |
|---|---|
| T0 | Undo toast, 6 s, actionable from the keyboard |
| T1 | Dialog naming the object and the **profile chip** |
| T2 | Passkey step-up + confirm |
| T3 | Step-up + type the object's name + a recoverability statement ("This cannot be undone" / "Restorable from backup …") |

Destructive buttons never sit in the thumb's primary position on the first screen of a flow.

## 6. Notifications, badges, install
- **Permission flow:**
  1. Ask only after a meaningful action (e.g. the first approval) and from a user tap.
  2. On iOS, ask only after Home Screen install. An install guide explains why (ip §12 #3, #23).
- **Categories (per device):** Approvals & questions · Reviews & blocked tasks · Failures (runs, cron, gateway) · Finished runs · Pairing · Budget · Updates. Each has on/off settings and a quiet-hours window. A digest option covers FYI categories. There is no push while any Caduceus client is visible (ip §12 #22).
- **Payloads:** title = the decision ("Approve `git push` on coder?"); body = the exact preview. The deep link opens the decision sheet. iOS gets no notification actions, so the deep link *is* the action.
- **Badging:** `navigator.setAppBadge(n)`, where n is the number of items that need the owner (the Today tab's count). It is supported on installed PWAs, including iOS 16.4+ Home Screen apps.
- **Install:**
  - Chromium: an **Install** button in Settings › Install app.
  - iOS: an "Add to Home Screen" guide after a meaningful action; the dismissal is remembered.
  - Manifest: `id` set; shortcuts Today and Health; `theme_color` follows the skin; maskable icons.
  - **Desktop → phone QR handoff:** a QR of Caduceus URL (and optionally `?profile=`), never a credential. The phone signs in with its own passkey (ip §12 #23).

## 7. Offline, flaky networks, resume
- **Status dot** in the app bar: connected / reconnecting (count) / offline. The banner gives an explicit reason (server unreachable, Hermes child restarting, auth expired).
- Cached lists show an **"as of 14:02"** timestamp and disable writes that cannot be queued.
- **Outbox** (IndexedDB) holds sends, comments and drafts. Each item has an "N pending" indicator and is flushed when the app returns to the foreground. T2/T3 actions are never queued.
- **Resume:** reconnects are coalesced on `visibilitychange`/`pageshow`/`online` (at most 1 per second, with backoff), then the resume sequence in `architecture.md` §4 runs. A "Catching up…" skeleton shows only if the replay takes longer than 300 ms.

## 8. Keyboard (hardware keyboards, desktop and tablet)
- **⌘K** opens the palette (session search lives inside it); **⇧⌘O** starts a new chat; **/** opens slash commands in the composer; **?** shows the shortcut sheet.
- **g + letter** navigates (`g h` Today, `g c` Talk, `g w` Work, `g p` Profiles, …); **j / k** move through lists; **↵** opens; **e** archives; **⌘↵** sends; **↵ on an approval card** = Allow once; **Esc** closes or steps back.
- Every shortcut is remappable, and single-key shortcuts can be turned off (WCAG 2.1.4; ip §12 #9, #13).

## 9. Accessibility release gate (WCAG 2.2 AA)
- **Contrast:** 4.5:1 for text and 3:1 for non-text and focus indicators, in every theme and skin. A contrast check runs in CI over `tokens.css`.
- **Focus:**
  - visible 2 px ring with an offset;
  - **focus is never obscured** by the tab bar, composer or banners (`scroll-padding-block` tokens match their heights; 2.4.11);
  - skip link;
  - logical focus order in sheets.
- **Semantics:**
  - the transcript is `role="log"` with throttled polite announcements (completed messages, not tokens);
  - status chips are `role="status"`;
  - approvals are `role="alertdialog"`;
  - the Today badge has a text equivalent;
  - icon buttons are named (enforced by lint).
- **Motion:** `prefers-reduced-motion` turns streaming shimmer, sheet springs and graph animations into fades or instant changes.
- **Text:** usable at 200% text zoom and 320 px width without loss; `forced-colors` support; logical properties for RTL.
- **Auth:** passkeys satisfy 3.3.8 (no cognitive test); the password field allows paste.

## 10. Performance budgets (p75, mid-range Android over 4G)

| Metric | Budget |
|---|---|
| LCP (shell + Today) | ≤ 2.5 s; cached start ≤ 1.0 s |
| INP | ≤ 200 ms (typing in the composer and switching tabs ≤ 100 ms) |
| CLS | ≤ 0.1 (space reserved for banners, images and charts) |
| Initial JS (shell + Today route) | ≤ 170 KB gzip. Modules are lazy-loaded per route; Mermaid, KaTeX, shiki, charts and the graph editor load on demand |
| Streaming | Token deltas batched per animation frame; markdown re-parse bounded (the streamdown approach) |
| Long lists | Virtualized (TanStack Virtual, end-anchored for transcripts and logs), stable keys, at most about 60 DOM rows |

## 11. Test gates (CI)
- **Playwright projects:** `phone` (390×844, touch, iOS UA), `small-phone` (320×568), `tablet` (820×1180), `desktop` (1440×900).
- **Every route, every project:**
  - no horizontal overflow;
  - hit targets meet the size rules (§2);
  - axe has no serious or critical violations;
  - focus is not obscured;
  - the screenshot diff passes.
- **Lint:** no raw colours, no `vh`, no hover-only handlers, icon buttons must be named, token scale only (adapted from PatterStage's design-lint).
- **Lighthouse CI** asserts the budgets in §10 on Today, the opening screen (`npm run perf`).
