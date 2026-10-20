#!/usr/bin/env node
// Test fixture: a stand-in for `hermes serve` that follows Hermes's launcher contract.
//   - reads the per-launch secret from HERMES_DASHBOARD_SESSION_TOKEN
//   - binds --host/--port (port 0 = OS-assigned) and announces `HERMES_BACKEND_READY port=<n>` on stdout
//   - like real headless Hermes on loopback, serves a token page at `/` and requires
//     X-Hermes-Session-Token on non-public /api routes (/api/status is public)
// Test-only side channels (never part of the HTTP surface Caduceus proxies):
//   FAKE_HERMES_STATE_DIR  -> writes `launch-<n>.json` ({ pid, token }) per launch
//   FAKE_HERMES_EXIT_BEFORE_READY=1 -> exit immediately without announcing (crash loop)
//   FAKE_HERMES_EXIT_AFTER_READY=1 -> announce, then exit at once (crash right after ready)
//   FAKE_HERMES_DEAF_AFTER_READY=1 -> announce, then stop listening but stay up: a Hermes the launcher still believes ready
//                                     whose port refuses connections (the moments after a crash, before the launcher has seen it)
//   GET /api/__fake/hits   -> every other request it has received since the last call, `{ method, target, body }`:
//                             what a test reads to prove a request was (or was not) forwarded
//   PUT /api/__fake/answers -> sets what GET `path` answers for the paths in the JSON body (`{ "/api/status": { … } }`), until it
//                             is set again: how a test scripts Hermes's status endpoints. A key may carry a query
//                             (`/api/status?profile=coder`), which then answers only that request, and may be any GET path
//                             (`/api/gateway/migrate/plan`). A `null` goes back to the built-in answer.
//                             Other paths answer what a healthy, idle Hermes does (`ANSWERS`)
//   GET /api/__fake/ws     -> the gateway (`/api/ws`) side since the start, or since the last `?reset=1`: `{ upgrades, frames,
//                             closes }`: every handshake it saw (`{ path, authorized, origin, cookie }`: what Caduceus
//                             presented), every text frame a socket sent it and the close code of every socket that has closed
//                             `?stall=1` makes it take every later gateway connection and never answer its handshake (a Hermes too
//                             busy to respond); `stalled` counts the connections it is still holding. `?mute=1` makes every gateway
//                             socket stop answering requests (a connection that looks open and is not), though it still receives them
// It follows the contracts Caduceus pins (`contracts/hermes/`), so Caduceus finds it compatible except for what a test pins
// differently: `/openapi.json` is the pinned REST contract, `gateway.ready` carries the pinned markers and `gateway.capabilities`
// answers the pinned capabilities (the gateway contract file lives in the Hermes install, which this stand-in has none of).
// Its gateway sends `gateway.ready` first (with a replay epoch that is new on every launch), answers `gateway.ping` and
// answers any other request with `{ method }`. The policy proxy in front of it judges the method, so a request asks for a
// misbehaviour through its params instead:
//   params.leak -> the result also carries the launch secret: an upstream that echoes it
//   params.drop -> closes the socket with code 1011 without answering, as a Hermes that dies mid-session would
//   params.desktopContract -> answers `{ session_id, info: { desktop_contract } }`, as a session create does
//   params.infoEvent -> first sends a `session.info` event carrying that desktop contract number
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const host = argValue('--host', '127.0.0.1');
const port = Number(argValue('--port', '9119'));
const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? '';
const stateDir = process.env.FAKE_HERMES_STATE_DIR;

if (process.env.FAKE_HERMES_EXIT_BEFORE_READY === '1') process.exit(3);

