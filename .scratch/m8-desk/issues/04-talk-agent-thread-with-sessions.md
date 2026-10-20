# 04: Talk: an agent's thread, sessions kept

**What to build:** Talk opens an agent's conversation directly. Owner decision: **sessions stay visible.** The agent's sessions are listed under its name (the latest one open), with search, pin, archive and fork as today. The header shows the sigil, the live line and a Details button. Details (a right panel on desktop, a sheet on a phone) shows Right now, a workspace preview with Take over, Work, and About (model, folder, cost, context). A handoff between agents shows in the thread as an event row. The transcript, composer chips, steer and queue controls keep working as in M1.

**Blocked by:** 01, 02

**Status:** resolved

- [x] Selecting an agent opens its latest session; the session list for that agent is one tap or click away on every width.
  - Deviation: the list shows the agent's own sessions by default (the Chat list showed every profile); All profiles in its filters widens it. Phone: a Sessions button opens the list as a sheet; tablet and desktop: a column.
- [x] No Chat feature is lost: every M1 chat acceptance test still passes against the new screen.
  - Deviation: the old context panel's Todo and Run tabs sit under Plan and run in Details, and its Artifacts tab is the Files view of the workspace preview. On a phone or tablet "Make this a task" is in the chat's ⋮ menu (the header button is on large screens).
- [x] Details opens and closes by click and by keyboard, on desktop and phone (a real click test, not a forced URL state).
- [x] The workspace preview reuses the existing terminal, files and browser views; Take over keeps its tier.
  - Deviation: Terminal and Browser show the chat's own tool cards for the agent's last command and last browser step (not a live xterm); Files is the existing Artifacts view. Take over is a T2 confirmation (passkey) before Hermes's terminal mode opens; terminal mode now opens on a phone when reached this way. Handoff rows come from Hermes's delegation (subagent) data only: Hermes has no profile-to-profile call.
- [x] Gates: 390, 320, 820, 1440; no overflow; axe clean.
