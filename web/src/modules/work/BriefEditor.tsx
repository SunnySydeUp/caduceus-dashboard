// Work › Tasks › New task, Edit and Duplicate with changes: the Brief editor. One form for a task that does not exist yet and one that does. Its
// sections are collapsible, the choices that start the task (the four dispatch modes) come last, and a bar at the bottom stays above the soft
// keyboard. What is wrong shows under the field once it is left, and everything shows on Save; a form that has been changed is guarded against
// leaving. Saving goes through `brief-actions.ts` (and `schedules-actions.ts` for a schedule), which ask the policy.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useParams, useSearch } from '@tanstack/react-router';
import type { Playbook } from '@caduceus/contracts/playbooks';
import { Icon } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate, useUrlProfile } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { REASONING_LEVELS } from '../models/model-settings.ts';
import { useHermesZone, useSkillNames } from './builder-data.ts';
import { takeBrief } from './brief-handoff.ts';
import { saveNewTask, saveTaskEdit } from './brief-actions.ts';
import { useProfiles, useTaskToEdit, type Profiles } from './brief-data.ts';
import { BriefPreview, BriefTextFields, DispatchPanel, FilesField, ModelField, ToolsetsNote } from './BriefParts.tsx';
import { briefProblems, createPlan, fieldsOfTask, newBriefFields, scheduledFields, TASK_REASONING, type BriefFields, type DispatchMode, type DraftKind } from './brief-task.ts';
import { emptySections } from './brief.ts';
import { Field, ListInput, NumberInput } from './FormParts.tsx';
import { formatInstant, useNow } from './JobParts.tsx';
import { createPlan as createJobPlan, newDraft } from './job-form.ts';
import { FirePreview, ScheduleFields } from './ScheduleFields.tsx';
import { nextFires, scheduleProblem, scheduleSpec, type ScheduleDraft } from './schedule-spec.ts';
import { saveJob } from './schedules-actions.ts';
import { uploadAttachment } from './task-actions.ts';
import type { TaskFull } from './task-model.ts';
import { WorkspaceField } from './WorkspaceField.tsx';
import { TemplatePicker } from './TemplatePicker.tsx';
import './brief.css';
import './work.css';

const REASONING_OPTIONS = TASK_REASONING.map((value) => ({ value, label: value === 'none' ? 'Off (no thinking)' : (REASONING_LEVELS.find((level) => level.value === value)?.label ?? value) }));

const ownerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
const randomUnique = (): string => Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** One collapsible group of the form. Every group starts open; the owner on a phone folds away what they are not using. */
function Group({ id, title, children, open = true, aside }: { id: string; title: string; children: ReactNode; open?: boolean; aside?: ReactNode }) {
  return (
    <details className="sb__section be__group" open={open} data-group={id}>
      <summary className="be__summary">
        <h2 id={`be-${id}`}>{title}</h2>
        <Icon name="chev-r" small />
      </summary>
      <div className="be__body">
        {aside}
        {children}
      </div>
    </details>
  );
}

const LOCKED_NOTE = 'Hermes cannot change this after the task is made. Use Duplicate with changes to make a copy that has it.';

interface FormProps {
  profiles: Profiles;
  initial: BriefFields;
  /** The task being edited, as it read when the editor opened: edits are sent as the difference from it, and the fields Hermes cannot change are shown but not editable. */
  edited?: TaskFull;
  /** The task this one is a copy of. */
  copyOf?: string;
  board: string | undefined;
  /** The id of a template to start from at once (`?template=`). */
  template?: string;
}

