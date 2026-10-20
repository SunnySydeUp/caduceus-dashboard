// Work › Playbooks › New template / Edit template, and Save as template from a task (`/work/playbooks/new?fromTask=<id>`): a template is edited as
// the brief it starts with, plus a name, a category and the questions it asks. A question is made by writing `{{name}}` where an answer goes, so the
// list of questions follows the text. Saving writes the YAML file through Caduceus; nothing is sent to Hermes.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useParams, useSearch } from '@tanstack/react-router';
import { isTemplate, readPlaybook, type Playbook, type PlaybookInput, type PlaybookStage } from '@caduceus/contracts/playbooks';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { REASONING_LEVELS } from '../models/model-settings.ts';
import { BriefPreview, BriefTextFields, ModelField } from './BriefParts.tsx';
import { briefProblems, fieldsOfTask, newBriefFields, TASK_REASONING, type BriefFields } from './brief-task.ts';
import { useProfiles, useTaskToEdit } from './brief-data.ts';
import { useSkillNames } from './builder-data.ts';
import { Field, ListInput, NumberInput } from './FormParts.tsx';
import { playbookPath } from './playbook-model.ts';
import { saveTemplate, usePlaybookLibrary } from './template-data.ts';
import { fieldsStage, inputsFor, stageFields } from './template-model.ts';
import { WorkspaceField } from './WorkspaceField.tsx';
import './brief.css';
import './templates.css';
import './work.css';

const REASONING_OPTIONS = TASK_REASONING.map((value) => ({ value, label: value === 'none' ? 'Off (no thinking)' : (REASONING_LEVELS.find((level) => level.value === value)?.label ?? value) }));

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details className="sb__section be__group" open data-group={id}>
      <summary className="be__summary">
        <h2 id={`te-${id}`}>{title}</h2>
        <Icon name="chev-r" small />
      </summary>
      <div className="be__body">{children}</div>
    </details>
  );
}

interface Start {
  /** The template being edited; none for a new one. */
  editing?: Playbook;
  name: string;
  description: string;
  category: string;
  fields: BriefFields;
  inputs: PlaybookInput[];
  /** The task a new template was made from. */
  fromTask?: string;
}

