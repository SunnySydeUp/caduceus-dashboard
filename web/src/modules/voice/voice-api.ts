// What the page asks Hermes for voice (M7 #07), through the policy proxy: `/api/audio/transcribe` for speech to text. Hermes's host-side `voice.*`
// gateway methods are never used (they use the Mac's own microphone). Free of the DOM and of React.

/** The page's way to call Caduceus; `fetch` in the browser, the test server's in a test. */
export type Request = (method: string, path: string, body?: unknown) => Promise<Response>;

const browserRequest: Request = (method, path, body) =>
  fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

export interface CallOptions {
  /** The profile whose speech settings Hermes uses; the active one when not given. */
  profile?: string;
  request?: Request;
}

/** A failed call, in Hermes's own words when it gave any. */
async function failure(res: Response, what: string): Promise<Error> {
  const body: unknown = await res.json().catch(() => undefined);
  const detail = typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string' ? body.detail : undefined;
  return new Error(detail ?? `${what} (HTTP ${res.status})`);
}

const withProfile = (route: string, profile: string | undefined) => (profile === undefined ? route : `${route}?profile=${encodeURIComponent(profile)}`);

/** A blob as a `data:` URL, which is how Hermes takes audio. */
export async function toDataUrl(body: Blob): Promise<string> {
  const bytes = new Uint8Array(await body.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${body.type || 'audio/webm'};base64,${btoa(binary)}`;
}

/** The words in a recording, by Hermes's own speech to text. An empty string means it heard no speech. */
export async function transcribe(recording: Blob, { profile, request = browserRequest }: CallOptions = {}): Promise<string> {
  const res = await request('POST', withProfile('/api/audio/transcribe', profile), { data_url: await toDataUrl(recording), mime_type: recording.type || 'audio/webm' });
  if (!res.ok) throw await failure(res, 'Hermes could not transcribe that');
  const body: unknown = await res.json();
  return typeof body === 'object' && body !== null && 'transcript' in body && typeof body.transcript === 'string' ? body.transcript : '';
}

/** A `data:…;base64,` address Hermes answered with, as a blob of its own type. Decoded here: the page's CSP (`connect-src 'self'`) refuses a `fetch` of a data address. */
export function fromDataUrl(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return new Blob([bytes], { type: /^data:([^;,]*)/.exec(dataUrl)?.[1] ?? '' });
}

/** A reply as speech, by the text to speech engine Hermes is set to (`tts.provider`). */
export async function speak(text: string, { profile, request = browserRequest }: CallOptions = {}): Promise<Blob> {
  const res = await request('POST', withProfile('/api/audio/speak', profile), { text });
  if (!res.ok) throw await failure(res, 'Hermes could not speak that');
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || !('data_url' in body) || typeof body.data_url !== 'string') throw new Error('Hermes did not answer with audio.');
  return fromDataUrl(body.data_url);
}

/** What Hermes says about one direction of voice: the engine it uses, how it reaches it (`direct` or `relay`) and, for speech, the voice. */
export interface EngineInfo {
  mode?: string;
  provider?: string;
  model?: string;
  voice?: string;
  language?: string;
  reason?: string;
}

export interface VoiceConfig {
  stt: EngineInfo;
  tts: EngineInfo;
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);

function engineOf(value: unknown): EngineInfo {
  if (typeof value !== 'object' || value === null) return {};
  const row: Record<string, unknown> = { ...value };
  return {
    ...(text(row.mode) && { mode: text(row.mode) }),
    ...(text(row.provider) && { provider: text(row.provider) }),
    ...(text(row.model) && { model: text(row.model) }),
    ...(text(row.voice) && { voice: text(row.voice) }),
    ...(text(row.language) && { language: text(row.language) }),
    ...(text(row.reason) && { reason: text(row.reason) }),
  };
}

/** Hermes's speech to text and text to speech engines for the profile (`GET /api/audio/voice-config`; Caduceus drops the keys it carries). */
export async function readVoiceConfig({ profile, request = browserRequest }: CallOptions = {}): Promise<VoiceConfig> {
  const res = await request('GET', withProfile('/api/audio/voice-config', profile));
  if (!res.ok) throw await failure(res, 'Hermes did not say how it does voice');
  const body: unknown = await res.json();
  const row: Record<string, unknown> = typeof body === 'object' && body !== null ? { ...body } : {};
  return { stt: engineOf(row.stt), tts: engineOf(row.tts) };
}
