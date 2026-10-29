// Puts a long transcript into a throwaway HERMES_HOME the way another Hermes tool would have (a CLI session, a Telegram chat): rows
// written to its `state.db` by Hermes's own `SessionDB`, so that Hermes serves them and nothing in Caduceus knows them. There is
// no way to make a session of thousands of messages through the stub LLM in a test's time.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SHARED_ROOT } from './hermes-installs.ts';
import { runProgram } from './run-program.ts';

/**
 * The checkout's own launcher (`<checkout>/.hermes/bin/hermes`). `~/.local/bin/hermes` is a wrapper that execs it (before 0.22 it was a symlink to
 * the venv's script), so the wrapper is followed until a launcher that is not a wrapper is found.
 */
function hermesLauncher(): string {
  let launcher = fs.realpathSync(execFileSync('which', ['hermes'], { encoding: 'utf8' }).trim());
  for (let hop = 0; hop < 3; hop++) {
    const next = /^exec (\/\S+\/hermes) "\$@"$/m.exec(fs.readFileSync(launcher, 'utf8'))?.[1];
    if (next === undefined) break;
    launcher = fs.realpathSync(next);
  }
  return launcher;
}

/**
 * Python for a script that imports Hermes's own packages (`hermes_state`, `gateway`) and so needs their dependencies, run as `<it> -c <script>` with
 * `HERMES_HOME` set. Hermes picks those dependencies at boot, from the data root's committed environment (the launcher's own Python is a bare one that
 * only does that), and a venv's `python` run under another root is sent back through the launcher's mechanism and loses them. So this is a script that
 * does what the launcher does (`pm.environments.activate_dependencies`) and then runs the `-c` code: the test home gets the environment of the shared
 * root it links (see `hermes-installs.ts`), the same one its Hermes runs on.
 */
export function hermesPython(): string {
  const bare = /^exec (\/\S+python\S*) /m.exec(fs.readFileSync(hermesLauncher(), 'utf8'))?.[1];
  if (bare === undefined) throw new Error(`Cannot find the Python that ${hermesLauncher()} runs`);
  const boot = [
    'import sys',
    'root, code = sys.argv[1], sys.argv[3]',
    'sys.path.insert(0, root)',
    'from pathlib import Path',
    'from pm.environments import activate_dependencies',
    'activate_dependencies(Path(root))',
    'sys.argv = ["-c"] + sys.argv[4:]',
    'exec(compile(code, "<string>", "exec"), {"__name__": "__main__"})',
  ].join('\n');
  const script = `#!/bin/sh\nexec '${bare}' -I -c '${boot}' '${hermesSourceRoot()}' "$@"\n`;
  const file = path.join(SHARED_ROOT, 'hermes-python');
  // Written beside the shared root once, and again only when it differs (another test process may be doing the same; the rename is atomic).
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== script) {
    fs.mkdirSync(SHARED_ROOT, { recursive: true });
    const staging = `${file}.${process.pid}`;
    fs.writeFileSync(staging, script, { mode: 0o755 });
    fs.renameSync(staging, file);
  }
  return file;
}

/** The directory of the installed Hermes's own Python packages (`hermes_state`, `gateway`), for a script that imports them. */
export function hermesSourceRoot(): string {
  return path.join(path.dirname(hermesLauncher()), '..', '..');
}

export interface SeedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** An assistant row that calls tools (`{ id, type: 'function', function: { name, arguments } }`), as the agent stores it. */
  tool_calls?: unknown[];
  /** A tool row: the call it answers. */
  tool_call_id?: string;
  tool_name?: string;
  /** An assistant row's reasoning. */
  reasoning?: string;
  /** What Hermes types a user row that is not something the owner wrote as such (`steer`: a mid-turn steer, which is also how a denial with a reason is delivered). */
  display_kind?: string;
}

/** Creates the session `id` in the home's default profile with `messages` (oldest first); returns the row ids in the same order. */
export async function seedSession(home: string, id: string, messages: readonly SeedMessage[], options: { title?: string; source?: string } = {}): Promise<number[]> {
  const python = hermesPython();
  const root = hermesSourceRoot();
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(root)})
from hermes_state import SessionDB
db = SessionDB()
sid, rows, options = json.load(sys.stdin)
db.create_session(sid, options.get('source') or 'cli')
db.append_messages_batch(sid, rows)
if options.get('title'):
    db.set_session_title(sid, options['title'])
