// The composer's attachments as React state (M1 #10): what is attached, where each one is while it goes to Hermes, and what was left out. The rules
// (limits, unpacking an archive, the large paste) are in `attachments.ts`, `archive.ts` and `attach-files.ts`.
import { useCallback, useRef, useState } from 'react';
import { attachFiles } from './attach-files.ts';
import { describeProblems, type Attachment, type Candidate, type Problem } from './attachments.ts';
import type { UploadStep } from './attachment-upload.ts';

export interface AttachmentList {
  attachments: readonly Attachment[];
  /** Where each attachment is while the message goes, by attachment id. */
  steps: Readonly<Record<string, UploadStep>>;
  /** What was left out of the last pick, one line for each reason. */
  left: readonly string[];
  /** Adds what was picked (archives are unpacked first). Resolves with the attachments after it. */
  add(picked: readonly Candidate[], extra?: readonly Problem[]): Promise<readonly Attachment[]>;
  remove(id: string): void;
  clear(): void;
  /** Replaces the list (undo of a large paste). */
  set(next: readonly Attachment[]): void;
  /** Where one attachment is, by its place in the list that was sent. */
  step(step: UploadStep): void;
  /** After a send that failed: the attachment Hermes refused stays marked, the others go back to waiting. */
  keepFailedSteps(): void;
  dismissLeft(): void;
}

export function useAttachments(): AttachmentList {
  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);
  const [steps, setSteps] = useState<Readonly<Record<string, UploadStep>>>({});
  const [left, setLeft] = useState<readonly string[]>([]);
  /** The list as the latest change left it: two picks in a row each add to the one before, though the second may start before the first has re-drawn. */
  const current = useRef<readonly Attachment[]>([]);
  const busy = useRef<Promise<unknown>>(Promise.resolve());
  const keep = useCallback((next: readonly Attachment[]) => {
    current.current = next;
    setAttachments(next);
  }, []);
  const add = useCallback(
    (picked: readonly Candidate[], extra: readonly Problem[] = []) => {
      const done = busy.current.then(async () => {
        const { attachments: next, problems } = await attachFiles(current.current, picked);
        keep(next);
        setLeft(describeProblems([...extra, ...problems]));
        return next;
      });
      busy.current = done.catch(() => undefined);
      return done;
    },
    [keep],
  );
  return {
    attachments,
    steps,
    left,
    add,
    remove: useCallback((id) => keep(current.current.filter((attachment) => attachment.id !== id)), [keep]),
    clear: useCallback(() => {
      keep([]);
      setSteps({});
    }, [keep]),
    set: keep,
    step: useCallback((step) => setSteps((all) => ({ ...all, [current.current[step.index]?.id ?? String(step.index)]: step })), []),
    keepFailedSteps: useCallback(() => setSteps((all) => Object.fromEntries(Object.entries(all).filter(([, step]) => step.state === 'failed'))), []),
    dismissLeft: useCallback(() => setLeft([]), []),
  };
}
