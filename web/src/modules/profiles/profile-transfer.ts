// Export and import of a profile (M4 #12), through Hermes's own endpoints. Hermes exchanges paths on the computer it runs on, not bytes: an
// export writes the archive there (secrets scrubbed, credential files left out: Hermes's work) and answers with its path; an import reads an
// archive from a path. So the browser's side is a download of the archive Hermes made, and an upload of the owner's file to a folder of
// Hermes's home before the import (and its removal after). Both are Tier 3 and need the owner's passkey; read-only mode blocks both.
// Caduceus keeps nothing: the archive is Hermes's, and the upload is deleted once Hermes has taken it.
import { toBase64 } from '../chat/attachment-upload.ts';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';

export interface TransferDeps {
  /** `fetchTiered`. */
  send(request: TieredRequest): Promise<TieredResult>;
  /** Hermes's managed-file download of an archive it made, through the policy proxy: the bytes. */
  download(path: string): Promise<Blob>;
}

export type ExportOutcome = { kind: 'done'; archive: Blob; fileName: string; hermesPath: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string };
export type ImportOutcome = { kind: 'done'; name: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** What Hermes's REST error says: FastAPI's `detail`, the policy's `message`, or the status. */
function reasonOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (typeof detail === 'string') return detail;
    if (typeof message === 'string') return message;
  }
  return `Hermes answered HTTP ${status}.`;
}

type Answered = { kind: 'ok'; body: Record<string, unknown> } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

async function answered(sending: Promise<TieredResult>): Promise<Answered> {
  const result = await sending;
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  const body: unknown = await result.response.json().catch(() => undefined);
  if (!result.response.ok) return { kind: 'failed', message: reasonOf(body, result.response.status) };
  return { kind: 'ok', body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {} };
}

/** The last segment of a path, for the file name the browser saves the archive as. */
export const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? 'profile.tar.gz';

/**
 * Exports a profile: Hermes writes the archive to its own export folder and the browser fetches it. The owner types the profile's name
 * (Tier 3): the archive holds the profile's SOUL, memory, skills and settings.
 */
export async function exportProfile(deps: TransferDeps, profile: string): Promise<ExportOutcome> {
  const made = await answered(
    deps.send({
      method: 'POST',
      path: `/api/profiles/${encodeURIComponent(profile)}/export`,
      body: {},
      confirm: {
        title: `Export ${profile}?`,
        text: 'Hermes packs the profile’s settings, SOUL, memory and skills into an archive, leaving its credential files out and hiding secrets in the text it keeps. The archive is saved on this computer, in Hermes’s export folder, and your browser downloads it.',
        object: profile,
        profile,
        confirmLabel: 'Export profile',
        recoverability: { undoable: true, note: 'Nothing in the profile changes. Delete the archive to undo it.' },
      },
    }),
  );
  if (made.kind !== 'ok') return made;
  const hermesPath = typeof made.body.archive === 'string' ? made.body.archive : undefined;
  if (!hermesPath) return { kind: 'failed', message: 'Hermes did not say where it saved the archive.' };
  try {
    return { kind: 'done', archive: await deps.download(hermesPath), fileName: baseName(hermesPath), hermesPath };
  } catch (error) {
    return { kind: 'failed', message: `Hermes made the archive at ${hermesPath} but it could not be downloaded: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface ImportRequest {
  file: Blob;
  /** The file's name, for the upload's own. */
  fileName: string;
  /** The name to import as; empty takes the archive's own folder name. */
  name: string;
  /** The profile Hermes puts imported archives under: the root profile's folder (`ProfileCard.path` of `default`). */
  rootPath: string;
  /** The time, for a name of the upload that no earlier one has. */
  now: number;
}

/** A file name that is safe as a path segment: the archive's own name, kept to letters, digits and `.-_`. */
const safeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(-80) || 'profile.tar.gz';

/**
 * Imports a profile archive: the file goes to Hermes's `profile-imports` folder (a Tier 1 upload, which the owner's choice of the file and
 * the import dialog already confirm), then Hermes imports it (Tier 3: the new profile's name typed), then the upload is removed whatever
 * the import said. The preview (`profile-archive.ts`) has already said what the name is and that it is free; Hermes has the last word.
 */
export async function importProfile(deps: TransferDeps, { file, fileName, name, rootPath, now }: ImportRequest, importedAs: string): Promise<ImportOutcome> {
  const uploadPath = `${rootPath.replace(/\/$/, '')}/profile-imports/${now}-${safeName(fileName)}`;
  const uploaded = await answered(
    deps.send({
      method: 'POST',
      path: '/api/files/upload',
      body: { path: uploadPath, data_url: `data:application/gzip;base64,${await toBase64(file)}`, overwrite: false },
      confirm: { title: 'Upload the archive to Hermes?', object: fileName, confirmLabel: 'Upload' },
      // The owner chose the file and pressed Import in a dialog that says what follows. Hermes's `profile-imports` folder is where Caduceus stages it, so the server judges it as it does a workspace's file.
      alreadyConfirmed: true,
      inWorkspace: true,
    }),
  );
  if (uploaded.kind !== 'ok') return uploaded;
  try {
    const done = await answered(
      deps.send({
        method: 'POST',
        path: '/api/profiles/import',
        body: { archive: uploadPath, ...(name.trim() === '' ? {} : { name: name.trim().toLowerCase() }) },
        confirm: {
          title: `Import the profile ${importedAs}?`,
          text: 'Hermes makes a new profile from the archive: its settings, SOUL, memory and skills. It does not replace a profile that exists. Keys are not in an archive, so add them afterwards.',
          object: importedAs,
          profile: importedAs,
          confirmLabel: 'Import profile',
          recoverability: { undoable: true, note: 'Delete the new profile to take it out again.' },
        },
      }),
    );
    if (done.kind !== 'ok') return done;
    return { kind: 'done', name: typeof done.body.name === 'string' ? done.body.name : importedAs };
  } finally {
    // The upload is only the way to hand the file to Hermes: it is removed whether or not the import took it.
    await deps.send({ method: 'DELETE', path: '/api/files', body: { path: uploadPath }, confirm: { title: 'Remove the uploaded archive?', object: fileName }, alreadyConfirmed: true, inWorkspace: true }).catch(() => undefined);
  }
}
