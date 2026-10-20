// The parts the Brief editor is made of: the six sections (or the one free section), the model choice, the profile's toolsets (read only), the
// files to attach, and the four dispatch modes. Each takes what it shows and reports what changed; the form holds the state.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { ModelPickerSheet } from '../models/ModelPicker.tsx';
import { useToolsets } from '../tools/tools-data.ts';
import { BRIEF_SECTIONS, emptySections, serialiseBrief, type BriefText } from './brief.ts';
import { DISPATCH_MODES, type DispatchMode, type DraftKind } from './brief-task.ts';
import { Field } from './FormParts.tsx';

/** The Brief itself: six labelled sections that become Markdown headings, or one free section when the body is not made of them. */
export function BriefTextFields({ brief, onChange }: { brief: BriefText; onChange(brief: BriefText): void }) {
  if (brief.kind === 'free') {
    return (
      <>
        <p className="field__help">
          This brief is not written in the Brief’s sections (a worker, the command line or <Term id="specify">Specify</Term> wrote it), so it is one text, kept exactly as it is.
        </p>
        <Field label="Brief" help="Markdown. This is the task’s body." name="brief">
          {(aria) => <textarea {...aria} className="input" rows={10} value={brief.text} onChange={(event) => onChange({ kind: 'free', text: event.target.value })} />}
        </Field>
        <div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => onChange({ kind: 'sections', sections: { ...emptySections(), goal: brief.text.trim() } })}>
            Use the sections instead
          </button>
          <p className="field__help">The text moves into Goal, where you can split it.</p>
        </div>
      </>
    );
  }
  const { sections } = brief;
  return (
    <>
      {BRIEF_SECTIONS.map(({ id, heading, help }) => (
        <Field key={id} label={heading} help={help} name={id}>
          {(aria) => <textarea {...aria} className="input" rows={id === 'goal' ? 4 : 3} value={sections[id]} onChange={(event) => onChange({ kind: 'sections', sections: { ...sections, [id]: event.target.value } })} />}
        </Field>
      ))}
      <div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ kind: 'free', text: serialiseBrief(brief) })}>
          Write it as one free text
        </button>
      </div>
    </>
  );
}

/** What the worker will read: the task body exactly as it will be saved. */
export function BriefPreview({ brief }: { brief: BriefText }) {
  const body = serialiseBrief(brief);
  return body.trim() === '' ? <p className="subtle">The brief is empty. The worker has only the title.</p> : <pre className="be__preview mono" tabIndex={0} aria-label="The brief as the worker reads it">{body}</pre>;
}

