import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { createAuditLog, type AuditLog } from '../src/audit-log.ts';
import { openCaduceusStore, type CaduceusStore } from '../src/caduceus-store.ts';
import { createConfirmations, type Confirmations } from '../src/confirmations.ts';
import { createGatewayPolicy, type GatewayConnection, type GatewayFrames, type GatewayPolicy } from '../src/gateway-policy.ts';

// The gateway frame policy is the hook the browser WebSocket proxy (M0 #09) calls for every frame in both directions.
// It is a domain module at its exported functions: the boundaries it leans on (the owner's step-up, the clock, the
// exec-quick-command lookup in Hermes's config) are the test's to set.
let dir: string;
let store: CaduceusStore;
let clock: { now: number };
let confirmations: Confirmations;
let state: { readOnly: boolean; stepUp: boolean; execQuickCommands: string[]; lookups: number; lookupFails: boolean };
let policy: GatewayPolicy;
let audit: AuditLog;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-gateway-policy-'));
  store = openCaduceusStore(dir);
  clock = { now: Date.parse('2026-10-07T09:00:00.000Z') };
  audit = createAuditLog(store, () => clock.now);
  confirmations = createConfirmations(() => clock.now);
  state = { readOnly: false, stepUp: false, execQuickCommands: [], lookups: 0, lookupFails: false };
  policy = createGatewayPolicy({
    audit,
    confirmations,
    readOnly: { enabled: () => state.readOnly },
    hasStepUp: () => state.stepUp,
    async execQuickCommands() {
      state.lookups++;
      if (state.lookupFails) throw new Error('Hermes did not answer');
      return new Set(state.execQuickCommands);
    },
  });
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const connection: GatewayConnection = { sessionId: 'owner-session', source: 'local' };

/** One frame, as the browser sends it. */
const request = (id: number | string, method: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params, ...extra });

/** What the policy did with a frame from the browser: where it went, and what the browser was told. */
async function fromBrowser(frames: GatewayFrames, text: string) {
  const verdict = await frames.fromBrowser(text);
  return {
    forwarded: verdict.forward === undefined ? undefined : JSON.parse(verdict.forward),
    answer: verdict.reply === undefined ? undefined : JSON.parse(verdict.reply),
  };
}

/** A server→client request, as Hermes sends it. */
const serverRequest = (id: string, method: string, params: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params: { session_id: 's', ...params } });

