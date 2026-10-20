import { describe, expect, test } from 'vitest';
import { splitAttachments } from '../src/modules/chat/message-attachments.ts';

// What a sent message says about what was attached to it (M1 #10): Hermes keeps an image as an `@image:<path>` line at the end of the message, and a
// file is a `[User attached file: <path>]` line the page wrote. The transcript draws them as thumbnails and chips instead of as text.
describe('the attachments at the end of a message', () => {
  test('image and file lines at the end leave the message: its words stay, and each attachment is named with its path', () => {
    const text = 'Compare these\n[User attached file: /home/o/.hermes/attachments/notes.txt]\n@image:/home/o/.hermes/images/upload_1.png\n@image:/home/o/.hermes/images/pdf_p2_1.png';
    expect(splitAttachments(text)).toEqual({
      body: 'Compare these',
      attachments: [
        { kind: 'file', path: '/home/o/.hermes/attachments/notes.txt', name: 'notes.txt' },
        { kind: 'image', path: '/home/o/.hermes/images/upload_1.png', name: 'upload_1.png' },
        { kind: 'image', path: '/home/o/.hermes/images/pdf_p2_1.png', name: 'pdf_p2_1.png' },
      ],
    });
  });

  test('a path with a space is read back whole from the quotes Hermes puts round it', () => {
    expect(splitAttachments('@image:`/Users/o/Library/App Support/images/a b.png`').attachments).toEqual([{ kind: 'image', path: '/Users/o/Library/App Support/images/a b.png', name: 'a b.png' }]);
    expect(splitAttachments('x\n[User attached file: /tmp/my notes (1).txt]').attachments).toEqual([{ kind: 'file', path: '/tmp/my notes (1).txt', name: 'my notes (1).txt' }]);
  });

  test('a message with only attachments has no words; a line like that in the middle of the words is the owner’s text, not an attachment', () => {
    expect(splitAttachments('@image:/a/b.png')).toEqual({ body: '', attachments: [{ kind: 'image', path: '/a/b.png', name: 'b.png' }] });
    const quoted = 'Hermes writes @image:/a/b.png lines.\n@image:/a/b.png\nand then more words';
    expect(splitAttachments(quoted)).toEqual({ body: quoted, attachments: [] });
  });

  test('a message with nothing attached is returned as it is', () => {
    expect(splitAttachments('Hello\n\nworld  ')).toEqual({ body: 'Hello\n\nworld  ', attachments: [] });
  });
});
