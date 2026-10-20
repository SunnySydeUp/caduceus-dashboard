import { describe, expect, test } from 'vitest';
import { audioTypeOf, isAudioName, recordingName } from '../src/modules/voice/audio-attachment.ts';
import { splitAttachments } from '../src/modules/chat/message-attachments.ts';

// How a raw audio message is named and recognised (M7 #07).
describe('recordings', () => {
  test('a recording is named by the moment it was made and the type its recorder gives', () => {
    const at = new Date(2026, 9, 19, 9, 5);
    expect(recordingName('audio/webm;codecs=opus', at)).toBe('voice-message-2026-10-19-0905.webm');
    expect(recordingName('audio/mp4', at)).toBe('voice-message-2026-10-19-0905.m4a');
    expect(recordingName('audio/ogg;codecs=opus', at)).toBe('voice-message-2026-10-19-0905.ogg');
  });

  test('audio files play, and a video that is not a recording of ours does not', () => {
    expect(isAudioName('memo.m4a')).toBe(true);
    expect(isAudioName('take.WAV')).toBe(true);
    expect(isAudioName('voice-message-2026-10-19-0905.webm')).toBe(true);
    expect(isAudioName('screen-recording.webm')).toBe(false);
    expect(isAudioName('clip.mp4')).toBe(false);
    expect(isAudioName('notes.txt')).toBe(false);
    expect(audioTypeOf('voice-message-x.webm')).toBe('audio/webm');
    expect(audioTypeOf('notes.txt')).toBeUndefined();
  });

  test('a message line that names a recording is audio; one that names anything else stays a file', () => {
    expect(splitAttachments('Listen\n[User attached file: /h/attachments/voice-message-2026-10-19-0905.webm]\n[User attached file: /h/attachments/notes.txt]').attachments).toEqual([
      { kind: 'audio', path: '/h/attachments/voice-message-2026-10-19-0905.webm', name: 'voice-message-2026-10-19-0905.webm' },
      { kind: 'file', path: '/h/attachments/notes.txt', name: 'notes.txt' },
    ]);
  });
});