describe('frames from the browser', () => {
  test('forwards an allowed call untouched, and answers a denied one with an error the UI can show, without forwarding it', async () => {
    const frames = policy.connect(connection);
    const allowed = request(1, 'session.list', { limit: 5 });

    const forwardedAsIs = await frames.fromBrowser(allowed);
    const denied = await fromBrowser(frames, request(2, 'shell.exec', { command: 'ls' }));
    const unknown = await fromBrowser(frames, request(3, 'shiny.new_method'));
    const notification = await fromBrowser(frames, JSON.stringify({ jsonrpc: '2.0', method: 'vault.unlock', params: {} }));

    // Byte for byte: nothing is re-serialised that does not have to be.
    expect(forwardedAsIs).toEqual({ forward: allowed });
    expect(denied.forwarded).toBeUndefined();
    expect(denied.answer).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32001,
        message: 'Running shell commands through Caduceus is not allowed. Shell access is the terminal, behind a passkey.',
        data: {
          error: 'denied',
          tier: 'denied',
          operation: 'rpc shell.exec',
          reason: 'shell-exec',
          message: 'Running shell commands through Caduceus is not allowed. Shell access is the terminal, behind a passkey.',
        },
      },
    });
    expect(unknown.answer).toMatchObject({ id: 3, error: { data: { error: 'denied', reason: 'unclassified' } } });
    // A notification has no id to answer: the browser is told with a notification of its own.
    expect(notification.forwarded).toBeUndefined();
    expect(notification.answer).toMatchObject({ jsonrpc: '2.0', method: 'caduceus.refused', params: { error: 'denied', reason: 'vault', operation: 'rpc vault.unlock' } });
    expect(audit.list(10).map((e) => [e.action, e.target, e.tier])).toEqual([
      ['policy.denied', 'rpc vault.unlock', 'denied'],
      ['policy.denied', 'rpc shiny.new_method', 'denied'],
      ['policy.denied', 'rpc shell.exec', 'denied'],
    ]);
  });

  test('refuses a frame that is not one JSON-RPC request object', async () => {
    const frames = policy.connect(connection);

    const answers = [
      await fromBrowser(frames, 'not json'),
      await fromBrowser(frames, '[{"jsonrpc":"2.0","id":1,"method":"ping"}]'),
      await fromBrowser(frames, '42'),
      await fromBrowser(frames, '{"jsonrpc":"2.0","id":7}'),
      await fromBrowser(frames, '{"jsonrpc":"2.0","id":8,"method":42}'),
    ];

    expect(answers.map((a) => a.forwarded)).toEqual(Array(5).fill(undefined));
    expect(answers.map((a) => a.answer.error.data.reason)).toEqual(Array(5).fill('bad-frame'));
    expect(answers.map((a) => a.answer.id)).toEqual([null, null, null, 7, 8]);
  });

  test('lets only reads through in read-only mode, at every tier, and asks for no step-up for what cannot happen', async () => {
    const frames = policy.connect(connection);
    state.readOnly = true;

    const sent = [
      await fromBrowser(frames, request(1, 'session.list')),
      await fromBrowser(frames, request(2, 'prompt.submit', { session_id: 's', text: 'hi' })),
      await fromBrowser(frames, request(3, 'process.stop')),
      await fromBrowser(frames, request(4, 'rollback.restore', { session_id: 's', hash: 'h' })),
      await fromBrowser(frames, request(5, 'config.get', { key: 'model' })),
    ];

    expect(sent.map((s) => (s.forwarded ? 'forwarded' : s.answer.error.data.error))).toEqual(['forwarded', 'read-only', 'read-only', 'read-only', 'forwarded']);
    expect(sent[1].answer.error.data).toMatchObject({ tier: 'T0', operation: 'rpc prompt.submit', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
  });

  test('asks for a step-up before a T2 call, using the connection’s live grant', async () => {
    const frames = policy.connect(connection);

    const without = await fromBrowser(frames, request(1, 'process.stop'));
    state.stepUp = true;
    const withGrant = await fromBrowser(frames, request(2, 'process.stop'));
    // A one-off approval needs none; "always" does.
    state.stepUp = false;
    const once = await fromBrowser(frames, request(3, 'approval.respond', { session_id: 's', choice: 'once' }));
    const always = await fromBrowser(frames, request(4, 'approval.respond', { session_id: 's', choice: 'always' }));

    expect(without.answer.error).toMatchObject({ data: { error: 'step-up-required', tier: 'T2', operation: 'rpc process.stop' } });
    expect(withGrant.forwarded).toMatchObject({ method: 'process.stop' });
    expect(once.forwarded).toMatchObject({ method: 'approval.respond' });
    expect(always.answer.error.data).toMatchObject({ error: 'step-up-required', tier: 'T2' });
  });

  test('in read-only mode lets the owner deny an approval, by call or by answer, and nothing else about it; YOLO is only ever switched off without a step-up', async () => {
    const frames = policy.connect(connection);
    frames.fromHermes(serverRequest('srq-1', 'approval'));
    frames.fromHermes(serverRequest('srq-2', 'approval'));
    state.readOnly = true;
    const answer = (id: string, result: Record<string, unknown>) => fromBrowser(frames, JSON.stringify({ jsonrpc: '2.0', id, result }));

    const denyCall = await fromBrowser(frames, request(1, 'approval.respond', { session_id: 's', choice: 'deny', request_id: 'r1' }));
    const denyAnswer = await answer('srq-1', { choice: 'deny' });
    const onceCall = await fromBrowser(frames, request(2, 'approval.respond', { session_id: 's', choice: 'once', request_id: 'r2' }));
    const onceAnswer = await answer('srq-2', { choice: 'once' });
    const viaRequestAnswer = await fromBrowser(frames, request(3, 'request.answer', { id: 'srq-2', result: { choice: 'deny' } }));
    const yoloOn = await fromBrowser(frames, request(4, 'config.set', { key: 'yolo', value: 'on', session_id: 's' }));
    state.readOnly = false;
    const yoloOnly = await fromBrowser(frames, request(5, 'config.set', { key: 'yolo', value: 'on', session_id: 's' }));
    const yoloOff = await fromBrowser(frames, request(6, 'config.set', { key: 'yolo', value: 'off', session_id: 's' }));
    const yoloToggle = await fromBrowser(frames, request(7, 'config.set', { key: 'yolo', session_id: 's' }));

    expect(denyCall.forwarded).toMatchObject({ method: 'approval.respond' });
    expect(denyAnswer.forwarded).toMatchObject({ id: 'srq-1' });
    expect(viaRequestAnswer.forwarded).toMatchObject({ method: 'request.answer' });
    expect(onceCall.answer.error.data).toMatchObject({ error: 'read-only' });
    expect(onceAnswer.answer.params).toMatchObject({ error: 'read-only' });
    expect(yoloOn.answer.error.data).toMatchObject({ error: 'read-only' });
    expect(yoloOnly.answer.error.data).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(yoloOff.forwarded).toMatchObject({ method: 'config.set' });
    expect(yoloToggle.answer.error.data).toMatchObject({ error: 'step-up-required', tier: 'T2' });
  });

  test('needs a typed confirmation for a T3 call, carried beside the call and stripped before Hermes sees it', async () => {
    const frames = policy.connect(connection);
    state.stepUp = true;
    const target = 'My old chat';
    const mint = () => confirmations.issue({ sessionId: connection.sessionId, operation: 'rpc rollback.restore', target }).token;
    const restore = (confirmation?: string, id = 1) =>
      fromBrowser(frames, request(id, 'rollback.restore', { session_id: 's', hash: 'abc' }, confirmation ? { caduceus: { confirmation } } : {}));

    const none = await restore();
    const token = mint();
    const confirmed = await restore(token, 2);
    const replayed = await restore(token, 3);
    const stale = mint();
    clock.now += 60_000;
    const late = await restore(stale, 4);
    const forOtherCall = await fromBrowser(
      frames,
      request(5, 'session.delete', { session_id: 's' }, { caduceus: { confirmation: mint() } }),
    );

    expect(none.answer.error.data).toMatchObject({ error: 'confirmation-required', tier: 'T3', operation: 'rpc rollback.restore' });
    expect(confirmed.forwarded).toEqual({ jsonrpc: '2.0', id: 2, method: 'rollback.restore', params: { session_id: 's', hash: 'abc' } });
    expect(replayed.answer.error.data.error).toBe('confirmation-invalid');
    expect(late.answer.error.data.error).toBe('confirmation-expired');
    // session.delete is T1, so a confirmation is not needed: it goes through, and a spare token is stripped all the same.
    expect(forOtherCall.forwarded).toEqual({ jsonrpc: '2.0', id: 5, method: 'session.delete', params: { session_id: 's' } });
  });

  test('refuses a T3 call in read-only mode, confirmation or not', async () => {
    const frames = policy.connect(connection);
    state.stepUp = true;
    const token = confirmations.issue({ sessionId: connection.sessionId, operation: 'rpc rollback.restore', target: 'x' }).token;
    state.readOnly = true;

    const answer = await fromBrowser(frames, request(1, 'rollback.restore', { session_id: 's', hash: 'h' }, { caduceus: { confirmation: token } }));

    expect(answer.answer.error.data).toMatchObject({ error: 'read-only', tier: 'T3' });
  });

  test('denies an exec-type quick command by name, however it is run, and asks Hermes’s config only when it must', async () => {
    const frames = policy.connect(connection);
    state.execQuickCommands = ['deploy', 'disk-usage'];

    const dispatch = await fromBrowser(frames, request(1, 'command.dispatch', { name: '/Deploy', session_id: 's' }));
    const slash = await fromBrowser(frames, request(2, 'slash.exec', { command: '  /disk-usage -h', session_id: 's' }));
    const alias = await fromBrowser(frames, request(3, 'command.dispatch', { name: 'retry', session_id: 's' }));
    const lookupsBefore = state.lookups;
    await fromBrowser(frames, request(4, 'session.list'));

    expect(dispatch.answer.error.data).toMatchObject({ error: 'denied', reason: 'exec-quick-command', operation: 'rpc command.dispatch' });
    expect(slash.answer.error.data).toMatchObject({ error: 'denied', reason: 'exec-quick-command', operation: 'rpc slash.exec' });
    expect(alias.forwarded).toMatchObject({ method: 'command.dispatch' });
    expect(lookupsBefore).toBe(3);
    expect(state.lookups).toBe(3);
  });

  test('denies an exec-type quick command named with extra slashes, other case or odd whitespace: Hermes strips them all before it looks the name up', async () => {
    const frames = policy.connect(connection);
    state.execQuickCommands = ['deploy', 'disk-usage', 'queue'];

    const attempts = [
      request(1, 'command.dispatch', { name: '//deploy', session_id: 's' }),
      request(2, 'command.dispatch', { name: '////DEPLOY', session_id: 's' }),
      request(3, 'slash.exec', { command: '//disk-usage -h', session_id: 's' }),
      request(4, 'slash.exec', { command: '\u00a0\u3000//Disk-Usage\u2003-h', session_id: 's' }),
      request(5, 'slash.exec', { command: '/deploy\u0085now', session_id: 's' }),
      // An alias of a built-in resolves to the built-in's name, which a quick command may carry.
      request(6, 'command.dispatch', { name: '//q', session_id: 's' }),
      // A name that still holds a slash or whitespace is refused outright.
      request(7, 'command.dispatch', { name: '/ /deploy', session_id: 's' }),
    ];
    const answers = [];
    for (const attempt of attempts) answers.push(await fromBrowser(frames, attempt));

    expect(answers.map((answer) => [answer.forwarded, answer.answer.error.data.reason])).toEqual([
      [undefined, 'exec-quick-command'],
      [undefined, 'exec-quick-command'],
      [undefined, 'exec-quick-command'],
      [undefined, 'exec-quick-command'],
      [undefined, 'exec-quick-command'],
      [undefined, 'exec-quick-command'],
      [undefined, 'slash-admin'],
    ]);
  });

  test('lets /learn through the slash-command path behind a passkey (T2), and in no way denies it as a shell command', async () => {
    const frames = policy.connect(connection);
    // Hermes's config has an exec-type quick command, as any owner's might: /learn is not one of them.
    state.execQuickCommands = ['deploy'];

    const withoutPasskey = await fromBrowser(frames, request(1, 'command.dispatch', { name: 'learn', arg: 'the release process', session_id: 's' }));
    state.stepUp = true;
    const dispatch = await fromBrowser(frames, request(2, 'command.dispatch', { name: '/Learn', arg: 'the release process', session_id: 's' }));
    const typed = await fromBrowser(frames, request(3, 'slash.exec', { command: '/learn the release process', session_id: 's' }));

    expect(withoutPasskey.answer.error.data).toMatchObject({ error: 'step-up-required', tier: 'T2', operation: 'rpc command.dispatch' });
    expect(dispatch.forwarded).toMatchObject({ method: 'command.dispatch', params: { name: '/Learn', arg: 'the release process' } });
    expect(typed.forwarded).toMatchObject({ method: 'slash.exec' });
    expect(audit.list(10).map((entry: AuditEntry) => [entry.action, entry.tier])).toEqual([['rpc slash.exec', 'T2'], ['rpc command.dispatch', 'T2']]);
  });

  test('denies a slash command it cannot check, rather than run what might be a shell command', async () => {
    const frames = policy.connect(connection);
    state.lookupFails = true;

    const dispatch = await fromBrowser(frames, request(1, 'command.dispatch', { name: 'retry', session_id: 's' }));
    // Only the calls that could run a quick command depend on the lookup.
    const other = await fromBrowser(frames, request(2, 'session.list'));

    expect(dispatch.answer.error.data).toMatchObject({ error: 'denied', reason: 'exec-unverified' });
    expect(other.forwarded).toMatchObject({ method: 'session.list' });
  });

  test('audits every forwarded T1 and higher call with its tier, session and profile, and no T0 call', async () => {
    const frames = policy.connect(connection);
    state.stepUp = true;

    await frames.fromBrowser(request(1, 'prompt.submit', { session_id: 's1', text: 'hi' }));
    await frames.fromBrowser(request(2, 'session.delete', { session_id: 's1', profile: 'coder' }));
    await frames.fromBrowser(request(3, 'process.stop', { profile: 'writer' }));
    clock.now += 1000;
    await frames.fromBrowser(request(4, 'projects.create', { name: 'p' }));

    expect(audit.list(10).map((e: AuditEntry) => [e.action, e.target, e.tier, e.profile])).toEqual([
      ['rpc projects.create', 'gateway', 'T1', undefined],
      ['rpc process.stop', 'gateway', 'T2', 'writer'],
      ['rpc session.delete', 'session:s1', 'T1', 'coder'],
    ]);
  });
});

