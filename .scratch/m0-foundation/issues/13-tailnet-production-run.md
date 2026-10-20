# 13: Tailnet production run (M0 done)

**What to build:** Caduceus runs as a background service. It starts at login and restarts if it crashes.

It is reachable only on the tailnet, at `https://<mac>.ts.net:9443`, through Tailscale Serve. It never uses Funnel, and this node's existing public Funnel on 443 is left untouched.

When served through Serve, Caduceus requires Tailscale's identity header to match an owner allowlist. That header can be trusted only because Caduceus listens on loopback alone. Passkeys switch to the tailnet hostname.

A setup command does the following:
1. creates Caduceus directory and permissions;
2. registers the service;
3. configures Serve, **after asking the owner at that moment**;
4. prints the warning that the hostname appears in public certificate-transparency logs.

The setup command is idempotent and can undo itself.

**Blocked by:**
- 04 (passkeys, device list and step-up re-auth)
- 11 (Health and Repairs)
- 12 (installable PWA and offline shell)

**Status:** blocked-on-owner

Built and verified, and installed live on 2026-10-07 with the owner's go-ahead. Only the owner's phone acceptance and a reboot check remain (see the last comment).

- [ ] **M0 acceptance, on the owner's phone over the tailnet:** *(owner only)*
  - open the HTTPS URL;
  - sign in with a passkey;
  - see Home with live Hermes health;
  - install it to the Home Screen and reopen it from the icon.
- [x] The existing Hermes dashboard (:9119), WebUI (:8787) and the :443 Funnel still work afterwards (checked).
- [ ] The service survives a crash (kill test) and a reboot. *(Crash: verified live. Reboot: owner, at their next restart.)*
- [x] When reached through Serve, requests without a matching identity header are refused. The loopback-only bind is verified.
- [x] Setup can be re-run safely. Uninstall removes the service and the Serve entry it added, and nothing else. No Tailscale change happens without the owner's confirmation at that moment.
- [x] The project README has a "Run Caduceus" section covering setup, upgrade, uninstall and troubleshooting.

## Comments

**2026-10-07: carried forward from M0 #03 and #04 (integrator).** Settle these here:
- **Cookie scope across ports.** Browsers don't scope cookies by port, so the Caduceus session cookie set for `<mac>.ts.net:9443` would also be sent to the public Funnel service on `<mac>.ts.net:443`.
  - Choose and document a mitigation, and ask the owner if it needs a Tailscale change. Options:
    - a separate hostname for Caduceus, if Tailscale Serve supports one on this tailnet;
    - confirming the Funnel service never logs or forwards cookies;
    - accepting the risk explicitly.
  - The `__Host-` prefix alone doesn't help, because it doesn't scope by port.
- **Set `publicOrigin` and `rpId`** to the stable ts.net origin and hostname. Passkeys registered on `localhost` don't carry over, so the owner registers one again on the phone.

**2026-10-07: owner decisions.**
- **Same host, port 9443:** `https://my-mac.tail0000aa.ts.net:9443`, through `tailscale serve --bg --https=9443 http://127.0.0.1:9130`. `publicOrigin` is that origin and `rpId` is `my-mac.tail0000aa.ts.net`. Funnel can use only 443, 8443 and 10000, so 9443 is Serve-only; the production configuration refuses those three ports.
- **Cookie scope: the owner explicitly ACCEPTS the risk** that browsers also send the Caduceus session cookie to the public Funnel on :443 of the same hostname (it proxies `localhost:2283`, likely Immich). Recorded in architecture §5. Exposure is kept down where it is free: the cookie is `HttpOnly`, `Secure` and `SameSite=Strict`; `Path` cannot be narrowed (Caduceus lives at `/`) and `__Host-` does not scope by port, so neither would help. What makes a leaked cookie harmless is the rest of the design: Caduceus is not on Funnel, Serve forwards only requests from allowed Tailscale logins (a request through the public Funnel carries no login and could never reach Caduceus anyway), T2/T3 actions need a passkey, and sessions can be revoked.

