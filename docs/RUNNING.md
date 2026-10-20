# Run Caduceus as a service

This guide covers macOS: the service is a LaunchAgent. For a quick local try, `npm run dev` is enough (see the [README](../README.md)).

Caduceus runs as a background service (a macOS LaunchAgent: it starts at login and starts again if it stops) and is reached from your phone at `https://<this-mac>.<tailnet>.ts.net:9443`, on the tailnet only, through Tailscale Serve. It never uses Funnel, and a Funnel you already run on the node (for example on :443) is left alone. Caduceus itself listens on `127.0.0.1:9130` and nothing else; through Serve it serves only the Tailscale logins you name, and a session cookie and a passkey or password are needed on top of that.

**Set up** (needs `hermes` and `tailscale` on your `PATH`, and the Tailscale app signed in):

```sh
npm install
npm run build -w web
npm run caduceus -- setup           # shows the plan and changes nothing
npm run caduceus -- setup --yes     # does it; asks you again, at that moment, before it touches Tailscale Serve
```

The hostname and the owner login default to what Tailscale reports for this node; the plan names where each value came from. Pass `--host <node>.<tailnet>.ts.net`, `--owner <login>` (repeat it for more people) or `--port <n>` to choose. In a script, `--yes-tailscale` confirms the Tailscale change in advance. Setup:

1. creates `~/.hermes/caduceus/` and its `logs/` (owner only) and writes `config.json` there: the port, the origin, the RP ID and the owner logins the service reads;
2. writes `~/Library/LaunchAgents/dev.caduceus.dashboard.plist` (the service runs from this checkout, with the `node` and `PATH` of the shell you ran setup in) and loads it;
3. waits until Caduceus answers on `127.0.0.1`, then, only if you confirm, runs `tailscale serve --bg --https=9443 http://127.0.0.1:9130`;
4. prints the warning that the hostname appears in public certificate-transparency logs (the certificate covers every port of the hostname, so a node that already uses Serve or Funnel over HTTPS is already listed).

It is safe to run again: it changes only what is missing or different, and does nothing when everything is in place. It stops before changing anything if the web app is not built, Tailscale does not answer, something else is on port 9443, or Funnel is on for it.

Then, **once**: on this Mac open `http://localhost:9130` and set the owner password (only possible from this Mac). On the phone, open the `https://` address, sign in, and add a passkey in Settings > Security. Passkeys made on `localhost` do not carry over, and a passkey belongs to the hostname: if the node is renamed, add a new one.

**Check it:** `npm run caduceus -- status` shows the LaunchAgent, whether launchd has it running, whether it answers, whether Serve points at it and whether Funnel is off for its port (exit 0 only when all of that is right). The log is `~/.hermes/caduceus/logs/caduceus.log`; it only grows, so truncate it now and then (`: > ~/.hermes/caduceus/logs/caduceus.log`).

**Upgrade:**

```sh
git pull && npm install && npm run build -w web
npm run caduceus -- restart --yes   # restarts the service in place; Tailscale is not touched
```

Run `setup --yes` again instead if `node` or `hermes` has moved (a new Node version, say): it rewrites the LaunchAgent with the new paths and reloads it. The service starts at login, so a Mac that should serve after a reboot must log in by itself.

**Change who may reach it:** edit `tailnetOwners` in `~/.hermes/caduceus/config.json`, then `npm run caduceus -- restart --yes`.

**Uninstall:**

```sh
npm run caduceus -- uninstall          # shows the plan
npm run caduceus -- uninstall --yes    # asks before it removes the Serve entry
```

It stops exposing Caduceus (`tailscale serve --https=9443 off`, and only if that entry is Caduceus's own), unloads the service and deletes its LaunchAgent, and nothing else: other Serve and Funnel entries stay. `~/.hermes/caduceus/` (the owner password, passkeys, sessions, audit log, configuration and logs) is kept; delete it yourself to remove them too.

**Troubleshooting**

- *The phone gets `403 {"error":"tailnet-identity"}`:* the login Tailscale sends is not in `tailnetOwners`. The log has a line `Refused a request through Tailscale Serve from tailnet:<login>` (once per login) with the one to add. A request with no login (a tagged device, or Funnel) is refused as `forwarded:<address>`.
- *`status` says it is not answering:* read the log. A configuration the service cannot use stops it with `Not starting: …` (it is restarted every ten seconds until you fix it); a Hermes that is not found, or a port that is taken, shows there too. `launchctl print gui/$(id -u)/dev.caduceus.dashboard` is launchd's own view.
- *`setup` refuses:* each reason is printed (web app not built, `npm install` not run, `hermes` or Tailscale not found, a foreign entry on 9443, Funnel on 9443). Tailscale needs HTTPS certificates enabled for the tailnet.
- *Sign-in from the browser fails with `origin-mismatch`:* open the page at exactly the address `setup` printed (the port matters).
- *Cookie scope:* browsers do not scope cookies by port. If the same hostname also serves a public Funnel (for example `https://<mac>.ts.net` on :443), a browser that visits both sends Caduceus's session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`) to the Funnel's service too. This is an accepted risk (M0 #13): the cookie opens nothing from outside, because Caduceus is reachable only through Serve with an allowed Tailscale login, and sensitive actions also need a passkey.
