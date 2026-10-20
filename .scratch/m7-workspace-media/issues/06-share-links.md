# 06: Share links

**What to build:** From a session's row menu or the transcript, the owner can create a read-only share link (R4). Caduceus takes a frozen snapshot of the transcript from Hermes's session messages endpoint, stores it as a derived artifact with a hashed token, expiry and the session/profile reference, and renders it at `/share/:token` using the rich transcript renderer.

Links are reachable only on the tailnet (D9: Caduceus is tailnet-only HTTPS on :9443); the UI says so plainly and never implies public reach. Viewers need no sign-in but get nothing beyond the snapshot. Settings › Security lists active shares with session, created, expiry and Revoke.

**Blocked by:** M1 #04 (Rich transcript rendering)

**Status:** resolved

- [x] Creating a share is T1 naming the session and profile, with expiry choices (e.g. 1 day, 7 days, 30 days, never) and copy-link.
- [x] Only a hash of the token is stored; the `/share/:token` route serves the snapshot without a Caduceus session and exposes no other API or session data (test).
- [x] Expired or revoked tokens return a not-found page; an expiry sweep deletes snapshots past expiry (test).
- [x] The renderer shows the snapshot read-only (no composer, no actions) and strips tool arguments flagged as secret.
  Deviation: tool arguments are judged secret by their names (a key, token, password, credential, authorisation or cookie, at any depth; text that is not JSON is not shown); tool results and messages are shown as they are.
- [x] Settings › Security lists active shares with Revoke (T0 with undo window before deletion of the snapshot).
  Revoke stops the link at once; Undo (a toast, one minute) brings it back, and the snapshot is deleted when the window ends.
- [x] Share UI states that links work only for devices on the owner's tailnet; no Funnel or public route is added.
- [x] Creating and revoking shares are audited.
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues; the module registers its help page and glossary terms (Share link, Snapshot), and the missing-help test passes.
  Catalogue part deferred (owner). The Share link term and a Share links help page are registered with the settings module (the list lives in Settings › Security); Snapshot is reused.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `24c6d42` feat: Share links: read-only snapshots behind hashed tokens, public viewer page, expiry sweep, revoke with undo, shares list in Settings › Security (M7 #06)
- **Tests added:**
  - `server/test/share-links.test.ts` (added in `24c6d42`): 7 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/shares-model.test.ts` (added in `24c6d42`): 4 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests that only a hash of the token is stored, that `/share/:token` exposes no other data, and that an expiry sweep deletes expired snapshots. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Tool arguments are judged secret by their names (a key, token, password, credential, authorisation or cookie, at any depth). Text that is not JSON is not shown. Tool results and messages are shown as they are.
  - Revoke stops the link at once. Undo (a toast, one minute) brings it back, and the snapshot is deleted when the window ends.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The Share link term and a Share links help page are registered with the settings module; Snapshot is reused (ticket text).