**2026-10-07: built (agent M0T13Tailnet).**
- **Identity gate.** `server/src/tailnet-identity.ts`; `startCaduceusServer` gains `tailnetOwners` and `onTailnetRefusal`. A request that is not from this Mac itself must carry a `Tailscale-User-Login` that is one of the owners (case-insensitive), on every route and on WebSocket upgrades (`gateUpgrades`), before anything else (no sign-in attempt to throttle, no Hermes). Refusal: `403 {"error":"tailnet-identity"}`, `no-store`. An empty list refuses everything through Serve; no list means no enforcement (development and the existing tests).
- **Production configuration.** `server/src/production-config.ts`: `config.json` in `<Hermes root>/caduceus/` (0600) with `port`, `publicOrigin`, `rpId`, `tailnetOwners`. It refuses a missing owner, a non-ts.net host, ports 443/8443/10000, an RP ID that is not the host and unknown keys. `main.ts` reads it when `CADUCEUS_CONFIG` is set and exits 1 with the reason when it cannot be used, rather than starting open; it logs each refused source once.
- **The `caduceus` command.** `npm run caduceus -- setup|uninstall|restart|status` (`server/scripts/caduceus.ts` → `server/src/service-cli.ts`; planning in the pure `server/src/service-plan.ts`). Nothing changes without `--yes`; the Tailscale step also needs `--yes-tailscale` or a typed yes at the terminal, asked at that moment (after the service answers on loopback, and after the certificate-transparency warning). Setup refuses to start when the web app or dependencies are missing, `hermes` or Tailscale is not found, something else is on port 9443, or Funnel is on for it. It never replaces a foreign Serve entry; uninstall removes only an entry that is exactly Caduceus's (`tailscale serve --https=9443 off`), unloads the service and deletes the LaunchAgent, and keeps `~/.hermes/caduceus/`. The LaunchAgent (`dev.caduceus.dashboard`: `RunAtLoad`, `KeepAlive`, `Umask` 077, log `~/.hermes/caduceus/logs/caduceus.log`) runs `node --import tsx/dist/loader.mjs server/src/main.ts` as **one process**: through tsx's own command the server would be a child that outlives a killed wrapper and keeps port 9130 (checked: with the loader, `kill -9` frees the port and the Hermes watchdog stops Hermes).
- **Moved:** `hermesRootHome` to `server/src/hermes-root-home.ts` (it takes the home directory as an optional argument), so that the command does not load SQLite (its experimental warning).
- **Tests** (red first; those that passed at once were mutation-checked, see below):
  - `tailnet-identity.test.ts` (6, HTTP/WS seam, real Hermes in a temp home, configured as production): refused on every route with any cookie for no login / wrong login / look-alike logins; the owner's login in any case is served (page, password sign-in with a `Secure` cookie, API, Hermes); WebSocket upgrade 403/403/101; this Mac itself never subject, empty list refuses all; refusal source reported; Caduceus accepts connections on 127.0.0.1 and on none of this Mac's other addresses.
  - `production-config.test.ts` (2, pure): parse/round trip; 17 refused configurations with their messages.
  - `production-run.test.ts` (2, `main.ts` as its own process): serves on the configured port with the origin and RP ID, owner login in / intruder out, refusal logged once; missing or unusable configuration exits 1 and listens on nothing.
  - `service-plan.test.ts` (13, pure): the LaunchAgent (read back with an independent plist reader and `plutil -lint`), Serve inspection (including a foreign entry, a TCP listener, Funnel on 9443), the fresh plan, **re-running changes nothing** (a simulated machine), reload on a changed setting, repairs, blockers, uninstall (restores the state before setup apart from the kept data; leaves the Funnel on 443), restart, `tailscale status` and `launchctl print` parsing, configuration choice (flags > what was written > Tailscale).
  - `caduceus-cli.test.ts` (13, the command against fake `launchctl`/`tailscale`/`hermes` that are the only programs on its PATH, in a temp home): dry run changes nothing; `--yes` does the local steps and leaves Tailscale alone; a typed no/yes at the terminal; `--yes-tailscale`; a second run with no options has nothing to do; uninstall in two stages; a foreign Serve entry, a service that never answers (Tailscale untouched), no Tailscale, usage errors; status; restart; the entry script as a process.
  - Mutation checks: case-sensitive login compare, empty list as "not enforced", local peers subject to the gate, bind to `0.0.0.0`, refusal hook dropped, exit 0 on a bad configuration, `&` not escaped in the plist, config change not reloading, `--yes` implying the Tailscale confirmation, any answer counting as yes: each failed the expected test.
