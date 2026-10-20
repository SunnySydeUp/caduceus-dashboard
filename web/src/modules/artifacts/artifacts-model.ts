// What Workspace › Artifacts knows, free of the DOM and of React (M6 #05): the server's list as the page uses it, the words for sources and kinds, where an
// artifact links back to, and the viewer's choice of how to show a file.
import { ARTIFACT_KINDS, ARTIFACT_SOURCE_TYPES, VIEWABLE_KINDS, type Artifact, type ArtifactKind, type ArtifactList, type ArtifactSourceType } from '@caduceus/contracts/artifacts';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { formatSize } from '../files/files-model.ts';
import { runPath } from '../work/playbook-model.ts';

export const sizeWords = formatSize;

export const SOURCE_LABELS: Readonly<Record<ArtifactSourceType, string>> = { session: 'Chat session', task: 'Task', run: 'Playbook run' };

export const KIND_LABELS: Readonly<Record<ArtifactKind, string>> = { markdown: 'Report (Markdown)', html: 'HTML page', image: 'Image', pdf: 'PDF', text: 'Text', file: 'Other file' };

/** The list filters, as the page keeps them in its address. */
export interface ArtifactFilters {
  source?: ArtifactSourceType;
  kind?: ArtifactKind;
}

export const filterQuery = ({ source, kind }: ArtifactFilters, extra: Record<string, string> = {}): string => {
  const params = new URLSearchParams(extra);
  if (source !== undefined) params.set('source', source);
  if (kind !== undefined) params.set('kind', kind);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
};

/** The filters an address holds; anything that is not a source or a kind is dropped. */
export function filtersOf(search: { source?: unknown; kind?: unknown }): ArtifactFilters {
  return { source: ARTIFACT_SOURCE_TYPES.find((type) => type === search.source), kind: ARTIFACT_KINDS.find((kind) => kind === search.kind) };
}

/** The page of the thing an artifact came from. */
export function sourceHref({ source }: Artifact): string {
  const board = source.board === undefined || source.board === 'default' ? '' : `?board=${encodeURIComponent(source.board)}`;
  switch (source.type) {
    case 'session':
      return `/chat/${encodeURIComponent(source.id)}`;
    case 'task':
      return `/work/tasks/${encodeURIComponent(source.id)}${board}`;
    case 'run':
      return source.playbook === undefined ? `/work/tasks/${encodeURIComponent(source.id)}${board}` : runPath(source.playbook, source.id, source.board);
  }
}

/** Reads `GET /_caduceus/api/artifacts`. */
export function parseList(body: unknown): ArtifactList | undefined {
  if (!isRecord(body) || !Array.isArray(body.artifacts) || !isRecord(body.usage) || typeof body.usage.bytes !== 'number' || typeof body.usage.capBytes !== 'number') return undefined;
  const artifacts = body.artifacts.filter((entry): entry is Artifact => isRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string' && isRecord(entry.source));
  return { artifacts, usage: { bytes: body.usage.bytes, capBytes: body.usage.capBytes } };
}

/** How the viewer shows a file: the kinds it opens, and a download for anything else. */
export const isViewable = (kind: ArtifactKind): boolean => VIEWABLE_KINDS.includes(kind);

export const contentUrl = (id: string, download = false): string => `/_caduceus/api/artifacts/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`;

/** Text files longer than this are cut for the viewer (the download has all of it). */
export const TEXT_VIEW_LIMIT = 1_000_000;
