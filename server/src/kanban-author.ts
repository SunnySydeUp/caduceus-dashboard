// Who a Kanban comment or upload is by: the owner, as Caduceus knows them. The browser never says (a forged `author` or
// `uploaded_by` is overwritten), so a task's history cannot name someone the owner is not.
export const KANBAN_AUTHOR = 'owner';

const COMMENT = /^\/api\/plugins\/kanban\/tasks\/[^/]+\/comments$/;
const ATTACHMENT = /^\/api\/plugins\/kanban\/tasks\/[^/]+\/attachments$/;

export interface StampedBody {
  body: Uint8Array<ArrayBuffer>;
  /** The content type to forward: a multipart body is written again, with a boundary of its own. */
  contentType: string | undefined;
}

/** The request's body with the author set by Caduceus, or `undefined` when this request names no author. A body that is not what Hermes expects is left to Hermes to refuse. */
export async function stampAuthor(method: string, pathname: string, contentType: string | undefined, body: Uint8Array<ArrayBuffer>): Promise<StampedBody | undefined> {
  if (method !== 'POST') return undefined;
  if (COMMENT.test(pathname)) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
      return { body: new TextEncoder().encode(JSON.stringify({ ...parsed, author: KANBAN_AUTHOR })), contentType };
    } catch {
      return undefined;
    }
  }
  if (ATTACHMENT.test(pathname) && contentType?.toLowerCase().includes('multipart/form-data')) {
    try {
      const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
      form.set('uploaded_by', KANBAN_AUTHOR);
      const written = new Response(form);
      return { body: new Uint8Array(await written.arrayBuffer()), contentType: written.headers.get('content-type') ?? contentType };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
