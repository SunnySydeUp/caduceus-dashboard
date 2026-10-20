// Work › Schedules › New schedule and Edit: the schedule builder. A form on a wide screen; on a phone the same fields are steps (type, what,
// when, review) so each screen holds little. What is wrong shows under the field as soon as it is left, and everything shows on Create;
// a draft that has been changed is guarded against leaving. Saving goes through `schedules-actions.ts`, which asks the policy.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useParams, useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate, useUrlProfile } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { loadScriptText, loadTaskFields, useBuilderData, useDeliveryTargets, useHermesZone, useSkillNames, type BuilderData } from './builder-data.ts';
import type { TaskFields } from './create-task-script.ts';
import { AgentFields, BlueprintFields, NameField, ProfileField, TaskFieldsForm, type FieldsProps } from './JobFields.tsx';
import { formatInstant, useNow } from './JobParts.tsx';
import { AdvancedFields, ScriptJobFields } from './ScriptFields.tsx';
import { blueprintDefaults, createPlan, draftOfJob, draftSpec, editPlan, FORM_TYPES, jobProblems, newDraft, type FormContext, type FormJobType, type JobDraft } from './job-form.ts';
import { FirePreview, ScheduleFields } from './ScheduleFields.tsx';
import { nextFires } from './schedule-spec.ts';
import { saveJob } from './schedules-actions.ts';
import { scheduleDraftFrom, takeSchedule } from './schedule-handoff.ts';
import { useJobs } from './schedules-data.ts';
import type { Job } from './schedules-model.ts';
import './work.css';

type StepId = 'type' | 'what' | 'when' | 'review';
const STEP_TITLES: Record<StepId, string> = { type: 'Type', what: 'What', when: 'When', review: 'Review' };

/** Which problems belong to which step, so Next can hold the owner on the step that has one. */
const STEP_OWNS: Record<StepId, (key: string) => boolean> = { type: () => false, what: (key) => key !== 'schedule', when: (key) => key === 'schedule', review: () => true };

/** The owner's IANA time zone, which the one-time schedule and the preview speak in. */
const ownerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A zone name Intl can use; Hermes's configured one is trusted only if it is. */
function usableZone(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return name;
  } catch {
    return undefined;
  }
}

const randomUnique = (): string => Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** What a Script job's script and its monitor script held when the form opened: what the edit is compared with. */
interface ScriptTexts {
  script: string;
  monitor: string;
}

interface FormProps {
  data: BuilderData;
  initial: JobDraft;
  /** The job being edited. */
  job?: Job;
  /** The fields of an edited Create-task job's script; `'foreign'` when the script is not one Caduceus wrote. */
  script?: TaskFields | 'foreign';
  /** The code of an edited Script job's script and of its monitor script. */
  texts?: ScriptTexts;
}