function BriefForm({ profiles, initial, copyOf, edited, board, template }: FormProps) {
  const navigate = useAppNavigate();
  const urlProfile = useUrlProfile();
  const now = useNow();
  const zone = useMemo(ownerZone, []);
  const editing = edited !== undefined;
  const [fields, setFields] = useState(initial);
  const [mode, setMode] = useState<DispatchMode>('queue');
  const [draft, setDraft] = useState<DraftKind>('triage');
  const [specify, setSpecify] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDraft>({ mode: 'daily', time: '09:00' });
  const [scheduleName, setScheduleName] = useState('');
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [focusRequest, setFocusRequest] = useState(0);
  /** Counts the templates applied: the inputs that keep their own text (skills, priority, retries) start again from the fields the template filled. */
  const [applied, setApplied] = useState(0);
  const [unique] = useState(randomUnique);
  const saved = useRef(false);
  const [first] = useState(() => JSON.stringify({ fields: initial, mode: 'queue', draft: 'triage', specify: false, schedule: { mode: 'daily', time: '09:00' }, scheduleName: '', files: 0 }));

  // The profile the worker is of: its skills and toolsets are the ones that count. Before one is chosen, the profile this tab works on.
  const workerProfile = fields.assignee !== '' ? fields.assignee : (profiles.names.includes(urlProfile ?? '') ? (urlProfile as string) : 'default');
  const skillNames = useSkillNames(workerProfile);
  const jobProfile = profiles.names.includes(urlProfile ?? '') ? (urlProfile as string) : profiles.names.includes('default') ? 'default' : (profiles.names[0] ?? 'default');
  const hermesZone = useHermesZone(jobProfile);
  const scheduling = !editing && mode === 'schedule';

  const allProblems = {
    ...briefProblems(fields, { mode, profiles: profiles.names, editing }),
    ...(scheduling && scheduleName.trim() === '' ? { scheduleName: 'Give the schedule a name.' } : {}),
    ...(scheduling && scheduleProblem(schedule, now, zone) ? { schedule: scheduleProblem(schedule, now, zone) as string } : {}),
  };
  // A schedule's task cannot carry files or parents, and a task's own reasoning effort cannot reach a script: those are not checked then.
  const problems = scheduling ? Object.fromEntries(Object.entries(allProblems).filter(([key]) => key !== 'parents')) : allProblems;
  const errors = Object.fromEntries(Object.entries(problems).filter(([key]) => submitted || touched[key]));
  const dirty = JSON.stringify({ fields, mode, draft, specify, schedule, scheduleName, files: files.length }) !== first;
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => dirty && !saved.current && current.pathname !== next.pathname, enableBeforeUnload: () => dirty && !saved.current, withResolver: true });

  useEffect(() => {
    if (focusRequest === 0) return;
    // A problem can sit in a section that is folded: open the sections around it, then focus it.
    const bad = document.querySelector<HTMLElement>('.be [aria-invalid="true"]');
    for (let group = bad?.closest('details'); group; group = group.parentElement?.closest('details')) group.open = true;
    bad?.focus();
  }, [focusRequest]);

  const set = (patch: Partial<BriefFields>) => setFields((previous) => ({ ...previous, ...patch }));
  const touch = (name: string) => setTouched((previous) => (previous[name] ? previous : { ...previous, [name]: true }));
  const startFromTemplate = (filled: BriefFields, from: Playbook) => {
    setFields(filled);
    setTouched({});
    setSubmitted(false);
    setApplied((count) => count + 1);
    toast(`Brief filled in from “${from.name}”. Nothing has been sent to Hermes.`, { tone: 'info' });
    // The template's questions are a sheet that is still closing (it holds the page still), so the title is brought into view once it has.
    void closeAllLayers().then(() =>
      requestAnimationFrame(() => {
        const title = document.querySelector<HTMLElement>('.be [data-field="title"] input');
        title?.scrollIntoView({ block: 'center' });
        title?.focus();
      }),
    );
  };
  const lockedInfo = editing ? LOCKED_NOTE : undefined;
  const taskHref = (id: string, query = '') => `/work/tasks/${encodeURIComponent(id)}${board ? `?board=${encodeURIComponent(board)}${query ? `&${query}` : ''}` : query ? `?${query}` : ''}`;

  const submit = async () => {
    if (Object.keys(problems).length > 0) {
      setSubmitted(true);
      setFocusRequest((count) => count + 1);
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      if (editing) {
        const outcome = await saveTaskEdit(edited, fields, board);
        if (outcome?.kind === 'failed') setFailure(outcome.message);
        if (outcome !== undefined && outcome.kind !== 'done') return;
        toast(outcome === undefined ? 'Nothing was changed' : `Saved “${fields.title.trim()}”`, { tone: outcome === undefined ? 'info' : 'success' });
        saved.current = true;
        void navigate(taskHref(edited.id));
        return;
      }
      if (scheduling) {
        const base = newDraft('task', jobProfile);
        const plan = createJobPlan({ ...base, name: scheduleName.trim(), schedule, task: scheduledFields(fields) }, { zone, unique });
        const outcome = await saveJob(plan, { name: scheduleName.trim(), profile: jobProfile, change: 'create' });
        if (outcome.kind === 'failed') setFailure(outcome.message);
        if (outcome.kind !== 'done') return;
        saved.current = true;
        toast(`Created “${scheduleName.trim()}”`, { tone: 'success' });
        void navigate(outcome.body.id ? `/work/schedules/${encodeURIComponent(outcome.body.id)}` : '/work/schedules');
        return;
      }
      const outcome = await saveNewTask(createPlan(fields, mode as Exclude<DispatchMode, 'schedule'>, { draft, board, profile: urlProfile }), fields.assignee);
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'failed') {
        setFailure(outcome.message);
        // The task exists, only a step after it failed: the form would make a second one. Go to the task that was made.
        if (outcome.id !== undefined) {
          saved.current = true;
          toast(outcome.message, { tone: 'warning' });
          void navigate(taskHref(outcome.id));
        }
        return;
      }
      saved.current = true;
      const failedFiles: string[] = [];
      for (const file of files) {
        const upload = await uploadAttachment(outcome.id, file, board);
        if (upload.kind !== 'done') failedFiles.push(file.name);
      }
      if (failedFiles.length > 0) toast(`The task was made, but ${failedFiles.join(', ')} could not be attached. Attach them on the task’s Attachments tab.`, { tone: 'warning' });
      else toast(mode === 'run-now' ? 'Task made and the dispatcher nudged' : mode === 'queue' ? 'Task queued' : 'Draft saved', { tone: 'success' });
      if (outcome.warning) toast(outcome.warning, { tone: 'warning' });
      void navigate(taskHref(outcome.id, mode === 'draft' && draft === 'triage' && specify ? 'specify=1' : ''));
    } finally {
      setBusy(false);
    }
  };

  const spec = scheduling ? scheduleSpec(schedule, zone) : undefined;
  const fireZone = hermesZone ?? zone;
  const firstRun = spec !== undefined && problems.schedule === undefined ? nextFires(spec, now, fireZone, 1)[0] : undefined;
  const saveLabel = editing ? 'Save changes' : mode === 'draft' ? 'Save draft…' : mode === 'queue' ? 'Queue…' : mode === 'run-now' ? 'Run now…' : 'Create schedule…';
  const cancelTo = editing ? taskHref(edited.id) : '/work/tasks';
  const lock = editing;

  return (
    <form
      className="bpage sb be"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PageHeader
        overline={editing ? `Work › Tasks › ${edited.id}` : 'Work › Tasks'}
        overlineAsIs={editing}
        title={editing ? `Edit ${edited.title}` : copyOf ? 'Duplicate with changes' : 'New task'}
        subtitle={<span className="subtle">The <Term id="brief">Brief</Term> is what the worker reads.</span>}
        actions={
          <AppLink className="btn btn--secondary" to={cancelTo}>
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
      {copyOf && (
        <div className="banner" data-tone="info" role="note">
          <Icon name="info" />
          <div className="banner__content">
            <p>
              A copy of <AppLink to={taskHref(copyOf)}>{copyOf}</AppLink>. Change what you need; the original stays as it is.
            </p>
          </div>
        </div>
      )}
      {editing && edited.status === 'running' && (
        <div className="banner" data-tone="warning" role="note">
          <Icon name="alert" />
          <span className="banner__content">A worker has this task now. It read the brief when it started, so a change to the brief reaches the next run only.</span>
        </div>
      )}
      {editing && (
        <div className="banner" data-tone="info" role="note">
          <Icon name="info" />
          <div className="banner__content">
            <p>
              Some settings below are fixed once a task is made. <AppLink to={`/work/tasks/new?from=${encodeURIComponent(edited.id)}${board ? `&board=${encodeURIComponent(board)}` : ''}`}>Duplicate with changes</AppLink> makes a copy with the changes.
            </p>
          </div>
        </div>
      )}

      <Fragment key={`task-${applied}`}>
      <Group id="task" title="Task">
        <Field label="Title" help="One line, as it shows on the board." error={errors.title} name="title">
          {(aria) => <input {...aria} className="input" value={fields.title} onChange={(event) => set({ title: event.target.value })} onBlur={() => touch('title')} autoComplete="off" />}
        </Field>
        <Field label="Assign to" help={mode === 'run-now' && !editing ? 'A worker of this profile does the task.' : 'The profile whose worker does the task. Leave it unassigned to hand it out later.'} error={errors.assignee} name="assignee">
          {(aria) => (
            <select {...aria} className="input" value={fields.assignee} onChange={(event) => set({ assignee: event.target.value })} onBlur={() => touch('assignee')}>
              <option value="">Unassigned</option>
              {fields.assignee !== '' && !profiles.names.includes(fields.assignee) && <option value={fields.assignee}>{fields.assignee}</option>}
              {profiles.names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Priority" help="Higher runs first. Leave it empty for the normal priority." error={errors.priority} name="priority">
          {(aria) => <NumberInput {...aria} value={fields.priority} onChange={(priority) => set({ priority })} onBlur={() => touch('priority')} />}
        </Field>
      </Group>
      </Fragment>

      {!editing && !copyOf && (
        <details className="sb__section be__group" open={template !== undefined} data-group="template">
          <summary className="be__summary">
            <h2>Start from a template</h2>
            <Icon name="chev-r" small />
          </summary>
          <div className="be__body">
            <TemplatePicker preselect={template} onStart={startFromTemplate} />
          </div>
        </details>
      )}

      <Fragment key={`rest-${applied}`}>

      <Group id="brief" title="Brief">
        <BriefTextFields brief={fields.brief} onChange={(brief) => set({ brief })} />
        <details className="be__more">
          <summary>Preview: what the worker will read</summary>
          <BriefPreview brief={fields.brief} />
        </details>
      </Group>

      <Group id="run" title="How the worker runs" open={false}>
        <ModelField profile={workerProfile} model={fields.model} provider={fields.provider} onChange={(model, provider) => set({ model, provider })} error={errors.model} />
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
        {scheduling && fields.reasoningEffort !== '' && <p className="field__help" role="note">A scheduled task cannot carry a reasoning effort: the job’s script calls <code>hermes kanban create</code>, which has no flag for it. The worker uses the profile’s level.</p>}
        <Field label="Skills" help={lockedInfo ?? 'Skills the worker loads first, separated by commas. Empty leaves the profile’s own.'} error={errors.skills} name="skills">
          {(aria) => <ListInput {...aria} value={fields.skills} onChange={(skills) => set({ skills })} options={skillNames} onBlur={() => touch('skills')} readOnly={lock} />}
        </Field>
        <div className="sb__row">
          <Field label="Time limit" help={lockedInfo ?? 'Seconds, or 30m, 2h, 1d. The worker is stopped and the task queued again when it runs over.'} error={errors.maxRuntime} name="maxRuntime">
            {(aria) => <input {...aria} className="input mono" value={fields.maxRuntime} readOnly={lock} onChange={(event) => set({ maxRuntime: event.target.value })} onBlur={() => touch('maxRuntime')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          </Field>
          <Field label="Retries" help={lockedInfo ?? 'Failures in a row that block the task. Empty uses the dispatcher’s limit.'} error={errors.maxRetries} name="maxRetries">
            {(aria) => <NumberInput {...aria} value={fields.maxRetries} readOnly={lock} onChange={(maxRetries) => set({ maxRetries })} onBlur={() => touch('maxRetries')} />}
          </Field>
        </div>
      </Group>

      <Group id="workspace" title="Workspace" open={false}>
        <WorkspaceField profile={workerProfile} workspace={fields.workspace} onChange={(workspace) => set({ workspace })} project={fields.project} onProjectChange={(project) => set({ project })} errors={errors} touch={touch} locked={lock} />
      </Group>

      <Group id="done" title="Done when" open={false}>
        <div className="switch-row">
          <div>
            <strong id="be-goal-name">Keep going until a judge says it is done</strong>
            <p id="be-goal-why" className="subtle">
              <Term id="goal-mode">Goal mode</Term>: after each turn a judge checks the reply against the brief, and the worker carries on until it agrees or the turns run out. {lockedInfo}
            </p>
          </div>
          <button type="button" id="be-goal" className="switch" role="switch" aria-labelledby="be-goal-name" aria-describedby="be-goal-why" aria-checked={fields.goalMode} disabled={lock} onClick={() => set({ goalMode: !fields.goalMode })} />
        </div>
        {fields.goalMode && (
          <Field label="Most turns" help="Empty uses Hermes’s default (20). The task is blocked for review when the turns run out." error={errors.goalMaxTurns} name="goalMaxTurns">
            {(aria) => <NumberInput {...aria} value={fields.goalMaxTurns} readOnly={lock} onChange={(goalMaxTurns) => set({ goalMaxTurns })} onBlur={() => touch('goalMaxTurns')} />}
          </Field>
        )}
        <Field label="Completion contract" help={lockedInfo ?? 'local-only (the default), OWNER/REPO to publish a pull request, or the exact URL of one. A task with a contract is done only when its pull request’s checks pass.'} error={errors.completionContract} name="completionContract">
          {(aria) => (
            <>
              <input {...aria} className="input mono" list="be-contracts" placeholder="local-only" value={fields.completionContract} readOnly={lock} onChange={(event) => set({ completionContract: event.target.value })} onBlur={() => touch('completionContract')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <datalist id="be-contracts">
                <option value="local-only" />
              </datalist>
            </>
          )}
        </Field>
        <p className="field__help">
          What these mean: <Term id="completion-contract">completion contract</Term>.
        </p>
      </Group>

      <Group id="files" title="Attachments and links" open={false}>
        {editing ? (
          <p className="subtle">
            Files and links are kept on the task. Add or remove them on its <AppLink to={taskHref(edited.id).replace(/(\?|$)/, '/attachments$1')}>Attachments</AppLink> and <AppLink to={taskHref(edited.id).replace(/(\?|$)/, '/links$1')}>Links</AppLink> tabs.
          </p>
        ) : scheduling ? (
          <p className="subtle">A scheduled task is made fresh each time by a script, which cannot carry files or links to other tasks. Put what the worker needs to read in the References section of the brief.</p>
        ) : (
          <>
            <FilesField files={files} onChange={setFiles} />
            <Field label="Waits for tasks" help={lockedInfo ?? 'Task ids that must be done before this one can run, separated by commas. It waits in Todo until they are.'} error={errors.parents} name="parents">
              {(aria) => <ListInput {...aria} value={fields.parents} onChange={(parents) => set({ parents })} onBlur={() => touch('parents')} placeholder="none" />}
            </Field>
          </>
        )}
      </Group>

      <Group id="tools" title="Tools" open={false}>
        <ToolsetsNote profile={workerProfile} />
      </Group>

      {!editing && (
        <Group id="start" title="How should it start?" aside={<span id="be-mode" className="sr-only">How the task starts</span>}>
          <span id="be-draft" className="sr-only">Where the draft waits</span>
          <DispatchPanel mode={mode} onMode={setMode} draft={draft} onDraft={setDraft} specify={specify} onSpecify={setSpecify} />
          <p className="field__help">
            <Term id="dispatch-mode">What the four modes do</Term>.
          </p>
          {scheduling && (
            <div className="sb__when">
              <Field label="Schedule name" help="How the job is listed under Schedules." error={errors.scheduleName} name="scheduleName">
                {(aria) => <input {...aria} className="input" value={scheduleName} placeholder={fields.title} onChange={(event) => setScheduleName(event.target.value)} onBlur={() => touch('scheduleName')} autoComplete="off" />}
              </Field>
              <ScheduleFields schedule={schedule} onChange={setSchedule} error={problems.schedule} touched={submitted || touched.schedule === true} onTouch={() => touch('schedule')} />
              <FirePreview spec={spec} now={now} fireZone={fireZone} zone={zone} problem={problems.schedule} />
              <p className="field__help" role="note">
                A schedule saves a small script on the Mac that runs Hermes, and a job that runs it. That is a high-risk change, so when you press the button below you will confirm with your passkey and type the script’s name, which the box will show you.
              </p>
              {firstRun !== undefined && <p className="field__help">The first task is made {formatInstant(firstRun)}, by a Create-task job in {jobProfile}.</p>}
            </div>
          )}
        </Group>
      )}
      </Fragment>

      <div className="sb__bar be__bar">
        {Object.keys(problems).length > 0 && submitted && (
          <p className="field__error be__count" role="alert">
            {Object.keys(problems).length === 1 ? 'One thing needs a look.' : `${Object.keys(problems).length} things need a look.`}
          </p>
        )}
        <AppLink className="btn btn--ghost" to={cancelTo}>
          Cancel
        </AppLink>
        <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          <Icon name="check" />
          {saveLabel}
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
          <p>{editing ? 'The changes you made to this task are not saved.' : 'This task is not saved yet.'} Leaving now throws away what you wrote.</p>
        </Sheet>
      )}
    </form>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <div className="bpage sb be">
      <PageHeader overline="Work › Tasks" title={title} />
      <p role="status">Loading from Hermes…</p>
    </div>
  );
}

function Failed({ title, what, onRetry }: { title: string; what: string; onRetry(): void }) {
  return (
    <div className="bpage sb be">
      <PageHeader overline="Work › Tasks" title={title} />
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so {what}.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Work › Tasks › New task. `?from=<id>` starts from a copy of that task; `?board=` names the board. A brief Chat handed over fills Goal and Context. */
export function NewTask() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const board = typeof search.board === 'string' && search.board !== '' ? search.board : undefined;
  const from = typeof search.from === 'string' && search.from !== '' ? search.from : undefined;
  const template = typeof search.template === 'string' && search.template !== '' ? search.template : undefined;
  const profiles = useProfiles();
  const source = useTaskToEdit(from, board);
  // A brief that Chat left is taken once, when the editor opens.
  const [prefill] = useState(takeBrief);
  if (profiles.status === 'failed' || source.status === 'failed') return <Failed title="New task" what="the profiles are not known yet" onRetry={() => (profiles.status === 'failed' ? profiles.reload() : source.reload())} />;
  if (profiles.value === undefined || source.value === undefined || (from !== undefined && source.value === null)) return <Loading title="New task" />;
  let initial = newBriefFields();
  if (source.value) initial = { ...fieldsOfTask(source.value.task, source.value.links.parents), title: `${source.value.task.title} (copy)` };
  else if (prefill) {
    initial = { ...initial, title: prefill.title, brief: { kind: 'sections', sections: { ...emptySections(), goal: prefill.goal, context: prefill.context, references: prefill.references } } };
  }
  return <BriefForm key={`${from ?? 'new'}`} profiles={profiles.value} initial={initial} copyOf={from} board={board} template={template} />;
}

/** Work › Tasks › Edit: the same editor over a task that exists. */
export function EditTask() {
  const { taskId = '' } = useParams({ strict: false }) as { taskId?: string };
  const { board } = useSearch({ strict: false }) as { board?: string };
  const slug = typeof board === 'string' && board !== '' ? board : undefined;
  const profiles = useProfiles();
  const loaded = useTaskToEdit(taskId, slug);
  // The task as it was when the form opened: what Hermes says later does not move what is being typed.
  const opened = useRef<{ id: string; detail: NonNullable<typeof loaded.value> }>(undefined);
  if (loaded.value && opened.current?.id !== taskId) opened.current = { id: taskId, detail: loaded.value };
  if (profiles.status === 'failed' || loaded.status === 'failed') {
    return <Failed title="Edit task" what={loaded.status === 'failed' ? 'the task could not be read; it may have been deleted' : 'the profiles are not known yet'} onRetry={() => (loaded.status === 'failed' ? loaded.reload() : profiles.reload())} />;
  }
  if (profiles.value === undefined || opened.current === undefined) return <Loading title="Edit task" />;
  const { task, links } = opened.current.detail;
  return <BriefForm key={task.id} profiles={profiles.value} initial={fieldsOfTask(task, links.parents)} edited={task} board={slug} />;
}
