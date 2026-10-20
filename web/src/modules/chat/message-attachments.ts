// What a sent message says about what was attached to it (M1 #10), free of the DOM and of React. Hermes keeps an image in the message as an
// `@image:<path>` line after the words (a path with a space or a bracket in quotes), and the page writes a file as `[User attached file: <path>]`.
// The transcript draws them as thumbnails and chips; this reads them from the end of the text.
import { isAudioName } from '../voice/audio-attachment.ts';

export interface MessageAttachment {
  kind: 'image' | 'audio' | 'file';
  path: string;
  name: string;
}

const IMAGE_LINE = /^@image:(?:`([^`]+)`|"([^"]+)"|'([^']+)'|(\S+))$/;
const FILE_LINE = /^\[User attached file: (.+)\]$/;

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function lineAttachment(line: string): MessageAttachment | undefined {
  const image = IMAGE_LINE.exec(line);
  if (image) {
    const path = image[1] ?? image[2] ?? image[3] ?? image[4]!;
    return { kind: 'image', path, name: nameOf(path) };
  }
  const file = FILE_LINE.exec(line);
  if (!file) return undefined;
  const name = nameOf(file[1]!);
  // A recording the owner sent (M7 #07) is played in the transcript, not shown as a file.
  return { kind: isAudioName(name) ? 'audio' : 'file', path: file[1]!, name };
}

/** The message without its attachment lines, and the attachments, in order. Only lines at the very end count: the same words inside the message are the owner's text. */
export function splitAttachments(text: string): { body: string; attachments: MessageAttachment[] } {
  const lines = text.split('\n');
  const attachments: MessageAttachment[] = [];
  let end = lines.length;
  while (end > 0) {
    const attachment = lineAttachment(lines[end - 1]!);
    if (!attachment) break;
    attachments.unshift(attachment);
    end--;
  }
  return attachments.length === 0 ? { body: text, attachments } : { body: lines.slice(0, end).join('\n'), attachments };
}
