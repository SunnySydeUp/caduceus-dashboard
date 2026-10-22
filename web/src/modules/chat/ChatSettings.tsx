// Settings › Chat (M1 #20): how the chat behaves, as Caduceus preferences. Each setting says whether it is this device's or the owner's (every device), takes effect in the
// chat at once, and is never written into Hermes's config. Reset to defaults asks first (T1) and resets the whole panel.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ACTIVITY_DEFAULTS, DENSITIES, MAX_PIN_LIMIT, MIN_PIN_LIMIT, SEND_KEYS, type ChatBehaviour } from '@caduceus/contracts/chat-behaviour';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { toast } from '../../shell/toasts.ts';
import { loadChatBehaviour, saveChatBehaviour, useChatBehaviour, useFinePointer } from './chat-behaviour.ts';
import { useChipPreference } from './chip-preference.ts';
import { ChipsEditor } from './ComposerEditors.tsx';
import { setDensity, useDensity } from './sessions-prefs.ts';

const sendKeyLabel = (value: ChatBehaviour['device']['sendKey'], finePointer: boolean): string => {
  if (value === 'auto') return `Automatic (${finePointer ? 'Enter' : '⌘/Ctrl+Enter'} on this device)`;
  return value === 'enter' ? 'Enter sends' : '⌘/Ctrl+Enter sends';
};
const DENSITY_LABELS: Record<(typeof DENSITIES)[number], string> = { comfortable: 'Comfortable', compact: 'Compact' };
const MODE_LABELS: Record<(typeof ACTIVITY_DEFAULTS)[number], string> = { worklog: 'Worklog', stream: 'Stream', final: 'Final only' };

const refused = () => toast('Caduceus could not save that setting', { tone: 'danger' });

