import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import type { KeyVerdict, KeyVerdictState } from './keys-model.ts';

const BADGE: Record<KeyVerdictState, { state: StatusState; label: string }> = {
  works: { state: 'online', label: 'Accepted' },
  rejected: { state: 'failed', label: 'Rejected' },
  unreachable: { state: 'offline', label: 'Not reached' },
  unchecked: { state: 'degraded', label: 'Not checked' },
};

/** What Hermes's validation said about a key, as a badge and a sentence. Colour is never alone: the badge has its own word. */
export function VerdictLine({ verdict }: { verdict: KeyVerdict }) {
  return (
    <div className="ky-verdict" role="status">
      <StatusBadge state={BADGE[verdict.state].state} label={BADGE[verdict.state].label} variant="plain" />
      <span>{verdict.text}</span>
    </div>
  );
}