describe('the composer settings (M1 #08)', () => {
  test('a chat model, reasoning and folder change, and reading usage, are tiered so: Compress, a folder change and a toolset change are T1 and audited, the rest is not', async () => {
    const frames = policy.connect(connection);

    const sent = [
      request(1, 'config.set', { key: 'model', value: 'm --provider p --session', session_id: 's1' }),
      request(2, 'config.set', { key: 'reasoning', value: 'low', session_id: 's1', scope: 'session' }),
      request(3, 'session.usage', { session_id: 's1' }),
      request(4, 'session.context_breakdown', { session_id: 's1' }),
      request(5, 'session.cwd.set', { session_id: 's1', cwd: '/tmp' }),
      request(6, 'tools.configure', { action: 'disable', names: ['todo'], session_id: 's1' }),
      request(7, 'session.compress', { session_id: 's1' }),
    ];
    const verdicts = await Promise.all(sent.map((text) => fromBrowser(frames, text)));

    expect(verdicts.map((verdict) => verdict.forwarded?.method)).toEqual(['config.set', 'config.set', 'session.usage', 'session.context_breakdown', 'session.cwd.set', 'tools.configure', 'session.compress']);
    expect(audit.list(10).map((e: AuditEntry) => [e.action, e.tier]).sort()).toEqual([['rpc session.compress', 'T1'], ['rpc session.cwd.set', 'T1'], ['rpc tools.configure', 'T1']].sort());
  });
});

