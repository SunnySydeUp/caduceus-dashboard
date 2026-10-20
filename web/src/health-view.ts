// How Health describes a health report: what is counted, in what order, and with which tone. Pure.
import type { Repair, RepairSeverity, SubsystemState } from '@caduceus/contracts/caduceus-api';
import type { IconName } from './icons.tsx';
import type { Tone } from './shell/banners.ts';
import type { StatusState } from './shell/StatusBadge.tsx';

/** A subsystem's state as the owner reads it: a tone, a word and a rung of the status ladder, so colour is never alone (design system §4.2). */
export const STATE_VIEW: Record<SubsystemState, { tone: Tone; label: string; badge: StatusState }> = {
  ok: { tone: 'success', label: 'Healthy', badge: 'online' },
  degraded: { tone: 'warning', label: 'Degraded', badge: 'degraded' },
  down: { tone: 'danger', label: 'Down', badge: 'failed' },
  unknown: { tone: 'neutral', label: 'Unknown', badge: 'offline' },
};

/** What a Repair that came back says about it: how many separate times it appeared, and within what window. */
export function recurringText({ times, windowHours }: NonNullable<Repair['recurring']>): string {
  return `Came back: seen ${times} times in the last ${windowHours === 1 ? 'hour' : `${windowHours} hours`}`;
}

export const SEVERITY_VIEW: Record<RepairSeverity, { tone: Tone; label: string; icon: IconName }> = {
  critical: { tone: 'danger', label: 'Critical', icon: 'failed' },
  warning: { tone: 'warning', label: 'Warning', icon: 'alert' },
  info: { tone: 'info', label: 'Info', icon: 'info' },
};

export interface HealthSummary {
  repairs: number;
  /** Subsystems that are `ok`: one that is unknown is not known to be healthy. */
  healthy: number;
  total: number;
  text: string;
}

/** Counts a health report: only the states and the number of Repairs matter. */
export function healthSummary(report: { subsystems: { state: SubsystemState }[]; repairs: unknown[] }): HealthSummary {
  const repairs = report.repairs.length;
  const total = report.subsystems.length;
  const healthy = report.subsystems.filter((subsystem) => subsystem.state === 'ok').length;
  const issues = repairs === 0 ? 'No open issues' : repairs === 1 ? '1 issue to repair' : `${repairs} issues to repair`;
  const state = healthy === total ? `all ${total} subsystems healthy` : `${healthy} of ${total} subsystems healthy`;
  return { repairs, healthy, total, text: `${issues} · ${state}` };
}
