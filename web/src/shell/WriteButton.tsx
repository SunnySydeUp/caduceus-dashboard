import { useId, type ButtonHTMLAttributes } from 'react';
import { writeGate } from '../offline.ts';
import { useReach } from './connection.ts';

/**
 * A button that changes something in Hermes or Caduceus. While the page cannot reach Caduceus (no network, or no answer) it is
 * switched off, and says why: the reason is its tooltip and its accessible description, so nobody meets a dead button with no
 * explanation (`../offline.ts` words the reasons). Changes this device keeps itself and sends later (the appearance choices) use a plain `button`.
 */
export function WriteButton({ disabled, 'aria-describedby': describedBy, title, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const gate = writeGate(useReach());
  const reasonId = useId();
  if (gate.allowed) {
    return (
      <button {...rest} disabled={disabled} aria-describedby={describedBy} title={title}>
        {children}
      </button>
    );
  }
  return (
    <>
      <button {...rest} disabled aria-describedby={[describedBy, reasonId].filter(Boolean).join(' ')} title={gate.reason}>
        {children}
      </button>
      <span id={reasonId} className="sr-only">
        {gate.reason}
      </span>
    </>
  );
}
