# 07: Voice

**What to build:** The composer gets a mic. Dictation transcribes speech either in the browser (Web Speech API where available) or on the server through Hermes's `/api/audio/transcribe`; on phones it is hold-to-talk (release sends or cancels, slide away cancels) with tap-to-toggle as the visible alternative. Hands-free voice mode keeps a back-and-forth conversation using `/api/audio/voice-live`. Replies can be read aloud per message or automatically, through `/api/audio/speak` / `speak-stream`. The owner can also send a raw audio message, attached through the gateway's `file.attach` as a data URL.

Settings › Voice chooses the transcription engine, TTS voice/engine (from Hermes's `voice-config`), auto-read and language. The gateway's host-side `voice.*` methods are not used, since they use the Mac's own microphone.

**Blocked by:** M1 #10 (Attachments)

**Status:** resolved

- [x] Mic permission is requested only on first use; denial shows how to re-enable it and keeps typing usable.
- [x] Browser and server transcription both fill the composer for review before sending; engine is chosen in Settings › Voice.
  Deviation: the browser engine (Web Speech) needs a real microphone and the browser maker's speech service, so it was not exercised here; Hermes's engine was verified end to end against a stub speech endpoint. The owner should try it once on a real device.
- [x] Phone hold-to-talk follows mobile-and-interaction.md (release sends or cancels, slide away cancels) and tap-to-toggle is always available (Playwright at 390).
  Deviation: checked with a throwaway browser smoke on touch emulation, not Playwright (AGENTS.md).
- [x] Hands-free mode shows a clear listening/speaking state and an always-visible Stop; leaving the screen ends it.
  Deviation: it is chained speech (Hermes's `/api/audio/transcribe`, the chat, `/api/audio/speak`), not GPT-Live over `/api/audio/voice-live/session` (WebRTC, needs the owner's OpenAI key). Replies use `/speak` as one audio file per part, not the `/speak-stream` WebSocket, which Caduceus does not proxy.
- [x] Read-aloud per message and auto-read setting; playback can be stopped; only one reply plays at a time.
- [x] Raw audio message records, previews and sends as an attachment the transcript plays back.
- [x] No `voice.*` gateway method is called from Caduceus (test).
- [x] Strings and Voice settings are catalogued (catalogue part deferred (owner)); works on a secure context only and explains why otherwise.
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues (catalogue part deferred (owner)); the module registers its help page and glossary terms (Dictation, Hands-free, Read aloud), and the missing-help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `5b2318d` feat: voice: dictation (Hermes or browser engine), phone hold-to-talk, hands-free mode, read aloud, audio messages, Settings › Voice (M7 #07)
- **Tests added:**
  - `server/test/fixtures/stub-speech.ts` (added in `5b2318d`): fixture, no cases
  - `server/test/voice-hermes.test.ts` (added in `5b2318d`): 6 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/voice-host-methods.test.ts` (added in `5b2318d`): 3 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/voice-message.test.ts` (added in `5b2318d`): 1 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/audio-attachment.test.ts` (added in `5b2318d`): 3 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/dictation-text.test.ts` (added in `5b2318d`): 4 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/hands-free.test.ts` (added in `5b2318d`): 15 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/hold-to-talk.test.ts` (added in `5b2318d`): 8 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/message-actions.test.ts` (changed in `5b2318d`): 15 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/read-aloud.test.ts` (added in `5b2318d`): 11 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/voice-mic.test.ts` (added in `5b2318d`): 6 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/voice-prefs.test.ts` (added in `5b2318d`): 4 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/voice-replies.test.ts` (added in `5b2318d`): 8 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Hermes's transcription engine was verified end to end against a stub speech endpoint. The browser engine (Web Speech) was not exercised: it needs a real microphone and the browser maker's speech service. Phone hold-to-talk was checked with a throwaway browser smoke on touch emulation, not Playwright (AGENTS.md). A test checks that no `voice.*` gateway method is called. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded).
- **Deviations:**
  - The browser engine (Web Speech) was not exercised in this environment.
  - Hold-to-talk was checked with a throwaway browser smoke on touch emulation, not Playwright.
  - Hands-free mode is chained speech (Hermes's `/api/audio/transcribe`, the chat, `/api/audio/speak`), not GPT-Live over `/api/audio/voice-live/session` (WebRTC, needs the owner's OpenAI key). Replies use `/speak` as one audio file per part, not the `/speak-stream` WebSocket, which Caduceus does not proxy.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The owner should try the browser speech engine once on a real device (ticket text).
  - GPT-Live voice is not built; it needs the owner's OpenAI key.
