import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';

/** A button that puts `text` on the clipboard and says so. `what` names it for a screen reader ("Copy the secret"). */
export function CopyText({ text, label = 'Copy', what, onCopied }: { text: string; label?: string; what: string; onCopied?(): void }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [copied, failed]);
  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm"
      aria-label={`${label} ${what}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            onCopied?.();
          },
          () => setFailed(true),
        );
        if (!navigator.clipboard) setFailed(true);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} small />
      <span aria-live="polite">{copied ? 'Copied' : failed ? 'Could not copy: select it by hand' : label}</span>
    </button>
  );
}
