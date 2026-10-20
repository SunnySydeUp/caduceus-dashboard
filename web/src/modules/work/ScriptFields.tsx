// The Script job's fields and the advanced options of an Agent prompt or Script job (M3 #12): the script and its code, how it runs, a monitor, jobs whose output is
// chained in, where results and failures go, whether the run attaches to a session, and the folder it runs in.
import { Term } from '../../shell/Term.tsx';
import type { DeliveryTarget } from './builder-data.ts';
import { Field } from './FormParts.tsx';
import { AgentFields, type FieldsProps } from './JobFields.tsx';
import type { AdvancedDraft, MonitorDraft, ScriptDraft } from './job-form.ts';
import type { Job } from './schedules-model.ts';

const MODES: { value: ScriptDraft['mode']; label: string; help: string }[] = [
  { value: 'output', label: 'Its output is the result', help: 'The script runs without an agent and what it prints is delivered as it is. No model is used.' },
  { value: 'context', label: 'Its output goes to an agent', help: 'What the script prints is given to an agent as context for the prompt, and the agent’s answer is the result. That uses the model.' },
];

/** A code box: the script is code, so it is monospace, never auto-corrected and never wrapped. */
export function CodeBox({ id, value, onChange, onBlur, readOnly, describedBy, invalid, label }: { id: string; value: string; onChange?(value: string): void; onBlur?(): void; readOnly?: boolean; describedBy?: string; invalid?: true; label?: string }) {
  return (
    <textarea
      id={id}
      className="input input--mono sf-code"
      rows={12}
      value={value}
      readOnly={readOnly}
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      spellCheck={false}
      autoCapitalize="none"
      autoComplete="off"
      wrap="off"
      onChange={(event) => onChange?.(event.target.value)}
      onBlur={onBlur}
    />
  );
}