if (stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const n = fs.readdirSync(stateDir).filter((f) => f.startsWith('launch-')).length + 1;
  fs.writeFileSync(path.join(stateDir, `launch-${n}.json`), JSON.stringify({ pid: process.pid, token }));
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** What Hermes's status endpoints answer when nothing says otherwise: a healthy, idle Hermes (shapes as Hermes 0.21.4 serves them). */
const ANSWERS = {
  '/api/status': { version: '0.21.4-fake', gateway_running: true, gateway_state: 'running', gateway_platforms: {}, gateway_exit_reason: null, gateway_heartbeat_stale_s: null, active_sessions: 2 },
  '/api/cron/jobs': [],
  '/api/plugins/kanban/stats': { by_status: {}, by_assignee: {}, oldest_ready_age_seconds: null, now: 1_790_000_000 },
  '/api/plugins/kanban/diagnostics': { diagnostics: [], count: 0 },
  '/api/credentials/pool': { providers: [] },
  '/api/system/stats': { cpu_count: 8, cpu_percent: 12.5, memory: { total: 17_179_869_184, used: 6_442_450_944, percent: 37.5 }, disk: { total: 500_000_000_000, used: 200_000_000_000, percent: 40 }, psutil: true },
  '/api/health': { ok: true, version: '0.21.4-fake', auth_required: false },
  '/api/host/identity': { ok: true, protocolVersion: 1, pid: 4242, role: 'serve', servesSpa: false },
  '/api/health/idle': { ok: true, idle: true, reason: null },
  '/api/egress/status': { text: 'Egress proxy status\n\nEnabled: no\nBinary: (missing)\nBinary version: (unknown)\nConfig: (not generated)\nCA cert: (not generated)\nTunnel port: 9090\nProcess: (stopped)\nListening: no\nCredential src: env\nDocker enforce: yes\nScope: Docker backend only in this release' },
  '/api/hermes/update/check': { install_method: 'git', current_version: '0.21.4-fake', behind: 0, update_available: false, can_apply: true, update_command: 'hermes update', message: "You're on the latest version." },
};
/**
 * Hermes's diagnostic actions (`POST /api/ops/doctor`…): each is spawned and answers at once, and its output goes to one log that every run appends to,
 * each run starting with `=== <name> started <time> ===`. `POST /api/__fake/action` drives one: `{ name, line }` prints, `{ name, finish: { exit_code } }` ends it.
 */
const ACTIONS = { doctor: 'doctor', 'security-audit': 'security-audit', 'prompt-size': 'prompt-size', dump: 'dump', 'config-migrate': 'config-migrate' };
const actions = {};
/** Routes a finished fake update took out of the contract; the launches after it serve the contract without them. */
const droppedRoutes = stateDir && fs.existsSync(path.join(stateDir, 'dropped-routes.json')) ? JSON.parse(fs.readFileSync(path.join(stateDir, 'dropped-routes.json'), 'utf8')) : [];
/** The `hermes update` the fake is running or ran last (`POST /api/hermes/update` starts it, `POST /api/__fake/update` drives it). */
const receiptFile = stateDir ? path.join(stateDir, 'update-receipt.json') : undefined;
// Hermes writes its receipt to disk, so a launch after the update still has it.
const update = { running: false, lines: [], exit_code: null, receipt: receiptFile && fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : null };
/** What `PUT /api/__fake/answers` has set. */
const scripted = new Map();

/** The requests received since the last read of `/api/__fake/hits`. */
let hits = [];

/** Set by `/api/__fake/ws?stall=1`: the gateway takes a connection and never answers its handshake. */
let stallUpgrades = false;
/** The connections `stallUpgrades` is holding, which are still open: `stalled` in what `/api/__fake/ws` says. */
const stalledSockets = new Set();
/** Set by `/api/__fake/ws?mute=1`: the gateway receives requests and answers none. */
let muted = false;

/** The gateway handshakes, frames and closes since the start, or since the last `/api/__fake/ws?reset=1`. */
let gateway = { upgrades: [], frames: [], closes: [] };
const replayEpoch = crypto.randomUUID().replaceAll('-', '');
const gatewaySockets = new WebSocketServer({ noServer: true });

const PINNED = new URL('../../../contracts/hermes/', import.meta.url);
const pinnedCapabilities = JSON.parse(fs.readFileSync(new URL('pin.json', PINNED), 'utf8')).markers.capabilities;

const server = http.createServer((req, res) => {
  // Read the whole request first, so that what a test sees as received is complete before anything is answered.
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')));
});

const handle = (req, res, body) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const authed = token !== '' && req.headers['x-hermes-session-token'] === token;
  if (url.pathname === '/api/__fake/hits') {
    json(res, 200, hits);
    hits = [];
    return;
  }
  if (url.pathname === '/api/__fake/answers') {
    for (const [path, answer] of Object.entries(JSON.parse(body))) answer === null ? scripted.delete(path) : scripted.set(path, answer);
    json(res, 200, { scripted: [...scripted.keys()] });
    return;
  }
  if (url.pathname === '/api/__fake/update') {
    // Drives the update the fake is running, one step at a time: `{ line }` is a line `hermes update` printed, `{ finish: { exit_code, receipt?, dropRoutes? } }` ends it.
    const step = JSON.parse(body);
    if (typeof step.line === 'string') update.lines.push(step.line);
    if (step.finish) {
      update.running = false;
      update.exit_code = step.finish.exit_code;
      update.receipt = step.finish.receipt ?? null;
      if (receiptFile && update.receipt) fs.writeFileSync(receiptFile, JSON.stringify(update.receipt));
      // A Hermes that was updated serves another contract after it is restarted: the launches after this one leave these routes out of their `/openapi.json`.
      if (stateDir && step.finish.dropRoutes) fs.writeFileSync(path.join(stateDir, 'dropped-routes.json'), JSON.stringify(step.finish.dropRoutes));
    }
    json(res, 200, { running: update.running });
    return;
  }
  if (url.pathname === '/api/__fake/action') {
    const step = JSON.parse(body);
    const action = (actions[step.name] ??= { running: false, lines: [], exit_code: null });
    if (typeof step.line === 'string') action.lines.push(step.line);
    if (step.finish) Object.assign(action, { running: false, exit_code: step.finish.exit_code });
    json(res, 200, { running: action.running });
    return;
  }
  if (url.pathname === '/api/__fake/ws') {
    json(res, 200, { ...gateway, stalled: stalledSockets.size });
    if (url.searchParams.get('stall') === '1') stallUpgrades = true;
    if (url.searchParams.get('mute') === '1') muted = true;
    if (url.searchParams.get('reset') === '1') gateway = { upgrades: [], frames: [], closes: [] };
    return;
  }
  hits.push({ method: req.method, target: req.url, body: body.slice(0, 4096) });

  if (url.pathname === '/') {
    // Real headless Hermes (ungated, loopback) serves exactly this so Desktop can adopt the token.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><script>window.__HERMES_SESSION_TOKEN__=${JSON.stringify(token)};</script>`);
    return;
  }
  const answer = (path, search = '') => scripted.get(path + search) ?? scripted.get(path) ?? ANSWERS[path];
  // Public, like Hermes's own `/api/status`.
  if (url.pathname === '/api/status') {
    json(res, 200, answer(url.pathname, url.search));
    return;
  }
  if (url.pathname === '/api/__fake/echo') {
    // Reports what reached the upstream without the secret itself crossing the proxy.
    json(res, 200, { host: req.headers.host, boundPort: server.address().port, authorized: authed });
    return;
  }
  if (!authed) {
    json(res, 401, { detail: 'Unauthorized' });
    return;
  }
  const known = answer(url.pathname, url.search);
  if (known !== undefined && (req.method === 'GET' || url.pathname in ANSWERS)) {
    json(res, 200, known);
    return;
  }
  // The gateway lifecycle, as Hermes 0.21.4 answers it: the action is spawned and the request answers at once.
  const lifecycle = /^\/api\/gateway\/(start|stop|restart|migrate|drain)$/.exec(url.pathname);
  if (req.method === 'POST' && lifecycle) {
    const verb = lifecycle[1];
    json(res, 200, verb === 'drain' ? { ok: true, action: JSON.parse(body || '{}').action ?? 'drain', draining: true } : { ok: true, pid: 4242, name: `gateway-${verb}` });
    return;
  }
  if (url.pathname === '/openapi.json') {
    const contract = JSON.parse(fs.readFileSync(new URL('openapi.json', PINNED), 'utf8'));
    for (const route of droppedRoutes) delete contract.paths[route];
    json(res, 200, contract);
    return;
  }
  // `hermes update`, as 0.21.4 serves it: the update is spawned and the request answers at once; its log, then its receipt, are read from the two routes below.
  if (req.method === 'POST' && url.pathname === '/api/hermes/update') {
    if (scripted.has('POST /api/hermes/update')) {
      json(res, 200, scripted.get('POST /api/hermes/update'));
      return;
    }
    Object.assign(update, { running: true, lines: [], exit_code: null, receipt: null });
    json(res, 200, { ok: true, pid: 4243, name: 'hermes-update', action_id: 'fake-action' });
    return;
  }
  const spawned = /^\/api\/ops\/([a-z-]+)$/.exec(url.pathname);
  if (req.method === 'POST' && spawned && ACTIONS[spawned[1]]) {
    const action = (actions[spawned[1]] ??= { running: false, lines: [], exit_code: null });
    Object.assign(action, { running: true, exit_code: null, runs: (action.runs ?? 0) + 1 });
    // The time differs from run to run in Hermes's log: the fake counts seconds.
    action.lines.push(`=== ${spawned[1]} started 2026-10-19 00:00:${String(action.runs).padStart(2, '0')} ===`);
    json(res, 200, { ok: true, pid: 4244, name: spawned[1] });
    return;
  }
  const status = /^\/api\/actions\/([a-z-]+)\/status$/.exec(url.pathname);
  if (status && actions[status[1]]) {
    const wanted = Number(url.searchParams.get('lines') ?? 200);
    json(res, 200, { name: status[1], running: actions[status[1]].running, exit_code: actions[status[1]].exit_code, pid: 4244, lines: actions[status[1]].lines.slice(-wanted) });
    return;
  }
  if (url.pathname === '/api/actions/hermes-update/status') {
    const wanted = Number(url.searchParams.get('lines') ?? 200);
    json(res, 200, { name: 'hermes-update', running: update.running, exit_code: update.exit_code, pid: 4243, lines: update.lines.slice(-wanted) });
    return;
  }
  if (url.pathname === '/api/hermes/update/receipt') {
    if (update.receipt) json(res, 200, { receipt: update.receipt, summary: { outcome: update.receipt.outcome, pre_sha: update.receipt.pre_update?.sha, post_sha: update.receipt.post_update?.sha, post_version: update.receipt.post_update?.version } });
    else json(res, 404, { detail: 'No update receipt found (no `hermes update` run recorded).' });
    return;
  }
  if (url.pathname === '/api/profiles') {
    json(res, 200, { profiles: [{ name: 'default' }, { name: 'coder' }, { name: 'librarian' }] });
    return;
  }
  if (url.pathname === '/api/__fake/leak') {
    // Simulates an upstream endpoint that echoes the secret in its body and headers.
    res.writeHead(200, { 'content-type': 'application/json', 'x-debug-token': token });
    res.end(JSON.stringify({ token }));
    return;
  }
  if (url.pathname === '/api/__fake/log-flood') {
    // Writes 1 MiB to stderr the way Python logging does: blocking until the pipe has room.
    // If nobody drains the pipe this never returns, which is the stall the launcher must prevent.
    const line = Buffer.from(`${'x'.repeat(1023)}\n`);
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; i < 1024; i++) {
      for (let written = 0; written < line.length; ) {
        try {
          written += fs.writeSync(2, line, written);
        } catch (error) {
          if (error.code !== 'EAGAIN') throw error;
          Atomics.wait(pause, 0, 0, 1);
        }
      }
    }
    json(res, 200, { flooded: true });
    return;
  }
  json(res, 404, { detail: 'Not Found' });
};

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const authorized = token !== '' && url.searchParams.get('token') === token;
  gateway.upgrades.push({ path: url.pathname, authorized, origin: req.headers.origin ?? null, cookie: req.headers.cookie ?? null });
  if (stallUpgrades) {
    stalledSockets.add(socket);
    socket.once('close', () => stalledSockets.delete(socket));
    // A socket of an HTTP server is half-open: it sees the peer hang up only if something reads it, and stays open until it ends itself.
    socket.once('end', () => socket.end());
    socket.resume();
    return;
  }
  if (url.pathname !== '/api/ws' || !authorized) {
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  gatewaySockets.handleUpgrade(req, socket, head, (ws) => {
    const ready = { skin: {}, change_events: true, heartbeat: true, replay_epoch: replayEpoch };
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: ready } }));
    ws.on('close', (code) => gateway.closes.push(code));
    ws.on('message', (data) => {
      const text = data.toString();
      gateway.frames.push(text);
      if (muted) return;
      const { id, method, params } = JSON.parse(text);
      if (params?.drop) ws.close(1011);
      else if (id !== undefined && method !== undefined) {
        // A session says its desktop contract number in the `info` of its create result and in `session.info` events; `desktopContract` makes the fake say it, as a result or as an event (`infoEvent`).
        if (typeof params?.infoEvent === 'number') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'session.info', session_id: 'fake-session', payload: { desktop_contract: params.infoEvent } } }));
        }
        const result =
          method === 'gateway.ping'
            ? { ok: true }
            : method === 'gateway.capabilities'
              ? pinnedCapabilities
              : scripted.has(`rpc ${method}`)
                ? scripted.get(`rpc ${method}`)
                : typeof params?.desktopContract === 'number'
                  ? { session_id: 'fake-session', info: { desktop_contract: params.desktopContract } }
                  : { method, ...(params?.leak ? { leaked: token } : {}) };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
      }
    });
  });
});

server.listen(port, host, () => {
  const ready = `HERMES_BACKEND_READY port=${server.address().port}\n`;
  if (process.env.FAKE_HERMES_EXIT_AFTER_READY === '1') process.stdout.write(ready, () => process.exit(4));
  else if (process.env.FAKE_HERMES_DEAF_AFTER_READY === '1') {
    process.stdout.write(ready);
    server.close();
    // Nothing else holds the process open once the listener is gone.
    setInterval(() => {}, 2 ** 30);
  } else process.stdout.write(ready);
});

process.on('SIGTERM', () => {
  // Like Hermes, hang up on whoever is connected, or the server waits for them for as long as they stay.
  for (const socket of gatewaySockets.clients) socket.close(1001);
  server.close(() => process.exit(0));
});
