# 06: Approvals and clarify questions

**What to build:** When Hermes asks to run a tool (an approval server request), the owner sees the exact action — tool, arguments, working directory — and answers with a typed decision: Allow once, Allow for this session, Allow always, or Deny with an optional reason. On desktop it is an inline card above the composer where Enter means Allow once; on a phone it is a bottom sheet that stays above the keyboard. Answers go back through the gateway's approval.respond.

Allow always and turning YOLO on for the session (Hermes's yolo config) are T2: they need a passkey step-up. When Hermes asks a clarify question, the owner can pick a choice, write free text, or let it lapse; a countdown runs from the deadline and the answer goes through request.answer.

Pending requests are never lost: on resume, the open requests are re-delivered to their cards before the UI unblocks. If the request is answered on another device, the card closes here with "Answered elsewhere".

**Blocked by:** 03 (Chat tracer bullet: new chat, streamed reply, resume), M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations)

**Status:** resolved

- [x] Each decision (once / session / always / deny with reason) sends the right approval.respond payload (tests against a stub gateway).
  Deviation: the tests run against the real Hermes with the stub LLM (`server/test/approvals.test.ts`, which checks what each answer did), plus a pure test of each payload (`web/test/requests.test.ts`). Hermes's `approval.respond` has no reason field (it rejects unknown params), so a deny reason goes as a `session.steer` note to the agent just before the deny.
- [x] Allow always and YOLO on require T2 step-up; without a grant the proxy refuses them (tests). Read-only mode allows only Deny.
  Note: switching YOLO off is T0 (it only makes Hermes ask more); only on or an unspecified toggle is T2.
- [x] Clarify supports choices, free text and a countdown from the deadline; at expiry the card shows what Hermes did.
  Deviation: Hermes sends no deadline with a clarify request. The countdown runs from when the page first saw the question to Hermes's configured timeout (new `GET /_caduceus/api/chat/limits`, which reads the profile's config server-side and passes on only the number, so config secrets never reach the browser); after a page reload it restarts from the reload. Multiple choice and batch (several questions) clarify are supported too.
- [x] Reloading or reconnecting with a pending approval shows it again before the composer unblocks (end-to-end).
- [x] Answering on one device closes the card on the other.
  Note: Hermes withdraws an approval answered elsewhere (`request.cancel` `resolved`) but not a clarify question, so a clarify card closes on the finished `clarify` tool call.
- [x] Desktop: inline card, Enter = Allow once. Phone: bottom sheet with typed buttons, Deny not in the primary thumb position.
- [x] Passes the M0 #05 gates; strings via catalogues; help page and glossary terms (approval, clarify, YOLO).
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `4dad25a` feat: approvals and clarify questions with typed decisions, T2 step-up for Allow always and YOLO, and cross-device close (M1 #06).
- **Tests added:**
  - `server/test/approvals.test.ts` (17): Caduceus WS seam over real Hermes with the stub LLM (checks what each answer did).
  - `web/test/requests.test.ts` (17): pure module (each payload).
  - Modified: `server/test/gateway-policy.test.ts` (14, was 13).
- **Verification recorded:** The ticket ticks every criterion; it records no browser gate, width, axe or perf result and the commit has no message body: not recorded.
- **Deviations:**
  - Tests run against the real Hermes with the stub LLM, not a stub gateway.
  - Hermes's `approval.respond` has no reason field, so a deny reason goes as a `session.steer` note just before the deny.
  - Hermes sends no clarify deadline; the countdown runs from when the page first saw the question to Hermes's configured timeout, read server-side through new `GET /_caduceus/api/chat/limits` (only the number reaches the browser); it restarts on reload. Multiple choice and batch clarify are supported too.
  - Hermes withdraws an approval answered elsewhere (`request.cancel` `resolved`) but not a clarify question, so a clarify card closes on the finished `clarify` tool call.
  - Catalogue part deferred (owner), as the ticket's own note says; M1 #01 is deferred, so no catalogues exist.
- **Follow-ups / open items:** None recorded in the ticket. Status: resolved.