/** The script of a Script job: its file, its code, and how it runs. `lockedFile`: a job's script keeps its name once it exists. */
export function ScriptJobFields(props: FieldsProps & { lockedFile: boolean }) {
  const { draft, change, errors, touch, lockedFile } = props;
  const { script } = draft;
  const set = (patch: Partial<ScriptDraft>) => change({ script: { ...script, ...patch } });
  return (
    <>
      <Field label="Script file" help={lockedFile ? 'A job keeps the file it was made with.' : <>The file in the profile’s scripts folder, the only place Hermes runs scripts from. Files ending in .sh or .bash run in bash; anything else runs in Python.</>} error={errors.scriptFile} name="scriptFile">
        {(aria) => <input {...aria} className="input input--mono" value={script.file} readOnly={lockedFile} placeholder="report.sh" onChange={(event) => set({ file: event.target.value })} onBlur={() => touch('scriptFile')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
      </Field>
      <Field label="Script" help={<>The code. Saving it is a step of its own that asks for your passkey and the script’s name: it runs on the Mac that runs Hermes. <Term id="script-job">What a Script job is</Term>.</>} error={errors.scriptContent} name="scriptContent">
        {(aria) => <CodeBox id={aria.id} value={script.content} onChange={(content) => set({ content })} onBlur={() => touch('scriptContent')} describedBy={aria['aria-describedby']} invalid={aria['aria-invalid']} />}
      </Field>
      <fieldset className="sf-modes">
        <legend className="field__label">What happens to its output</legend>
        {MODES.map((mode) => (
          <label key={mode.value} className="sf-mode">
            <input type="radio" name="script-mode" checked={script.mode === mode.value} onChange={() => set({ mode: mode.value })} />
            <span>
              <strong>{mode.label}</strong>
              <span className="subtle"> {mode.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {script.mode === 'context' && <AgentFields {...props} />}
    </>
  );
}

const NO_MONITOR_LABEL: Record<MonitorDraft['kind'], string> = { none: 'No monitor', script: 'A script checks', url: 'An address is watched' };

function TargetPicker({ legend, help, chosen, targets, onChange }: { legend: string; help: string; chosen: string[]; targets: readonly DeliveryTarget[]; onChange(next: string[]): void }) {
  const known = new Set(targets.map((target) => target.id));
  const all = [...targets, ...chosen.filter((id) => !known.has(id)).map((id) => ({ id, name: id, ready: true }))];
  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]);
  return (
    <fieldset className="sf-modes">
      <legend className="field__label">{legend}</legend>
      <p className="field__help">{help}</p>
      {all.length === 0 && <p className="subtle">Hermes has not listed any target yet.</p>}
      {all.map((target) => (
        <label key={target.id} className="sf-mode">
          <input type="checkbox" checked={chosen.includes(target.id)} onChange={() => toggle(target.id)} />
          <span>
            {target.name} <span className="mono subtle">{target.id}</span>
            {!target.ready && <span className="subtle"> · no home channel set in Hermes: nothing would arrive</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The advanced options. `noAgent`: the job runs without an agent, so a monitor (which decides whether the agent runs) is not offered. */
export function AdvancedFields({ draft, change, errors, touch, targets, jobs, noAgent }: FieldsProps & { targets: readonly DeliveryTarget[]; jobs: readonly Job[]; noAgent: boolean }) {
  const { advanced } = draft;
  const set = (patch: Partial<AdvancedDraft>) => change({ advanced: { ...advanced, ...patch } });
  const setMonitor = (patch: Partial<MonitorDraft>) => set({ monitor: { ...advanced.monitor, ...patch } });
  const others = jobs.filter((job) => job.profile === draft.profile);
  const chained = advanced.contextFrom;
  const toggleJob = (id: string) => set({ contextFrom: chained.includes(id) ? chained.filter((item) => item !== id) : [...chained, id] });
  const known = new Set(others.map((job) => job.id));
  return (
    <details className="sb__more" open={Object.keys(errors).some((key) => key === 'monitor' || key.startsWith('monitor') || key === 'workdir') || undefined}>
      <summary>Advanced options</summary>
      <div className="sb__stack">
        <Field label="Monitor" help={<>A <Term id="job-monitor">monitor</Term> is a cheap check that runs first. When what it reads has not changed since the last run, the agent does not run.</>} error={errors.monitor} name="monitor">
          {(aria) => (
            <select {...aria} className="input" value={advanced.monitor.kind} onChange={(event) => setMonitor({ kind: event.target.value as MonitorDraft['kind'] })}>
              {(Object.keys(NO_MONITOR_LABEL) as MonitorDraft['kind'][]).map((kind) => (
                <option key={kind} value={kind}>
                  {NO_MONITOR_LABEL[kind]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {noAgent && advanced.monitor.kind !== 'none' && <p className="field__help">A script that runs without an agent has nothing for a monitor to hold back.</p>}
        {advanced.monitor.kind === 'url' && (
          <Field label="Address to watch" help="Fetched on each tick; the agent runs when its content changes." error={errors.monitorUrl} name="monitorUrl">
            {(aria) => <input {...aria} className="input input--mono" value={advanced.monitor.value} placeholder="https://example.com/feed" onChange={(event) => setMonitor({ value: event.target.value })} onBlur={() => touch('monitorUrl')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          </Field>
        )}
        {advanced.monitor.kind === 'script' && (
          <>
            <Field label="Monitor script file" help="Also in the scripts folder; what it prints is what is compared." error={errors.monitorFile} name="monitorFile">
              {(aria) => <input {...aria} className="input input--mono" value={advanced.monitor.file} placeholder="check.sh" onChange={(event) => setMonitor({ file: event.target.value, value: event.target.value })} onBlur={() => touch('monitorFile')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
            </Field>
            <Field label="Monitor script" error={errors.monitorContent} name="monitorContent">
              {(aria) => <CodeBox id={aria.id} value={advanced.monitor.content} onChange={(content) => setMonitor({ content })} onBlur={() => touch('monitorContent')} describedBy={aria['aria-describedby']} invalid={aria['aria-invalid']} />}
            </Field>
          </>
        )}
        <fieldset className="sf-modes">
          <legend className="field__label">Chain other jobs’ output</legend>
          <p className="field__help">
            The latest output of the jobs you tick is given to the agent as context (Hermes’s <Term id="context-from">context_from</Term>).
          </p>
          <label className="sf-mode">
            <input type="checkbox" checked={chained.includes('self')} onChange={() => toggleJob('self')} />
            <span>This job’s own last output</span>
          </label>
          {others.map((job) => (
            <label key={job.id} className="sf-mode">
              <input type="checkbox" checked={chained.includes(job.id)} onChange={() => toggleJob(job.id)} />
              <span>
                {job.name} <span className="mono subtle">{job.id}</span>
              </span>
            </label>
          ))}
          {chained.filter((id) => id !== 'self' && !known.has(id)).map((id) => (
            <label key={id} className="sf-mode">
              <input type="checkbox" checked onChange={() => toggleJob(id)} />
              <span className="mono">{id}</span>
            </label>
          ))}
        </fieldset>
        <TargetPicker legend="Deliver the result to" help="Local only saves the result. Tick a platform to send it there too." chosen={advanced.deliver} targets={targets} onChange={(deliver) => set({ deliver })} />
        <TargetPicker legend="Deliver a failure to" help="Leave all unticked to send failures where the result goes." chosen={advanced.failureDeliver} targets={targets} onChange={(failureDeliver) => set({ failureDeliver })} />
        <Field label="Attach to a session" help="Whether each run is added to the chat session the job was made in. Default follows Hermes’s own setting." name="attach">
          {(aria) => (
            <select {...aria} className="input" value={advanced.attachToSession} onChange={(event) => set({ attachToSession: event.target.value as AdvancedDraft['attachToSession'] })}>
              <option value="default">Hermes’s default</option>
              <option value="attach">Attach each run</option>
              <option value="detach">Never attach</option>
            </select>
          )}
        </Field>
        <Field label="Working folder" help="The folder the job’s tools and scripts run in. Empty lets Hermes choose." error={errors.workdir} name="workdir">
          {(aria) => <input {...aria} className="input input--mono" value={advanced.workdir} placeholder="/Users/you/project" onChange={(event) => set({ workdir: event.target.value })} onBlur={() => touch('workdir')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
        </Field>
      </div>
    </details>
  );
}
