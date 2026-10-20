// Sending attachments to Hermes (M1 #10), free of the DOM and of React: each one goes through the gateway method that matches its kind
// (`image.attach_bytes`, `pdf.attach`, `file.attach`), with the bytes in the frame, since the browser's files are not on Hermes's disk.
import type { AttachedImageResult, FileAttachResult, ImageDetachResult, PdfAttachResult } from '@caduceus/contracts/hermes/gateway';

export type UploadKind = 'image' | 'pdf' | 'file';

/** One attachment on its way to Hermes. */
export interface Upload {
  name: string;
  kind: UploadKind;
  body: Blob;
}

/** Where one attachment is: Hermes has the bytes of `uploading` ones in flight, `attached` ones are queued for the next prompt, `failed` ones carry Hermes's words. */
export interface UploadStep {
  /** Its place in the list that was sent. */
  index: number;
  name: string;
  state: 'uploading' | 'attached' | 'failed';
  /** Why it failed. */
  error?: string;
}

/** What Hermes made of them: the images it queued for the next prompt (by path, to detach them again), and the lines the message gets. */
export interface Uploaded {
  /** The line that names each file in the prompt. */
  fileRefs: string[];
  /** Hermes's paths of the images and PDF pages it queued. */
  imagePaths: string[];
}

export type Requester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

const CHUNK = 0x8000;

/** The bytes as base64: in slices, since one `String.fromCharCode` call over a large file overflows the stack. */
export async function toBase64(body: Blob): Promise<string> {
  const bytes = new Uint8Array(await body.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}

const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Sends the attachments one after the other. Stops at the first Hermes refuses: the images already queued are taken off the session again
 * (`image.detach`), so that a second try does not send them twice, and the error says which attachment it was.
 */
export async function uploadAttachments(request: Requester, sessionId: string, uploads: readonly Upload[], onStep: (step: UploadStep) => void = () => undefined): Promise<Uploaded> {
  const done: Uploaded = { fileRefs: [], imagePaths: [] };
  for (const [index, upload] of uploads.entries()) {
    onStep({ index, name: upload.name, state: 'uploading' });
    try {
      const content = await toBase64(upload.body);
      if (upload.kind === 'image') {
        const result = await request<AttachedImageResult>('image.attach_bytes', { session_id: sessionId, content_base64: content, filename: upload.name });
        if (!result.attached || !result.path) throw new Error(result.message ?? 'Hermes did not take the image.');
        done.imagePaths.push(result.path);
      } else if (upload.kind === 'pdf') {
        const result = await request<PdfAttachResult>('pdf.attach', { session_id: sessionId, content_base64: content, filename: upload.name });
        if (!result.attached) throw new Error('Hermes did not take the PDF.');
        done.imagePaths.push(...result.pages.map((page) => page.path));
      } else {
        const result = await request<FileAttachResult>('file.attach', { session_id: sessionId, data_url: `data:${upload.body.type || 'application/octet-stream'};base64,${content}`, name: upload.name });
        if (!result.attached) throw new Error('Hermes did not take the file.');
        // An uploaded file is staged outside the chat's workspace, where Hermes's `@file:` expansion refuses it: the message says where it is, as Hermes's own drop does, and the agent reads it with its tools.
        done.fileRefs.push(result.ref_path.startsWith('/') ? `[User attached file: ${result.path}]` : result.ref_text);
      }
      onStep({ index, name: upload.name, state: 'attached' });
    } catch (error) {
      onStep({ index, name: upload.name, state: 'failed', error: words(error) });
      for (const path of done.imagePaths) await request<ImageDetachResult>('image.detach', { session_id: sessionId, path }).catch(() => undefined);
      throw new Error(`${upload.name}: ${words(error)}`);
    }
  }
  return done;
}