function BuilderForm({ data, initial, job, script, texts }: FormProps) {
  const compact = useSizeClass() === 'compact';
  const navigate = useAppNavigate();
  const now = useNow();
  const zone = useMemo(ownerZone, []);
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [step, setStep] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [unique] = useState(randomUnique);
  const saved = useRef(false);
  const editing = job !== undefined;
  const foreign = script === 'foreign';
  const hermesZone = usableZone(useHermesZone(draft.profile));
  const skillNames = useSkillNames(draft.profile);
  const targets = useDeliveryTargets(draft.profile);
  const { jobs: allJobs } = useJobs();

  const context: FormContext = { profiles: data.profiles, blueprints: data.blueprints, now, zone };
  // A blueprint's job, once made, is a prompt on a schedule: it is edited as one.
  const asEdited = editing && draft.type === 'blueprint' ? { ...draft, type: 'agent' as const } : draft;
  const allProblems = jobProblems(asEdited, context);
  // A script Caduceus did not write has no fields to check: only the name and the schedule are the owner's here.
  const problems = foreign ? Object.fromEntries(Object.entries(allProblems).filter(([key]) => key === 'name' || key === 'schedule')) : allProblems;
  const spec = draftSpec(asEdited, context);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // Only a move to another page is guarded: a dialog opening and closing (each owns a history entry) stays on this one.
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => dirty && !saved.current && current.pathname !== next.pathname, enableBeforeUnload: () => dirty && !saved.current, withResolver: true });

  const steps: StepId[] = editing ? ['what', 'when', 'review'] : draft.type === 'blueprint' ? ['type', 'what', 'review'] : ['type', 'what', 'when', 'review'];
  const current = steps[Math.min(step, steps.length - 1)];
  const shows = (id: StepId) => (compact ? current === id : id !== 'review' && (id !== 'type' || !editing) && (id !== 'when' || editing || draft.type !== 'blueprint'));
  const errors = Object.fromEntries(Object.entries(problems).filter(([key]) => submitted || touched[key]));

  useEffect(() => {
    if (focusRequest > 0) document.querySelector<HTMLElement>('.sb [aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const change = (patch: Partial<JobDraft>) => setDraft((previous) => ({ ...previous, ...patch }));
  const touch = (name: string) => setTouched((previous) => (previous[name] ? previous : { ...previous, [name]: true }));
  const pick = (key: string) => {
    const blueprint = data.blueprints.find((candidate) => candidate.key === key);
    setDraft((previous) => ({ ...previous, blueprint: { key, values: blueprint ? blueprintDefaults(blueprint) : {} } }));
    setTouched({});
  };
  const chooseType = (type: FormJobType) => {
    setDraft((previous) => ({ ...previous, type, ...(type === 'blueprint' && previous.blueprint.key === '' && data.blueprints[0] ? { blueprint: { key: data.blueprints[0].key, values: blueprintDefaults(data.blueprints[0]) } } : {}) }));
    setTouched({});
  };

  const fields: FieldsProps = { draft, change, errors, touch, profiles: data.profiles, skillNames, locked: editing };
  const back = job ? `/work/schedules/${encodeURIComponent(job.id)}` : '/work/schedules';

  /** Holds the owner on the first step that has a problem, with it showing. Returns whether there was none. */
  const checkStep = (id: StepId): boolean => {
    const keys = Object.keys(problems).filter(STEP_OWNS[id]);
    if (keys.length === 0) return true;
    setTouched((previous) => ({ ...previous, ...Object.fromEntries(keys.map((key) => [key, true as const])) }));
    setFocusRequest((count) => count + 1);
    return false;
  };

  const submit = async () => {
    if (Object.keys(problems).length > 0) {
      setSubmitted(true);
      if (compact) setStep(Math.max(0, steps.findIndex((id) => id !== 'type' && id !== 'review' && Object.keys(problems).some(STEP_OWNS[id]))));
      setFocusRequest((count) => count + 1);
      return;
    }
    const plan = editing ? editPlan(job, draft, { zone, original: script === 'foreign' ? undefined : script, scriptContent: texts?.script, monitorContent: texts?.monitor }) : createPlan(draft, { zone, unique });
    if (plan === undefined) {
      toast('Nothing was changed', { tone: 'info' });
      saved.current = true;
      void navigate(back);
      return;
    }
    const blueprint = data.blueprints.find((candidate) => candidate.key === draft.blueprint.key);
    const name = draft.type === 'blueprint' && !editing ? (blueprint?.title ?? draft.name) : draft.name.trim();
    setBusy(true);
    setFailure(undefined);
    try {
      const typed = draft.type === 'script' ? draft.script.file.trim() : draft.advanced.monitor.kind === 'script' && (draft.type === 'agent' || editing) ? draft.advanced.monitor.file.trim() : undefined;
      const outcome = await saveJob(plan, { name, profile: draft.profile, change: editing ? 'edit' : 'create', ...(typed ? { script: typed } : {}) });
      if (outcome.kind === 'failed') setFailure(outcome.message);
      if (outcome.kind !== 'done') return;
      saved.current = true;
      toast(editing ? `Saved “${name}”` : `Created “${name}”`, { tone: 'success' });
      const id = job?.id ?? outcome.body.id;
      void navigate(id ? `/work/schedules/${encodeURIComponent(id)}` : '/work/schedules');
    } finally {
      setBusy(false);
    }
  };

  const preview = <FirePreview spec={spec} now={now} fireZone={hermesZone ?? zone} zone={zone} problem={problems.schedule} />;
  const typeLabel = FORM_TYPES[draft.type].label;
  const first = spec !== undefined && problems.schedule === undefined ? nextFires(spec, now, hermesZone ?? zone, 1)[0] : undefined;
  const lastStep = step >= steps.length - 1;

  return (
    <form
      className="bpage sb"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!compact || lastStep) void submit();
        else if (checkStep(current)) setStep(step + 1);
      }}
    >
      <PageHeader
        overline="Work › Schedules"
        title={editing ? `Edit ${job.name}` : 'New schedule'}
        actions={
          <AppLink className="btn btn--secondary" to={back}>
            Cancel
          </AppLink>
        }
      />
      {compact && (
        <ol className="sb__steps" aria-label="Steps">
          {steps.map((id, index) => (
            <li key={id} aria-current={index === step ? 'step' : undefined} data-done={index < step ? '' : undefined}>
              <span className="sb__stepn">{index + 1}</span>
              <span>{STEP_TITLES[id]}</span>
            </li>
          ))}
        </ol>
      )}
      {failure && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{failure}</span>
        </div>
      )}
      {foreign && (
        <div className="banner" data-tone="info" role="note">
          <Icon name="info" />
          <span className="banner__content">This job runs a script that Caduceus did not write, so only its name and its schedule can be changed here.</span>
        </div>
      )}

      {shows('type') && (
        <section className="sb__section" aria-labelledby="sb-type">
          <h2 id="sb-type">What kind of schedule?</h2>
          <RadioGroup
            labelledBy="sb-type"
            value={draft.type}
            onChange={chooseType}
            className="sb__types"
            optionClassName="sb__type"
            options={(Object.keys(FORM_TYPES) as FormJobType[]).map((type) => ({
              value: type,
              label: (
                <>
                  <strong>{FORM_TYPES[type].label}</strong>
                  <span className="subtle">{FORM_TYPES[type].detail}</span>
                </>
              ),
            }))}
          />
          <p className="field__help">
            <Term id="job-types">What the types mean</Term>. Or <AppLink to="/work/schedules/blueprints">browse the blueprints</AppLink> to start from one.
          </p>
        </section>
      )}

      {shows('what') && (
        <section className="sb__section" aria-labelledby="sb-what">
          <h2 id="sb-what">{editing ? 'Settings' : draft.type === 'blueprint' ? 'Inputs' : 'What it does'}</h2>
          {data.status === 'loading' && <p role="status">Loading Hermes’s profiles and blueprints…</p>}
          {data.status === 'failed' && (
            <div className="banner" data-tone="danger" role="alert">
              <Icon name="alert" />
              <span className="banner__content">Hermes did not answer, so the profiles are not known yet.</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={data.reload}>
                Try again
              </button>
            </div>
          )}
          {draft.type === 'blueprint' && !editing ? (
            <>
              <ProfileField {...fields} />
              <BlueprintFields {...fields} blueprints={data.blueprints} pick={pick} />
              {!compact && preview}
            </>
          ) : (
            <>
              <NameField {...fields} locked={editing && draft.type === 'blueprint'} help={editing && draft.type === 'blueprint' ? 'Hermes knows a blueprint’s job by its name, so it stays.' : undefined} />
              <ProfileField {...fields} />
              {(draft.type === 'agent' || draft.type === 'blueprint') && <AgentFields {...fields} />}
              {draft.type === 'script' && <ScriptJobFields {...fields} lockedFile={editing} />}
              {draft.type === 'task' && <TaskFieldsForm {...fields} locked={foreign} />}
              {(draft.type === 'agent' || draft.type === 'script') && <AdvancedFields {...fields} targets={targets} jobs={allJobs ?? []} noAgent={draft.type === 'script' && draft.script.mode === 'output'} />}
            </>
          )}
        </section>
      )}

      {shows('when') && (
        <section className="sb__section" aria-labelledby="sb-when">
          <h2 id="sb-when">When it runs</h2>
          <ScheduleFields schedule={draft.schedule} onChange={(schedule) => change({ schedule })} error={problems.schedule} touched={submitted || touched.schedule === true} onTouch={() => touch('schedule')} />
          {preview}
        </section>
      )}

      {shows('review') && compact && (
        <section className="sb__section" aria-labelledby="sb-review">
          <h2 id="sb-review">Review</h2>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{typeLabel}</dd>
            <dt>Name</dt>
            <dd>{draft.type === 'blueprint' && !editing ? (data.blueprints.find((candidate) => candidate.key === draft.blueprint.key)?.title ?? '—') : draft.name}</dd>
            <dt>Profile</dt>
            <dd>{draft.profile}</dd>
            <dt>Schedule</dt>
            <dd className="mono">{spec ?? '—'}</dd>
            <dt>First run</dt>
            <dd>{first === undefined ? '—' : formatInstant(first)}</dd>
          </dl>
          {draft.type === 'blueprint' && !editing && preview}
          {Object.keys(problems).length > 0 && <p className="field__error" role="alert">{Object.keys(problems).length === 1 ? 'One thing needs a look.' : `${Object.keys(problems).length} things need a look.`} Go back to see which.</p>}
        </section>
      )}

      <div className="sb__bar">
        {compact && step > 0 && (
          <button type="button" className="btn btn--secondary" onClick={() => setStep(step - 1)}>
            <Icon name="chev-l" />
            Back
          </button>
        )}
        {(!compact || lastStep) && (
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="check" />
            {editing ? 'Save changes' : 'Create schedule'}
          </WriteButton>
        )}
        {compact && !lastStep && (
          <button type="submit" className="btn btn--primary">
            Next
            <Icon name="chev-r" />
          </button>
        )}
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
                Discard changes
              </button>
            </>
          }
        >
          <p>{editing ? 'The changes you made to this schedule are not saved.' : 'This schedule is not created yet.'} Leaving now throws them away.</p>
        </Sheet>
      )}
    </form>
  );
}

