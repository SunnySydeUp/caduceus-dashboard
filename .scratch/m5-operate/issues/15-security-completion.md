# 15: Security completion

**What to build:** System › Security gains extra sign-in methods next to password and passkeys: OIDC against a configured identity provider, and Tailscale identity sign-in (proxy-header SSO), which accepts only the tailnet identity configured for the owner. Each method can be enabled and configured (T2) and is tested before it can be enabled. The page also gets an audit-log viewer for Caduceus's audit entries (actor, tier, action, target, profile, time), with filters and export. Session list, revoke and read-only mode already exist from M0 #04 and #08.

**Blocked by:** M0 #13 (Tailnet production run), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
  - Deviation: the Playwright-based gates were run from a Playwright adapter (not the omp tab) over `/system/security`, `/system/security/audit` and `/sign-in` with both extra buttons, at all four widths; the Tailscale identity was simulated with Serve headers on loopback requests, no real tailnet.
- [x] OIDC sign-in works end to end against a test identity provider, and wrong issuer, audience or user is refused (tests).
- [x] Tailscale identity sign-in trusts identity headers only when they come from the local Tailscale Serve hop, and only for the configured owner identity. Spoofed headers from other sources are refused (test).
- [x] Enabling or changing a sign-in method is T2 and audited. At least one working method must always remain.
- [x] The audit viewer lists entries with filters (tier, action, profile, date) and export. It is read-only.
- [x] Phone: the audit entries render as cards, with filters in a sheet.
- [x] Every string goes through the message catalogues (catalogue part deferred (owner)); the module registers its help page and glossary terms (OIDC, Tailscale identity, audit log), and the help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `a436a4d` fix: Security page layout on phones, terms out of headings, verified in a browser (M5 #15)
  - `ea34cd1` feat: Security completion: OIDC and Tailscale identity sign-in as extra methods, audit log viewer with filters and export (M5 #15)
  - Fix commit `a436a4d` ("Security page layout on phones, terms out of headings, verified in a browser") changes no test file.
- **Tests added:**
  - `a436a4d`: no test file changed.
  - `server/test/audit-viewer.test.ts` (added in `ea34cd1`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/auth-methods.test.ts` (added in `ea34cd1`): 14 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/fixtures/stub-oidc.ts` (added in `ea34cd1`): fixture, no cases
  - `server/test/tailnet-identity.test.ts` (changed in `ea34cd1`): 7 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/audit-model.test.ts` (added in `ea34cd1`): 4 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for OIDC against a test identity provider (wrong issuer, audience, user refused) and for refused spoofed Tailscale headers. The gates were run from a Playwright adapter (not the omp tab) over `/system/security`, `/system/security/audit` and `/sign-in` with both extra buttons, at all four widths. The Tailscale identity was simulated with Serve headers on loopback requests; no real tailnet.
- **Deviations:**
  - The Playwright-based gates were run from a Playwright adapter, not the omp tab.
  - The Tailscale identity was simulated with Serve headers on loopback requests; no real tailnet was used.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Tailscale identity sign-in on a real tailnet is not verified.
