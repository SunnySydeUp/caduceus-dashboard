// The changes Workspace › Files makes, each through `fetchTiered` with the tier the policy map gives the route: upload, new folder and delete are T1, a
// text save is a T1 inside a workspace Caduceus knows and a T3 elsewhere, and emptying a folder with everything in it is a T3. The server keeps the
// text a save replaces as a snapshot and refuses a save made from a stale copy; this only asks first and says what happened.
import { fetchTiered } from '../../tiered.ts';
import { fingerprint, saveRequest } from '../profiles/behaviour-files.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { parentOf, toBase64, type FileEntry } from './files-model.ts';

export type SaveOutcome = { kind: 'saved' } | { kind: 'cancelled' } | { kind: 'failed'; message: string } | { kind: 'conflict'; current: string };

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;

/**
 * Saves `text` as the whole file. `base` is the text the editor was opened with: when the file is no longer that text the server refuses
 * (`conflict`, with the text now on disk) and nothing is written.
 */
export async function saveText(path: string, text: string, base: string, inWorkspace: boolean, profile: string | undefined): Promise<SaveOutcome> {
  const name = baseName(path);
  const result = await fetchTiered({
    ...saveRequest({ kind: 'file', path }, text, await fingerprint(base)),
    inWorkspace,
    confirm: {
      title: `Save ${name}?`,
      text: inWorkspace ? 'Hermes replaces the file with this text. Caduceus keeps the text it replaces as a snapshot first.' : `${path} is outside your workspaces (a protected area), so saving it needs your passkey and its name typed. Caduceus keeps the text it replaces as a snapshot first.`,
      object: name,
      profile,
      confirmLabel: 'Save',
      recoverability: { undoable: true, note: 'The previous text is kept as a snapshot.' },
    },
  });
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  const body: unknown = await result.response.json().catch(() => undefined);
  if (result.response.ok) return { kind: 'saved' };
  const answer = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; current?: unknown; message?: unknown; detail?: unknown };
  if (result.response.status === 409 && answer.error === 'conflict' && typeof answer.current === 'string') return { kind: 'conflict', current: answer.current };
  return { kind: 'failed', message: typeof answer.message === 'string' ? answer.message : typeof answer.detail === 'string' ? answer.detail : `Hermes answered HTTP ${result.response.status}.` };
}

/** Makes a folder (T1 inside a workspace, T3 elsewhere: `inWorkspace` is whether the folder is inside one, which the server judges in the end). */
export function makeFolder(path: string, profile: string | undefined, inWorkspace: boolean): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/api/files/mkdir',
      body: { path },
      inWorkspace,
      confirm: { title: `Create the folder ${baseName(path)}?`, text: path, object: path, profile, confirmLabel: 'Create folder' },
    }),
  );
}

/** The bytes of a file as a `data:` URL, the way Hermes's upload route takes them. */
function readAsDataUrl(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
  reader.readAsDataURL(file);
  return promise;
}

/** Uploads files into a folder: one confirmation for the lot in a workspace (T1), one passkey and typed name per file elsewhere (T3). A file that is already there is not replaced. Stops at the first that fails. */
export async function uploadFiles(folder: string, files: readonly File[], profile: string | undefined, inWorkspace: boolean): Promise<ActionOutcome<{ uploaded: number }>> {
  let uploaded = 0;
  for (const [index, file] of files.entries()) {
    const outcome = await runTiered(
      fetchTiered({
        method: 'POST',
        path: '/api/files/upload',
        body: { path: `${folder.replace(/\/+$/, '')}/${file.name}`, data_url: await readAsDataUrl(file), overwrite: false },
        alreadyConfirmed: index > 0,
        inWorkspace,
        confirm: {
          title: files.length === 1 ? `Upload ${file.name}?` : `Upload ${files.length} files?`,
          text: `Into ${folder}. A file with the same name is not replaced.`,
          object: folder,
          profile,
          confirmLabel: 'Upload',
        },
      }),
    );
    if (outcome.kind === 'cancelled') return outcome;
    if (outcome.kind === 'failed') return { kind: 'failed', message: uploaded > 0 ? `${outcome.message} (${uploaded} of ${files.length} were uploaded.)` : outcome.message };
    uploaded++;
  }
  return { kind: 'done', body: { uploaded } };
}

