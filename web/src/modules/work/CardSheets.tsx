// The sheets that change a card: its menu (⋮ and a long press), Move to…, Assign… and Priority…. The same three are used for one card (a T0
// with an undo toast) and for the selection (a T2): they only say what the owner chose, and the caller sends it (`board-actions.ts`).
import { useId, useState, type FormEvent } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { PRIORITY_CHOICES, cardMenu, moveTargets, type BulkResult, type CardChange, type MenuEntry, type MoveTarget } from './board-ops.ts';
import { STATUS_META, UNASSIGNED, priorityLabel, type BoardTask } from './board-model.ts';
import './board-ops.css';

const MENU_ICON: Record<MenuEntry['id'], IconName> = { move: 'rows', assign: 'user', priority: 'flag', reclaim: 'refresh', select: 'check', open: 'arrow-r' };

/** A card's menu: every action there is, so that none is only a gesture. A switched-off entry says why, in words under its name. */
export function CardMenuSheet({ task, readOnly, onChoose, onClose }: { task: BoardTask; readOnly: boolean; onChoose(id: MenuEntry['id']): void; onClose(): void }) {
  return (
    <Sheet title={task.title} onClose={onClose}>
      <ul className="bo-acts">
        {cardMenu(task, { readOnly }).map((entry) => {
          const body = (
            <>
              <Icon name={MENU_ICON[entry.id]} />
              <span>
                <span>{entry.label}</span>
                {entry.disabled && <small>{entry.disabled}</small>}
              </span>
            </>
          );
          const Button = entry.writes ? WriteButton : 'button';
          return (
            <li key={entry.id}>
              <Button type="button" className="bo-act" data-act={entry.id} disabled={entry.disabled !== undefined} onClick={() => onChoose(entry.id)}>
                {body}
              </Button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/** Done and Blocked take a note: how the task was finished, or why it waits. Both are optional. */
const NOTE_FOR: Partial<Record<MoveTarget, { label: string; help: string; confirm: string }>> = {
  done: { label: 'How was it finished?', help: 'Hermes keeps this as the result of the task. Left empty, it says you marked it done from Caduceus.', confirm: 'Mark done' },
  blocked: { label: 'Why is it blocked?', help: 'Shown on the card. Optional.', confirm: 'Block it' },
};

const STATUS_HINT: Record<MoveTarget, string> = {
  triage: 'Not specified yet; Hermes can write the brief.',
  todo: 'Waits for the tasks it depends on.',
  scheduled: 'Waits for a time.',
  ready: 'The dispatcher may start a worker for it.',
  blocked: 'Stopped until something changes.',
  review: 'Waits for your review.',
  done: 'Finished. Hermes records the result.',
  archived: 'Off the board.',
};

const labelOf = (target: MoveTarget) => (target === 'archived' ? 'Archive' : STATUS_META[target].label);

export const ALL_TARGETS: readonly MoveTarget[] = ['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review', 'done', 'archived'];

/** Move to…: the columns Hermes lets this card go to (any column but Running, for a selection, where Hermes answers for each). */
export function MoveSheet({ title, task, onPick, onClose }: { title: string; task?: Pick<BoardTask, 'status'>; onPick(change: CardChange): void; onClose(): void }) {
  const [noting, setNoting] = useState<MoveTarget>();
  const [note, setNote] = useState('');
  const noteId = useId();
  const targets = task ? moveTargets(task) : ALL_TARGETS;

  if (noting !== undefined) {
    const words = NOTE_FOR[noting]!;
    const submit = (event: FormEvent) => {
      event.preventDefault();
      onPick({ kind: 'move', to: noting, note });
    };
    return (
      <Sheet title={`${labelOf(noting)}: ${title}`} onClose={onClose}>
        <form className="bo-form" onSubmit={submit}>
          <div className="field">
            <label className="field__label" htmlFor={noteId}>
              {words.label}
            </label>
            <textarea id={noteId} className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby={`${noteId}-help`} />
            <p id={`${noteId}-help`} className="field__help">
              {words.help}
            </p>
          </div>
          <div className="bo-form__bar">
            <button type="button" className="btn btn--secondary" onClick={() => setNoting(undefined)}>
              Back
            </button>
            <WriteButton type="submit" className="btn btn--primary">
              {words.confirm}
            </WriteButton>
          </div>
        </form>
      </Sheet>
    );
  }
  return (
    <Sheet title={`Move to…`} detents={['auto', 'full']} onClose={onClose}>
      <p className="subtle bo-sub">{title}</p>
      <div className="plist" role="group" aria-label="Move to">
        {targets.length === 0 && <p className="subtle">This task cannot be moved from where it is.</p>}
        {targets.map((target) => (
          <WriteButton
            key={target}
            type="button"
            className="plist__row"
            data-target={target}
            onClick={() => (NOTE_FOR[target] ? setNoting(target) : onPick({ kind: 'move', to: target }))}
          >
            <Icon name={target === 'archived' ? 'archive' : 'chev-r'} />
            <span className="plist__main">
              <span className="plist__name">{labelOf(target)}</span>
              <span className="subtle bo-hint">{STATUS_HINT[target]}</span>
            </span>
            <span />
            <span />
          </WriteButton>
        ))}
      </div>
    </Sheet>
  );
}

/** Assign…: the profiles Hermes knows and the board already names, and nobody. */
export function AssignSheet({ title, names, current, onPick, onClose }: { title: string; names: readonly { name: string; count: number }[]; current?: string | null; onPick(change: CardChange): void; onClose(): void }) {
  const known = current && !names.some((entry) => entry.name === current) ? [...names, { name: current, count: 0 }] : names;
  return (
    <Sheet title="Assign…" detents={known.length > 6 ? ['half', 'full'] : ['auto']} onClose={onClose}>
      <p className="subtle bo-sub">{title}</p>
      <div className="plist" role="group" aria-label="Assign to">
        {known.map((entry) => (
          <WriteButton key={entry.name} type="button" className="plist__row" data-profile={entry.name} aria-pressed={current === entry.name} onClick={() => onPick({ kind: 'assign', to: entry.name })}>
            <Sigil name={entry.name} size="xs" />
            <span className="plist__main">
              <span className="plist__name">{entry.name}</span>
            </span>
            <span className="mono subtle">{entry.count}</span>
            <span className="plist__check">{current === entry.name && <Icon name="check" />}</span>
          </WriteButton>
        ))}
        <WriteButton type="button" className="plist__row" data-profile={UNASSIGNED} aria-pressed={current === null} onClick={() => onPick({ kind: 'assign', to: null })}>
          <UnassignedSigil size="xs" />
          <span className="plist__main">
            <span className="plist__name">Unassigned</span>
            <span className="subtle bo-hint">No worker takes it until a profile is given.</span>
          </span>
          <span />
          <span className="plist__check">{current === null && <Icon name="check" />}</span>
        </WriteButton>
      </div>
    </Sheet>
  );
}

/** Priority…: a few named steps, and any whole number. Higher runs first. */
export function PrioritySheet({ title, current, onPick, onClose }: { title: string; current?: number; onPick(change: CardChange): void; onClose(): void }) {
  const [custom, setCustom] = useState('');
  const customId = useId();
  const typed = custom.trim() === '' ? undefined : Number(custom);
  const problem = typed !== undefined && (!Number.isInteger(typed) || Math.abs(typed) > 99) ? 'Use a whole number from −99 to 99.' : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed !== undefined && problem === undefined) onPick({ kind: 'priority', to: typed });
  };
  return (
    <Sheet title="Priority…" detents={['auto', 'full']} onClose={onClose}>
      <p className="subtle bo-sub">{title}</p>
      <div className="plist" role="group" aria-label="Priority">
        {[...PRIORITY_CHOICES].reverse().map((choice) => (
          <WriteButton key={choice.value} type="button" className="plist__row" data-priority={choice.value} aria-pressed={current === choice.value} onClick={() => onPick({ kind: 'priority', to: choice.value })}>
            <Icon name="flag" />
            <span className="plist__main">
              <span className="plist__name">{choice.label}</span>
            </span>
            <span className="mono subtle">{choice.value}</span>
            <span className="plist__check">{current === choice.value && <Icon name="check" />}</span>
          </WriteButton>
        ))}
      </div>
      <form className="bo-form bo-form--inline" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor={customId}>
            Another number
          </label>
          <input id={customId} className="input mono" inputMode="numeric" autoComplete="off" value={custom} placeholder={current === undefined ? '0' : String(current)} aria-invalid={problem ? true : undefined} aria-describedby={`${customId}-help`} onChange={(event) => setCustom(event.target.value)} />
          <p id={`${customId}-help`} className={problem ? 'field__error' : 'field__help'}>
            {problem ?? `Higher runs first. ${current === undefined ? '' : `Now: ${priorityLabel(current) ?? 'normal'}.`}`}
          </p>
        </div>
        <WriteButton type="submit" className="btn btn--secondary" disabled={typed === undefined || problem !== undefined}>
          Set
        </WriteButton>
      </form>
    </Sheet>
  );
}

/** What a bulk change came to, task by task: which Hermes changed and which it refused, with its reason. */
export function BulkReportSheet({ results, titles, onClose }: { results: readonly BulkResult[]; titles: Readonly<Record<string, string>>; onClose(): void }) {
  const failed = results.filter((result) => !result.ok);
  return (
    <Sheet title={failed.length === 0 ? 'All changed' : `${results.length - failed.length} of ${results.length} changed`} detents={['auto', 'full']} onClose={onClose}>
      <div className="bo-report">
        <p className="subtle">Hermes answers for each task on its own, so one refusal did not stop the others. The tasks it refused stay selected.</p>
        <ul className="bo-list">
          {results.map((result) => (
            <li key={result.id} data-ok={result.ok}>
              <Icon name={result.ok ? 'succeeded' : 'failed'} small />
              <span>
                <strong>{titles[result.id] ?? result.id}</strong>
                <span className="subtle bo-why">{result.ok ? 'Changed.' : (result.error ?? 'Refused.')}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
