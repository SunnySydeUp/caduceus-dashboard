import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm rich__copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} small />
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