/** Deletes a file or an empty folder (T1 in a workspace, T3 elsewhere, naming the path and profile). With `contents` a folder goes with everything in it (T3, its name typed). */
export function deleteEntry(entry: Pick<FileEntry, 'name' | 'path' | 'directory'>, profile: string | undefined, contents: boolean, inWorkspace: boolean): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'DELETE',
      path: '/api/files',
      body: { path: entry.path, recursive: contents },
      inWorkspace,
      confirm: {
        title: contents ? `Delete ${entry.name} and everything in it?` : `Delete ${entry.name}?`,
        text: entry.path,
        object: contents ? entry.name : entry.path,
        profile,
        confirmLabel: 'Delete',
        recoverability: { undoable: false, note: 'Hermes deletes it from the Mac; Caduceus keeps no copy.' },
      },
    }),
  );
}

/** SHA-256 in hex of a document's bytes, the way an Office save names the bytes it was opened from. */
export async function fingerprintBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type OfficeSaveOutcome = { kind: 'saved'; sha256: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string } | { kind: 'conflict' };

/**
 * Saves an Office document over the file. `base` is the fingerprint of the bytes it was opened from: when the file is no longer those bytes the server
 * refuses (`conflict`) and nothing is written. The server keeps the bytes it replaces as a snapshot first. A T1 inside a workspace, a T3 elsewhere.
 */
export async function saveOffice(path: string, bytes: Uint8Array<ArrayBuffer>, base: string, inWorkspace: boolean, profile: string | undefined): Promise<OfficeSaveOutcome> {
  const name = baseName(path);
  const result = await fetchTiered({
    method: 'PUT',
    path: '/_caduceus/api/files/office',
    body: { path, content: toBase64(bytes), base, ...(profile ? { profile } : {}) },
    inWorkspace,
    confirm: {
      title: `Save ${name}?`,
      text: inWorkspace ? 'Caduceus replaces the document with your version. It keeps the bytes it replaces as a snapshot first.' : `${path} is outside your workspaces (a protected area), so saving it needs your passkey and its name typed. Caduceus keeps the bytes it replaces as a snapshot first.`,
      object: name,
      profile,
      confirmLabel: 'Save',
      recoverability: { undoable: true, note: 'The previous version is kept as a snapshot.' },
    },
  });
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  const body: unknown = await result.response.json().catch(() => undefined);
  const answer = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; message?: unknown; sha256?: unknown };
  if (result.response.ok && typeof answer.sha256 === 'string') return { kind: 'saved', sha256: answer.sha256 };
  if (result.response.status === 409 && answer.error === 'conflict') return { kind: 'conflict' };
  return { kind: 'failed', message: typeof answer.message === 'string' ? answer.message : `Caduceus answered HTTP ${result.response.status}.` };
}

/** Where a rename or a move put the file or folder, as the server canonicalised it. */
export interface Relocated {
  from: string;
  to: string;
}

/** Renames a file or folder in its folder (T0 in a workspace: no dialog, and the toast offers the undo, which is this again with the old name; T3 elsewhere). */
export function renameEntry(path: string, name: string, profile: string | undefined, inWorkspace: boolean): Promise<ActionOutcome<Relocated>> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/_caduceus/api/files/rename',
      body: { path, name, ...(profile ? { profile } : {}) },
      inWorkspace,
      confirm: { title: `Rename ${baseName(path)} to ${name}?`, text: `${path} is outside your workspaces (a protected area), so renaming it needs your passkey and its name typed.`, object: baseName(path), profile, confirmLabel: 'Rename' },
    }),
  );
}

/** Moves a file or folder into another folder (T1 when both are in a workspace, T3 otherwise; naming the source, the destination and the profile). */
export function moveEntry(entry: Pick<FileEntry, 'name' | 'path'>, destination: string, profile: string | undefined, inWorkspace: boolean): Promise<ActionOutcome<Relocated>> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/_caduceus/api/files/move',
      body: { path: entry.path, destination, ...(profile ? { profile } : {}) },
      inWorkspace,
      confirm: {
        title: `Move ${entry.name}?`,
        text: `From ${parentOf(entry.path)} to ${destination}. Nothing is overwritten: a name that is taken in the destination stops the move.`,
        object: destination,
        profile,
        confirmLabel: 'Move',
      },
    }),
  );
}