print(json.dumps([m['id'] for m in db.get_messages(sid)]))
`;
  const out = await runProgram(python, ['-c', script], { input: JSON.stringify([id, messages, options]), env: { ...process.env, HERMES_HOME: home } });
  return JSON.parse(out.trim().split('\n').at(-1)!) as number[];
}

export interface SeedListed {
  id: string;
  /** Where the session came from; `cli` when left out. */
  source?: string;
  title?: string;
  /** How many exchanges (a user message and a reply) it holds; one when left out, none for an empty session. */
  exchanges?: number;
  /** How long ago it started and last spoke, in days (it is made now when left out); an ended session this old is one that a prune can match. */
  daysOld?: number;
  /** Why it ended (`error`, `cli_close`…); it is left open when left out. */
  endReason?: string;
}

/**
 * Puts many sessions into the home's default profile the way other Hermes tools would have, in one Python run (so thousands cost seconds):
 * a row each, with a title, a source, exchanges and an end reason as given. The last one is the newest.
 */
export async function seedSessions(home: string, sessions: readonly SeedListed[]): Promise<void> {
  const python = hermesPython();
  const root = path.join(path.dirname(fs.realpathSync(execFileSync('which', ['hermes'], { encoding: 'utf8' }).trim())), '..', '..');
  const script = `
import json, sqlite3, sys, time
sys.path.insert(0, ${JSON.stringify(root)})
from hermes_state import SessionDB
db = SessionDB()
for spec in json.load(sys.stdin):
    sid = spec['id']
    db.create_session(sid, spec.get('source') or 'cli')
    rows = []
    for n in range(spec.get('exchanges', 1)):
        rows += [{'role': 'user', 'content': f"Question {n + 1} of {sid}"}, {'role': 'assistant', 'content': f"Answer {n + 1} of {sid}"}]
    if rows:
        db.append_messages_batch(sid, rows)
    if spec.get('title'):
        db.set_session_title(sid, spec['title'])
    if spec.get('endReason'):
        db.end_session(sid, spec['endReason'])
    if spec.get('daysOld'):
        then = time.time() - spec['daysOld'] * 86400
        raw = sqlite3.connect(str(db.db_path))
        raw.execute('UPDATE sessions SET started_at = ? WHERE id = ?', (then, sid))
        raw.execute('UPDATE messages SET timestamp = ? WHERE session_id = ?', (then, sid))
        if spec.get('endReason'):
            raw.execute('UPDATE sessions SET ended_at = ? WHERE id = ?', (then + 60, sid))
        raw.commit()
        raw.close()
`;
  await runProgram(python, ['-c', script], { input: JSON.stringify(sessions), env: { ...process.env, HERMES_HOME: home } });
}

export interface SeedUsage {
  id: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  /** What Hermes estimated the run cost, in US dollars; none when left out. */
  estimatedCost?: number;
  /** What the provider billed, in US dollars; none when left out. */
  actualCost?: number;
  /** How long ago the session started, in days; now when left out. */
  daysOld?: number;
}

/** Records model usage in the home's default profile the way a run does (Hermes's own `update_token_counts`), one session per row. */
export function seedUsage(home: string, rows: readonly SeedUsage[]): void {
  const script = `
import json, sqlite3, sys, time
sys.path.insert(0, ${JSON.stringify(hermesSourceRoot())})
from hermes_state import SessionDB
db = SessionDB()
for spec in json.load(sys.stdin):
    sid = spec['id']
    db.create_session(sid, 'cli', model=spec['model'])
    db.update_token_counts(sid, input_tokens=spec['inputTokens'], output_tokens=spec['outputTokens'], model=spec['model'], billing_provider=spec['provider'],
                           estimated_cost_usd=spec.get('estimatedCost'), actual_cost_usd=spec.get('actualCost'), api_call_count=spec['apiCalls'])
    db.flush_token_counts()
    if spec.get('daysOld'):
        raw = sqlite3.connect(str(db.db_path))
        raw.execute('UPDATE sessions SET started_at = ? WHERE id = ?', (time.time() - spec['daysOld'] * 86400, sid))
        raw.commit()
        raw.close()
