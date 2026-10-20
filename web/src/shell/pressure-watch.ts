// The app-wide resource-pressure banner (M5 #07), decided: Hermes's own pressure signal (`contracts/pressure.ts`) in, a banner out. The banner is
// dismissible per session, and a dismissal must hold for as long as the same stretch of pressure lasts and no longer: each stretch (an episode) has
// its own banner id, and `banners.ts` keeps a dismissed id hidden. Pure; the hook that reads Hermes and shows the banner is `pressure-banners.ts`.
import { PRESSURE_RANK, pressureClause, type PressureLevel, type ResourcePressure } from '@caduceus/contracts/pressure';
import type { Banner } from './banners.ts';

/** Where the banner sits among the others: under a lost connection and a read-only notice, over the restart notices. */
const PRIORITY = 3;

export interface PressureWatch {
  /** Counts the episodes of pressure seen; 0 before the first. */
  episode: number;
  /** The level of the latest reading Hermes gave (never `unknown`: that holds what was known). */
  level: PressureLevel;
  /** The life of Hermes's gateway the latest reading was from, where Hermes names it. */
  bootId: string | undefined;
}

export const NO_PRESSURE_YET: PressureWatch = { episode: 0, level: 'ok', bootId: undefined };

export interface PressureStep {
  watch: PressureWatch;
  /** The banner to show; none when Hermes reports no pressure. */
  banner?: Banner;
  /** Hermes could not tell this time: change nothing on screen. */
  hold?: true;
}

/**
 * Takes in one reading. A new episode begins when pressure appears after none, when it gets worse, and when Hermes's gateway restarted while
 * it went on; it ends when Hermes reports `ok`. A reading of `unknown` (the sample is stale, or the platform has none) is neither: the banner stays as it is.
 */
export function watchPressure(watch: PressureWatch, signal: ResourcePressure): PressureStep {
  if (signal.level === 'unknown') return { watch, hold: true };
  const bootId = signal.bootId ?? watch.bootId;
  if (signal.level === 'ok') return { watch: { ...watch, level: 'ok', bootId } };
  const restarted = watch.bootId !== undefined && signal.bootId !== undefined && signal.bootId !== watch.bootId;
  const episode = PRESSURE_RANK[signal.level] > PRESSURE_RANK[watch.level] || restarted ? watch.episode + 1 : watch.episode;
  return { watch: { episode, level: signal.level, bootId }, banner: pressureBanner(signal, episode) };
}

function pressureBanner(signal: ResourcePressure, episode: number): Banner {
  const short = (['memory', 'disk'] as const).filter((kind) => signal[kind].reading === 'elevated' || signal[kind].reading === 'critical');
  const what = short.map((kind) => (kind === 'memory' ? 'memory' : 'disk space')).join(' and ');
  return {
    id: `resource-pressure:${episode}`,
    priority: PRIORITY,
    tone: signal.level === 'critical' ? 'danger' : 'warning',
    icon: 'alert',
    title: `Hermes is short of ${what}`,
    body: `${short.map((kind) => `${pressureClause(kind, signal[kind])}.`).join(' ')} Agents may slow down or fail until it eases.`,
    actions: [{ label: 'Open Health', to: '/observe/health' }],
    dismissible: true,
  };
}
