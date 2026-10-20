# Contributing

Thanks for your interest. Caduceus is a personal project that is shared in the hope it is useful. Issues and pull requests are welcome, but answers can be slow, and changes that do not fit the design may be declined. For a large change, open an issue first.

## Setup

You need macOS (Linux is untested), Node 22.12 or newer, and [Hermes Agent](https://github.com/NousResearch/hermes-agent) at the version pinned in `contracts/hermes/pin.json` on your `PATH`.

```sh
npm install
npm run dev     # builds the web app, starts Caduceus on http://127.0.0.1:9130 with a private Hermes
```

For a throwaway run, point `HERMES_HOME` at a temp folder. Otherwise Caduceus uses your real `~/.hermes`.

## Before you open a pull request

```sh
npx tsc -p server --noEmit && npx tsc -p web --noEmit   # typecheck
npm run lint:ui                                           # design lint (UI changes)
npm test                                                  # server and web tests
```

`npm test` starts real `hermes serve` processes in temporary homes, so it needs `hermes` installed. CI runs the typecheck, the design lint and the web tests only.

## Rules

[`AGENTS.md`](AGENTS.md) is the full guide for humans and coding agents alike. The short version:

- **Tests first.** Write the test, see it fail, then make it pass. Test at the seams in `AGENTS.md` ("Tests"): the Caduceus HTTP/WS API as a black box, pure domain modules, and the Hermes launcher. No new Playwright tests.
- **Never run `hermes` against your real home from a test or a script.** Tests use a temp `HERMES_HOME` (`launchTestHermes()`).
- **Hermes types come only from `npm run contracts:regenerate`.** Never hand-write them. Every new Hermes operation needs a tier in `contracts/policy/`.
- **Do not weaken the security rules** in `AGENTS.md` (policy proxy, tiers, file guard, CSP, secret masking). A change there needs a test that shows the rule still holds.
- **UI:** use only the `--cd-*` design tokens, logical CSS properties, 44 px touch targets, and plain English strings. Every route has help in its module's `help.ts`.
- **Commits** follow `type: description` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`).

## Reporting bugs

Use the bug report template. In the app, **Control › System › Maintenance › Diagnostics › Copy for bug report** copies the Caduceus, Node and Hermes versions and the contract state, with paths, names and keys removed. Report security problems privately: see [`SECURITY.md`](SECURITY.md).
