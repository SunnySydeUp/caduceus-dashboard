// The "What" of the builder, for each job type: an agent's prompt, model and skills; a task's title, brief and options; a blueprint's inputs.
import type { TaskFields, TaskWorkspace } from './create-task-script.ts';
import { Field, ListInput, NumberInput } from './FormParts.tsx';
import type { Blueprint, BlueprintField, FieldErrors, JobDraft } from './job-form.ts';

/** What the fields of a job need from the form: the draft, how to change it, and the problems the owner is to see. */
export interface FieldsProps {
  draft: JobDraft;
  change(patch: Partial<JobDraft>): void;
  errors: FieldErrors;
  /** Marks a field as one the owner has left, so its problem shows. */
  touch(name: string): void;
  profiles: readonly string[];
  skillNames: readonly string[];
  /** The fields that may not be changed, because the job already exists. */
  locked?: boolean;
}

export function ProfileField({ draft, change, errors, touch, profiles, locked }: FieldsProps) {
  return (
    <Field label="Profile" help={locked ? 'A job belongs to the profile it was made in.' : 'The profile whose settings, memory and model the job uses.'} error={errors.profile} name="profile">
      {(aria) => (
        <select {...aria} className="input" value={draft.profile} disabled={locked} onChange={(event) => change({ profile: event.target.value })} onBlur={() => touch('profile')}>
          {!profiles.includes(draft.profile) && <option value={draft.profile}>{draft.profile || 'Choose a profile'}</option>}
          {profiles.map((profile) => (
            <option key={profile} value={profile}>
              {profile}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function NameField({ draft, change, errors, touch, locked, help }: Pick<FieldsProps, 'draft' | 'change' | 'errors' | 'touch' | 'locked'> & { help?: string }) {
  return (
    <Field label="Name" help={help} error={errors.name} name="name">
      {(aria) => <input {...aria} className="input" value={draft.name} readOnly={locked} onChange={(event) => change({ name: event.target.value })} onBlur={() => touch('name')} autoComplete="off" />}
    </Field>
  );
}

export function AgentFields({ draft, change, errors, touch, skillNames }: FieldsProps) {
  return (
    <>
      <Field label="Prompt" help="What the agent is asked each time the schedule fires." error={errors.prompt} name="prompt">
        {(aria) => <textarea {...aria} className="input" rows={6} value={draft.prompt} onChange={(event) => change({ prompt: event.target.value })} onBlur={() => touch('prompt')} />}
      </Field>
      <Field label="Model" help="Leave empty to use the profile’s model.">
        {(aria) => <input {...aria} className="input" value={draft.model} onChange={(event) => change({ model: event.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
      </Field>
      <Field label="Skills" help="Skills the agent loads first, separated by commas.">
        {(aria) => <ListInput {...aria} value={draft.skills} onChange={(skills) => change({ skills })} options={skillNames} placeholder="none" />}
      </Field>
    </>
  );
}

const WORKSPACES = [
  { value: 'scratch', label: 'A fresh scratch folder' },
  { value: 'dir', label: 'A folder on this Mac' },
  { value: 'worktree', label: 'A git worktree' },
] as const;

function workspaceOf(kind: TaskWorkspace['kind'], previous: TaskWorkspace): TaskWorkspace {
  const path = 'path' in previous ? previous.path : undefined;
  if (kind === 'scratch') return { kind };
  if (kind === 'dir') return { kind, path: path ?? '' };
  return { kind, ...(path ? { path } : {}), ...('branch' in previous && previous.branch ? { branch: previous.branch } : {}) };
}

export function TaskFieldsForm({ draft, change, errors, touch, profiles, skillNames, locked }: FieldsProps) {
  const task = draft.task;
  const set = (patch: Partial<TaskFields>) => change({ task: { ...task, ...patch } });
  const workspace = task.workspace;
  return (
    <>
      <Field label="Task title" help="The title of each task this schedule puts on the board." error={errors.title} name="title">
        {(aria) => <input {...aria} className="input" value={task.title} readOnly={locked} onChange={(event) => set({ title: event.target.value })} onBlur={() => touch('title')} autoComplete="off" />}
      </Field>
      <Field label="Brief" help="What the worker is asked to do, in Markdown. It becomes the task’s body." name="brief">
        {(aria) => <textarea {...aria} className="input" rows={7} value={task.brief} readOnly={locked} onChange={(event) => set({ brief: event.target.value })} />}
      </Field>
      <Field label="Assign to" help="The profile that works the task. Leave it unassigned to pick it up later." error={errors.assignee} name="assignee">
        {(aria) => (
          <select {...aria} className="input" value={task.assignee} disabled={locked} onChange={(event) => set({ assignee: event.target.value })} onBlur={() => touch('assignee')}>
            <option value="">Unassigned</option>
            {task.assignee !== '' && !profiles.includes(task.assignee) && <option value={task.assignee}>{task.assignee}</option>}
            {profiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="switch-row">
        <label htmlFor="sb-triage">
          <strong id="sb-triage-name">Park each task in triage</strong>
          <br />
          <span className="subtle">A specifier fleshes it out before it is made ready to run, instead of the task being ready at once.</span>
        </label>
        <button type="button" id="sb-triage" className="switch" role="switch" aria-labelledby="sb-triage-name" aria-checked={task.triage} disabled={locked} onClick={() => set({ triage: !task.triage })} />
      </div>
      <details className="sb__more">
        <summary>More task options</summary>
        <div className="sb__stack">
          <Field label="Workspace" help="Where the worker runs." name="workspace" error={errors.workspace}>
            {(aria) => (
              <select {...aria} className="input" value={workspace.kind} disabled={locked} onChange={(event) => set({ workspace: workspaceOf(event.target.value as TaskWorkspace['kind'], workspace) })}>
                {WORKSPACES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {workspace.kind !== 'scratch' && (
            <Field label={workspace.kind === 'dir' ? 'Folder' : 'Repository folder (optional)'} help="A full path, such as /Users/you/project." error={errors.workspace}>
              {(aria) => (
                <input {...aria} className="input input--mono" value={workspace.path ?? ''} readOnly={locked} onChange={(event) => set({ workspace: workspace.kind === 'dir' ? { kind: 'dir', path: event.target.value } : { ...workspace, path: event.target.value } })} onBlur={() => touch('workspace')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              )}
            </Field>
          )}
          {workspace.kind === 'worktree' && (
            <Field label="Branch (optional)">
              {(aria) => <input {...aria} className="input input--mono" value={workspace.branch ?? ''} readOnly={locked} onChange={(event) => set({ workspace: { ...workspace, branch: event.target.value } })} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
            </Field>
          )}
          <div className="sb__row">
            <Field label="Priority" help="Higher runs first." error={errors.priority} name="priority">
              {(aria) => <NumberInput {...aria} value={task.priority} onChange={(priority) => set({ priority })} onBlur={() => touch('priority')} />}
            </Field>
            <Field label="Retries" help="Failures before it is blocked." error={errors.maxRetries} name="maxRetries">
              {(aria) => <NumberInput {...aria} value={task.maxRetries} onChange={(maxRetries) => set({ maxRetries })} onBlur={() => touch('maxRetries')} />}
            </Field>
          </div>
          <Field label="Time limit" help="Seconds, or 30m, 2h, 1d. The worker is stopped and the task queued again when it runs over." error={errors.maxRuntime} name="maxRuntime">
            {(aria) => <input {...aria} className="input mono" value={task.maxRuntime ?? ''} readOnly={locked} onChange={(event) => set({ maxRuntime: event.target.value || undefined })} onBlur={() => touch('maxRuntime')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          </Field>
          <Field label="Model" help="Pins the worker to this model. Leave empty to use the assignee’s.">
            {(aria) => <input {...aria} className="input" value={task.model} readOnly={locked} onChange={(event) => set({ model: event.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          </Field>
          <Field label="Skills" help="Skills the worker loads first, separated by commas.">
            {(aria) => <ListInput {...aria} value={task.skills} onChange={(skills) => set({ skills })} options={skillNames} />}
          </Field>
        </div>
      </details>
    </>
  );
}

function BlueprintInput({ field, value, error, onChange, touch }: { field: BlueprintField; value: string; error: string | undefined; onChange(value: string): void; touch(): void }) {
  const label = field.optional ? `${field.label.replace(/\?$/, '')} (optional)` : field.label;
  const choices = field.options;
  return (
    <Field label={label} help={field.help || undefined} error={error} name={`value.${field.name}`}>
      {(aria) => {
        if (field.type === 'time') return <input {...aria} className="input" type="time" value={value} onChange={(event) => onChange(event.target.value)} onBlur={touch} />;
        if ((field.type === 'enum' || field.type === 'weekdays') && field.strict && choices.length > 0) {
          return (
            <select {...aria} className="input" value={value} onChange={(event) => onChange(event.target.value)} onBlur={touch}>
              {!choices.includes(value) && <option value={value}>{value === '' ? 'Choose…' : value}</option>}
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          );
        }
        if (field.type === 'enum' || field.type === 'weekdays') {
          const listId = `${aria.id}-options`;
          return (
            <>
              <input {...aria} className="input" list={listId} value={value} onChange={(event) => onChange(event.target.value)} onBlur={touch} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <datalist id={listId}>
                {choices.map((choice) => (
                  <option key={choice} value={choice} />
                ))}
              </datalist>
            </>
          );
        }
        return <textarea {...aria} className="input" rows={2} value={value} onChange={(event) => onChange(event.target.value)} onBlur={touch} />;
      }}
    </Field>
  );
}

/** The blueprint chosen, and the inputs it asks for. */
export function BlueprintFields({ draft, change, errors, touch, blueprints, pick }: FieldsProps & { blueprints: readonly Blueprint[]; pick(key: string): void }) {
  const blueprint = blueprints.find((candidate) => candidate.key === draft.blueprint.key);
  return (
    <>
      <Field label="Blueprint" help={blueprint?.description} error={errors.blueprint} name="blueprint">
        {(aria) => (
          <select {...aria} className="input" value={draft.blueprint.key} onChange={(event) => pick(event.target.value)}>
            {blueprint === undefined && <option value={draft.blueprint.key}>Choose a blueprint…</option>}
            {blueprints.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      {blueprint?.fields.map((field) => (
        <BlueprintInput key={field.name} field={field} value={draft.blueprint.values[field.name] ?? ''} error={errors[`value.${field.name}`]} onChange={(value) => change({ blueprint: { ...draft.blueprint, values: { ...draft.blueprint.values, [field.name]: value } } })} touch={() => touch(`value.${field.name}`)} />
      ))}
    </>
  );
}
