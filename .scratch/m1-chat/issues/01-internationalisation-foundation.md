# 01: Internationalisation foundation

**What to build:** Every string Caduceus shows comes from per-locale message catalogues in ICU format, so plurals, dates, relative times, numbers and currency are formatted for the chosen locale. Settings › Language lets the owner pick English or a pseudo-locale (accented, about 40% longer, wrapped in markers) that makes hard-coded or truncated text obvious. The choice is a Caduceus preference per device, with "follow the browser" as the default.

Right-to-left works from the start: layout uses logical CSS properties only, direction follows the locale, and the pseudo-locale has an RTL variant so mirroring can be checked before real RTL locales ship in M7 #08.

All M0 screens (sign-in, shell, palette, appearance, policy dialogs, Health, devices) are migrated to the catalogues. A lint rule bans hard-coded user-visible strings and physical CSS properties, so later modules cannot regress.

**Blocked by:** M0 #05 (Adaptive app shell, module registry, profile scope and quality gates), M0 #07 (Appearance settings)

**Status:** deferred

Deferred by the owner on 2026-10-08 ("don't worry about internationalisation for now"). A partial implementation (catalogue helpers, translator, pseudo-locale, lint rule, some migrated screens; not finished and not reviewed) is parked on the branch `wip/m1-01-i18n` (commit `36d7da5`). Resume from there when the owner asks.

- [ ] Every user-visible string on the M0 screens comes from the English catalogue; a lint rule fails on a hard-coded string literal in UI code and on physical CSS (`left`, `margin-right`, …) (tests for the rule).
- [ ] Plurals, dates, relative times, numbers and currency use ICU formatting; unit tests cover a plural, a relative time and a currency in English and the pseudo-locale.
- [ ] Settings › Language offers Follow browser, English and pseudo-locale (LTR and RTL); switching applies without reload and persists per device.
- [ ] With the RTL pseudo-locale, the shell, nav, sheets and dialogs mirror correctly, and icons with direction flip (end-to-end screenshot at phone and desktop).
- [ ] With the pseudo-locale, every M0 screen passes the M0 #05 gates at 320, 390, 820 and 1440 with no overflow or clipped text.
- [ ] A test fails when a catalogue key is used in code but missing from English, or present in English but unused.
- [ ] Missing translations fall back to English, never to the key.
- [ ] Language choice is a Caduceus preference only; nothing is written to Hermes config.

## Comments

### Evidence (documentation pass)
- **Commit(s):** none: deferred. The owner deferred this ticket on 2026-10-08 (commit `0b55266` chore: defer internationalisation (M1 #01, M7 #08) at the owner's request). A partial, unreviewed attempt is parked on branch `wip/m1-01-i18n` (`36d7da5` wip: partial internationalisation foundation (M1 #01), deferred by owner); it is not on main.
- **Tests added:** none on main. Any tests on the wip branch were not reviewed here.
- **Verification recorded:** none; no criterion is ticked and the ticket records no checks.
- **Deviations:**
  - The whole ticket is deferred (owner). Other tickets note "catalogue part deferred (owner)" and ship plain English strings.
- **Follow-ups / open items:** Status: deferred. Resume from `wip/m1-01-i18n` only when the owner asks. M7 #08 (real RTL locales) was deferred with it.
