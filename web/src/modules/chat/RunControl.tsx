// Run control (M1 #07): what the owner has set going beside the running turn, above the composer. What they steered the turn with, the
// messages queued behind it (each can be edited, or cancelled, which hands its text back to the composer) and the side tasks (`/btw`,
// `/background`) with their results. The state is the chat engine's; the goal is in the context panel's Run tab.
import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import type { Chat, ChatState, SideTask } from './chat-session.ts';
import type { QueuedMessage } from './queue.ts';
import { Rich } from './Rich.tsx';

/** The first words of a message, for naming its buttons. */
const gist = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text);

function QueueItem({ item, position, chat, toComposer }: { item: QueuedMessage; position: number; chat: Chat | undefined; toComposer(text: string): void }) {
  const [editing, setEditing] = useState<string>();
  const fieldId = useId();
  if (editing !== undefined) {
    const save = () => {
      chat?.editQueued(item.id, editing);
      setEditing(undefined);
    };
    return (
      <li className="run__item run__item--editing">
        <label className="sr-only" htmlFor={fieldId}>
          Queued message {position}
        </label>
        <textarea id={fieldId} className="input run__edit" rows={2} value={editing} autoFocus onChange={(event) => setEditing(event.target.value)} />
        <div className="run__acts">
          <button type="button" className="btn btn--primary btn--sm" disabled={editing.trim() === ''} onClick={save}>
            Save
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(undefined)}>
            Discard changes
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="run__item">
      <span className="run__pos" aria-hidden="true">
        {position}
      </span>
      <span className="run__text">{item.text}</span>
      <div className="run__acts">
        <button type="button" className="btn btn--ghost btn--sm" aria-label={`Edit queued message: ${gist(item.text)}`} onClick={() => setEditing(item.text)}>
          Edit
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label={`Cancel queued message and put it back in the message box: ${gist(item.text)}`}
          onClick={() => {
            const text = chat?.cancelQueued(item.id);
            if (text !== undefined) toComposer(text);
          }}
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

function SideTaskRow({ task, chat }: { task: SideTask; chat: Chat | undefined }) {
  const [open, setOpen] = useState(false);
  const label = task.kind === 'btw' ? 'Side question' : 'Background task';
  const finished = task.status !== 'running';
  return (
    <li className="run__item run__item--task" data-status={task.status}>
      <Icon name={task.status === 'running' ? 'running' : task.status === 'failed' ? 'failed' : 'succeeded'} small className={task.status === 'running' ? 'spin' : undefined} />
      <span className="run__text">
        <span className="run__label">{label}</span> <span className="subtle">{task.prompt}</span>
      </span>
      <span className="run__state" role="status">
        {task.status === 'running' ? (task.kind === 'btw' ? 'Answering…' : 'Running…') : task.status === 'failed' ? 'Failed' : 'Done'}
        {task.unseen && <span className="count count--accent run__new">new</span>}
      </span>
      {finished && (
        <div className="run__acts">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-label={`${task.kind === 'btw' ? 'Show the answer to' : 'Open the result of'}: ${gist(task.prompt)}`}
            onClick={() => {
              setOpen(true);
              chat?.readSideTask(task.id);
            }}
          >
            {task.kind === 'btw' ? 'Show answer' : 'Open result'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" aria-label={`Dismiss: ${gist(task.prompt)}`} onClick={() => chat?.dismissSideTask(task.id)}>
            Dismiss
          </button>
        </div>
      )}
      {open && (
        <Sheet title={task.kind === 'btw' ? 'Answer to your side question' : 'Background result'} detents={['half', 'full']} onClose={() => setOpen(false)}>
          <p className="subtle run__asked">{task.prompt}</p>
          {task.status === 'failed' ? (
            <p className="banner" data-tone="danger" role="alert">
              <Icon name="alert" />
              <span className="banner__content">{task.answer || 'Hermes could not finish this.'}</span>
            </p>
          ) : (
            <Rich text={task.answer ?? ''} anchor={`side-${task.id}`} />
          )}
        </Sheet>
      )}
    </li>
  );
}

/** Steers, the queue and the side tasks of the chat, above the composer. `toComposer` puts a cancelled message's text back in the message box. */
export function RunStatus({ chat, state, toComposer }: { chat: Chat | undefined; state: ChatState; toComposer(text: string): void }) {
  const queueTitle = useId();
  const tasksTitle = useId();
  const steered = state.steers.length > 0 && state.running;
  if (!steered && state.queue.length === 0 && state.sideTasks.length === 0) return null;
  return (
    <div className="run-stack">
      {steered && (
        <p className="subtle run__steers" role="status">
          <Icon name="steer" small /> <Term id="steer">Steered</Term>: “{gist(state.steers.at(-1)!)}”
          {state.steers.length > 1 ? ` and ${state.steers.length - 1} more` : ''}. Hermes hands it to the agent with the result of its next tool call.
        </p>
      )}
      {state.queue.length > 0 && (
        <section className="run" aria-labelledby={queueTitle}>
          <h2 id={queueTitle} className="run__title">
            <Icon name="queued" small /> <Term id="queue">Queued</Term> ({state.queue.length})
          </h2>
          {state.queuePaused && (
            <p className="banner" data-tone="warning" role="status">
              <Icon name="paused" />
              <span className="banner__content">The queue is paused because the last turn was stopped or failed.</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => chat?.runQueue()}>
                Run queue
              </button>
            </p>
          )}
          <ol className="run__list">
            {state.queue.map((item, index) => (
              <QueueItem key={item.id} item={item} position={index + 1} chat={chat} toComposer={toComposer} />
            ))}
          </ol>
        </section>
      )}
      {state.sideTasks.length > 0 && (
        <section className="run" aria-labelledby={tasksTitle}>
          <h2 id={tasksTitle} className="run__title">
            <Icon name="subagent" small /> <Term id="side-task">Side tasks</Term>
          </h2>
          <ul className="run__list">
            {state.sideTasks.map((task) => (
              <SideTaskRow key={task.id} task={task} chat={chat} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
