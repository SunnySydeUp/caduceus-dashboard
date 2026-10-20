// The requests the task page sends to Hermes's Kanban plugin, as data: pure, so a server test can send the very same ones to the real
// Hermes through Caduceus. `task-actions.ts` adds the dialogs.
const KANBAN = '/api/plugins/kanban';

/** A request without its confirmation dialog; `fetchTiered` takes it as it is. */
export interface Plain {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export const board = (slug: string | undefined, extra: Record<string, string> = {}) => {
  const query = new URLSearchParams(extra);
  if (slug) query.set('board', slug);
  const text = query.toString();
  return text ? `?${text}` : '';
};

const taskPath = (taskId: string) => `${KANBAN}/tasks/${encodeURIComponent(taskId)}`;

/** The requests, as Hermes's Kanban plugin takes them. */
export const requests = {
  comment: (taskId: string, text: string, slug?: string): Plain => ({ method: 'POST', path: `${taskPath(taskId)}/comments${board(slug)}`, body: { body: text } }),
  setStatus: (taskId: string, status: string, slug?: string): Plain => ({ method: 'PATCH', path: `${taskPath(taskId)}${board(slug)}`, body: { status } }),
  /** Retry: back to Ready. Caduceus does it (a T1 of its own, audited), where a card's move to Ready in the board is Hermes's own T0 `PATCH`. */
  retry: (taskId: string, slug?: string): Plain => ({ method: 'POST', path: `/_caduceus/api/work/tasks/${encodeURIComponent(taskId)}/retry${board(slug)}` }),
  dispatch: (slug?: string): Plain => ({ method: 'POST', path: `${KANBAN}/dispatch${board(slug)}` }),
  terminate: (runId: number, reason: string | undefined, slug?: string): Plain => ({ method: 'POST', path: `${KANBAN}/runs/${runId}/terminate${board(slug)}`, body: reason ? { reason } : {} }),
  reclaim: (taskId: string, reason: string | undefined, slug?: string): Plain => ({ method: 'POST', path: `${taskPath(taskId)}/reclaim${board(slug)}`, body: reason ? { reason } : {} }),
  reassign: (taskId: string, profile: string | null, reclaimFirst: boolean, slug?: string): Plain => ({ method: 'POST', path: `${taskPath(taskId)}/reassign${board(slug)}`, body: { profile: profile ?? '', reclaim_first: reclaimFirst } }),
  specify: (taskId: string, slug?: string): Plain => ({ method: 'POST', path: `${taskPath(taskId)}/specify${board(slug)}`, body: {} }),
  decompose: (taskId: string, slug?: string): Plain => ({ method: 'POST', path: `${taskPath(taskId)}/decompose${board(slug)}`, body: {} }),
  estimate: (taskId: string, slug?: string): Plain => ({ method: 'POST', path: `${taskPath(taskId)}/estimate${board(slug)}` }),
  link: (parentId: string, childId: string, slug?: string): Plain => ({ method: 'POST', path: `${KANBAN}/links${board(slug)}`, body: { parent_id: parentId, child_id: childId } }),
  unlink: (parentId: string, childId: string, slug?: string): Plain => ({ method: 'DELETE', path: `${KANBAN}/links${board(slug, { parent_id: parentId, child_id: childId })}` }),
  deleteAttachment: (attachmentId: number, slug?: string): Plain => ({ method: 'DELETE', path: `${KANBAN}/attachments/${attachmentId}${board(slug)}` }),
  /** Puts the title, brief and column back (what Reject does after a Specify). */
  restore: (taskId: string, snapshot: { title: string; brief: string; status: string }, slug?: string): Plain => ({ method: 'PATCH', path: `${taskPath(taskId)}${board(slug)}`, body: { status: snapshot.status, title: snapshot.title, body: snapshot.brief } }),
  upload: (taskId: string, slug?: string) => `${taskPath(taskId)}/attachments${board(slug)}`,
  attachmentUrl: (attachmentId: number, slug?: string) => `${KANBAN}/attachments/${attachmentId}${board(slug)}`,
};
