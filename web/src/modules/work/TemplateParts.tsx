// The parts the template screens share: the category pills, and the sheet that asks a template's inputs. The Brief editor's picker, the
// Playbooks library and the Run form (`RunSheet.tsx`) use them; the sheet only asks, and what is done with the answers is the caller's.
import { useState, type ReactNode } from 'react';
import type { Playbook } from '@caduceus/contracts/playbooks';
import { Icon } from '../../icons.tsx';
import { Sheet, type SheetProps } from '../../overlays/Sheet.tsx';
import { Field } from './FormParts.tsx';
import { KIND_LABEL, type PlaybookKind } from './playbook-model.ts';
import { answerProblems, initialAnswers, type Answers, type TemplateGroup } from './template-model.ts';

const KIND_TONE = { seed: 'info', template: 'neutral', playbook: 'running' } as const;

/** The badge that says what a card is: a seed, a one-stage template or a multi-stage playbook. */
export function KindBadge({ kind }: { kind: PlaybookKind }) {
  return (
    <span className="tag" data-tone={KIND_TONE[kind]}>
      {KIND_LABEL[kind]}
    </span>
  );
}

/** “All” and a pill for each category that has playbooks (or every category, when `every`), with how many each holds. */
export function CategoryPills({ groups, selected, onSelect, every = false, total }: { groups: readonly TemplateGroup[]; selected: string | undefined; onSelect(id: string | undefined): void; every?: boolean; total: number }) {
  const shown = groups.filter((group) => every || group.templates.length > 0);
  return (
    <div className="tp__pills" role="group" aria-label="Playbook categories">
      <button type="button" className="chip" aria-pressed={selected === undefined} onClick={() => onSelect(undefined)}>
        All<span className="mono subtle">{total}</span>
      </button>
      {shown.map((group) => (
        <button key={group.id || 'other'} type="button" className="chip" aria-pressed={selected === group.id} onClick={() => onSelect(group.id)}>
          {group.name}
          <span className="mono subtle">{group.templates.length}</span>
        </button>
      ))}
    </div>
  );
}

/** One question of a template, as the control that fits it. */
function InputField({ playbook, input, value, error, onChange }: { playbook: Playbook; input: Playbook['inputs'][number]; value: string; error?: string; onChange(value: string): void }) {
  return (
    <Field label={input.required ? input.label : `${input.label} (optional)`} error={error} name={`${playbook.id}-${input.key}`}>
      {(aria) =>
        input.multiline ? (
          <textarea {...aria} className="input" rows={4} value={value} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <input {...aria} className="input" value={value} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
        )
      }
    </Field>
  );
}

/** What a sheet that asks a template's inputs may add: a full-screen sheet, a summary of what will happen, the server's problems with the answers, and a pending state. */
export interface InputsSheetOptions {
  detents?: SheetProps['detents'];
  /** Shown under the description: what answering will start. */
  summary?: ReactNode;
  /** The note under the questions; the default is the Brief editor's. */
  help?: string;
  /** What the server refused in the answers, in its words. */
  problems?: readonly string[];
  busy?: boolean;
}

/** Asks a template's inputs and hands back the answers: the Brief editor fills a brief from them (nothing is sent), a playbook run is started with them. */
export function InputsSheet({ playbook, confirm, onAnswers, onClose, detents = ['auto', 'full'], summary, help = 'A line of the brief whose answer you leave empty is left out. You can change everything in the editor afterwards.', problems: refused = [], busy = false }: { playbook: Playbook; confirm: string; onAnswers(answers: Answers): void; onClose(): void } & InputsSheetOptions) {
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(playbook.inputs));
  const [submitted, setSubmitted] = useState(false);
  const problems = answerProblems(playbook, answers);
  return (
    <Sheet title={playbook.name} initialFocus="input, textarea" detents={detents} onClose={onClose}>
      <form
        className="stack tp__inputs"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (Object.keys(problems).length > 0) return setSubmitted(true);
          onAnswers(answers);
        }}
      >
        {playbook.description && <p className="subtle">{playbook.description}</p>}
        {summary}
        {playbook.inputs.map((input) => (
          <InputField key={input.key} playbook={playbook} input={input} value={answers[input.key] ?? ''} error={submitted ? problems[input.key] : undefined} onChange={(value) => setAnswers((previous) => ({ ...previous, [input.key]: value }))} />
        ))}
        {refused.length > 0 && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <div className="banner__content">
              <p>Caduceus did not accept the answers.</p>
              <ul>
                {refused.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <p className="field__help">{help}</p>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {confirm}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
