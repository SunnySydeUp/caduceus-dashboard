# Caduceus Dashboard: clickable prototype

**PROTOTYPE.** This is a throwaway, clickable rendering of the design in `../` (IA, mobile spec, work model, design system). It uses mock data and has no backend. Nothing persists except per-device appearance preferences in `localStorage`. It has no build step, no framework and no CDN: vanilla ES modules styled only by `../tokens.css`.

## Run

```sh
cd ~/hermes-dashboard/docs/design && python3 -m http.server 8090
# open http://localhost:8090/prototype/
```

On this Mac, OrbStack holds port 8090, so use any free port instead, for example `python3 -m http.server 8091 --bind 127.0.0.1` → http://127.0.0.1:8091/prototype/. Serve from `docs/design/` (not `prototype/`), because `index.html` links `../tokens.css`.

**Prototype bar.** The floating **PROTOTYPE** pill sits bottom-end, above the tab bar on phones. It sets:
- theme: light / dark / system;
- skin: nous / hermes / gold / cherenkov / verdant / mono;
- density: auto / compact / comfortable;
- text size: S / M / L / XL;
- the mock connection state: online / flaky / offline. This drives the status dot and the banner stack.

"Reset prototype" clears the stored preferences.

## Files

| File | Owns |
|---|---|
| `index.html` | Static frame: skip link, `#app` (`#side` nav, `#appbar`, `#subnav`, `#banners`, `#main`, `#tabbar`), `#proto`, `#toasts` (polite live region) and `#overlays`. An inline boot script applies the stored appearance before first paint |
| `components.css` | Part 1 is the reference component CSS extracted verbatim from `../specimen.html`. Part 2 is the shell, overlays, toasts, prototype bar and shared screen patterns, plus Home/More styles. Tokens only |
| `shared.js` | Helpers, icons, status ladder, overlays (sheet, dialog, drawer, tiered confirm), toasts, module registry and **mock data** |
| `app.js` | Route table, hash router, adaptive shell, command palette, profile switcher, banner stack, keyboard shortcuts and the prototype bar |
| `screens/*.js` | One module per screen (contract below) |
| `screenshots/` | Verification captures |

## Route table → screen files

Every route in IA §7 is registered up front in `app.js` (`ROUTES`). Screens load by dynamic `import()`. If a file is missing (404) or throws while loading, the route falls back to `screens/module.js`, which shows a "Not prototyped" page naming the missing file. Wave-2 builders therefore **only create their own screen file** and never edit `app.js`.

| Screen file | Routes |
|---|---|
| `screens/home.js` (wave 1) | `/home` |
| `screens/more.js` (wave 1) | `/more` |
| `screens/chat.js` | `/chat`, `/chat/new`, `/chat/:id` |
| `screens/inbox.js` | `/inbox`, `/inbox/:id` |
| `screens/board.js` | `/work/board`, `/work/board/:board` |
| `screens/tasks.js` | `/work/tasks`, `/work/tasks/new`, `/work/tasks/:id`, `/work/runs/:runId` |
| `screens/schedules.js` | `/work/schedules`, `/work/schedules/:jobId` |
| `screens/playbooks.js` | `/work/playbooks`, `/work/playbooks/:id`, `/work/playbooks/:id/runs/:rootTaskId` |
| `screens/profiles.js` | `/agents/profiles`, `/agents/profiles/new`, `/agents/profiles/:name`, `/agents/profiles/:name/:tab` |
| `screens/config.js` | `/system/config`, `/system/config/:category` |
| `screens/keys.js` | `/system/keys` |
| `screens/health.js` | `/observe/health` |
| `screens/module.js` (wave 1) | Every other IA §7 route: `/work/projects[/:projectId]`, `/agents/skills[/hub \| /*path]`, `/agents/memory[/:tab]`, `/agents/models[/:tab]`, `/agents/tools[/:tab]`, `/connect/gateway`, `/connect/channels[/:platform]`, `/connect/pairing`, `/connect/webhooks`, `/workspace/files[/*path]`, `/workspace/git`, `/workspace/checkpoints`, `/workspace/terminal`, `/workspace/artifacts`, `/observe/insights`, `/observe/logs`, `/system/plugins`, `/system/maintenance`, `/system/security`, `/settings[/:section]`, and unknown paths ("Page not found") |

**Redirects.** `/` → `/home`, `/work` → `/work/board`, `/agents` → `/agents/profiles`, `/connect` → `/connect/gateway`, `/workspace` → `/workspace/files`, `/observe` → `/observe/insights`, `/system` → `/system/config`.

