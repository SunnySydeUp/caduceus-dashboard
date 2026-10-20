// Hermes's resource-pressure signal: the `memory` and `disk` blocks of `GET /api/status`, each with Hermes's own verdict (`pressure`). Health (the server)
// and the app-wide banner (the web app) both read it through here, so they never disagree about what Hermes said. Hermes classifies the pressure itself
// (`gateway/memory_status.py`, `gateway/disk_status.py`); nothing here repeats its thresholds.
import { isRecord } from './policy/guards.ts';

export type PressureLevel = 'ok' | 'elevated' | 'critical';
/** `unknown` is what Hermes says when it could not read the sample (the gateway is down, or the platform has no reading): never to be taken as `ok`. */
export type PressureReading = PressureLevel | 'unknown';

export interface GaugePressure {
  reading: PressureReading;
  /** What is left, in MB: memory available to programs, or disk free. */
  freeMb?: number;
  totalMb?: number;
}

export interface ResourcePressure {
  memory: GaugePressure;
  disk: GaugePressure;
  /** The worse of the two readings that are known; `unknown` when Hermes gave neither. */
  level: PressureReading;
  /** Names this life of Hermes's gateway (its `boot_id`): after a restart it is another one. */
  bootId?: string;
  /** Hermes's gateway was last started after an unclean exit that looks like an out-of-memory kill. */
  lastStartSuspectedOom: boolean;
}

/** How bad each reading is; `unknown` is below `ok` so that a known reading always wins over a missing one. */
export const PRESSURE_RANK: Record<PressureReading, number> = { unknown: -1, ok: 0, elevated: 1, critical: 2 };

const READINGS: Record<string, PressureLevel> = { ok: 'ok', elevated: 'elevated', critical: 'critical' };

const megabytes = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);

function gaugeOf(block: unknown, free: string, total: string): GaugePressure {
  if (!isRecord(block)) return { reading: 'unknown' };
  const freeMb = megabytes(block[free]);
  const totalMb = megabytes(block[total]);
  const reading = typeof block.pressure === 'string' && Object.hasOwn(READINGS, block.pressure) ? READINGS[block.pressure] : 'unknown';
  return { reading, ...(freeMb === undefined ? {} : { freeMb }), ...(totalMb === undefined ? {} : { totalMb }) };
}

/** Reads the signal from Hermes's status, which declares no schema: anything missing or odd is `unknown`. */
export function readPressure(status: unknown): ResourcePressure {
  const answer = isRecord(status) ? status : {};
  const memory = gaugeOf(answer.memory, 'system_available_mb', 'system_total_mb');
  const disk = gaugeOf(answer.disk, 'free_mb', 'total_mb');
  const level = PRESSURE_RANK[memory.reading] >= PRESSURE_RANK[disk.reading] ? memory.reading : disk.reading;
  const block = isRecord(answer.memory) ? answer.memory : {};
  return {
    memory,
    disk,
    level,
    ...(typeof block.boot_id === 'string' && block.boot_id !== '' ? { bootId: block.boot_id } : {}),
    lastStartSuspectedOom: block.last_boot_suspected_oom === true,
  };
}

/** An amount of room as a person says it: "40 MB", "16.0 GB". */
export const roomText = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

/**
 * What Hermes reports about one gauge that is under pressure, as a clause: “Hermes reports critical memory pressure: 40 MB of 16.0 GB is available”.
 * `where` goes after the amounts (“ on the disk it uses”). It has no full stop, so a sentence can go on from it.
 */
export function pressureClause(kind: 'memory' | 'disk', gauge: GaugePressure, where = ''): string {
  const room = gauge.freeMb !== undefined && gauge.totalMb !== undefined ? `: ${roomText(gauge.freeMb)} of ${roomText(gauge.totalMb)} is ${kind === 'memory' ? 'available' : 'free'}${where}` : where;
  return `Hermes reports ${gauge.reading} ${kind} pressure${room}`;
}
