// Shared helper for tests that need a real Hermes to have a model provider without a real LLM: a local OpenAI-compatible
// server (the one a test points a throwaway HERMES_HOME's profile at) that records every request it receives, answers the
// model list, and streams chat completions: a scripted reply (`nextReply`) or a default one. A test that asserts `requests`
// holds no `/chat/completions` has proved that no prompt was sent.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { TestHermes } from './real-hermes.ts';

/** What the stub streams for one chat completion. */
export interface ReplyScript {
  /** The reply, one streamed chunk (one `delta.content`) each. */
  chunks: readonly string[];
  /** Stops after this many chunks (each, if there are several) and waits for `resume()` (or for the client to hang up), so that a test holds a turn open mid-reply. */
  pauseAfter?: number | readonly number[];
  /** The model's reasoning, one streamed chunk (one `delta.reasoning_content`) each, sent before the reply. */
  reasoning?: readonly string[];
  /** Tool calls the model makes after its reply text (the completion then ends with `finish_reason: tool_calls`, and Hermes runs the tools and asks for the next completion, which a test scripts too). */
  toolCalls?: readonly { id: string; name: string; arguments: Record<string, unknown> }[];
  /** The token counts the completion reports (`usage`); `{ prompt: 20, completion: 10 }` when not given. */
  usage?: { prompt: number; completion: number };
  /** The completion is refused instead of streamed: the provider's error, as an HTTP status and message (a 400 is one Hermes does not retry). `chunks` is not used. */
  fail?: { status: number; message: string };
}

/** A scripted reply as the test sees it: what the stub has done with it so far, and the way to let it go on. */
export interface ScriptedReply {
  /** Resolves once the stub has sent every chunk before the first pause and is waiting (when the reply is done, for a reply with no pause). */
  readonly paused: Promise<void>;
  /** Resolves once the stub has sent `chunks` chunks and is waiting, for a reply that pauses after that many. */
  reached(chunks: number): Promise<void>;
  /** Lets a paused reply send on, to its next pause or its end. */
  resume(): void;
  /** Resolves when the client hangs up on this reply: Hermes stopped waiting for it (a stopped turn). */
  readonly hungUp: Promise<void>;
}