describe('message actions (M1 #12)', () => {
  test('a prompt that cuts the transcript (edit and resend, regenerate) is T1 and audited; an ordinary prompt, undo, branch and the title are T0', async () => {
    const frames = policy.connect(connection);

    const sent = [
      request(1, 'prompt.submit', { session_id: 's1', text: 'again' }),
      request(2, 'prompt.submit', { session_id: 's1', text: 'edited', truncate_before_row_id: 7, confirm_truncate: true }),
      request(3, 'session.undo', { session_id: 's1' }),
      request(4, 'session.branch', { session_id: 's1' }),
      request(5, 'session.title', { session_id: 's1', title: 'Named' }),
      request(6, 'prompt.submit', { session_id: 's1', text: 'old ordinal', truncate_before_user_ordinal: 2, confirm_truncate: true }),
    ];
    const verdicts = await Promise.all(sent.map((text) => fromBrowser(frames, text)));

    expect(verdicts.map((verdict) => verdict.forwarded?.method)).toEqual(['prompt.submit', 'prompt.submit', 'session.undo', 'session.branch', 'session.title', 'prompt.submit']);
    expect(audit.list(10).map((e: AuditEntry) => [e.action, e.tier])).toEqual([['rpc prompt.submit', 'T1'], ['rpc prompt.submit', 'T1']]);
  });
});