function TemplateForm({ start, categories, profiles }: { start: Start; categories: { id: string; name: string }[]; profiles: string[] }) {
  const navigate = useAppNavigate();
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [category, setCategory] = useState(start.category);
  const [fields, setFields] = useState(start.fields);
  const [overrides, setOverrides] = useState(start.inputs);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const saved = useRef(false);
  const [first] = useState(() => JSON.stringify({ name: start.name, description: start.description, category: start.category, fields: start.fields, inputs: start.inputs }));
  const skillNames = useSkillNames(fields.assignee !== '' ? fields.assignee : 'default');
  const stage = useMemo(() => fieldsStage(fields), [fields]);
  const inputs = useMemo(() => inputsFor(stage, overrides), [stage, overrides]);
  const dirty = JSON.stringify({ name, description, category, fields, inputs: overrides }) !== first;
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => dirty && !saved.current && current.pathname !== next.pathname, enableBeforeUnload: () => dirty && !saved.current, withResolver: true });

  const problems: Record<string, string> = { ...briefProblems(fields, { mode: 'draft', profiles }) };
  if (name.trim() === '') problems.name = 'Give the template a name.';
  else if (name.trim().length > 80) problems.name = 'Use 80 characters or fewer.';
  if (!categories.some((entry) => entry.id === category)) problems.category = 'Choose a category.';
  if (fields.title.trim() === '') problems.title = 'Give the task a title (it may hold {{questions}}).';
  const errors = submitted ? problems : {};
  const set = (patch: Partial<BriefFields>) => setFields((previous) => ({ ...previous, ...patch }));
  const setInput = (key: string, patch: Partial<PlaybookInput>) =>
    setOverrides((previous) => {
      const current = inputs.find((input) => input.key === key) ?? { key, label: key };
      const next = { ...current, ...patch };
      return [...previous.filter((input) => input.key !== key), next];
    });

  const submit = async () => {
    if (Object.keys(problems).length > 0) {
      setSubmitted(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.te [aria-invalid="true"]')?.focus());
      return;
    }
    const draft = { name: name.trim(), ...(description.trim() === '' ? {} : { description: description.trim() }), category, inputs, stages: [stage] satisfies [PlaybookStage] };
    const check = readPlaybook({ ...draft, id: 'check', version: 1, edges: [] });
    if (check.problems) {
      setFailure(check.problems.join(' '));
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      const stored = await saveTemplate(draft, start.editing);
      // The owner declined the Tier 1 confirmation: the form stays as it is.
      if (stored === undefined) return;
      saved.current = true;
      toast(start.editing ? `Saved “${stored.name}” as version ${stored.version}` : `Made the template “${stored.name}”`, { tone: 'success' });
      void navigate('/work/playbooks');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Caduceus did not save the template.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="bpage sb be te"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PageHeader
        overline="Work › Playbooks"
        title={start.editing ? `Edit ${start.editing.name}` : start.fromTask ? 'Save as template' : 'New template'}
        subtitle={<span className="subtle">A <Term id="template">template</Term> is a brief with blanks.</span>}
        actions={
          <AppLink className="btn btn--secondary" to="/work/playbooks">
            Cancel
          </AppLink>
        }
      />
      {failure && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{failure}</span>
        </div>
      )}
      {start.fromTask && (
        <div className="banner" data-tone="info" role="note">
          <Icon name="info" />
          <div className="banner__content">
            <p>
              Made from the task <AppLink to={`/work/tasks/${encodeURIComponent(start.fromTask)}`}>{start.fromTask}</AppLink>: its brief and settings, without its runs, comments or links. Write <code>{'{{name}}'}</code> where an answer should go, and the template will ask for it.
            </p>
          </div>
        </div>
      )}

      <Group id="template" title="Template">
        <Field label="Name" help="How it is listed." error={errors.name} name="name">
          {(aria) => <input {...aria} className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Category" help={<>Groups templates; it is not a Hermes setting. Make and rename categories on the Playbooks page.</>} error={errors.category} name="category">
          {(aria) => (
            <select {...aria} className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {!categories.some((entry) => entry.id === category) && <option value={category}>Choose a category</option>}
              {categories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Description" help="One line on what it is for." name="description">
          {(aria) => <input {...aria} className="input" value={description} maxLength={400} onChange={(event) => setDescription(event.target.value)} autoComplete="off" />}
        </Field>
      </Group>

      <Group id="task" title="Task">
        <Field label="Title" help={<>One line. Write <code>{'{{name}}'}</code> where an answer goes, for example <code>{'Fix: {{bug}}'}</code>.</>} error={errors.title} name="title">
          {(aria) => <input {...aria} className="input" value={fields.title} onChange={(event) => set({ title: event.target.value })} autoComplete="off" />}
        </Field>
        <Field label="Assign to" help="The profile whose worker does the task. Leave it unassigned to choose when you start it." error={errors.assignee} name="assignee">
          {(aria) => (
            <select {...aria} className="input" value={fields.assignee} onChange={(event) => set({ assignee: event.target.value })}>
              <option value="">Unassigned</option>
              {fields.assignee !== '' && !profiles.includes(fields.assignee) && <option value={fields.assignee}>{fields.assignee}</option>}
              {profiles.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Priority" help="Higher runs first. Leave it empty for the normal priority." error={errors.priority} name="priority">
          {(aria) => <NumberInput {...aria} value={fields.priority} onChange={(priority) => set({ priority })} />}
        </Field>
      </Group>

      <Group id="brief" title="Brief">
        <BriefTextFields brief={fields.brief} onChange={(brief) => set({ brief })} />
        <details className="be__more">
          <summary>Preview: the brief with its blanks</summary>
          <BriefPreview brief={fields.brief} />
        </details>
      </Group>

      <Group id="questions" title="Questions">
        {inputs.length === 0 ? (
          <p className="subtle">
            This template asks nothing. Write <code>{'{{name}}'}</code> in the title or the brief and a question appears here.
          </p>
        ) : (
          <ul className="te__inputs">
            {inputs.map((input) => (
              <li key={input.key} className="te__input">
                <p className="te__placeholder">
                  Answer for <code>{`{{${input.key}}}`}</code>
                </p>
                <Field label="Question" error={errors[`input-${input.key}`]} name={`input-${input.key}`}>
                  {(aria) => <input {...aria} className="input" value={input.label} maxLength={80} onChange={(event) => setInput(input.key, { label: event.target.value })} autoComplete="off" />}
                </Field>
                <Field label="Starts as" help="What the answer is if it is not changed." name={`default-${input.key}`}>
                  {(aria) => <input {...aria} className="input" value={input.default ?? ''} onChange={(event) => setInput(input.key, { default: event.target.value === '' ? undefined : event.target.value })} autoComplete="off" />}
                </Field>
                <div className="switch-row">
                  <strong id={`te-req-${input.key}`}>Must be answered</strong>
                  <button type="button" className="switch" role="switch" aria-labelledby={`te-req-${input.key}`} aria-checked={input.required === true} onClick={() => setInput(input.key, { required: input.required === true ? undefined : true })} />
                </div>
                <div className="switch-row">
                  <strong id={`te-long-${input.key}`}>Long answer</strong>
                  <button type="button" className="switch" role="switch" aria-labelledby={`te-long-${input.key}`} aria-checked={input.multiline === true} onClick={() => setInput(input.key, { multiline: input.multiline === true ? undefined : true })} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group id="run" title="How the worker runs">
        <ModelField profile={fields.assignee !== '' ? fields.assignee : 'default'} model={fields.model} provider={fields.provider} onChange={(model, provider) => set({ model, provider })} error={errors.model} />
        <Field label="Reasoning effort" help="How hard the model thinks. The profile’s own level when empty." error={errors.reasoningEffort} name="reasoningEffort">
          {(aria) => (
            <select {...aria} className="input" value={fields.reasoningEffort} onChange={(event) => set({ reasoningEffort: event.target.value })}>
              <option value="">The profile’s level</option>
              {REASONING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Skills" help="Skills the worker loads first, separated by commas." error={errors.skills} name="skills">
          {(aria) => <ListInput {...aria} value={fields.skills} onChange={(skills) => set({ skills })} options={skillNames} />}
        </Field>
        <div className="sb__row">
          <Field label="Time limit" help="Seconds, or 30m, 2h, 1d." error={errors.maxRuntime} name="maxRuntime">
            {(aria) => <input {...aria} className="input mono" value={fields.maxRuntime} onChange={(event) => set({ maxRuntime: event.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          </Field>
          <Field label="Retries" help="Failures in a row that block the task." error={errors.maxRetries} name="maxRetries">
            {(aria) => <NumberInput {...aria} value={fields.maxRetries} onChange={(maxRetries) => set({ maxRetries })} />}
          </Field>
        </div>
      </Group>

      <Group id="workspace" title="Workspace">
        <WorkspaceField profile={fields.assignee !== '' ? fields.assignee : 'default'} workspace={fields.workspace} onChange={(workspace) => set({ workspace })} project={fields.project} onProjectChange={(project) => set({ project })} errors={errors} touch={() => undefined} />
      </Group>

      <Group id="done" title="Done when">
        <div className="switch-row">
          <div>
            <strong id="te-goal-name">Keep going until a judge says it is done</strong>
            <p id="te-goal-why" className="subtle">
              <Term id="goal-mode">Goal mode</Term>: after each turn a judge checks the reply against the brief.
            </p>
          </div>
          <button type="button" className="switch" role="switch" aria-labelledby="te-goal-name" aria-describedby="te-goal-why" aria-checked={fields.goalMode} onClick={() => set({ goalMode: !fields.goalMode })} />
        </div>
        {fields.goalMode && (
          <Field label="Most turns" help="Empty uses Hermes’s default (20)." error={errors.goalMaxTurns} name="goalMaxTurns">
            {(aria) => <NumberInput {...aria} value={fields.goalMaxTurns} onChange={(goalMaxTurns) => set({ goalMaxTurns })} />}
          </Field>
        )}
        <Field label="Completion contract" help="local-only (the default), OWNER/REPO, or the exact URL of a pull request." error={errors.completionContract} name="completionContract">
          {(aria) => <input {...aria} className="input mono" placeholder="local-only" value={fields.completionContract} onChange={(event) => set({ completionContract: event.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
        </Field>
      </Group>

      <div className="sb__bar be__bar">
        {Object.keys(problems).length > 0 && submitted && (
          <p className="field__error be__count" role="alert">
            {Object.keys(problems).length === 1 ? 'One thing needs a look.' : `${Object.keys(problems).length} things need a look.`}
          </p>
        )}
        <AppLink className="btn btn--ghost" to="/work/playbooks">
          Cancel
        </AppLink>
        <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          <Icon name="check" />
          {start.editing ? 'Save changes' : 'Save template'}
        </WriteButton>
      </div>

      {blocker.status === 'blocked' && (
        <Sheet
          title="Leave without saving?"
          role="alertdialog"
          dismissOnScrim={false}
          escapable={false}
          initialFocus="[data-stay]"
          onClose={blocker.reset}
          footer={
            <>
              <button type="button" className="btn btn--secondary" data-stay onClick={blocker.reset}>
                Keep editing
              </button>
              <button type="button" className="btn btn--danger" onClick={blocker.proceed}>
                Discard
              </button>
            </>
          }
        >
          <p>This template is not saved yet. Leaving now throws away what you wrote.</p>
        </Sheet>
      )}
    </form>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bpage sb be te">
      <PageHeader overline="Work › Playbooks" title={title} />
      {children}
    </div>
  );
}

/** Work › Playbooks › New template (blank, or from a task with `?fromTask=` and `?board=`) and › Edit template (`/work/playbooks/:playbookId/edit`). */
export function TemplateEditor() {
  const { playbookId = 'new' } = useParams({ strict: false }) as { playbookId?: string };
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const fromTask = typeof search.fromTask === 'string' && search.fromTask !== '' ? search.fromTask : undefined;
  const board = typeof search.board === 'string' && search.board !== '' ? search.board : undefined;
  const isNew = playbookId === 'new';
  const templates = usePlaybookLibrary();
  const profiles = useProfiles();
  const source = useTaskToEdit(isNew ? fromTask : undefined, board);
  // Opened once: what the server or Hermes says later does not move what is being typed.
  const opened = useRef<{ key: string; start: Start }>(undefined);
  const key = `${playbookId}|${fromTask}`;
  const library = templates.library;

  if (templates.error || profiles.status === 'failed' || source.status === 'failed') {
    return (
      <Page title={isNew ? 'New template' : 'Edit template'}>
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{templates.error ? `The templates could not be read: ${templates.error}` : source.status === 'failed' ? 'Hermes did not answer, so the task could not be read; it may have been deleted.' : 'Hermes did not answer, so the profiles are not known yet.'}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={templates.error ? templates.reload : source.status === 'failed' ? source.reload : profiles.reload}>
            Try again
          </button>
        </div>
      </Page>
    );
  }
  if (library === undefined || profiles.value === undefined || source.value === undefined) {
    return (
      <Page title={isNew ? 'New template' : 'Edit template'}>
        <p role="status">Loading…</p>
      </Page>
    );
  }
  if (opened.current?.key !== key) {
    const existing = isNew ? undefined : library.templates.find((template) => template.id === playbookId);
    // A seed, or a definition with several stages, is not a brief to edit: its detail page has its stages and its YAML.
    const other = isNew || (existing !== undefined && isTemplate(existing)) ? undefined : (existing ?? library.seeds.find((seed) => seed.id === playbookId));
    if (other) {
      return (
        <Page title="Edit template">
          <div className="empty">
            <Icon name="playbook" />
            <h2>{library.seeds.some((seed) => seed.id === other.id) ? 'This playbook is built in' : 'This is a playbook with several stages'}</h2>
            <p>It is not a brief with blanks, so it is not edited here. Open it to see its stages and edit its YAML; a seed can be duplicated first.</p>
            <AppLink className="btn btn--primary" to={playbookPath(other.id)}>
              Open {other.name}
            </AppLink>
          </div>
        </Page>
      );
    }
    if (!isNew && existing === undefined) {
      return (
        <Page title="Edit template">
          <div className="empty">
            <Icon name="file" />
            <h2>This template is gone</h2>
            <p>It was deleted, perhaps on another device.</p>
            <AppLink className="btn btn--primary" to="/work/playbooks">
              Back to Playbooks
            </AppLink>
          </div>
        </Page>
      );
    }
    const fallback = library.categories[0]?.id ?? '';
    if (existing) opened.current = { key, start: { editing: existing, name: existing.name, description: existing.description ?? '', category: existing.category, fields: stageFields(existing), inputs: existing.inputs } };
    else if (source.value) {
      const fields = { ...fieldsOfTask(source.value.task), parents: [] };
      opened.current = { key, start: { name: source.value.task.title.slice(0, 80), description: '', category: fallback, fields, inputs: inputsFor(fieldsStage(fields)), fromTask } };
    } else opened.current = { key, start: { name: '', description: '', category: fallback, fields: newBriefFields(), inputs: [] } };
  }
  return <TemplateForm key={key} start={opened.current.start} categories={library.categories} profiles={profiles.value.names} />;
}
