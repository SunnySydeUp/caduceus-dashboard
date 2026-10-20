// The bar under the message field (M8 #09 step A): the add button, the context button, and on the right the voice entry (an empty field) or Send (a field with words).
// What shows is `composer-controls.ts`'s. Send has a small "Send as" menu beside it; while Hermes is answering, Steer, Queue and Stop are there as before, side by side
// so that each is one tap on a phone.
import { Icon } from '../../icons.tsx';
import { ComposerPopover } from './composer-popover.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { handsFree } from '../voice/hands-free-session.ts';
import type { PressState } from '../voice/hold-to-talk.ts';
import type { VoiceInput } from '../voice/use-voice-input.ts';
import type { VoicePrefs } from '../voice/voice-prefs.ts';
import { MicButton } from '../voice/VoiceControls.tsx';
import type { Chat, ChatState } from './chat-session.ts';
import { composerBar } from './composer-controls.ts';
import { INTENT_META, type Intent } from './composer-intent.ts';
import { ComposerContext, type ComposerSettings } from './ComposerChips.tsx';
import { AttachControl } from './ComposerAttachments.tsx';
import { SendAsMenu } from './ComposerIntent.tsx';
import { requestPromptLibrary } from './prompts-handoff.ts';
import type { PromptsAccess } from './Prompts.tsx';
import './composer-bar.css';

export interface ComposerBarProps {
  chat: Chat | undefined;
  state: ChatState;
  settings: ComposerSettings;
  prompts: PromptsAccess;
  intent: Intent;
  onIntent(next: Intent): void;
  /** Nothing typed and nothing attached. */
  empty: boolean;
  /** The message and its attachments are on their way to Hermes. */
  sending: boolean;
  voice: VoiceInput;
  voicePrefs: VoicePrefs;
  handsActive: boolean;
  onPress(state: PressState): void;
  onFiles(files: File[]): void;
  onWorkspace(): void;
  onRecord(): void;
  onSteer(): void;
  onQueue(): void;
  onStop(): void;
}

export function ComposerBar({ chat, state, settings, prompts, intent, onIntent, empty, sending, voice, voicePrefs, handsActive, onPress, onFiles, onWorkspace, onRecord, onSteer, onQueue, onStop }: ComposerBarProps) {
  const running = state.running;
  const bar = composerBar({ empty, running, intent });
  const has = (control: (typeof bar)[number]) => bar.includes(control);
  const blocked = !chat || empty || sending;
  const action = INTENT_META[intent].action;
  return (
    <div className="composer__foot chat__foot composer__bar">
      <AttachControl disabled={!chat || sending} onFiles={onFiles} onRecord={onRecord} onWorkspace={onWorkspace} onPrompts={() => requestPromptLibrary(() => undefined)} />
      <ComposerContext settings={settings} prompts={prompts} />
      <span className="composer__grow" />
      {has('mic') && <MicButton input={voice} prefs={voicePrefs} disabled={!chat || sending || handsActive} onPress={onPress} />}
      {has('voice') && (
        <ComposerPopover
          label="Voice"
          placement="top"
          align="fill"
          className="composer__voice-pop"
          trigger={(props) => (
            <button {...props} className="btn btn--ghost btn--icon composer__voice-more" aria-label="More ways to talk">
              <Icon name="chev-u" small />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <p className="pop__title">Voice</p>
              <button
                type="button"
                className="pop__item"
                aria-pressed={handsActive}
                title={voice.unsupported ?? 'Talk with Hermes without typing'}
                disabled={!chat || sending || running || handsActive || voice.phase !== 'idle' || !!voice.unsupported}
                onClick={() => {
                  close();
                  handsFree.start();
                }}
              >
                <Icon name="wave" />
                <span>
                  Hands-free conversation
                  <small className="pop__hint">Talk with Hermes without typing</small>
                </span>
              </button>
            </>
          )}
        </ComposerPopover>
      )}
      {!running && has('send') && (
        <span className="composer__split">
          <WriteButton type="submit" className="btn btn--primary btn--icon composer__send" aria-label={action} title={action} disabled={blocked}>
            <Icon name="send" />
          </WriteButton>
          <SendAsMenu intent={intent} agent={settings.profile} disabled={sending} split onChange={onIntent} />
        </span>
      )}
      {running && has('sendAs') && <SendAsMenu intent={intent} agent={settings.profile} disabled={sending} split={false} onChange={onIntent} />}
      {running && (
        <div className="chat__runctl" role="group" aria-label="While Hermes is working">
          {has('steer') && (
            <WriteButton type="button" className="btn btn--primary" disabled={blocked} onClick={onSteer}>
              <Icon name="steer" />
              Steer
            </WriteButton>
          )}
          {has('queue') && (
            <WriteButton type="button" className="btn btn--secondary" disabled={blocked} onClick={onQueue}>
              <Icon name="queued" />
              Queue
            </WriteButton>
          )}
          {has('send') && (
            <WriteButton type="button" className="btn btn--primary" disabled={blocked} onClick={onSteer}>
              <Icon name="send" />
              {action}
            </WriteButton>
          )}
          {has('stop') && (
            <button type="button" className="btn btn--secondary" onClick={onStop}>
              <Icon name="stop" />
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}