/** One setting: its label, what it does and whose it is, and its control. `id` marks it for Settings search. */
function Setting({ id, label, about, scope, children }: { id: string; label: string; about: string; scope: 'device' | 'account'; children: ReactNode }) {
  return (
    <section className="cs-setting" data-setting-field={`chat/${id}`} tabIndex={-1} aria-label={label}>
      <div className="cs-setting__head">
        <h3 id={`chat-${id}-label`} className="cs-setting__label">{label}</h3>
        <span className="chip cs-setting__scope" data-scope={scope}>
          {scope === 'device' ? 'This device' : 'Every device'}
        </span>
      </div>
      <p className="subtle cs-setting__about">{about}</p>
      {children}
    </section>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange(next: boolean): void }) {
  return <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function ChatSettings() {
  const { device, account } = useChatBehaviour();
  const finePointer = useFinePointer();
  const listDensity = useDensity();
  const chips = useChipPreference();
  const pinId = useId();
  const [pin, setPin] = useState(String(account.pinLimit));
  useEffect(() => {
    void loadChatBehaviour();
  }, []);
  useEffect(() => setPin(String(account.pinLimit)), [account.pinLimit]);
  const saveDevice = (change: Partial<ChatBehaviour['device']>) => void saveChatBehaviour({ device: change }).then((ok) => !ok && refused());
  const saveAccount = (change: Partial<ChatBehaviour['account']>) => void saveChatBehaviour({ account: change }).then((ok) => !ok && refused());
  const reset = async () => {
    const confirmed = await confirmTier({ tier: 'T1', moduleId: 'chat', action: 'chat.settings.reset', label: 'Reset the chat settings?', text: 'Every setting on this page goes back to its default: this device’s and the ones that follow you to every device. Hermes is not changed.', confirmLabel: 'Reset to defaults' });
    if (!confirmed) return;
    setDensity('comfortable');
    if (await saveChatBehaviour({ device: null, account: null })) toast('Chat settings are back to their defaults');
    else refused();
  };
  const commitPin = () => {
    const limit = Number(pin);
    if (Number.isInteger(limit) && limit >= MIN_PIN_LIMIT && limit <= MAX_PIN_LIMIT) {
      if (limit !== account.pinLimit) saveAccount({ pinLimit: limit });
    } else setPin(String(account.pinLimit));
  };
  return (
    <div className="stack cs">
      <PageHeader title="Chat" subtitle="How the chat behaves. These are Caduceus settings: Hermes’s own config is not changed." />
      <Setting id="send-key" label="Send key" scope="device" about="What sends a message. Automatic uses Enter with a mouse or trackpad and ⌘/Ctrl+Enter on a touch screen. The other key starts a new line; Shift+Enter is always a new line and ⌘/Ctrl+Enter always sends.">
        <RadioGroup labelledBy="chat-send-key-label" className="seg" value={device.sendKey} options={SEND_KEYS.map((value) => ({ value, label: sendKeyLabel(value, finePointer) }))} onChange={(sendKey) => saveDevice({ sendKey })} />
      </Setting>
      <Setting id="completion-sound" label="Completion sound" scope="device" about="A short sound when Hermes finishes a reply.">
        <Switch label="Completion sound" on={device.completionSound} onChange={(completionSound) => saveDevice({ completionSound })} />
      </Setting>
      <Setting id="timestamps" label="Timestamps" scope="device" about="The time each message was written, under it.">
        <Switch label="Timestamps" on={device.timestamps} onChange={(timestamps) => saveDevice({ timestamps })} />
      </Setting>
      <Setting id="transcript-density" label="Transcript density" scope="device" about="How much room the messages of a conversation take.">
        <RadioGroup labelledBy="chat-transcript-density-label" className="seg" value={device.transcriptDensity} options={DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value] }))} onChange={(transcriptDensity) => saveDevice({ transcriptDensity })} />
      </Setting>
      <Setting id="list-density" label="Session list density" scope="device" about="How tightly the rows of the sessions list are packed.">
        <RadioGroup labelledBy="chat-list-density-label" className="seg" value={listDensity} options={DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value] }))} onChange={setDensity} />
      </Setting>
      <Setting id="auto-follow" label="Auto-follow" scope="device" about="A reply that is arriving keeps the conversation scrolled to its end, until you scroll up.">
        <Switch label="Auto-follow" on={device.autoFollow} onChange={(autoFollow) => saveDevice({ autoFollow })} />
      </Setting>
      <Setting id="finished-marks" label="Finished marks on agents" scope="device" about="The green ring and tick on an agent that has finished work you have not opened yet. Off hides them; the work stays in Ready for review.">
        <Switch label="Finished marks on agents" on={device.finishedMarks} onChange={(finishedMarks) => saveDevice({ finishedMarks })} />
      </Setting>
      <Setting id="pin-limit" label="Pin limit" scope="account" about={`How many sessions can be pinned at once (${MIN_PIN_LIMIT} to ${MAX_PIN_LIMIT}).`}>
        <input id={pinId} className="input cs-pin" type="number" inputMode="numeric" min={MIN_PIN_LIMIT} max={MAX_PIN_LIMIT} aria-label="Pin limit" value={pin} onChange={(event) => setPin(event.target.value)} onBlur={commitPin} onKeyDown={(event) => event.key === 'Enter' && commitPin()} />
      </Setting>
      <Setting id="activity-mode" label="Default activity mode" scope="account" about="How agent activity shows in a chat on a device that has not chosen a mode itself.">
        <RadioGroup labelledBy="chat-activity-mode-label" className="seg" value={account.activityMode} options={ACTIVITY_DEFAULTS.map((value) => ({ value, label: MODE_LABELS[value] }))} onChange={(activityMode) => saveAccount({ activityMode })} />
      </Setting>
      <Setting id="chip-order" label="Composer chips" scope="account" about="Which chips sit under the message box and in what order. Hidden chips stay in the chat settings sheet.">
        <ChipsEditor preference={chips} />
      </Setting>
      <div>
        <button type="button" className="btn btn--secondary" onClick={() => void reset()}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
