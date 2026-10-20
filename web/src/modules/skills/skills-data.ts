// Reading Hermes for Agents › Skills. Only GETs live here; every change goes through `skill-actions.ts`. Nothing is kept beyond
// what the screen shows: a reload shows Hermes's skills (D1).
import { useCallback, useRef, useState } from 'react';
import { useLiveLoad } from '../../gateway.ts';
import { contentPath, filePath, folderPath, linkedFiles, listPath, parseFolder, parseSkills, readContent, readFile, type FileText, type LinkedFile, type SkillContent, type SkillRow } from './skills-model.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/** The profile's skills as Hermes lists them now. Throws when Hermes cannot be asked. */
export async function fetchSkills(profile: string): Promise<SkillRow[]> {
  return parseSkills(await read(listPath(profile)));
}

/** A skill's SKILL.md and its folder, or `undefined` when Hermes has no such skill. Throws when Hermes cannot be asked. */
export async function fetchSkillContent(profile: string, name: string): Promise<SkillContent | undefined> {
  const res = await fetch(contentPath(profile, name));
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${contentPath(profile, name)}: HTTP ${res.status}`);
  return readContent(await res.json());
}

/** The files beside a skill's SKILL.md, through Hermes's file listing. A folder Hermes cannot list is an empty one. */
export function fetchLinkedFiles(folder: string): Promise<LinkedFile[]> {
  return linkedFiles(folder, async (at) => parseFolder(await read(folderPath(at)).catch(() => ({}))));
}

/** One linked file's text, read-only. */
export async function fetchFileText(file: string): Promise<FileText> {
  const text = readFile(await read(filePath(file)));
  if (!text) throw new Error('Hermes sent no text for this file.');
  return text;
}

export interface SkillsState {
  /** `undefined` until Hermes has answered. It stays, as the last list Hermes gave, while a newer one is asked for or Hermes does not answer. */
  skills: SkillRow[] | undefined;
  /** The last ask failed: Hermes did not answer, so a list that shows is the last one Hermes gave. */
  failed: boolean;
  reload(): Promise<void>;
}

/** The profile's skills, loaded now and at every `gateway.ready`, never on a timer. A screen mounts one per profile (`key={profile}`). */
export function useSkills(profile: string): SkillsState {
  const [skills, setSkills] = useState<SkillRow[]>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await fetchSkills(profile);
      if (request !== latest.current) return;
      setSkills(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);
  useLiveLoad(() => void reload());
  return { skills, failed, reload };
}
