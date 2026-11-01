import type { CrewRow } from '../../shell/nav-order.ts';

/**
 * What a crew row says it is doing, in the crew list and on Today's tiles: its line, or, while a read the crew is made of is on its way (`CrewMember.pending`), a skeleton with no
 * words (its state words for a screen reader are on the row). Once the wait is long the line is "Still reading Hermes…", and when a read failed it is "Can’t check".
 */
export function CrewLine({ row, className, text }: { row: Pick<CrewRow, 'line' | 'pending'>; className?: string; text?: string }) {
  if (row.pending === 'reading') return <span className="skel mate__skel-line mate__skel-line--short" aria-hidden="true" />;
  return <small className={className}>{text ?? row.line}</small>;
}
