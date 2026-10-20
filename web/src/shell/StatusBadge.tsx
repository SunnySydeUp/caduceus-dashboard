import { Icon, type IconName } from '../icons.tsx';
import type { Tone } from './banners.ts';

interface Rung {
  tone: Tone;
  /** The glyph icon; `dot` states use a coloured dot instead. */
  glyph?: IconName;
  label: string;
  attn?: boolean;
  spin?: boolean;
  dot?: boolean;
}

/** The status ladder (design system §4.2): every state has a tone, a glyph and a label, so colour is never alone. */
const LADDER = {
  waiting: { tone: 'warning', glyph: 'waiting', label: 'Waiting for you', attn: true },
  running: { tone: 'running', glyph: 'running', label: 'Running', spin: true },
  queued: { tone: 'neutral', glyph: 'queued', label: 'Queued' },
  scheduled: { tone: 'neutral', glyph: 'queued', label: 'Scheduled' },
  paused: { tone: 'paused', glyph: 'paused', label: 'Paused' },
  blocked: { tone: 'blocked', glyph: 'blocked', label: 'Blocked' },
  failed: { tone: 'danger', glyph: 'failed', label: 'Failed' },
  stale: { tone: 'stale', glyph: 'stale', label: 'Stale' },
  succeeded: { tone: 'success', glyph: 'succeeded', label: 'Succeeded' },
  done: { tone: 'success', glyph: 'succeeded', label: 'Done' },
  cancelled: { tone: 'neutral', glyph: 'cancelled', label: 'Cancelled' },
  offline: { tone: 'neutral', glyph: 'offline', label: 'Offline' },
  draft: { tone: 'neutral', glyph: 'draft', label: 'Draft' },
  online: { tone: 'success', dot: true, label: 'Online' },
  degraded: { tone: 'warning', dot: true, label: 'Degraded' },
  reconnecting: { tone: 'warning', dot: true, label: 'Reconnecting' },
} as const satisfies Record<string, Rung>;

export type StatusState = keyof typeof LADDER;

/** A status chip: `running` is the only spinner, `waiting` gets the attention treatment. */
export function StatusBadge({ state, label, detail, variant }: { state: StatusState; label?: string; detail?: string; variant?: 'plain' | 'solid' | 'attn' }) {
  const rung: Rung = LADDER[state];
  const style = variant ?? (rung.attn ? 'attn' : undefined);
  return (
    <span className={`status${style ? ` status--${style}` : ''}`} data-tone={rung.tone} data-state={state}>
      {rung.dot ? <span className="dot" aria-hidden="true" /> : <Icon name={rung.glyph!} className={rung.spin ? 'spin' : undefined} />}
      <span>{label ?? rung.label}</span>
      {detail && <span className="mono status__detail">{detail}</span>}
    </span>
  );
}