describe('frames from Hermes', () => {
  const event = (type: string, payload: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: 's', payload } });

  test('passes events and results to the browser, drops the events of denied families, and answers a denied server request itself', () => {
    const frames = policy.connect(connection);

    const delta = frames.fromHermes(event('message.delta', { text: 'hi' }));
    const result = frames.fromHermes(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { sessions: [] } }));
    const billing = frames.fromHermes(event('billing.step_up.verification', { url: 'https://x' }));
    const unknownEvent = frames.fromHermes(event('shiny.new_event'));
    const approval = frames.fromHermes(serverRequest('srq-1', 'approval', { command: 'rm -rf x' }));
    const vault = frames.fromHermes(serverRequest('srq-2', 'vault.unlock_prompt'));
    const unknownRequest = frames.fromHermes(serverRequest('srq-3', 'shiny.new_request'));

    expect(delta.forward).toBe(event('message.delta', { text: 'hi' }));
    expect(result.forward).toBeDefined();
    expect([billing.forward, unknownEvent.forward, vault.forward, unknownRequest.forward]).toEqual([undefined, undefined, undefined, undefined]);
    expect(approval.forward).toBeDefined();
    // Hermes is told the request is declined, so the agent does not wait for an answer that cannot come.
    expect(JSON.parse(vault.reply!)).toMatchObject({ jsonrpc: '2.0', id: 'srq-2', error: { code: -32001, data: { error: 'denied', reason: 'vault' } } });
    expect(JSON.parse(unknownRequest.reply!)).toMatchObject({ id: 'srq-3', error: { data: { reason: 'unclassified' } } });
  });

  test('asks a step-up for the answers that hand the agent a secret or a standing permission, and for an answer to a request it never saw', async () => {
    const frames = policy.connect(connection);
    frames.fromHermes(serverRequest('srq-1', 'approval'));
    frames.fromHermes(serverRequest('srq-2', 'secret', { env_var: 'API_KEY' }));
    frames.fromHermes(serverRequest('srq-3', 'clarify', { question: 'which?' }));
    const answer = (id: string, result: Record<string, unknown>) => fromBrowser(frames, JSON.stringify({ jsonrpc: '2.0', id, result }));

    const once = await answer('srq-1', { choice: 'once' });
    const secret = await answer('srq-2', { value: 'sk-live' });
    const clarified = await answer('srq-3', { answer: 'the second' });
    const stranger = await answer('srq-9', { choice: 'once' });
    // `request.answer` is the same answer made as a call, for a client that never received the request.
    frames.fromHermes(serverRequest('srq-4', 'clarify', { question: 'again?' }));
    const viaCallKnown = await fromBrowser(frames, request(10, 'request.answer', { id: 'srq-4', result: { answer: 'the first' } }));
    const viaCallStranger = await fromBrowser(frames, request(11, 'request.answer', { id: 'srq-9', result: { choice: 'once' } }));
    state.stepUp = true;
    const secretWithGrant = await answer('srq-2', { value: 'sk-live' });

    expect(once.forwarded).toMatchObject({ id: 'srq-1' });
    expect(clarified.forwarded).toMatchObject({ id: 'srq-3' });
    expect(secret.answer).toMatchObject({ method: 'caduceus.refused', params: { error: 'step-up-required', tier: 'T2', operation: 'rpc secret' } });
    expect(stranger.answer.params).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(viaCallKnown.forwarded).toMatchObject({ method: 'request.answer' });
    expect(viaCallStranger.answer.error.data).toMatchObject({ error: 'step-up-required', tier: 'T2', operation: 'rpc request.answer' });
    // The answer to the secret was refused, not consumed: it is still open and can be answered once the owner confirms.
    expect(secretWithGrant.forwarded).toMatchObject({ id: 'srq-2' });
  });

  test('answers an approval "always" only behind a step-up, and forgets a request Hermes withdraws', async () => {
    const frames = policy.connect(connection);
    frames.fromHermes(serverRequest('srq-1', 'approval'));
    frames.fromHermes(serverRequest('srq-2', 'approval'));
    frames.fromHermes(event('request.cancel', { id: 'srq-2', method: 'approval', reason: 'timeout' }));
    const answer = (id: string, choice: string) => fromBrowser(frames, JSON.stringify({ jsonrpc: '2.0', id, result: { choice } }));

    const always = await answer('srq-1', 'always');
    const cancelled = await answer('srq-2', 'once');

    expect(always.answer.params).toMatchObject({ error: 'step-up-required', operation: 'rpc approval' });
    // A withdrawn request is one it no longer knows, so answering it is the same as answering a stranger's.
    expect(cancelled.answer.params).toMatchObject({ error: 'step-up-required' });
  });

  test('learns the requests a resumed session still has open from the result that carries them', async () => {
    const frames = policy.connect(connection);
    const resumed = JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      result: { session_id: 's', open_requests: [{ id: 'srq-4', method: 'approval', params: { session_id: 's' } }, { id: 'srq-5', method: 'secret', params: { session_id: 's' } }] },
    });

    const forwarded = frames.fromHermes(resumed).forward;
    const approved = await fromBrowser(frames, JSON.stringify({ jsonrpc: '2.0', id: 'srq-4', result: { choice: 'once' } }));
    const secret = await fromBrowser(frames, JSON.stringify({ jsonrpc: '2.0', id: 'srq-5', result: { value: 'x' } }));

    expect(forwarded).toBe(resumed);
    expect(approved.forwarded).toMatchObject({ id: 'srq-4' });
    expect(secret.answer.params).toMatchObject({ error: 'step-up-required', operation: 'rpc secret' });
  });
});
