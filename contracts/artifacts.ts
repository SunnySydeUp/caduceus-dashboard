// Artifacts (M6 #05; work model §2.3, architecture §2 `artifacts/`): derived outputs Caduceus keeps in its own folder: a research report, a file a playbook stage
// handed in. An artifact is never a copy of Hermes data that Hermes still owns: the task or session it came from stays Hermes's, and the artifact only names it.
// The kind says how the page may show the file; a file of a kind the page does not know is offered as a download and nothing else.

export const ARTIFACT_KINDS = ['markdown', 'html', 'image', 'pdf', 'text', 'file'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The kinds the viewer can open; every other kind (`file`) is a download only. */
export const VIEWABLE_KINDS: readonly ArtifactKind[] = ['markdown', 'html', 'image', 'pdf', 'text'];

export const ARTIFACT_SOURCE_TYPES = ['session', 'task', 'run'] as const;
export type ArtifactSourceType = (typeof ARTIFACT_SOURCE_TYPES)[number];

/** Where an artifact came from: the id is the session's, the task's or the playbook run's root task. */
export interface ArtifactSource {
  type: ArtifactSourceType;
  id: string;
  /** The Kanban board of a task or run. */
  board?: string;
  /** The Hermes profile of a session. */
  profile?: string;
  /** The id of the playbook a run was of (its run page is under it). */
  playbook?: string;
  /** The task whose attachment it was (for a run, the stage's task). */
  taskId?: string;
  /** What to call the source: the playbook's name, the task's title or the session's title. */
  label: string;
}

export interface Artifact {
  id: string;
  /** The file's name as it was attached. */
  name: string;
  /** What the list shows: the first heading of a Markdown report, else the file's name. */
  title: string;
  kind: ArtifactKind;
  mime: string;
  size: number;
  source: ArtifactSource;
  pinned: boolean;
  /** Milliseconds since the epoch. */
  createdAt: number;
}

export interface ArtifactList {
  artifacts: Artifact[];
  /** Bytes of every artifact kept (those still in their undo window included) and the size the store is held under. */
  usage: { bytes: number; capBytes: number };
}

/** One artifact deleted (a T1): the file stays for `undoMs` and `POST …/restore` brings it back. */
export const ARTIFACT_UNDO_MS = 60_000;

export const DEFAULT_ARTIFACT_CAP_BYTES = 1024 * 1024 * 1024;
export const MIN_ARTIFACT_CAP_BYTES = 1024 * 1024;
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

const BY_EXTENSION: Readonly<Record<string, ArtifactKind>> = {
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image',
  pdf: 'pdf',
  txt: 'text', log: 'text', csv: 'text', json: 'text', yaml: 'text', yml: 'text', xml: 'text', toml: 'text', diff: 'text', patch: 'text',
};

/** The MIME types a page may put in an `<img>`: SVG is one only as an image source, where its scripts never run. */
const IMAGE_TYPES: Readonly<Record<string, true>> = { 'image/png': true, 'image/jpeg': true, 'image/gif': true, 'image/webp': true, 'image/avif': true, 'image/svg+xml': true };

/** The kind of a file, from its name first (what the owner or the worker called it) and then the type it was attached with. */
export function artifactKind(name: string, mime: string | null | undefined): ArtifactKind {
  const dot = name.lastIndexOf('.');
  const byName = dot > 0 ? BY_EXTENSION[name.slice(dot + 1).toLowerCase()] : undefined;
  if (byName !== undefined) return byName;
  const type = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'text/markdown') return 'markdown';
  if (type === 'text/html') return 'html';
  if (type === 'application/pdf') return 'pdf';
  if (IMAGE_TYPES[type] === true) return 'image';
  if (type === 'text/plain' || type === 'text/csv' || type === 'application/json') return 'text';
  return 'file';
}

/** The type a file is served with: the one its kind implies, never what the sender claimed, so a page can only be what the viewer expects. */
export function artifactMime(kind: ArtifactKind, name: string): string {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  switch (kind) {
    case 'markdown':
      return 'text/markdown; charset=utf-8';
    case 'html':
      return 'text/html; charset=utf-8';
    case 'pdf':
      return 'application/pdf';
    case 'image':
      return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' }[extension] ?? 'application/octet-stream';
    case 'text':
      return extension === 'json' ? 'application/json; charset=utf-8' : extension === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8';
    case 'file':
      return 'application/octet-stream';
  }
}

/** A Markdown report's title: its first level-one heading, if the file has one. */
export function markdownTitle(text: string): string | undefined {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text.slice(0, 20_000));
  return match?.[1].trim().slice(0, 200) || undefined;
}
