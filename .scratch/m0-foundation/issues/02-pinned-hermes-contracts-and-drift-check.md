# 02: Pinned Hermes contracts, generated types, drift check

**What to build:** Caduceus builds against a pinned copy of the installed Hermes version's two contracts:
- its REST contract (OpenAPI);
- its gateway contract (OpenRPC).

Both the web app and the Caduceus server use types generated from these pins. Hermes's shared gateway client library (`@hermes/shared`: JSON-RPC gateway client, replay, heartbeat, reconnect backoff, fuzzy, theme presets) is vendored at the same version. One regenerate command refreshes the pins, the types and the vendored library together.

A contract check fails loudly when the running Hermes no longer matches the pin, and names exactly what changed. The Caduceus server runs the same comparison at startup and exposes "compatible / incompatible + reasons" through the Caduceus API. The comparison covers the REST and gateway contracts plus the gateway's capability markers: replay epoch, heartbeat, change events and the desktop contract number.

This is the third early check: a Hermes update that changes the API must be caught before it breaks Caduceus.

**Blocked by:** 01 (walking skeleton).

**Status:** resolved

- [x] The pinned contracts record the Hermes version they came from. A single regenerate command updates pins, generated types and the vendored shared library.
- [x] The Home request from ticket 01 uses the generated types. There are no hand-written Hermes types.
- [x] The contract check passes against the local Hermes. Altering a pinned operation or method makes it fail with a readable diff of added, removed and changed REST operations and gateway methods (tests).
- [x] At startup the Caduceus server reports compatibility and reasons through the Caduceus API, including the gateway capability markers.
- [x] The diff logic has unit tests. The check runs as part of the project's test command.
- [x] The contracts workspace also holds the Caduceus server's own API types (starting with the backend status from ticket 01), and the web app imports them. This removes the copy of the backend-state union in Home (code-review finding on ticket 01).

## Comments

**2026-10-07: resolved (TDD).**

- **What was built:**
  - `contracts/` workspace (`@caduceus/contracts`):
    - `caduceus-api.ts`: the Caduceus API types (`BackendStatus`, `BackendState`, `CompatibilityReport`, `GatewayMarkers`, `ContractChanges`);
    - `hermes/openapi.json` + `hermes/rest.generated.ts` (openapi-typescript): the REST pin;
    - `vendor/hermes-shared/`: `@hermes/shared` from `apps/shared` (MIT `LICENSE` and `package.json` included, tests left out). It carries the gateway pin `gateway-contract.openrpc.json` and Hermes's generated `gateway-contract.generated.ts`;
    - `hermes/pin.json`: Hermes `0.21.4` (`2026.9.21`, upstream `2e1afdf0`) and the markers.
  - `npm run contracts:regenerate` (`server/scripts/regenerate-contracts.ts`) refreshes all of the above in one go. Running it twice produced byte-identical files.
  - `GET /_caduceus/api/compatibility` runs again on every backend launch, because a restart may bring up an updated Hermes. It compares three things with the pins: the live `/openapi.json`, the gateway contract published in the Hermes install (`apps/shared/src/gateway-contract.openrpc.json`, found through `hermes --version`), and the live `gateway.ready` and `gateway.capabilities` markers, read over `/api/ws` through the new launcher method `openGateway()`.
    - Additions are listed but leave Hermes compatible. Removals, changes and lost or changed markers make it incompatible, and each one is named in `reasons`.
  - The diff resolves `$ref`s (cycle-safe) and ignores documentation-only keys. It covers gateway methods, server→client requests and events.
  - Server types come from the pins: the gateway marker frames are typed with the vendored `BackendGatewayEventMap` and `RpcMethods`.
- **Tests:**
  - `server/test/contract-diff.test.ts` (pure module, 9 tests): REST added/removed/changed; a change inside a referenced schema; documentation-only edits ignored, while a property named `title` still counts; gateway methods, events and server requests with a self-referencing schema; marker mismatches; an unobserved desktop contract does not count.
  - `server/test/hermes-compatibility.test.ts` (Caduceus API, one real `hermes serve` in a temp `HERMES_HOME` through the new shared helper `server/test/fixtures/real-hermes.ts` › `launchTestHermes()`):
    - the local Hermes is compatible, with an exact match: no additions, version 0.21.4, all markers;
    - an altered pin (an extra REST operation, changed `/api/status` parameters, a missing `ping`, changed `session.create` params, `heartbeat` false, an extra capability) is reported incompatible, with each item named.
  - Red first: the API test failed on the missing route, and the diff tests failed on the missing module. Mutation checks: dropping the "REST changed" reasons, and disabling the `properties` handling in the diff, each made a test fail.
- **Verification:**
  - `npm test`: 21 pass, 1 opt-in skipped, about 3.5 s;
  - both typechecks are clean;
  - `npm run test:e2e`: 6 pass;
  - `npm run smoke:real`: passes;
  - a typecheck probe confirmed that `getHermes('/api/not-pinned')` does not compile.
