# Security policy

Caduceus controls an AI agent that can run commands, write files and spend money on model providers. Security reports are welcome and taken seriously.

## Reporting a vulnerability

Do not open a public issue. Report privately through GitHub: **Security › Report a vulnerability** on this repository ([direct link](https://github.com/SunnySydeUp/caduceus-dashboard/security/advisories/new)).

Include the version (commit), the Hermes Agent version, the steps to reproduce, and what an attacker gains. You will get an answer within 7 days. This is a one-person project, so a fix can take longer; you will be told the plan.

## Supported versions

Only the latest commit on `main` is supported.

## In scope

The security model is described in [`AGENTS.md`](AGENTS.md) ("Security rules") and [`docs/design/architecture.md`](docs/design/architecture.md). Reports about these are most useful:

- **Authentication**: owner password, passkeys (WebAuthn), sessions, step-up, the Tailscale identity check.
- **The policy proxy**: any Hermes REST operation, gateway method or event that reaches Hermes without its tier, or that is not in `contracts/policy/` and is not denied.
- **The file guard**: reaching a protected, secret or persistence path (for example `.env`, `auth.json`, SSH keys, shell startup files, Hermes `hooks`/`skills`/`plugins`) through a Caduceus file route.
- **Secret leaks**: a credential that reaches the browser, a log, a share link or a backup made by Caduceus.
- **Share-link redaction**: a secret that survives in a shared transcript.
- **Web security**: XSS, CSRF, CSP bypass, origin checks, push-subscription abuse.

## Out of scope

- Vulnerabilities in Hermes Agent itself. Report them to [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).
- Attacks that need the owner's unlocked Mac, their Tailscale account, or their passkey.
- Running Caduceus outside its intended setup (for example on a non-loopback address, or behind Tailscale Funnel).