/** The model the worker is pinned to: Hermes's shared picker, and a way back to the profile's own. */
export function ModelField({ profile, model, provider, onChange, error, locked }: { profile: string; model: string; provider: string; onChange(model: string, provider: string): void; error?: string; locked?: boolean }) {
  const [picking, setPicking] = useState(false);
  return (
    <Field label="Model" help="Pins the worker to this model. Leave it on the profile’s to use whatever the profile has set." error={error} name="model">
      {(aria) => (
        <div className="be__model">
          <button {...aria} type="button" className="btn btn--secondary be__model-pick" disabled={locked} onClick={() => setPicking(true)}>
            <span className="mono truncate">{model === '' ? 'The profile’s model' : `${model}${provider ? ` · ${provider}` : ''}`}</span>
            <Icon name="chev-r" small />
          </button>
          {model !== '' && !locked && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange('', '')}>
              Use the profile’s
            </button>
          )}
          {picking && (
            <ModelPickerSheet
              title={`Model for ${profile}’s worker`}
              profile={profile}
              value={model === '' ? undefined : { provider, model }}
              onPick={(choice) => {
                onChange(choice.model, choice.provider);
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
    </Field>
  );
}

/** The toolsets of the assignee profile, read only: Hermes keeps toolsets per profile and cannot set one per task. */
export function ToolsetsNote({ profile }: { profile: string }) {
  const { value, failed } = useToolsets(profile);
  const on = value?.filter((toolset) => toolset.enabled) ?? [];
  return (
    <div className="be__tools">
      <p className="field__help">
        A task cannot have toolsets of its own: Hermes keeps them per profile, and the worker uses {profile}’s. Nothing about toolsets is sent with the task.
      </p>
      {value === undefined && !failed && <p role="status" className="subtle">Asking Hermes for {profile}’s toolsets…</p>}
      {failed && value === undefined && <p className="subtle">Hermes did not say which toolsets {profile} has.</p>}
      {value !== undefined && (on.length === 0 ? <p className="subtle">{profile} has no toolset switched on.</p> : <ul className="be__chips" aria-label={`Toolsets of ${profile}`}>{on.map((toolset) => <li key={toolset.name} className="chip">{toolset.label}</li>)}</ul>)}
      <AppLink className="btn btn--secondary btn--sm" to={`/agents/profiles/${encodeURIComponent(profile)}/tools`}>
        <Icon name="sliders" small />
        Edit {profile}’s toolsets
      </AppLink>
    </div>
  );
}

const bytes = (size: number): string => (size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`);

/** Files chosen here are attached to the task once it exists; Hermes lists them in the task's Attachments tab and workers can read them. */
export function FilesField({ files, onChange }: { files: readonly File[]; onChange(files: File[]): void }) {
  return (
    <div className="be__files">
      {files.length > 0 && (
        <ul className="be__filelist">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="row">
              <Icon name="file" small />
              <span className="truncate">{file.name}</span>
              <span className="subtle">{bytes(file.size)}</span>
              <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, at) => at !== index))}>
                <Icon name="x" small />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="btn btn--secondary">
        <Icon name="arrow-up" />
        Attach files
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            onChange([...files, ...Array.from(event.currentTarget.files ?? [])]);
            event.currentTarget.value = '';
          }}
        />
      </label>
    </div>
  );
}

const DRAFT_KINDS: readonly { value: DraftKind; label: string; detail: string }[] = [
  { value: 'triage', label: 'Triage', detail: 'Waits for a specifier to write the brief.' },
  { value: 'todo', label: 'Todo', detail: 'Waits until you make it Ready.' },
];

/** How the task starts: the four dispatch modes, and for a draft where it waits and whether a model writes its brief now. */
export function DispatchPanel({ mode, onMode, draft, onDraft, specify, onSpecify }: { mode: DispatchMode; onMode(mode: DispatchMode): void; draft: DraftKind; onDraft(draft: DraftKind): void; specify: boolean; onSpecify(on: boolean): void }) {
  return (
    <>
      <RadioGroup
        labelledBy="be-mode"
        value={mode}
        onChange={onMode}
        className="sb__types be__modes"
        optionClassName="sb__type"
        options={DISPATCH_MODES.map((option) => ({
          value: option.id,
          label: (
            <>
              <strong>{option.label}</strong>
              <span className="subtle">{option.detail}</span>
            </>
          ),
        }))}
      />
      {mode === 'draft' && (
        <div className="be__draft">
          <RadioGroup
            labelledBy="be-draft"
            value={draft}
            onChange={onDraft}
            className="sb__types be__draftkinds"
            optionClassName="sb__type"
            options={DRAFT_KINDS.map((option) => ({
              value: option.value,
              label: (
                <>
                  <strong>{option.label}</strong>
                  <span className="subtle">{option.detail}</span>
                </>
              ),
            }))}
          />
          {draft === 'triage' && (
            <div className="switch-row">
              <div>
                <strong id="be-specify-name">Have a model write the brief after saving</strong>
                <p id="be-specify-why" className="subtle">
                  <Term id="specify">Specify</Term> turns the title and your notes into a full brief. You see it first and can reject it. It uses the model.
                </p>
              </div>
              <button type="button" id="be-specify" className="switch" role="switch" aria-labelledby="be-specify-name" aria-describedby="be-specify-why" aria-checked={specify} onClick={() => onSpecify(!specify)} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