**Param syntax.** `:name` matches one segment and `*name` matches the rest. Specific routes come before param routes (`/chat/new` before `/chat/:id`). Query strings are free-form: `?profile=` is valid everywhere, and list state such as filters, tabs and search belongs in the query (IA §7).

## Screen-module contract

```js
// screens/inbox.js
import { html, icon, statusBadge, pageHeader /* … */ } from '../shared.js';

export default {
  routes: ['/inbox', '/inbox/:id'],   // informational; app.js ROUTES is authoritative
  title: 'Inbox',                      // string or (ctx) => string; default app-bar title
  group: 'top',                        // registry group (top | work | agents | connect | workspace | observe | system | settings)
  layout: 'page',                      // optional: 'fill' = full-height, no page padding, screen owns scrolling (Chat)
  render(ctx) { return html`…`; },     // returns an HTML string or html`` result; must contain one <h1>
  mount(root, ctx) { /* listeners */ return () => { /* cleanup: timers etc. */ }; },  // optional
  paletteActions(ctx) { return [{ label, icon, sub?, shortcut?, run() }]; },          // optional, shown first under Actions
};
```

**Render and mount**
- `render` runs on every navigation, on a size-class change (compact ↔ medium ↔ large) and on `ctx.refresh()`.
- `mount` receives a **fresh root element each render**, so listeners attached to `root` are discarded with it. The returned cleanup only needs to clear timers and global listeners.

**Focus**
- After navigation, focus moves to the screen's `<h1>`. Use `pageHeader()`, which adds `tabindex="-1"`.

**App bar**
- The app bar shows `ctx.setAppBar({ title?, back?, actions? })` if set, otherwise `screen.title`, otherwise the module title.
- `actions` is an array of `[{ icon, label, onClick, primary?, iconOnly? }]`. On compact they render as icon buttons; keep at most one there.
- On compact, `back` defaults to the parent route (`/chat/:id` → `/chat`). On large, the app bar shows a breadcrumb instead.

**The `ctx` object**

| Key | Meaning |
|---|---|
| `path`, `params`, `query` | Current path, route params, query object |
| `route`, `module` | `{ path, file }` of the matched route; the registry entry (`title`, `group`, `icon`, `path`, `summary`, `contents`, `crossProfile`, `profileScoped`) |
| `fallback` | `{ file, reason }` when `module.js` stands in for a missing screen file, else `null` |
| `size` | `'compact'` < 600 ≤ `'medium'` < 1200 ≤ `'large'` (window width only) |
| `profile` | Effective profile object: `?profile=` > device last-used > Hermes default (IA §6) |
| `scope` | `'all'` or a profile name. Cross-profile modules default to `'all'`; filter lists with `inScope(item.profile, ctx.scope)` |
| `crossProfile` | Whether this module shows the "All profiles" scope |
| `navigate(path, { replace?, keepProfile? })` | Closes overlays, then routes. Keeps `?profile=` unless the path sets it |
| `href(path)` | In-app href that keeps `?profile=`. Use it for every `<a>` |
| `openSheet`, `closeSheet`, `openDialog`, `openDrawer`, `toast` | See `shared.js` below |
| `openProfileSwitcher()` | Opens the profile sheet |
| `setAppBar(o)`, `refresh()` | Override the app bar; re-render the screen and chrome. Call `refresh()` after mutating `data`, so the Inbox badge and other chrome update |
| `data` | The shared mock data (mutable in-memory; a reload resets it) |

## `shared.js` exports

- **HTML:**
  - `html` / `h` is a tagged template that auto-escapes interpolations. Arrays are joined, and `raw()`, `icon()` and nested `html` results pass through.
  - `raw(str)`, `esc(str)`, `uid(prefix)`.
- **Format:** `fmtAgo(ts, {suffix})`, `fmtDur(sec)`, `fmtMoney(n)`, `fmtTokens(n)`, `fmtTime(ts)`, `fmtWhen(ts)`, `ago(min)`, `inMin(min)`, `nextAt(hour, minute, dow?)`, `NOW`.
- **Icons:** `icon(name, cls?)` gives inline Tabler-style SVG, `aria-hidden`. Use `'i-sm'` for 14 px, and name the button, not the icon. `iconNames` lists every name.
- **Status:** `statusBadge(state, { label?, detail?, variant?: 'plain'|'solid'|'attn' })` uses the states in `LADDER`:
  - `waiting`, `running`, `queued`, `scheduled`, `paused`, `blocked`, `failed`, `stale`, `succeeded`, `done`, `cancelled`, `offline`, `draft`, `online`, `degraded`, `reconnecting`;
  - `taskState(task)` maps a Kanban task to `{ state, label }`.
