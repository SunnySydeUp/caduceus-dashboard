# 08: Additional locales

**What to build:** Ship every locale in the union of the Hermes Dashboard's 17 and Hermes WebUI's 15 locales through the M1 #01 catalogue pipeline, selectable in Settings › Language. Arabic verifies right-to-left layout across all modules. A report lists untranslated keys per locale and the build shows it; missing keys fall back to English.

Optionally mirror the chosen locale into Hermes's `display.language` (T1) so Hermes's own static messages match; agent replies are unaffected.

**Blocked by:** M1 #01 (Internationalisation foundation)

**Status:** deferred

Deferred with M1 #01 by the owner on 2026-10-08.

- [ ] Settings › Language lists every locale in the union with its native name; switching applies without reload and persists per device.
- [ ] ICU plurals, dates and numbers are correct for each shipped locale (snapshot tests on a sample of keys).
- [ ] Arabic renders RTL across every registered route with no overflow at 390 and 1440 (M0 #05 gates run in Arabic).
- [ ] The untranslated-key report runs in CI and lists missing keys per locale; missing keys fall back to English, never to raw key ids (test).
- [ ] Mirroring into Hermes `display.language` is opt-in and T1.
- [ ] Help pages and glossary terms are included in the catalogues.
- [ ] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [ ] All strings go through the message catalogues; the module registers its help page and glossary terms (Locale), and the missing-help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - none (no commit carries `(M7 #08)`)
- **Tests added:**
  - none
- **Verification recorded:** Not applicable. Nothing was built, and no criterion is ticked. No verification recorded.
- **Deviations:**
  - None: the ticket is deferred, not built.
- **Follow-ups / open items:**
  - Deferred with i18n (M1 #01) by the owner on 2026-10-08 (ticket text). All criteria stay open. The ticket is blocked by M1 #01 and cannot start until that ticket is picked up.
