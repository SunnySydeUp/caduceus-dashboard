// Reading Hermes for the schedule builder and the blueprint gallery. Only GETs live here; saving goes through `schedules-actions.ts`.
// Nothing is kept: Hermes's profiles, blueprints and clock are asked for when a screen opens.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { useCallback, useEffect, useState } from 'react';
import { readCreateTaskScript, type TaskFields } from './create-task-script.ts';
import { parseBlueprints, parseProfileHomes, type Blueprint } from './job-form.ts';

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

export interface BuilderData {
  /** `loading` until Hermes has answered both; `failed` when it did not answer one of them. */
  status: 'loading' | 'ready' | 'failed';
  profiles: string[];
  homes: Record<string, string>;
  blueprints: Blueprint[];
  reload(): void;
}

/** Hermes's profiles (with where their scripts go) and its blueprints. */
export function useBuilderData(): BuilderData {
  const [state, setState] = useState<Omit<BuilderData, 'reload'>>({ status: 'loading', profiles: [], homes: {}, blueprints: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void Promise.all([read('/api/profiles'), read('/api/cron/blueprints')]).then(
      ([profiles, blueprints]) => {
        if (!current) return;
        const homes = parseProfileHomes(profiles);
        setState({ status: 'ready', profiles: Object.keys(homes), homes, blueprints: parseBlueprints(blueprints) });
      },
      () => current && setState((previous) => ({ ...previous, status: 'failed' })),
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  return { ...state, reload: useCallback(() => setAttempt((count) => count + 1), []) };
}

/** The time zone Hermes keeps time in for a profile, when its config names one; undefined means Hermes uses the Mac's own clock, which is the owner's. */
export function useHermesZone(profile: string): string | undefined {
  const [zone, setZone] = useState<{ profile: string; name: string | undefined }>();
  useEffect(() => {
    if (profile === '') return;
    let current = true;
    void read(`/api/config?profile=${encodeURIComponent(profile)}`).then(
      (config) => current && setZone({ profile, name: isRecord(config) && typeof config.timezone === 'string' && config.timezone.trim() !== '' ? config.timezone.trim() : undefined }),
      () => current && setZone({ profile, name: undefined }),
    );
    return () => {
      current = false;
    };
  }, [profile]);
  return zone?.profile === profile ? zone.name : undefined;
}

/** The names of a profile's skills, for the skills field to suggest. */
export function useSkillNames(profile: string): string[] {
  const [names, setNames] = useState<{ profile: string; list: string[] }>();
  useEffect(() => {
    if (profile === '') return;
    let current = true;
    void read(`/api/skills?profile=${encodeURIComponent(profile)}`).then(
      (body) => current && setNames({ profile, list: (Array.isArray(body) ? body : []).flatMap((skill) => (isRecord(skill) && typeof skill.name === 'string' ? [skill.name] : [])).sort() }),
      () => current && setNames({ profile, list: [] }),
    );
    return () => {
      current = false;
    };
  }, [profile]);
  return names?.profile === profile ? names.list : [];
}

/** What a Create-task job's script says it makes, read back from the script file; `undefined` when the script was not made by Caduceus. Throws when Hermes cannot be asked. */
export async function loadTaskFields(home: string, script: string): Promise<TaskFields | undefined> {
  const file = `${home.replace(/\/$/, '')}/scripts/${script.split('/').pop()}`;
  const body = await read(`/api/fs/read-text?path=${encodeURIComponent(file)}`);
  return isRecord(body) && typeof body.text === 'string' ? readCreateTaskScript(body.text) : undefined;
}

/** One place a job's result can be sent: Hermes's `local` (save only) or a messaging platform it is set up for. */
export interface DeliveryTarget {
  id: string;
  name: string;
  /** Hermes has a home channel for it; without one a delivery has nowhere to go. */
  ready: boolean;
}

/** Where Hermes is asked for the delivery targets of a profile: its platforms decide them, so the profile that owns the job is named (none yet: Hermes's current one). */
export const deliveryTargetsPath = (profile: string): string => `/api/cron/delivery-targets${profile === '' ? '' : `?profile=${encodeURIComponent(profile)}`}`;

/** Hermes's delivery targets for a profile (`GET /api/cron/delivery-targets`); empty until it answers, and when it does not. */
export function useDeliveryTargets(profile: string): DeliveryTarget[] {
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  useEffect(() => {
    let current = true;
    void read(deliveryTargetsPath(profile)).then(
      (body) => {
        const listed = isRecord(body) && Array.isArray(body.targets) ? body.targets : [];
        if (current) setTargets(listed.flatMap((entry) => (isRecord(entry) && typeof entry.id === 'string' ? [{ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id, ready: entry.home_target_set !== false }] : [])));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [profile]);
  return targets;
}

/** The text of a file Hermes holds, or `undefined` when it has none there (a script not yet written). Throws when Hermes cannot be asked. */
export async function loadScriptText(home: string, file: string): Promise<string | undefined> {
  const path = `${home.replace(/\/$/, '')}/scripts/${file.split('/').pop()}`;
  const response = await fetch(`/api/fs/read-text?path=${encodeURIComponent(path)}`);
  if (response.status >= 400 && response.status < 500) return undefined;
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  const body: unknown = await response.json();
  return isRecord(body) && typeof body.text === 'string' ? body.text : undefined;
}