- **Fragments:**
  - `avatar(name|'all', {size:'sm'})` and `avatarIdx(name)` (a stable hash onto `--cd-avatar-1…8`);
  - `profileTag(name)`, `sourceTag(source)`, `SOURCES`;
  - `pageHeader({ overline?, title, subtitle?, actions? })`;
  - `emptyState({ icon, title, body, action? })`;
  - `kbd(...keys)` and `fuzzy(query, text)`.
- **Overlays:** every overlay traps focus, makes the background `inert`, closes on Esc, browser back and the scrim, and restores focus.
  - `openSheet({ title, body, footer?, detents?: ['auto'|'half'|'full'…], wide?, initialFocus?, onMount?(panel, layer), onClose? })` is a bottom sheet on compact and a centred dialog elsewhere. `[data-close]` elements close it. It returns `layer` (`.close()`, `.panel`).
  - `openDialog({ tier: 1|2|3, title, body, object?, profile?, confirmLabel, danger?, recoverability?, onConfirm? })` returns `Promise<boolean>`:
    - T1 names the object and the profile;
    - T2 adds a mock passkey step-up;
    - T3 also requires typing `object` and shows the recoverability statement;
    - on T2/T3 a scrim tap does nothing.
  - `openDrawer({ title?, label?, body, side: 'start'|'end', initialFocus?, onMount? })` opens a modal side panel (inspectors use `side: 'end'`).
  - `closeSheet()` closes the top layer.
  - `openLayer(…)` is the low-level primitive.
  - Before opening a new overlay right after closing one, `await overlaysSettled()`.
- **Toasts:** `toast(msg, { tone?: 'success'|'info'|'warning'|'danger', detail?, undo?: fn, action?: { label, onClick }, timeout? })`.
  - Toasts sit above the tab bar and move to the top while a sheet is open. At most 3 are shown.
  - Undo toasts last 6 s; danger toasts persist.
- **Registry:**
  - `modules` (IA §1: `id`, `title`, `group`, `icon`, `path`, `key` = `g`+letter, `summary`, `contents`, `crossProfile`, `profileScoped`);
  - `moduleById`, `navGroups`.
- **Lookups:**
  - `getProfile`, `defaultProfile`, `getSession`, `getTask`, `getInboxItem`, `getPlaybook`, `getJob`;
  - `actionableCount(scope)` gives the Inbox badge (`needsAction && !resolved`);
  - `inScope(profile, scope)`, `sizeClass()`, `TASK_STATUSES`.

## Mock data (`data`)

All the records describe one consistent fictional install, and IDs cross-reference each other. For example, inbox `in_approval` → session `s_8f2c1a` → transcript approval `apr_8f2c`.