/** Work › Schedules › New: `?type=` and `?blueprint=` choose where it starts (the blueprint gallery sends the owner here with one). */
export function ScheduleBuilder() {
  const data = useBuilderData();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const urlProfile = useUrlProfile();
  // Repeat in a chat leaves its message here (once): the form starts from it, and nothing is created until the owner confirms the schedule.
  const [offer] = useState(takeSchedule);
  const initial = useMemo(() => {
    if (offer) return scheduleDraftFrom(offer);
    const profile = data.profiles.includes(urlProfile ?? '') ? (urlProfile as string) : (data.profiles.find((name) => name === 'default') ?? data.profiles[0] ?? 'default');
    const key = typeof search.blueprint === 'string' ? search.blueprint : '';
    const blueprint = data.blueprints.find((candidate) => candidate.key === key);
    const type: FormJobType = blueprint ? 'blueprint' : search.type === 'task' || search.type === 'blueprint' || search.type === 'script' ? search.type : 'agent';
    const draft = newDraft(type, profile);
    if (blueprint) return { ...draft, blueprint: { key, values: blueprintDefaults(blueprint) } };
    if (type === 'blueprint' && data.blueprints[0]) return { ...draft, blueprint: { key: data.blueprints[0].key, values: blueprintDefaults(data.blueprints[0]) } };
    return draft;
  }, [offer, data.profiles, data.blueprints, urlProfile, search.blueprint, search.type]);
  if (data.status === 'loading') {
    return (
      <div className="bpage sb">
        <PageHeader overline="Work › Schedules" title="New schedule" />
        <p role="status">Loading Hermes’s profiles and blueprints…</p>
      </div>
    );
  }
  // The form starts from the draft once and keeps what the owner types; it is made again only when the data it started from is.
  return <BuilderForm key={`${data.profiles.join()}|${data.blueprints.length}`} data={data} initial={initial} />;
}

