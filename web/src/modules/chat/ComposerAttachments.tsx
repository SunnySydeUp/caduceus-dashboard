// The composer's attachments (M1 #10): the add button (a popover: files, on a phone the camera, an audio recording, a file of the workspace and the saved prompts), the chips that show what is
// attached, and the line that says what was left out. What each file is and may be is `attachments.ts`; this is what is drawn.
import { useEffect, useRef, useState } from 'react';
import { MAX_DRAFT_ATTACHMENT_BYTES, MAX_DRAFT_ATTACHMENTS_BYTES } from '@caduceus/contracts/chat-drafts';
import { Icon, type IconName } from '../../icons.tsx';
import { ComposerPopover } from './composer-popover.tsx';
import { sizeText, type Attachment } from './attachments.ts';
import { addRows, type AddRow } from './composer-controls.ts';
import type { UploadStep } from './attachment-upload.ts';
import { isAudioName } from '../voice/audio-attachment.ts';
import { AudioPreview } from '../voice/AudioClip.tsx';

const MB = 1024 * 1024;

/** Where the owner is on a phone or a tablet: the camera is offered there. */
const touchScreen = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** A thumbnail's address for an image the owner attached: it lives as long as the chip. */
function usePreview(attachment: Attachment): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (attachment.kind !== 'image') return;
    const made = URL.createObjectURL(attachment.body);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [attachment]);
  return url;
}

function Chip({ attachment, step, locked, onRemove, onKeepInline }: { attachment: Attachment; step: UploadStep | undefined; locked: boolean; onRemove(): void; onKeepInline?: () => void }) {
  const preview = usePreview(attachment);
  const state = step?.state;
  return (
    <li className="attach-chip" data-state={state} title={attachment.origin ?? attachment.name}>
      {preview ? <img className="attach-chip__thumb" src={preview} alt="" /> : <span className="attach-chip__thumb attach-chip__thumb--icon"><Icon name="file" small /></span>}
      <span className="attach-chip__text">
        <span className="attach-chip__name">{attachment.name}</span>
        <span className="attach-chip__meta">
          {state === 'uploading' ? 'Uploading…' : state === 'attached' ? 'Uploaded' : state === 'failed' ? (step?.error ?? 'Failed') : `${attachment.kind === 'pdf' ? 'PDF' : attachment.kind === 'image' ? 'Image' : isAudioName(attachment.name) ? 'Voice message' : 'File'} · ${sizeText(attachment.size)}`}
        </span>
        {state === 'uploading' && <progress className="attach-chip__bar" aria-label={`Uploading ${attachment.name}`} />}
        {isAudioName(attachment.name) && <AudioPreview body={attachment.body} name={attachment.name} />}
      </span>
      {onKeepInline && !locked && (
        <button type="button" className="btn btn--ghost btn--sm attach-chip__undo" onClick={onKeepInline}>
          Keep inline
        </button>
      )}
      <button type="button" className="attach-chip__x" disabled={locked} aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
        <Icon name="x" small />
      </button>
    </li>
  );
}

/** What is attached, as chips with a thumbnail, the size, progress while it goes, and a remove button. */
export function AttachmentChips({ attachments, steps, locked, onRemove, onKeepInline }: { attachments: readonly Attachment[]; steps: Readonly<Record<string, UploadStep>>; locked: boolean; onRemove(id: string): void; onKeepInline(id: string): void }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="attach-chips" aria-label={`Attachments, ${attachments.length}`}>
      {attachments.map((attachment) => (
        <Chip key={attachment.id} attachment={attachment} step={steps[attachment.id]} locked={locked} onRemove={() => onRemove(attachment.id)} {...(attachment.pasted ? { onKeepInline: () => onKeepInline(attachment.id) } : {})} />
      ))}
    </ul>
  );
}

/** What was left out of the last pick, and why. */
export function AttachmentNotes({ lines, onDismiss }: { lines: readonly string[]; onDismiss(): void }) {
  if (lines.length === 0) return null;
  return (
    <div className="attach-notes banner" data-tone="warning" role="status">
      <Icon name="alert" />
      <ul className="banner__content attach-notes__list">
        {lines.map((line) => (
          <li key={line}>Not attached: {line}</li>
        ))}
      </ul>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="x" small />
      </button>
    </div>
  );
}

const ROW: Record<AddRow, { icon: IconName; title(phone: boolean): string; hint: string }> = {
  files: { icon: 'file', title: (phone) => (phone ? 'Photos and files' : 'Files from this device'), hint: 'Images, PDFs, documents and archives' },
  camera: { icon: 'camera', title: () => 'Take a photo', hint: 'Opens the camera' },
  record: { icon: 'mic', title: () => 'Record an audio message', hint: 'Sent as a file Hermes can play or transcribe' },
  workspace: { icon: 'folder', title: () => 'A file of the workspace', hint: 'Types @ so you can pick one' },
  prompts: { icon: 'book', title: () => 'Saved prompts', hint: 'Insert or manage the words you use again' },
};

/**
 * The add button (M8 #09): a popover with files (the system's picker, which on a phone lists its photo library and files), the camera (phones and tablets), an audio
 * recording, a file of the workspace (which types `@`, opening the path menu) and the saved prompts. The inputs sit outside the popover (and stay in the page when it
 * closes), so that the picker opens from the tap that chose the item.
 */
export function AttachControl({ disabled, onFiles, onWorkspace, onRecord, onPrompts }: { disabled: boolean; onFiles(files: File[]): void; onWorkspace(): void; /** Starts recording an audio message (M7 #07). */ onRecord(): void; /** Opens the saved prompts. */ onPrompts(): void }) {
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [phone] = useState(touchScreen);
  const picked = (input: HTMLInputElement) => {
    if (input.files && input.files.length > 0) onFiles([...input.files]);
    // The same file can be picked again after it was removed.
    input.value = '';
  };
  const run: Record<AddRow, () => void> = { files: () => files.current?.click(), camera: () => camera.current?.click(), record: onRecord, workspace: onWorkspace, prompts: onPrompts };
  return (
    <>
      <input ref={files} hidden type="file" multiple data-attach="files" onChange={(event) => picked(event.currentTarget)} />
      <input ref={camera} hidden type="file" accept="image/*" capture="environment" data-attach="camera" onChange={(event) => picked(event.currentTarget)} />
      <ComposerPopover
        label="Add"
        placement="top"
        align="fill"
        className="composer__add-pop"
        trigger={(props) => (
          <button {...props} className="btn btn--ghost btn--icon" aria-label="Add a file or a saved prompt" disabled={disabled}>
            <Icon name="plus" />
          </button>
        )}
      >
        {({ close }) => (
          <>
            {addRows(phone).map((row) => (
              <button key={row} type="button" className="pop__item" onClick={() => {
                close();
                run[row]();
              }}>
                <Icon name={ROW[row].icon} />
                <span>
                  {ROW[row].title(phone)}
                  <small className="pop__hint">{ROW[row].hint}</small>
                </span>
              </button>
            ))}
            <p className="pop__note">
              Your draft keeps attachments of up to {MAX_DRAFT_ATTACHMENT_BYTES / MB} MB each and {MAX_DRAFT_ATTACHMENTS_BYTES / MB} MB in all, so they are still here after a reload. Nothing that looks like a password or a key is kept.
            </p>
          </>
        )}
      </ComposerPopover>
    </>
  );
}
