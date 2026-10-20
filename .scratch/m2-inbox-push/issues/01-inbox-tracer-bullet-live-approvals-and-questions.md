# 01: Inbox tracer bullet: live approvals and questions

**What to build:** The owner opens the Inbox and sees every pending tool approval and clarify question from every active session, in every profile, not only the chat they have open. Each item shows the session, profile, tool or question and the exact preview (command, arguments). It offers Allow once and Deny for approvals, and Answer for questions (choice buttons or free text with the countdown). Allow for session / always and the rest open the same typed decision sheet Chat uses.

The Caduceus server keeps its own **observer connection** to the gateway. It learns about pending requests from the server requests fanned out to it, from `request.cancel` events and from `approval.pending` / `session.active_list.status`. It never answers anything itself. The owner's answer goes through the policy proxy as an `approval.respond` or `request.answer` on the session's behalf. When a request is answered elsewhere (Telegram, the TUI, another device) or withdrawn, the item disappears without a refresh.

The Inbox nav badge counts only items that need a decision. `/inbox/:id` opens straight to the decision, which is how later push notifications land.

**Blocked by:** M1 #06 (Approvals and clarify questions)

**Status:** resolved

- [x] A spike, recorded in the ticket's notes before the UI work, verifies against the running Hermes that server requests fan out to the observer as well as to attached sockets, and that the observer never answering leaves the requester's timeout and the first-answer-wins rule unchanged (test with a fake session socket).
  Spike result: the assumption is wrong, and the design follows what is true. Hermes sends a server request only to the sockets attached to its session (`session_transports.py`), so a socket that attaches to nothing is sent no `approval`, `clarify` or `request.cancel` (`server/test/inbox.test.ts`, "Hermes sends no request to the observer"). The observer therefore stays unattached, which also means it never counts as a client that answers (`client.capabilities` is not sent), never keeps a session alive past its reaper and never changes whether Hermes thinks a request is answerable. It learns by asking: `session.active_list` is read only and reports a blocked session as `waiting`, and `session.events.since` is read only and returns the session's `open_requests`, with the request's `srq` id, so the requester's own timeout and first-answer-wins are untouched (tests: an unanswered approval lapses at Hermes's two-second deadline and its item goes with it; an item answered in the chat disappears and a late answer says `already-answered`).
  Deviation: a fake session socket is not used; the real Hermes with a second unattached gateway socket proves the point better.
- [x] Pending approvals and clarifies from sessions in at least two profiles appear in one cross-profile Inbox within 2 s; filtering by the profile chip works, and nothing is written to the Caduceus store for them.
  Note: the server asks Hermes once a second, so an item shows within about a second. An item whose profile cannot be told is shown under every profile chip, so a decision is never hidden by a filter.
- [x] Allow once, Deny (with optional reason) and Answer resolve the request in Hermes. Allow always and YOLO require T2 step-up, exactly as in M1 #06. Read-only mode blocks the decisions at the proxy (test).
  Note: YOLO is not an Inbox decision (it is a session setting); Allow always is T2. Read-only mode lets a Deny through and blocks the rest, as in Chat.
- [x] An item answered from another client, cancelled by `request.cancel`, or expired at the deadline is removed live; answering a stale item shows "Already answered elsewhere" instead of an error (test).
- [x] The badge equals the number of items that need a decision and has a text equivalent; `/inbox/:id` deep-links to the decision and shows a clear resolved state if it is gone.
- [x] Phone: items are cards with the preview and 1–2 inline buttons; the decision opens as a bottom sheet. Desktop: list and detail panes; `↵` on a focused approval card is Allow once; j / k move.
- [x] The empty state says nothing is waiting and offers Open Chat.
- [x] Passes the M0 #05 gates; strings via catalogues; the Inbox registers its module, help page and glossary terms (Inbox item, Needs decision, Observer connection).
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `da03cae feat: Inbox tracer bullet: live approvals and questions from every profile through Caduceus's observer connection, decisions, nav badge, deep links (M2 #01)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `da03cae` `e2e/home.spec.ts`: 3 cases; seam: Playwright e2e against the Caduceus server.
  - `da03cae` `server/test/inbox.test.ts`: 9 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `da03cae` `web/test/inbox-feed.test.ts`: 4 cases; seam: pure web module (model/render).
  - `da03cae` `web/test/inbox-model.test.ts`: 11 cases; seam: pure web module (model/render).
  - `da03cae` `web/test/module-registry.test.ts`: 8 cases; seam: pure web module (model/render).
  - `da03cae` `web/test/shortcuts.test.ts`: 12 cases; seam: pure web module (model/render).
- **Verification recorded:** The spike result is recorded in the ticket (tests named there: Hermes sends no request to the observer; an unanswered approval lapses at Hermes's two-second deadline and its item goes with it; an item answered in chat disappears; a late answer returns `already-answered`). Items appear within about a second (server polls once a second). The criterion "passes the M0 #05 gates" is ticked; the ticket records no widths or results beyond that. Perf numbers: not recorded.
- **Deviations:**
  - The spike's premise was wrong: Hermes sends server requests only to sockets attached to the session, so the observer stays unattached and learns by reading `session.active_list` and `session.events.since`. The ticket records this as the spike result.
  - No fake session socket was used; a real Hermes with a second unattached gateway socket was used instead.
  - An item whose profile cannot be told shows under every profile chip. YOLO is not an Inbox decision; Allow always is T2; read-only mode lets Deny through and blocks the rest.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
