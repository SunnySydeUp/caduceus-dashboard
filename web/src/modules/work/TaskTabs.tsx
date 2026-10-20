// The six panels of the task page. Each reads what Hermes holds (`TaskDetail`) and asks the page to change it; none keeps anything.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { plainDuration } from '../../plain-duration.ts';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Rich } from '../chat/Rich.tsx';
import { keepTaskFile } from '../artifacts/artifacts-data.ts';
import { ProfileRemoteBadge } from '../tools/RemoteBadge.tsx';
import { addLink, deleteAttachment, postComment, removeLink, uploadAttachment } from './task-actions.ts';
import { loadAttachmentText } from './task-data.ts';
import { requests } from './task-requests.ts';
import { activityOf, runRows, type TaskAttachment, type TaskDetail } from './task-model.ts';
import { taskHref } from './TaskPeek.tsx';

export const when = (seconds: number) => new Date(seconds * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

interface PanelProps {
  detail: TaskDetail;
  slug: string | undefined;
  /** Reads the task again now, for a change the events socket has not yet reported. */
  reload(): void;
}

/** Tells the owner what an action came to: a failure in words, and nothing for a decline. Returns whether it worked. */
export function report(outcome: { kind: 'done' } | { kind: 'cancelled' } | { kind: 'failed'; message: string }, done: string): boolean {
  if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
  if (outcome.kind === 'done') toast(done, { tone: 'success' });
  return outcome.kind === 'done';
}

export function BriefPanel({ detail }: PanelProps) {
  const { task, childResults } = detail;
  return (
    <div className="td-stack">
      {task.brief.trim() ? <Rich text={task.brief} anchor="task-brief" /> : <p className="subtle">This task has no brief.</p>}
      {task.result && (
        <section aria-labelledby="td-result">
          <h3 id="td-result" className="overline">
            Result
          </h3>
          <Rich text={task.result} anchor="task-result" />
        </section>
      )}
      {childResults.length > 0 && (
        <section aria-labelledby="td-children-results">
          <h3 id="td-children-results" className="overline">
            Subtasks
          </h3>
          <ul className="td-list">
            {childResults.map((child) => (
              <li key={child.id}>
                <AppLink to={taskHref(child.id, undefined)}>{child.title}</AppLink> <span className="tag">{child.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function RunsPanel({ detail, slug, nowSeconds }: PanelProps & { nowSeconds: number }) {
  const rows = runRows(detail.runs, nowSeconds);
  if (rows.length === 0) return <p className="subtle">No worker has run this task yet. A <Term id="kanban-run">run</Term> appears here when one does.</p>;
  return (
    <ol className="td-runs">
      {rows.map((row) => (
        <li key={row.id} className="card td-run">
          <div className="td-run__head">
            <AppLink className="td-run__link" to={`/work/runs/${row.id}${slug ? `?board=${encodeURIComponent(slug)}` : ''}`}>
              Run {row.id}
            </AppLink>
            <span className="tag" data-tone={row.running ? 'running' : row.outcomeLabel === 'Completed' ? 'success' : row.outcomeLabel === 'Crashed' || row.outcomeLabel === 'Timed out' || row.outcomeLabel === 'Could not start' ? 'danger' : undefined}>
              {row.outcomeLabel}
            </span>
            <span className="subtle">{row.status}</span>
          </div>
          <dl className="td-facts td-facts--inline">
            <div>
              <dt>Profile</dt>
              <dd>{row.profile ?? '—'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{when(row.startedAt)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{plainDuration(row.durationSeconds)}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{row.costUsd === null ? <span title="Hermes does not record what a run cost; this shows when the worker reports one.">—</span> : `$${row.costUsd.toFixed(row.costUsd < 1 ? 3 : 2)}`}</dd>
            </div>
          </dl>
          {row.summary && <p className="td-run__summary">{row.summary}</p>}
          {row.error && <p className="td-run__error mono">{row.error}</p>}
        </li>
      ))}
    </ol>
  );
}

export function ActivityPanel({ detail, slug, reload }: PanelProps) {
  const items = activityOf(detail);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || posting) return;
    setPosting(true);
    // The author is never sent: the Caduceus server stamps it.
    const worked = report(await postComment(detail.task.id, text, slug), 'Comment posted');
    setPosting(false);
    if (worked) {
      setText('');
      reload();
    }
  };
  return (
    <div className="td-stack">
      {items.length === 0 ? (
        <p className="subtle">Nothing has happened to this task yet.</p>
      ) : (
        <ol className="td-activity">
          {items.map((item) =>
            item.kind === 'comment' ? (
              <li key={item.key} className="td-activity__comment">
                <div className="td-activity__who">
                  <Sigil name={item.comment.author || 'unknown'} size="xs" />
                  <strong>{item.comment.author || 'unknown'}</strong>
                  <time className="subtle" dateTime={new Date(item.at * 1000).toISOString()}>
                    {when(item.at)}
                  </time>
                </div>
                <Rich text={item.comment.body} anchor={`comment-${item.comment.id}`} />
              </li>
            ) : (
              <li key={item.key} className="td-activity__event">
                <Icon name="clock" small />
                <span>{item.text}</span>
                <time className="subtle" dateTime={new Date(item.at * 1000).toISOString()}>
                  {when(item.at)}
                </time>
              </li>
            ),
          )}
        </ol>
      )}
      <form className="td-compose" onSubmit={post}>
        <label className="field__label" htmlFor="td-comment">
          Add a comment
        </label>
        <textarea id="td-comment" className="input" rows={3} value={text} onChange={(event) => setText(event.target.value)} />
        <div>
          <WriteButton type="submit" className="btn btn--primary" disabled={!text.trim() || posting}>
            <Icon name="send" />
            Post comment
          </WriteButton>
        </div>
      </form>
    </div>
  );
}

export function LinksPanel({ detail, slug, reload }: PanelProps) {
  const { task, links } = detail;
  const [other, setOther] = useState('');
  const [side, setSide] = useState<'parent' | 'child'>('parent');
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const id = other.trim();
    if (!id) return;
    const outcome = await (side === 'parent' ? addLink(id, task.id, slug) : addLink(task.id, id, slug));
    if (report(outcome, 'Link added')) {
      setOther('');
      reload();
    }
  };
  const remove = async (parent: string, child: string) => {
    if (report(await removeLink(parent, child, slug), 'Link removed')) reload();
  };
  const group = (title: string, ids: string[], pair: (id: string) => [string, string], empty: string) => (
    <section aria-label={title} className="td-links">
      <h3 className="overline">{title}</h3>
      {ids.length === 0 ? (
        <p className="subtle">{empty}</p>
      ) : (
        <ul className="td-list">
          {ids.map((id) => (
            <li key={id}>
              <AppLink className="mono" to={taskHref(id, slug)}>
                {id}
              </AppLink>
              <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Remove the link to ${id}`} onClick={() => void remove(...pair(id))}>
                <Icon name="x" small />
                Remove
              </WriteButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className="td-stack">
      {group('Parents', links.parents, (id) => [id, task.id], 'No task has to finish before this one.')}
      {group('Children', links.children, (id) => [task.id, id], 'No task waits for this one.')}
      <form className="td-compose" onSubmit={add}>
        <label className="field__label" htmlFor="td-link-id">
          Link another task
        </label>
        <div className="td-compose__row">
          <select className="input" aria-label="The other task is" value={side} onChange={(event) => setSide(event.target.value === 'child' ? 'child' : 'parent')}>
            <option value="parent">a parent: it runs first</option>
            <option value="child">a child: it waits for this one</option>
          </select>
          <input id="td-link-id" className="input mono" placeholder="Task id, like t_1a2b3c" autoComplete="off" value={other} onChange={(event) => setOther(event.target.value)} />
          <WriteButton type="submit" className="btn btn--secondary" disabled={!other.trim()}>
            <Icon name="plus" />
            Add link
          </WriteButton>
        </div>
      </form>
    </div>
  );
}

const PREVIEW_CHARS = 20_000;
const isText = (file: TaskAttachment) => /^text\//.test(file.contentType ?? '') || /\.(md|markdown|txt|json|ya?ml|csv|log|toml)$/i.test(file.filename);
const isImage = (file: TaskAttachment) => /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/.test(file.contentType ?? '');
const isMarkdown = (file: TaskAttachment) => file.contentType === 'text/markdown' || /\.(md|markdown)$/i.test(file.filename);

const bytes = (size: number) => (size < 1024 ? `${size} B` : size < 1_048_576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1_048_576).toFixed(1)} MB`);

function Preview({ file, slug }: { file: TaskAttachment; slug: string | undefined }) {
  const url = requests.attachmentUrl(file.id, slug);
  const [text, setText] = useState<{ text: string; truncated: boolean } | 'loading' | 'failed'>('loading');
  const readable = isText(file) && !isImage(file);
  useEffect(() => {
    if (!readable) return;
    let current = true;
    setText('loading');
    loadAttachmentText(url, PREVIEW_CHARS).then(
      (loaded) => current && setText(loaded),
      () => current && setText('failed'),
    );
    return () => {
      current = false;
    };
  }, [url, readable]);
  if (isImage(file)) return <img className="td-preview__image" src={url} alt={file.filename} />;
  if (!isText(file)) return <p className="subtle">There is no preview for this kind of file. Download it to open it.</p>;
  if (text === 'failed') return <p className="error-text">Hermes did not give this file.</p>;
  if (text === 'loading') return <p role="status">Reading the file…</p>;
  return (
    <div className="td-preview__text">
      {isMarkdown(file) ? <Rich text={text.text} anchor={`attachment-${file.id}`} /> : <pre className="mono">{text.text}</pre>}
      {text.truncated && <p className="subtle">Showing the first {PREVIEW_CHARS.toLocaleString()} characters. Download the file for the rest.</p>}
    </div>
  );
}

export function AttachmentsPanel({ detail, slug, reload }: PanelProps) {
  const [open, setOpen] = useState<number>();
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    let worked = true;
    for (const file of files) worked = report(await uploadAttachment(detail.task.id, file, slug), `Uploaded ${file.name}`) && worked;
    setBusy(false);
    if (worked) reload();
  };
  const [keptIds, setKeptIds] = useState<ReadonlySet<number>>(new Set());
  const keep = async (file: TaskAttachment) => {
    if (keptIds.has(file.id)) return;
    const outcome = await keepTaskFile(slug ?? 'default', detail.task.id, file.id);
    if (outcome.kind === 'done') setKeptIds((ids) => new Set(ids).add(file.id));
    if (outcome.kind === 'done') toast(`Kept ${file.filename} in Artifacts`, { tone: 'success' });
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
  };
  const remove = async (file: TaskAttachment) => {
    if (report(await deleteAttachment(file, detail.task.assignee ?? undefined, slug), `Deleted ${file.filename}`)) reload();
  };
  return (
    <div className="td-stack">
      {detail.attachments.length === 0 ? (
        <p className="subtle">No files are attached. Workers can read what you attach.</p>
      ) : (
        <ul className="td-files">
          {detail.attachments.map((file) => (
            <li key={file.id} className="card">
              <div className="td-files__row">
                <button type="button" className="btn btn--ghost td-files__name" aria-expanded={open === file.id} onClick={() => setOpen(open === file.id ? undefined : file.id)}>
                  <Icon name="file" small />
                  <span>{file.filename}</span>
                </button>
                <span className="subtle">
                  {bytes(file.size)}
                  {file.uploadedBy ? ` · ${file.uploadedBy}` : ''}
                </span>
                <a className="btn btn--ghost btn--sm" href={requests.attachmentUrl(file.id, slug)} download={file.filename}>
                  <Icon name="download" small />
                  <span className="sr-only">Download {file.filename}</span>
                  <span aria-hidden="true">Download</span>
                </a>
                <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`${keptIds.has(file.id) ? 'Kept in Artifacts' : 'Keep in Artifacts'}: ${file.filename}`} disabled={keptIds.has(file.id)} onClick={() => void keep(file)}>
                  <Icon name="package" small />
                  {keptIds.has(file.id) ? 'Kept' : 'Keep in Artifacts'}
                </WriteButton>
                <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Delete ${file.filename}`} onClick={() => void remove(file)}>
                  <Icon name="trash" small />
                  Delete
                </WriteButton>
              </div>
              {open === file.id && <Preview file={file} slug={slug} />}
            </li>
          ))}
        </ul>
      )}
      <div>
        <label className="btn btn--secondary td-upload">
          <Icon name="arrow-up" />
          {busy ? 'Uploading…' : 'Upload a file'}
          <input type="file" multiple className="sr-only" disabled={busy} onChange={(event) => { void upload(event.currentTarget.files); event.currentTarget.value = ''; }} />
        </label>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SettingsPanel({ detail, slug }: PanelProps) {
  const { task } = detail;
  const query = slug ? `?board=${encodeURIComponent(slug)}` : '';
  const none = <span className="subtle">Not set</span>;
  return (
    <div className="td-stack">
      <dl className="td-facts">
        <Fact label="Task">
          <span className="mono">{task.id}</span>
        </Fact>
        <Fact label="Assignee">{task.assignee ?? <span className="subtle">Unassigned</span>}</Fact>
        <Fact label="Priority">{task.priority}</Fact>
        <Fact label="Tenant">{task.tenant ?? none}</Fact>
        <Fact label="Project">{task.projectId ?? none}</Fact>
        <Fact label="Workspace">
          {task.workspaceKind}
          {task.workspacePath ? <span className="mono"> · {task.workspacePath}</span> : null}
          {task.workspacePath ? <ProfileRemoteBadge profile={task.assignee ?? undefined} /> : null}
        </Fact>
        {task.branchName && (
          <Fact label="Branch">
            <span className="mono">{task.branchName}</span>
          </Fact>
        )}
        <Fact label="Skills">{task.skills === null ? <span className="subtle">The profile’s defaults</span> : task.skills.length === 0 ? <span className="subtle">None</span> : task.skills.join(', ')}</Fact>
        <Fact label="Model">{task.modelOverride ? `${task.modelOverride}${task.providerOverride ? ` (${task.providerOverride})` : ''}` : <span className="subtle">The profile’s model</span>}</Fact>
        <Fact label="Reasoning effort">{task.reasoningEffort ?? <span className="subtle">The profile’s level</span>}</Fact>
        <Fact label="Time limit">{task.maxRuntimeSeconds === null ? <span className="subtle">No limit</span> : plainDuration(task.maxRuntimeSeconds)}</Fact>
        <Fact label="Retries">{task.maxRetries === null ? <span className="subtle">The dispatcher’s limit</span> : `Blocked after ${task.maxRetries} ${task.maxRetries === 1 ? 'failure' : 'failures'} in a row`}</Fact>
        <Fact label="Goal mode">{task.goalMode ? `On${task.goalMaxTurns ? `, up to ${task.goalMaxTurns} turns` : ''}` : 'Off'}</Fact>
        <Fact label="Completion contract">{task.completionContract === null ? <span className="subtle">local-only</span> : <span className="mono">{task.completionContract}</span>}</Fact>
        <Fact label="Toolsets">
          {task.assignee ? (
            <>
              The toolsets of {task.assignee}, <AppLink to={`/agents/profiles/${encodeURIComponent(task.assignee)}/tools`}>which you edit on the profile</AppLink>
            </>
          ) : (
            <span className="subtle">The assignee’s, once the task has one</span>
          )}
        </Fact>
        <Fact label="Created">
          {when(task.createdAt)}
          {task.createdBy ? ` by ${task.createdBy}` : ''}
        </Fact>
        {task.startedAt !== null && <Fact label="Started">{when(task.startedAt)}</Fact>}
        {task.completedAt !== null && <Fact label="Completed">{when(task.completedAt)}</Fact>}
        {task.consecutiveFailures > 0 && <Fact label="Failures in a row">{task.consecutiveFailures}</Fact>}
        {task.lastFailureError && (
          <Fact label="Last failure">
            <span className="mono">{task.lastFailureError}</span>
          </Fact>
        )}
      </dl>
      <div className="td-edit">
        <AppLink className="btn btn--secondary" to={`/work/tasks/${encodeURIComponent(task.id)}/edit${query}`}>
          <Icon name="sliders" />
          Edit
        </AppLink>
        <AppLink className="btn btn--ghost" to={`/work/tasks/new?from=${encodeURIComponent(task.id)}${slug ? `&board=${encodeURIComponent(slug)}` : ''}`}>
          <Icon name="copy" />
          Duplicate with changes
        </AppLink>
        <p className="subtle">Edit changes the title, brief, profile, priority, model and reasoning effort. Hermes cannot change the rest after the task is made: duplicate it with the changes instead.</p>
      </div>
    </div>
  );
}