`;
  execFileSync(hermesPython(), ['-c', script], { input: JSON.stringify(rows), env: { ...process.env, HERMES_HOME: home }, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
}

export interface SeedWorkerRow {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** An assistant row's tool calls, as Hermes stores them (OpenAI shape). */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  /** Seconds after the session's start. */
  at: number;
  token_count?: number;
  reasoning?: string;
}

export interface SeedWorker {
  id: string;
  /** The directory the worker ran in (a task's workspace). */
  cwd: string;
  /** Unix seconds; the session starts, and its rows are stamped, from here. */
  startedAt: number;
  endedAt?: number;
  rows: readonly SeedWorkerRow[];
  /** What Hermes recorded for the session as a whole. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

/**
 * Puts a Kanban worker's session into the home's default profile the way a dispatched worker leaves one (source `kanban`, its working
 * directory, a first user message `work kanban task <id>`): written by Hermes's own `SessionDB`, so Hermes serves it and nothing in
 * Caduceus knows it.
 */
export async function seedWorkerSession(home: string, worker: SeedWorker): Promise<void> {
  const python = hermesPython();
  const root = hermesSourceRoot();
  const script = `
import json, sqlite3, sys
sys.path.insert(0, ${JSON.stringify(root)})
from hermes_state import SessionDB
db = SessionDB()
spec = json.load(sys.stdin)
sid = spec['id']
db.create_session(sid, 'kanban', cwd=spec['cwd'], model='stub-model')
rows = []
for row in spec['rows']:
    made = {k: v for k, v in row.items() if k != 'at'}
    made['timestamp'] = spec['startedAt'] + row['at']
    rows.append(made)
db.append_messages_batch(sid, rows)
usage = spec.get('usage')
if usage:
    db.update_token_counts(sid, input_tokens=usage['inputTokens'], output_tokens=usage['outputTokens'], estimated_cost_usd=usage.get('costUsd'), model='stub-model')
db.flush_token_counts()
raw = sqlite3.connect(str(db.db_path))
raw.execute('UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?', (spec['startedAt'], spec.get('endedAt'), sid))
raw.commit()
raw.close()
`;
  await runProgram(python, ['-c', script], { input: JSON.stringify(worker), env: { ...process.env, HERMES_HOME: home } });
}

/** Appends messages to the session `id` the way another process writing to Hermes's store would (a CLI, the messaging gateway); returns the new row ids. */
export async function appendToSession(home: string, id: string, messages: readonly SeedMessage[]): Promise<number[]> {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(hermesSourceRoot())})
from hermes_state import SessionDB
db = SessionDB()
sid, rows = json.load(sys.stdin)
before = {m['id'] for m in db.get_messages(sid)}
db.append_messages_batch(sid, rows)
print(json.dumps([m['id'] for m in db.get_messages(sid) if m['id'] not in before]))
`;
  const out = await runProgram(hermesPython(), ['-c', script], { input: JSON.stringify([id, messages]), env: { ...process.env, HERMES_HOME: home } });
  return JSON.parse(out.trim().split('\n').at(-1)!) as number[];
}

/**
 * Puts a chain of sessions into the home's default profile the way a messaging gateway leaves one: each segment ends by compression and the next
 * carries on from it (`parent_session_id`), each with an exchange of its own (`Question n of <id>` / `Answer n of <id>`). `source` is `telegram` when left out.
 */
export async function seedLineage(home: string, ids: readonly string[], source = 'telegram'): Promise<void> {
  const script = `
import json, sys, time
sys.path.insert(0, ${JSON.stringify(hermesSourceRoot())})
from hermes_state import SessionDB
db = SessionDB()
ids, source = json.load(sys.stdin)
previous = None
for n, sid in enumerate(ids):
    if previous is not None:
        db.end_session(previous, 'compression')
        time.sleep(0.02)
    db.create_session(sid, source, **({'parent_session_id': previous} if previous else {}))
    db.append_messages_batch(sid, [{'role': 'user', 'content': f'Question {n + 1} of {sid}'}, {'role': 'assistant', 'content': f'Answer {n + 1} of {sid}'}])
    db.set_session_title(sid, f'Segment {n + 1}')
    previous = sid
`;
  await runProgram(hermesPython(), ['-c', script], { input: JSON.stringify([ids, source]), env: { ...process.env, HERMES_HOME: home } });
}