/** Work › Schedules › Edit. */
export function ScheduleEdit() {
  const { jobId = '' } = useParams({ strict: false }) as { jobId?: string };
  const data = useBuilderData();
  const { jobs, failed } = useJobs();
  const zone = useMemo(ownerZone, []);
  const job = jobs?.find((candidate) => candidate.id === jobId);
  const [script, setScript] = useState<{ id: string; fields: TaskFields | 'foreign' | 'failed' }>();
  // The job as it was when the form opened: later changes Hermes tells of do not move what the owner is typing.
  const opened = useRef<Job>(undefined);
  if (job && opened.current?.id !== job.id) opened.current = job;
  const target = opened.current;

  useEffect(() => {
    if (!target || target.type !== 'task') return;
    const home = typeof target.config.hermes_home === 'string' ? target.config.hermes_home : data.homes[target.profile];
    const file = typeof target.config.script === 'string' ? target.config.script : '';
    if (!home || !file) {
      setScript({ id: target.id, fields: 'foreign' });
      return;
    }
    let current = true;
    loadTaskFields(home, file).then(
      (fields) => current && setScript({ id: target.id, fields: fields ?? 'foreign' }),
      () => current && setScript({ id: target.id, fields: 'failed' }),
    );
    return () => {
      current = false;
    };
  }, [target, data.homes]);

  // A Script job's code, and its monitor script's, are read from Hermes before the form opens: the edit is compared with what was read.
  const [texts, setTexts] = useState<{ id: string; value: ScriptTexts | 'failed' }>();
  const scriptFile = target ? (typeof target.config.script === 'string' ? target.config.script : '') : '';
  const monitorFile = target && typeof target.config.monitor_script === 'string' ? target.config.monitor_script : '';
  const needsTexts = target !== undefined && target.type !== 'task' && (target.type === 'script' || monitorFile !== '');
  useEffect(() => {
    if (!target || !needsTexts) return;
    const home = typeof target.config.hermes_home === 'string' && target.config.hermes_home !== '' ? target.config.hermes_home : data.homes[target.profile];
    if (!home) return;
    let current = true;
    Promise.all([target.type === 'script' && scriptFile !== '' ? loadScriptText(home, scriptFile) : Promise.resolve(''), monitorFile !== '' ? loadScriptText(home, monitorFile) : Promise.resolve('')]).then(
      ([script, monitor]) => current && setTexts({ id: target.id, value: { script: script ?? '', monitor: monitor ?? '' } }),
      () => current && setTexts({ id: target.id, value: 'failed' }),
    );
    return () => {
      current = false;
    };
  }, [target, needsTexts, scriptFile, monitorFile, data.homes]);

  const head = <PageHeader overline="Work › Schedules" title={target ? `Edit ${target.name}` : 'Edit schedule'} />;
  if (jobs !== undefined && target === undefined) {
    return (
      <div className="bpage sb">
        {head}
        <div className="empty">
          <Icon name="calendar" />
          <h2>This schedule is gone</h2>
          <p>It was deleted, perhaps on another device or from the command line.</p>
          <AppLink className="btn btn--primary" to="/work/schedules">
            Show every schedule
          </AppLink>
        </div>
      </div>
    );
  }
  if (target === undefined || data.status === 'loading') {
    return (
      <div className="bpage sb">
        {head}
        <p role={failed ? 'alert' : 'status'}>{failed ? 'Hermes did not answer, so the schedule cannot be opened. Caduceus tries again by itself.' : 'Loading the schedule…'}</p>
      </div>
    );
  }
  const readTexts = texts?.id === target.id ? texts.value : undefined;
  if (needsTexts && readTexts === undefined) {
    return (
      <div className="bpage sb">
        {head}
        <p role="status">Reading the script…</p>
      </div>
    );
  }
  if (readTexts === 'failed') {
    return (
      <div className="bpage sb">
        {head}
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not give this job’s script, so it cannot be opened for editing.</span>
        </div>
      </div>
    );
  }
  const loaded = script?.id === target.id ? script.fields : undefined;
  if (target.type === 'task' && loaded === undefined) {
    return (
      <div className="bpage sb">
        {head}
        <p role="status">Reading the task’s script…</p>
      </div>
    );
  }
  if (loaded === 'failed') {
    return (
      <div className="bpage sb">
        {head}
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not give this job’s script, so its fields cannot be opened.</span>
        </div>
      </div>
    );
  }
  const fields = typeof loaded === 'object' ? loaded : undefined;
  const scripts = typeof readTexts === 'object' ? readTexts : undefined;
  const initial = draftOfJob(target, zone, fields, scripts?.script ?? '', scripts?.monitor ?? '');
  if (initial === undefined) return null;
  return <BuilderForm key={target.id} data={data} initial={initial} job={target} script={loaded} texts={scripts} />;
}