- **Verification:** `npm test` 360 passed (1 opt-in skipped); `npx tsc -p server --noEmit` and `-p web` clean; `npm run lint:ui` clean; `npm run test:e2e` 6 passed; no stray processes. **Nothing was run against the real launchd, the real Tailscale config, `~/Library/LaunchAgents` or `~/.hermes/caduceus`.** Read-only `tailscale serve status --json`, `tailscale status --json` (filtered) and `tailscale serve --help` were run once to pin the JSON shapes (current state: only the Funnel on 443 → `localhost:2283`).
- **Deviations / notes.**
  - Architecture §8 listed VAPID keys and registering the first passkey in `setup`; those are not part of it (VAPID is M2; the owner sets the password on this Mac and adds the passkey in Settings), noted in §8.
  - `restart` was added (not in the ticket) so that upgrading has one command.
  - The `launchctl print` field names (`state`, `pid`, `last exit code`) are from launchd's documented output, not observed here (launchctl was off limits); `status` only displays them, and its verdict rests on the HTTP liveness probe.
  - Setup needs the owner's Tailscale login: it defaults to the user that owns this node (`tailscale status`). If the phone belongs to another tailnet user, pass `--owner`.
- **Follow-ups:** log rotation for `caduceus.log` (it only grows); M5 #15 (OIDC / Tailscale-identity sign-in, audit viewer) can build on the identity gate.

**Owner: what is left, in order (all on the Mac unless it says phone).**

1. Set up (plan first, then apply; it asks again before it changes Tailscale Serve):
   ```sh
   cd ~/hermes-dashboard
   npm install && npm run build -w web
   npm run caduceus -- setup          # read the plan: host, owner login, steps
   npm run caduceus -- setup --yes    # answer y at "Change Tailscale Serve now? [y/N]"
   npm run caduceus -- status         # exit 0 = installed, running, answering, served, Funnel off for 9443
   ```
   If the owner login in the plan is not the one your phone uses, re-run with `--owner <login>` (and `--host my-mac.tail0000aa.ts.net` if the host differs).
2. **Phone acceptance:** on the Mac open `http://localhost:9130`, set the owner password. On the phone (Tailscale on): open `https://my-mac.tail0000aa.ts.net:9443`, sign in with the password, Settings › Security › add a passkey, sign out and sign in with the passkey, check Home shows live Hermes health, Add to Home Screen, reopen from the icon.
3. **Existing services and the Funnel:**
   ```sh
   tailscale serve status                                  # :443 Funnel → localhost:2283 unchanged; :9443 tailnet only
   curl -s -o /dev/null -w '%{http_code}\n' https://my-mac.tail0000aa.ts.net/     # the Funnel still answers
   curl -s -o /dev/null -w '%{http_code}\n' http://100.64.0.10:9119/                           # stock dashboard (the address its LaunchAgent binds)
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/                              # WebUI
   ```
4. **Crash and reboot:**
   ```sh
   launchctl print gui/$(id -u)/dev.caduceus.dashboard | grep -E 'state|pid'
   kill -9 <that pid>; sleep 15; npm run caduceus -- status    # running again, new pid
   ```
   Then restart the Mac, log in, and run `npm run caduceus -- status` (the service starts at login).
5. **Serve identity, live, and the loopback bind:**
   ```sh
   lsof -nP -iTCP:9130 -sTCP:LISTEN                         # 127.0.0.1:9130 only
   curl -m 3 http://$(ipconfig getifaddr en0):9130/_caduceus/healthz    # must fail to connect
   # temporarily lock yourself out: set "tailnetOwners" in ~/.hermes/caduceus/config.json to ["nobody@example.com"]
   npm run caduceus -- restart --yes
   curl -s -w ' %{http_code}\n' https://my-mac.tail0000aa.ts.net:9443/_caduceus/healthz    # {"error":"tailnet-identity"} 403
   grep Refused ~/.hermes/caduceus/logs/caduceus.log        # names the login Tailscale sent
   # put your login back in config.json, then:
   npm run caduceus -- restart --yes
   ```
6. Tick the criteria above, set `Status: resolved`. To undo everything: `npm run caduceus -- uninstall --yes` (asks before removing the Serve entry).

