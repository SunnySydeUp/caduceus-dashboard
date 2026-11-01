import type { ReactNode } from 'react';
import { useOnline } from './connection.ts';
import { needsConnection } from './link-memory.ts';
import { AppLink } from './navigation.tsx';

/**
 * An action that cannot work without a network (a Retry, "Start setup", "Start a new chat"). While the device is offline it is a switched-off button whose accessible name says why
 * ("Retry. Needs a connection"); the banner says the device is offline, so the button does not say it again. Online it is a link when it has a `to`, else a button.
 */
export function NetworkAction({ label, to, className, busy, disabled, onClick, children }: { label: string; to?: string; className: string; busy?: boolean; disabled?: boolean; onClick?(): void; children: ReactNode }) {
  const online = useOnline();
  if (!online) {
    return (
      <button type="button" className={className} disabled aria-label={needsConnection(label)}>
        {children}
      </button>
    );
  }
  if (to !== undefined) {
    return (
      <AppLink className={className} to={to} onClick={onClick}>
        {children}
      </AppLink>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled} aria-busy={busy} onClick={onClick}>
      {children}
    </button>
  );
}
