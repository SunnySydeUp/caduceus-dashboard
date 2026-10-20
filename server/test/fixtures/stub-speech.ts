// Shared helper for tests that need a real Hermes to transcribe and speak without a real speech service: a local OpenAI-compatible server
// (`/v1/audio/transcriptions` and `/v1/audio/speech`) that a throwaway HERMES_HOME's profile is pointed at (`stt.openai` and `tts.openai`), which
// records what it was asked and answers with a scripted transcript and a short tone.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestHermes } from './real-hermes.ts';

export interface StubSpeech {
  /** The `/v1` base URL of the server, as an OpenAI client takes it. */
  baseUrl: string;
  /** Every request received so far, in order, as `METHOD /path`. */
  readonly requests: readonly string[];
  /** The text of every `/audio/speech` request, in order. */
  readonly spoken: readonly string[];
  /** The size in bytes of the audio each transcription request uploaded, in order. */
  readonly uploaded: readonly number[];
  /** Scripts what the next transcription says (it says `DEFAULT_TRANSCRIPT` when nothing is scripted). */
  nextTranscript(text: string): void;
  /** Points a profile of `hermes` at this server for transcription and speech, through Hermes's own `config set`. */
  connect(hermes: TestHermes, profile?: string): Promise<void>;
  close(): Promise<void>;
}

export const DEFAULT_TRANSCRIPT = 'hello from the stub microphone';

/** A 16-bit mono WAV of a quiet tone: audio any decoder takes. */
export function toneWav(seconds = 0.4, rate = 16_000): Buffer {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

export async function startStubSpeech(): Promise<StubSpeech> {
  const requests: string[] = [];
  const spoken: string[] = [];
  const uploaded: number[] = [];
  const transcripts: string[] = [];
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://stub').pathname;
    requests.push(`${req.method} ${path}`);
    const body = await readBody(req);
    if (req.method === 'POST' && path === '/v1/audio/transcriptions') {
      // The SDK sends multipart; the file's bytes are most of the body.
      uploaded.push(body.length);
      const text = transcripts.shift() ?? DEFAULT_TRANSCRIPT;
      if (body.toString('latin1').includes('name="response_format"\r\n\r\ntext')) {
        res.writeHead(200, { 'content-type': 'text/plain' }).end(text);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text }));
      }
    } else if (req.method === 'POST' && path === '/v1/audio/speech') {
      const { input }: { input: string } = JSON.parse(body.toString('utf8'));
      spoken.push(input);
      res.writeHead(200, { 'content-type': 'audio/wav' }).end(toneWav());
    } else {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'not found' } }));
    }
  });
  const { promise: listening, resolve } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', resolve);
  await listening;
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return {
    baseUrl,
    requests,
    spoken,
    uploaded,
    nextTranscript: (text) => void transcripts.push(text),
    async connect(hermes, profile) {
      for (const [key, value] of [
        ['stt.provider', 'openai'],
        ['stt.openai.api_key', 'stub-key'],
        ['stt.openai.base_url', baseUrl],
        ['tts.provider', 'openai'],
        ['tts.openai.api_key', 'stub-key'],
        ['tts.openai.base_url', baseUrl],
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