**2026-10-07: installed live (integrator, with the owner's explicit go-ahead).**
- **Setup:**
  - `npm run caduceus -- setup` showed the plan.
  - `setup --yes` created `~/.hermes/caduceus/{,logs/}` and `config.json`, and wrote and loaded `~/Library/LaunchAgents/dev.caduceus.dashboard.plist`.
  - Piped input did not count as the Tailscale confirmation (correct). `setup --yes --yes-tailscale` then ran `tailscale serve --bg --https=9443 http://127.0.0.1:9130`.
  - `tailscale serve status` now shows the untouched Funnel `https://my-mac.tail0000aa.ts.net` → `localhost:2283`, plus `:9443 (tailnet only)` → `127.0.0.1:9130`.
  - `caduceus status`: LaunchAgent up to date, service running, health answering, Funnel off for 9443, owner `owner@example.com`.
- **Bind:** `lsof` shows only `127.0.0.1:9130`. The LAN address `192.168.68.50:9130` refuses connections.
- **Other services afterwards:** Funnel :443 → 200; stock dashboard :9119 → 302 (its login); WebUI :8787 → 302 (its login); gateway processes still running.
- **Crash:**
  - `kill -9` of the listener (pid 77684): launchd restarted Caduceus in about 1 s (new pid 78186).
  - The old Hermes backend was stopped by the watchdog, leaving one watchdog and one `hermes serve` under the new server.
- **Identity gate, live through the real Serve:**
  - With `tailnetOwners` temporarily set to `nobody@example.com` and the service restarted, `https://…:9443/_caduceus/healthz` from this tailnet node answered `403 {"error":"tailnet-identity"}`, and the refusal was logged once.
  - Direct loopback (not through Serve) still answered 200.
  - With the config restored and the service restarted, it answered 200 through Serve.
- **Left for the owner:**
  1. On this Mac, open http://localhost:9130 and set the owner password.
  2. On the phone, open https://my-mac.tail0000aa.ts.net:9443, sign in, add a passkey (Settings › Security), sign in with it, see Home health, Add to Home Screen, and reopen it from the icon.
  3. After the next reboot, run `npm run caduceus -- status`.
  
  Then tick the remaining two boxes and set `Status: resolved`.

### Evidence (documentation pass)
- **Commit(s):**
  - `5c383fe` feat: tailnet production run tooling (M0 #13).
  - `267816a` chore: note cookie scope and origin settings for M0 #13 (ticket text only).
  - `7f630eb` chore: record live install and checks for M0 #13 (ticket text only).
- **Tests added** (all in `5c383fe`):
  - `server/test/tailnet-identity.test.ts` (6): Caduceus HTTP/WS API over real Hermes configured as production.
  - `server/test/production-run.test.ts` (2): `main.ts` run as its own process.
  - `server/test/production-config.test.ts` (2), `service-plan.test.ts` (13): pure modules.
  - `server/test/caduceus-cli.test.ts` (13): the `caduceus` command against fake `launchctl`, `tailscale` and `hermes` as the only programs on its PATH.
  - Modified: `hermes-root-home.test.ts` (1, was 1). Fixtures: `fake-system.ts`, `plist.ts`.
- **Verification recorded:**
  - In the build: `npm test` 360 passed (1 skipped); both typechecks, `lint:ui` clean; `npm run test:e2e` 6 passed. Nothing in the tests ran against real launchd, Tailscale or `~/.hermes/caduceus`; only read-only `tailscale` commands ran once to pin JSON shapes. Mutation checks listed in the comment.
  - Live install on 2026-10-07 with the owner's go-ahead: plan shown, `setup --yes --yes-tailscale` created the config, loaded the LaunchAgent and added the Serve entry on :9443. `lsof` showed only `127.0.0.1:9130`; the LAN address refused. Funnel :443 answered 200; :9119 and :8787 answered 302 (their logins); gateway processes still running. `kill -9` of the listener: launchd restarted Caduceus in about 1 s and the watchdog stopped the old backend. Identity gate through the real Serve: `403 {"error":"tailnet-identity"}` with a foreign owner list, 200 after restoring it.
  - Not verified: the reboot survival, and the phone acceptance (open the HTTPS URL, passkey sign-in, Home with live health, install to Home Screen).
- **Deviations:**
  - VAPID keys and registering the first passkey are not part of `setup` (VAPID is M2; the owner adds the passkey in Settings); noted in architecture §8.
  - `restart` was added (not in the ticket) so an upgrade has one command.
  - The `launchctl print` field names are from launchd's documented output, not observed (launchctl was off limits); `status` rests on the HTTP liveness probe.
  - Setup defaults the owner login to the node's user; use `--owner` if the phone belongs to another tailnet user.
  - Owner decision: same host on port 9443; the owner explicitly accepts that browsers also send the session cookie to the Funnel on :443 of the same hostname (recorded in architecture §5).
- **Follow-ups / open items:**
  - Status: blocked-on-owner. Criteria still unticked: the phone acceptance, and the crash and reboot item (crash verified live; reboot not yet).
  - The owner must: (1) open `http://localhost:9130` on the Mac and set the owner password; (2) on the phone, open `https://my-mac.tail0000aa.ts.net:9443`, sign in, add a passkey in Settings › Security, sign out and in with it, check Home health, Add to Home Screen, reopen from the icon; (3) after the next reboot run `npm run caduceus -- status`. Then tick the two boxes and set `Status: resolved`.
  - Log rotation for `caduceus.log` (it only grows); M5 #15 can build on the identity gate.