| Key | Shape (abridged) |
|---|---|
| `profiles` (6) | `{ name, model, provider, isDefault, gateway: 'running'|'stopped', description, channels[], sessions, skills, successRate, runs7d, av }`. The profiles are default, coder, librarian, property, general and homeassistant |
| `projects` | `{ id, name, repo, profile, boards[], openTasks }` |
| `sessions` (15) | `{ id, title, preview, source: caduceus|cli|telegram|discord|cron|kanban|claude-code, profile, model, live, liveState?, pinned, archived?, project, updated, started, messages, tokens, cost, context?, taskId?, jobId? }` |
| `transcripts.s_8f2c1a` | Blocks `{ type: 'user'|'reasoning'|'tool'|'subagent'|'assistant'|'approval', at, … }`. A tool block is `{ name, args, status, duration, output? , diff?: { file, add, remove, lines:[{t:'ctx'|'add'|'rem', ln, text}] }, reason? }` (one diff and one failing test). An assistant block is `{ profile, model, blocks:[{p}|{table:{head,rows}}|{code:{file,lang,text}}] }`. The approval block is the pending `git push origin feat/x` |
| `inbox` (9) | `{ id, kind: approval|clarify|review|needs_input|pairing|cron_failed|gave_up|budget|update, urgency: decision|failed|fyi, needsAction, title (backticks = code), preview, profile, source:{type,id}, created, actions[]?, choices[]?, playbookRun?, resolved? }` |
| `boards` | `{ id, name, project, dispatcher, concurrency }` |
| `tasks` (18) | Hermes Kanban: `{ id, board, title, status (TASK_STATUSES), block_kind?, gave_up?, stale?, heartbeat?, assignee, priority, skills[], model_override?, goal_mode?, goal_max_turns?, completion_contract?, workspace?, project, playbook?, step_key?, playbookRun?, scheduledFor?, parents?, body (markdown brief), runs:[{ id, profile, status, started, duration, step?, summary, error?, tokens, cost, sessionId?, turn? }], comments }` |
| `playbooks` (4) | `{ id, name, version, category, description, stages:[{ key, title, gate?, assignee }], inputs:[{ key, label, type, required?, options? }], runs, lastRun }`. Software Delivery has 16 stages and two gates |
| `playbookRuns` (2) | `{ id, rootTaskId, playbook, version, title, profile, started, state, cost, stages:[{ key, state, taskId?, attempt, duration? }] }`. `pr_1060` waits at the design-review gate (`t_1061`); `pr_1051` is running |
| `cron` (6) | `{ id, name, type: agent|script|task|blueprint, profile, schedule, human, state: active|running|paused, next, lastStatus, deliver?, script?, no_agent?, monitor_*?, creates?, blueprint?, runs:[{ id, at, status, duration, exit?, output, tokens?, cost?, sessionId? }] }` |
| `health` (5) | `{ id, name, state: online|degraded, detail, metric, reason?, fix?:{ label, tier, taskId } }`. The dispatcher is degraded |
| `spend` | `{ today, week, month, budget:{ day, week, month, warnAt }, bySource[], byModel[], daily[14] }`. The week is at 82% |
| `skills`, `mcpServers`, `config` (categories → keys with `modified` / `restartRequired`), `keys`, `oauth`, `channels`, `pairing`, `models` | Everything later screens need |
| `connection` | `'online'|'reconnecting'|'offline'` (set from the prototype bar) |

## Shared CSS classes for wave-2 screens

Use these classes rather than inventing styles. The specimen classes come from `../specimen.html`; the shell classes are in Part 2 of `components.css`.

| Category | Classes |
|---|---|
| Layout | `.page-header` (via `pageHeader()`), `.section`, `.section__head`, `.section__title`, `.section__link`, `.panel`, `.panel--pad`, `.cards` (auto-fill grid), `.split` (list/detail at ≥ 720), `.toolbar`, `.chips-scroll`, `.strip` (snap row on compact, grid elsewhere), `.row`, `.stack` |
| Lists | `.list` + `li > .list-row` (`__icon`, `__main`, `__title`, `__sub`, `__meta`, `__end`, `__chev`), `.plist` / `.plist__row` (picker rows; `role="radio"` + `aria-checked`), `.dl` (DataList table → cards ≤ 560 px; wrap in `.dl-wrap`), `.kv` |
| Controls | `.btn` (`--primary`, `--secondary`, `--ghost`, `--danger`, `--danger-quiet`, `--sm`, `--lg`, `--icon`, `--block`), `.chip` (`[aria-pressed]`, `--profile`), `.seg` (`role=radiogroup`; app.js gives arrow-key support), `.input`, `.input-wrap`, `.field`, `__label`, `__help`, `__error`, `.switch` (`role=switch`), `.switch-row`, `.check`, `kbd` |
| Status | `.status` (via `statusBadge()`), `.dot` (`--hollow`, `--dashed`, `.pulse`), `.count`, `.tag` (neutral pill; set `data-tone` to tint), `.progress > i` (`--p`), `[data-tone]` (exposes `--t-fg`, `--t-solid`, `--t-soft`, `--t-border`, `--t-on`), `.spin` |
| Feedback | `.banner` (+ `.banner__content`, `__title`, `__body`, `__actions`), `.empty`, `.skel`, `.skel-row` |
| Work | `.board-wrap`, `.board`, `.board-seg`, `.lane`, `.lane__head`, `.kcard` (`__top`, `__title`, `__meta`, `.is-attn`, `.is-selected`), `.timeline` / `.step` (`__icon`, `__body`, `__head`, `__title`, `__time`) |
| Chat | `.chat`, `.msg-user`, `.msg-agent` (`__by`), `.thinking`, `.msg-actions`, `.tool` (`<details>`: `__name`, `__args`, `__dur`, `__body`, `--failed`, `.chev`), `.log`, `.approval` (`__head`, `__actions`), `.composer` (`__foot`, `__chips`, `.wide-only` / `.narrow-only`, `.ring`), `.chat-grid` |
| Code | `.code` (`__head`, `pre`, token classes `.k .s .n .c .f .t .p`), `.diff` (`span.add`, `span.rem` with `.ln` and `.sg`) |
| Charts | `.chart`, `.legend`, `.heat` (`.h1`–`.h5`), `.stat`, `__value`, `__delta`, `.s1`–`.s6`, `.f1`–`.f6` |
| Identity | `.avatar` (`data-av`, `--sm`, `--all`), `.ptag` (via `profileTag()`), `.srctag` (via `sourceTag()`) |
| Utilities | `.mono`, `.num`, `.muted`, `.subtle`, `.overline`, `.sr-only`, `.truncate`, `.hit` (hit-area expansion) |

