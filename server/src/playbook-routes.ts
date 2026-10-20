// Running a playbook, and reading runs (M6 #02): `POST /_caduceus/api/work/playbooks/:id/runs` starts one (a T1 the owner confirms, naming the
// playbook and the profiles it will assign), and `GET /_caduceus/api/work/playbook-runs` lists runs and shows one with its timeline. A run is read
// from Hermes Kanban each time (`playbook-engine.ts`); Caduceus holds nothing about it.
import type { Hono } from 'hono';
import { ID_PATTERN } from '@caduceus/contracts/playbooks';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import { StartRefused, type PlaybookEngine } from './playbook-engine.ts';
import type { PlaybookLibrary } from './playbooks.ts';
import { gateRequest } from './policy-gate.ts';
import type { RestPolicy } from './policy.ts';

const MAX_BODY = 200_000;
const BOARD = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ROOT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface PlaybookRunRoutesDeps {
  engine: PlaybookEngine;
  library: PlaybookLibrary;
  policy: RestPolicy;
  /** Told when a task was made, so the pages watching a board load it again. */
  onWrite(): void;
}

export function mountPlaybookRuns(app: Hono<AuthEnv>, { engine, library, policy, onWrite }: PlaybookRunRoutesDeps): void {
  app.post('/_caduceus/api/work/playbooks/:id/runs', async (c) => {
    const gated = await gateRequest(policy, c, 'POST', MAX_BODY);
    if ('refusal' in gated) return gated.refusal;
    const id = c.req.param('id');
    const body = gated.body;
    if (!ID_PATTERN.test(id) || !isRecord(body)) return c.json({ error: 'bad-request' }, 400);
    const inputs = body.inputs === undefined ? {} : body.inputs;
    if (!isRecord(inputs) || !Object.values(inputs).every((value) => typeof value === 'string')) return c.json({ error: 'bad-request', problems: ['inputs must be text answers, by question.'] }, 400);
    const board = body.board === undefined ? undefined : body.board;
    if (board !== undefined && (typeof board !== 'string' || !BOARD.test(board))) return c.json({ error: 'bad-request', problems: ['board must be the name of a board.'] }, 400);
    const profile = body.profile === undefined ? undefined : body.profile;
    if (profile !== undefined && (typeof profile !== 'string' || !PROFILE.test(profile))) return c.json({ error: 'bad-request', problems: ['profile must be the name of a profile.'] }, 400);
    const version = body.version === undefined ? library.current(id)?.version : body.version;
    const playbook = typeof version === 'number' ? library.get(id, version) : undefined;
    if (playbook === undefined) return c.json({ error: 'not-found' }, 404);
    try {
      const started = await engine.start(playbook, inputs as Record<string, string>, { board, profile });
      onWrite();
      return c.json({ ...started, ref: `${playbook.id}@${playbook.version}` }, 201);
    } catch (error) {
      if (error instanceof StartRefused) return c.json({ error: 'bad-request', problems: error.problems }, 400);
      throw error;
    }
  });

  // Re-run from a stage: a new attempt of it, with the stages that are done left as they are. The owner confirms (T1).
  app.post('/_caduceus/api/work/playbook-runs/:root/rerun', async (c) => {
    const gated = await gateRequest(policy, c, 'POST', MAX_BODY);
    if ('refusal' in gated) return gated.refusal;
    const board = c.req.query('board') ?? 'default';
    const root = c.req.param('root');
    const body = gated.body;
    if (!BOARD.test(board) || !ROOT.test(root) || !isRecord(body) || typeof body.stage !== 'string') return c.json({ error: 'bad-request' }, 400);
    try {
      const made = await engine.rerun(board, root, body.stage);
      onWrite();
      return c.json(made, 201);
    } catch (error) {
      if (error instanceof StartRefused) return c.json({ error: 'bad-request', problems: error.problems }, 400);
      throw error;
    }
  });

  app.get('/_caduceus/api/work/playbook-runs', async (c) => {
    try {
      return c.json({ runs: await engine.runs() });
    } catch {
      return c.json({ error: 'hermes-unavailable', message: 'Caduceus could not read the boards from Hermes.' }, 502);
    }
  });

  app.get('/_caduceus/api/work/playbook-runs/:root', async (c) => {
    const board = c.req.query('board') ?? 'default';
    const root = c.req.param('root');
    if (!BOARD.test(board) || !ROOT.test(root)) return c.json({ error: 'bad-request' }, 400);
    try {
      const run = await engine.run(board, root);
      return run ? c.json({ run }) : c.json({ error: 'not-found' }, 404);
    } catch {
      return c.json({ error: 'hermes-unavailable', message: 'Caduceus could not read the board from Hermes.' }, 502);
    }
  });
}
