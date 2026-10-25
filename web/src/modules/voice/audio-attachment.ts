// A raw audio message (M7 #07), free of the DOM and of React: a recording is attached to a message as a file (`file.attach`, as a data URL), so what
// the message says of it is the line the page writes for any file (`[User attached file: <path>]`). The transcript recognises a recording by its
// extension and plays it by reading the file back from Hermes. This module names recordings, tells audio from other files, and reads one back.
import { fromDataUrl } from './voice-api.ts';

/** The types a recording or an audio file is played as, by extension. Hermes types a `.webm` as video, so the page types them itself. */
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** Whether a message's attached file is audio to play. Only a recording this page made (`voice-message-…`) counts when it could as well be video (`.webm`, `.mp4`). */
export function isAudioName(name: string): boolean {
  const extension = extensionOf(name);
  if (!(extension in AUDIO_TYPES)) return false;
  return extension === 'webm' || extension === 'mp4' ? name.startsWith('voice-message-') : true;
}

/** The type audio of this name is played as. */
export function audioTypeOf(name: string): string | undefined {
  return AUDIO_TYPES[extensionOf(name)];
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The name a recording is attached under: `voice-message-2026-10-19-0930.webm`, with the extension its recorder's type needs. */
export function recordingName(mime: string, at: Date): string {
  const type = mime.split(';')[0]!.trim().toLowerCase();
  const extension = type === 'audio/mp4' || type === 'audio/x-m4a' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : type === 'audio/wav' ? 'wav' : type === 'audio/mpeg' ? 'mp3' : 'webm';
  return `voice-message-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.${extension}`;
}

/** Reads a file of Hermes's as a data URL (`GET /api/fs/read-data-url`, through the proxy's file guard); undefined when it cannot be read. */
export type ReadDataUrl = (route: string) => Promise<string | undefined>;

/** The recording at a path in Hermes, as a blob of its audio type; undefined when it is gone, too large or refused. */
export async function audioBlobAt(path: string, read: ReadDataUrl): Promise<Blob | undefined> {
  const dataUrl = await read(`/api/fs/read-data-url?path=${encodeURIComponent(path)}`);
  if (dataUrl === undefined) return undefined;
  const type = audioTypeOf(path);
  if (type === undefined || !/^data:[^,]*;base64,/.test(dataUrl)) return undefined;
  return new Blob([fromDataUrl(dataUrl)], { type });
}