**Size rules.** Use `.app[data-size="compact|medium|large"] …` in CSS when the layout must follow the window class exactly. Container queries (`.dl-wrap`, `.board-wrap`, `.composer`) remain available.

## Shell behaviour implemented

- **Compact (< 600).**
  - The app bar holds the brand glyph or a back chevron, a title that appears once the page h1 scrolls away, the profile chip, the connection dot and search.
  - The bottom tab bar has Home · Chat · Inbox (badge = items needing a decision) · Work · More. It respects the safe area and hides on scroll-down.
  - Work list routes get a chip sub-nav (Board · Tasks · Playbooks · Schedules · Projects).
- **Medium (600–1199).** A navigation rail with the same five destinations. The ☰ button opens the grouped drawer.
- **Large (≥ 1200).**
  - The grouped sidebar has health dots on Connect and Observe, the Inbox count and the Board running count.
  - It collapses to a rail; the choice is remembered.
  - The app bar shows a breadcrumb and a wide search field (⌘K).
- **Command palette.**
  - Opens with ⌘K / Ctrl+K, `/` or the search button. It is full-screen on compact.
  - Groups: Actions (screen actions first), Navigate, Search (sessions, tasks, playbooks, skills, config keys, settings), and Ask Hermes.
  - Keys: ↑ ↓ ↵ Esc. Results carry shortcut hints.
- **Keyboard.**
  - `g` + letter jumps to a destination (see `?`). `?` opens the shortcut sheet, which can turn off single-key shortcuts. ⇧⌘O starts a new chat.
  - Arrow keys work inside `.seg` radiogroups.
- **Profile chip.**
  - Opens the switcher (a sheet on compact, a dialog elsewhere). On cross-profile views it offers "All profiles".
  - Choosing a profile sets `?profile=` for this tab only.
  - "Make … default…" runs the T2 confirm with a mock passkey.
- **Banner stack.** One banner is visible at a time; the rest sit behind a "+N more" pill. Home shows a dismissible "Gateway restarted" info banner. The connection states add reconnecting and offline banners.
- **Overlays and history.** Every overlay pushes one history entry, so hardware or browser back closes sheets before it changes routes.

## Known limitations (prototype)

- Data mutations (resolve, stop, make default) live in memory and reset on reload. The connection state is not persisted.
- Sheet detents are basic: the grabber drags to dismiss and taps to switch detents, with no spring physics.
- Headless verification could not emulate `pointer: coarse`. Kbd hints hide only on real touch devices.
- A route whose screen file is missing logs a `404` for that file in the console before the fallback renders. This is expected. All wave-2 screens now exist (chat, inbox, board, tasks, schedules, playbooks, profiles, config, keys, health); every other route uses `screens/module.js`.
- Some playbook-run task ids (`t_1057`–`t_1059` and newly started runs) are not in `data.tasks`. Their links open the tasks screen's not-found state.

## Gotchas for screen authors

- `ctx.query` is a plain object, not `URLSearchParams`. Read `ctx.query.q`, not `.get('q')`.
- The `html` helper renders `true` and `false` as an empty string. ARIA attributes need `String(bool)`, e.g. `aria-pressed="${String(on)}"`.
- Screen CSS lives in `screens/<name>.css`, which the module injects once.
- Sticky bottom bars (bulk bars, dispatch bars) should carry a `data-dock` attribute. Toasts and the PROTOTYPE pill then sit above them automatically (`measureDock` in `shared.js`). Chat measures its own composer dock in `chat.css`.
- A snoozed Inbox item sets `snoozedUntil`, and `actionableCount` ignores it until the snooze expires.