export interface StubLlm {
  /** The `/v1` base URL of the server, as an OpenAI client takes it. */
  baseUrl: string;
  /** Every request received so far, in order, as `METHOD /path`. */
  readonly requests: readonly string[];
  /** The JSON body of every streamed chat completion received so far, in order (the title generator's calls are not among them). */
  readonly completions: readonly { model: string; reasoning_effort?: string; tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[];
  /** The JSON body of every completion that was not streamed (Hermes asking a model for a title), in order. */
  readonly titleRequests: readonly { model: string; messages: { role: string; content: unknown }[] }[];
  /** Scripts the title the next such completion answers with (or, with `fail`, the provider's refusal of it: an HTTP status and message); the others answer `STUB_TITLE`. */
  nextTitle(title: string | { fail: { status: number; message: string } }): void;
  /** Scripts the next streamed chat completion; completions not scripted stream `DEFAULT_REPLY`. */
  nextReply(script: ReplyScript): ScriptedReply;
  /** Points a profile of `hermes` (the default one unless `profile` names another, which must exist) at this server as its custom provider, through Hermes's own `config set`. */
  connect(hermes: TestHermes, profile?: string): Promise<void>;
  close(): Promise<void>;
}

/** What the stub says when a test has scripted nothing. */
export const DEFAULT_REPLY: readonly string[] = ['Hello ', 'from ', 'the ', 'stub ', 'model.'];

/** The models the stub lists: the first is the one `connect` makes the profile's default; a test can switch to another. */
export const STUB_MODELS = ['stub-model', 'stub-model-large'] as const;

/** The title the stub gives a conversation when Hermes asks a model for one (a completion that is not streamed). */
export const STUB_TITLE = 'Stub conversation';

interface Pending {
  script: ReplyScript;
  /** Where the reply pauses, in chunks sent. */
  pauses: number[];
  /** Resolved when the stub reaches each pause (or, for the key `-1`, the end of the reply). */
  reached: Map<number, PromiseWithResolvers<void>>;
  hungUp: PromiseWithResolvers<void>;
  /** The release of the pause the stub is in now. */
  released: PromiseWithResolvers<void>;
}

const chunkFrame = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'stub-completion', object: 'chat.completion.chunk', created: 0, model: 'stub-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

async function readBody(req: http.IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

export async function startStubLlm(): Promise<StubLlm> {
  const requests: string[] = [];
  const completions: StubLlm['completions'][number][] = [];
  const scripts: Pending[] = [];
  const titleRequests: StubLlm['titleRequests'][number][] = [];
  const titles: (string | { fail: { status: number; message: string } })[] = [];

  async function stream(req: http.IncomingMessage, res: http.ServerResponse, pending: Pending | undefined) {
    const chunks = pending?.script.chunks ?? DEFAULT_REPLY;
    if (pending?.script.fail) {
      const { status, message } = pending.script.fail;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message, type: 'invalid_request_error', code: null } }));
      pending.reached.get(-1)?.resolve();
      return;
    }
    let hungUp = false;
    res.on('close', () => {
      if (res.writableFinished) return;
      hungUp = true;
      pending?.hungUp.resolve();
      pending?.released.resolve();
    });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(chunkFrame({ role: 'assistant', content: '' }));
    for (const part of pending?.script.reasoning ?? []) {
      res.write(chunkFrame({ reasoning_content: part }));
      await nextTurn();
    }
    for (const [index, chunk] of chunks.entries()) {
      if (pending?.pauses.includes(index)) {
        pending.reached.get(index)?.resolve();
        await pending.released.promise;
        pending.released = Promise.withResolvers<void>();
      }
      if (hungUp) return;
      res.write(chunkFrame({ content: chunk }));
      // One event-loop turn per chunk, so that Hermes sees them as separate deltas rather than one read.
      await nextTurn();
    }
    pending?.reached.get(-1)?.resolve();
    if (hungUp) return;
    const calls = pending?.script.toolCalls ?? [];
    for (const [index, call] of calls.entries()) {
      res.write(chunkFrame({ tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }));
      await nextTurn();
    }
    res.write(chunkFrame({}, calls.length > 0 ? 'tool_calls' : 'stop'));
    const usage = pending?.script.usage ?? { prompt: 20, completion: 10 };
    res.write(`data: ${JSON.stringify({ id: 'stub-completion', object: 'chat.completion.chunk', created: 0, model: 'stub-model', choices: [], usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion } })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }

  const server = http.createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ object: 'list', data: STUB_MODELS.map((id) => ({ id, object: 'model', owned_by: 'stub' })) }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = JSON.parse(await readBody(req));
      if (body.stream) {
        completions.push(body);
        await stream(req, res, scripts.shift());
        return;
      }
      // Hermes asks a model for a conversation's title with a plain completion.
      titleRequests.push(body);
      res.setHeader('content-type', 'application/json');
      const scripted = titles.shift() ?? STUB_TITLE;
      if (typeof scripted !== 'string') {
        res.statusCode = scripted.fail.status;
        res.end(JSON.stringify({ error: { message: scripted.fail.message, type: 'invalid_request_error', code: null } }));
        return;
      }
      res.end(JSON.stringify({ id: 'stub-title', object: 'chat.completion', created: 0, model: 'stub-model', choices: [{ index: 0, message: { role: 'assistant', content: scripted }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: `the stub LLM answers the model list and chat completions, not ${req.method} ${req.url}` } }));
  });
  const { promise: listening, resolve } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', resolve);
  await listening;
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return {
    baseUrl,
    requests,
    completions,
    titleRequests,
    nextTitle: (title) => void titles.push(title),
    nextReply(script) {
      const pauses = [script.pauseAfter ?? []].flat();
      const pending: Pending = { script, pauses, reached: new Map([...pauses, -1].map((at) => [at, Promise.withResolvers<void>()])), hungUp: Promise.withResolvers<void>(), released: Promise.withResolvers<void>() };
      scripts.push(pending);
      const reached = (chunks: number) => pending.reached.get(chunks)?.promise ?? Promise.reject(new Error(`the reply does not pause after ${chunks} chunks`));
      return { paused: reached(pauses[0] ?? -1), reached, resume: () => pending.released.resolve(), hungUp: pending.hungUp.promise };
    },
    async connect(hermes, profile) {
      for (const [key, value] of [
        ['model.provider', 'custom'],
        ['model.default', 'stub-model'],
        ['model.base_url', baseUrl],
        ['model.api_key', 'stub-key'],
      ]) {
        await hermes.cli(...(profile ? ['-p', profile] : []), 'config', 'set', key, value);
      }
    },
    async close() {
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      server.close(() => onClosed());
      server.closeAllConnections();
      await closed;
    },
  };
}