- **Manual check against real Hermes:** `npm run dev` with the owner's home returned `compatible`, `reasons: []`. REST `added` lists the owner's plugin routes `GET /api/plugins/commandcode-usage/{credits,health}`, which are not in the pristine-home pin. This confirms the pin must come from a temp home and that additions must stay compatible.
- **Browser smoke check (Home, 390/320/820/1440):** "Hermes 0.21.4 · Gateway running · 6 profiles" at every width, with no horizontal overflow and no console or page errors. Screenshots are in `.scratch/m0-foundation/m0-02-smoke/`. No axe run or target check: the only change to Home is its types.
- **Deviations:**
  - **`desktop_contract`:** Hermes reports it only in `session.info`, so no session is created to read it.
    - The pinned value 7 is read from `DESKTOP_BACKEND_CONTRACT` in the installed source at regenerate time.
    - The live value is `null` ("not observed") and does not count as a mismatch.
    - The comparison (`markerMismatches`) already handles a live number. **M1 #03** (first Caduceus session, over the M0 #09 connection) must feed `session.info.desktop_contract` into it, and ticket 10's spike can record the live value.
  - **REST response types:** Hermes 0.21.4's OpenAPI declares a response schema for only 1 of its 333 operations. FastAPI handlers there return plain dicts.
    - Home's request therefore uses the generated types for the path and operation (`web/src/hermes-api.ts` › `getHermes`, which only accepts pinned GET paths), and the response comes back as `unknown`.
    - Home narrows the three fields it reads at runtime instead of declaring a hand-written Hermes interface.
    - When Hermes adds response models, regenerating types them automatically.
  - **Gateway contract source:** no RPC lists the gateway's methods, so the "live" OpenRPC is the file that the running Hermes install publishes. Hermes's CI keeps it in sync with its registry. The markers are read live.
  - **REST generator:** `openapi-typescript` needs the TypeScript 5 compiler API, which the repo's TypeScript 7 lacks. The regenerate script therefore runs pinned versions through `npx` (`openapi-typescript@7.13.0` with `typescript@5.9.3`) and adds no dependency. It needs network access the first time.
  - Opening `/api/ws` makes Hermes register its backend heartbeat and schedule its usual once-per-process orphan sweep. Desktop and the stock dashboard trigger the same on connect.
- **Follow-ups:**
  - M0 #08 can build its policy map from `contracts/hermes/openapi.json` and the vendored OpenRPC.
  - M0 #11 turns an `incompatible` report into a Repair plus read-only mode.
  - M1 #03 compares the live `desktop_contract` (above).
- **Housekeeping:**
  - The stale `package-lock.json` name (`hermes-console`) was corrected by `npm install` when the contracts workspace was added.
  - No stray processes or temp homes were left.
  - Tests and the regenerate script touch only temp homes. During the manual `npm run dev` check, the private backend made its usual writes to `~/.hermes` (logs, its heartbeat row, the `--version` update-check cache). Nothing else outside the project was modified.

### Evidence (documentation pass)
- **Commit(s):** `5afc9ec` feat: pinned Hermes contracts, generated types and compatibility check (M0 #02).
- **Tests added:**
  - `server/test/contract-diff.test.ts` (9): pure module (REST and gateway diff).
  - `server/test/hermes-compatibility.test.ts` (2): Caduceus HTTP API seam over one real `hermes serve` in a temp `HERMES_HOME`.
  - Fixture: `fixtures/real-hermes.ts` (`launchTestHermes()`).
- **Verification recorded:** `npm test` 21 pass, 1 opt-in skipped; both typechecks clean; `npm run test:e2e` 6 pass; `npm run smoke:real` pass; a typecheck probe showed `getHermes('/api/not-pinned')` does not compile. Manual check with the owner's home: `compatible`, `reasons: []`. Browser smoke on Home at 390/320/820/1440: "Hermes 0.21.4 · Gateway running · 6 profiles", no overflow, no console errors; screenshots in `.scratch/m0-foundation/m0-02-smoke/`. No axe run or target check (only Home's types changed). Two mutation checks failed the named tests.
- **Deviations:**
  - `desktop_contract` is reported by Hermes only in `session.info`, so the live value is `null` ("not observed", not a mismatch); the pinned value 7 is read from the Hermes source at regenerate time. M1 #03 feeds the live value.
  - REST response types: Hermes 0.21.4 declares a response schema for 1 of 333 operations, so Home types the path and operation and narrows the three fields it reads at runtime.
  - No RPC lists gateway methods, so the "live" OpenRPC is the file the installed Hermes publishes; markers are read live.
  - The REST generator runs pinned `openapi-typescript@7.13.0` with `typescript@5.9.3` through `npx` (the repo's TypeScript 7 lacks the API); first run needs network.
  - Opening `/api/ws` makes Hermes register its heartbeat and schedule its orphan sweep once per process.
- **Follow-ups / open items:** M0 #08 builds the policy map from the pins; M0 #11 turns `incompatible` into a Repair and read-only mode; M1 #03 compares the live `desktop_contract`. Status: resolved.
