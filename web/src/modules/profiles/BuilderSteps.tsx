// The five panels of the profile builder (M4 #12). Each shows its entries and what is wrong with them; the container (`ProfileBuilder.tsx`)
// owns the draft, the step and the footer. A panel only edits the draft it is given: Hermes is read, never written, until Finish.
import { useEffect, useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import type { ModelChoice } from '../models/model-catalogue.ts';
import { ModelPickerSheet } from '../models/ModelPicker.tsx';
import { fetchHubOfficial } from '../skills/hub-data.ts';
import type { OfficialSkill } from '../skills/hub-model.ts';
import { useMcpCatalog } from '../tools/mcp-data.ts';
import { asks, catalogueEligible, copyable, type Asks, type Baseline, type Draft, type PlanStep, type Start, type StepProblems, type StepResult } from './builder-model.ts';
import { PERSONAS, personaState } from './personas.ts';
import type { ProfileCard } from './profiles-model.ts';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {message}
    </p>
  ) : null;
}

export interface StepProps {
  draft: Draft;
  set(change: Partial<Draft>): void;
  baseline: Baseline | undefined;
  baselineFailed: boolean;
  /** Problems of this step's entries, shown once the owner has tried to go on. */
  problems: StepProblems;
}

const START_OPTIONS = [
  { value: 'blank', label: 'Blank' },
  { value: 'persona', label: 'Persona' },
  { value: 'clone', label: 'Clone' },
] as const satisfies readonly { value: Start['kind']; label: string }[];

export function IdentityStep({
  draft,
  set,
  problems,
  cards,
  chooseStart,
  seeding,
}: StepProps & { cards: readonly ProfileCard[]; chooseStart(start: Start): void; seeding: boolean }) {
  const id = useId();
  const names = cards.map((card) => card.name);
  const kind = draft.start.kind;
  return (
    <div className="bd-step">
      <p className="bd-note">
        A <Term id="profile">profile</Term> is a separate agent with its own settings, memory and skills. Start from nothing, from a <Term id="persona">persona</Term> that fills in a name and a SOUL, or as a <Term id="profile-clone">clone</Term> of a profile you have.
      </p>
      <div className="field">
        <span className="field__label" id={`${id}-start`}>
          Start from
        </span>
        <RadioGroup
          labelledBy={`${id}-start`}
          value={kind}
          options={START_OPTIONS}
          onChange={(next) => chooseStart(next === 'blank' ? { kind: 'blank' } : next === 'persona' ? { kind: 'persona', persona: PERSONAS[0]!.id } : { kind: 'clone', source: (cards.find((card) => card.isDefault) ?? cards[0])?.name ?? 'default' })}
          className="seg"
        />
      </div>
      {draft.start.kind === 'persona' && (
        <fieldset className="bd-fieldset">
          <legend className="field__label">Persona</legend>
          <ul className="bd-personas">
            {PERSONAS.map((persona) => {
              const chosen = draft.start.kind === 'persona' && draft.start.persona === persona.id;
              const state = personaState(persona, names);
              return (
                <li key={persona.id}>
                  <button type="button" className="bd-persona" aria-pressed={chosen} onClick={() => chooseStart({ kind: 'persona', persona: persona.id })}>
                    <span className="bd-persona__name">{persona.title}</span>
                    <span className="bd-persona__summary">{persona.summary}</span>
                    <span className="tag" data-tone={state === 'exists' ? 'neutral' : 'accent'}>
                      {state === 'exists' ? 'Profile exists' : 'Restore'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="field__help">A persona is only a starting point: nothing of it is kept by Caduceus. Restore means no profile has the persona’s name, so Finish makes it in Hermes again.</p>
        </fieldset>
      )}
      {draft.start.kind === 'clone' && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-source`}>
            Profile to clone
          </label>
          <select id={`${id}-source`} className="input" value={draft.start.source} onChange={(event) => chooseStart({ kind: 'clone', source: event.target.value })}>
            {cards.map((card) => (
              <option key={card.name} value={card.name}>
                {card.name}
              </option>
            ))}
          </select>
          <p className="field__help">Hermes copies the profile’s settings, SOUL and skills into the new one. The profile you clone is not changed.</p>
        </div>
      )}
      {seeding && <p role="status">Reading the profile from Hermes…</p>}
      <div className="field">
        <label className="field__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <div className="bd-name">
          <Sigil name={draft.name.trim().toLowerCase() || 'new'} size="md" />
          <input
            id={`${id}-name`}
            className="input input--mono"
            value={draft.name}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={problems.name ? true : undefined}
            aria-describedby={`${id}-name-help ${id}-name-error`}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <p className="field__help" id={`${id}-name-help`}>
          Lowercase letters, numbers, - or _. It is also the name on the command line. The pattern and colour of its sigil come from the name: Hermes keeps no look for a profile, and Caduceus keeps none either.
        </p>
        <FieldError id={`${id}-name-error`} message={problems.name} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-display`}>
          Assistant display name <span className="subtle">(optional)</span>
        </label>
        <input id={`${id}-display`} className="input" value={draft.displayName} maxLength={80} autoComplete="off" aria-invalid={problems.displayName ? true : undefined} aria-describedby={`${id}-display-error`} onChange={(event) => set({ displayName: event.target.value })} />
        <p className="field__help">What chat headers call this assistant. Caduceus keeps it for the profile; Hermes never sees it.</p>
        <FieldError id={`${id}-display-error`} message={problems.displayName} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-description`}>
          Description <span className="subtle">(optional)</span>
        </label>
        <textarea id={`${id}-description`} className="input" rows={2} value={draft.description} aria-invalid={problems.description ? true : undefined} aria-describedby={`${id}-description-error`} onChange={(event) => set({ description: event.target.value })} />
        <FieldError id={`${id}-description-error`} message={problems.description} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-soul`}>
          SOUL <span className="subtle">(optional)</span>
        </label>
        <textarea id={`${id}-soul`} className="input input--mono bd-soul" rows={10} spellCheck value={draft.soul} aria-invalid={problems.soul ? true : undefined} aria-describedby={`${id}-soul-help ${id}-soul-error`} onChange={(event) => set({ soul: event.target.value })} />
        <p className="field__help" id={`${id}-soul-help`}>
          The <Term id="soul">SOUL</Term> is who this agent is, in Markdown: Hermes writes it to the profile’s SOUL.md and reads it at the start of every conversation. Leave it empty to keep Hermes’s own.
        </p>
        <FieldError id={`${id}-soul-error`} message={problems.soul} />
      </div>
    </div>
  );
}

export function ModelStep({ draft, set, baseline }: StepProps) {
  const [picking, setPicking] = useState(false);
  const clone = draft.start.kind === 'clone';
  const inherited = baseline?.model;
  return (
    <div className="bd-step">
      <p className="bd-note">
        The <Term id="main-model">main model</Term> answers the profile’s chats. {clone ? 'A clone starts with the model of the profile it copies; choose another to change it.' : 'A new profile has no model until you choose one: it cannot chat before that.'}
      </p>
      <div className="panel panel--pad bd-model">
        <div>
          <div className="field__label">Main model</div>
          <div className="mono" data-testid="builder-model">
            {draft.model ? `${draft.model.model} (${draft.model.provider})` : clone && inherited ? `${inherited.model} (${inherited.provider}) · from the copy` : 'None chosen'}
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={() => setPicking(true)}>
            <Icon name="cpu" />
            {draft.model ? 'Change model' : 'Choose a model'}
          </button>
          {draft.model && !clone && (
            <button type="button" className="btn btn--ghost" onClick={() => set({ model: undefined })}>
              Choose later
            </button>
          )}
        </div>
      </div>
      <p className="field__help">The list is Hermes’s live catalogue for the profile you start from. You can change the model later on the profile’s Model tab.</p>
      {picking && (
        <ModelPickerSheet
          title="Main model of the new profile"
          profile={baseline?.source ?? 'default'}
          value={draft.model ?? inherited}
          onPick={(choice: ModelChoice) => {
            set({ model: choice });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange(next: boolean): void; children: React.ReactNode }) {
  return (
    <label className="check bd-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const LIMIT = 40;

export function SkillsStep({ draft, set, baseline, baselineFailed, problems }: StepProps) {
  const [query, setQuery] = useState('');
  const [official, setOfficial] = useState<OfficialSkill[]>();
  const [officialFailed, setOfficialFailed] = useState(false);
  const source = baseline?.source ?? 'default';
  useEffect(() => {
    let current = true;
    fetchHubOfficial(source).then(
      (list) => current && setOfficial(list),
      () => current && setOfficialFailed(true),
    );
    return () => {
      current = false;
    };
  }, [source]);
  const needle = query.trim().toLowerCase();
  const has = (text: string) => needle === '' || text.toLowerCase().includes(needle);
  const installed = (baseline?.skills ?? []).filter((skill) => has(`${skill.name} ${skill.description}`));
  const hub = (official ?? []).filter((skill) => !skill.installed && has(`${skill.name} ${skill.description}`));
  const off = new Set(draft.skillsOff);
  const picked = new Set(draft.hubSkills.map((skill) => skill.identifier));
  return (
    <div className="bd-step">
      <p className="bd-note">
        A <Term id="skill">skill</Term> is a procedure the agent can follow. Switch off the skills this profile should not have, and choose hub skills to install once it exists. Each hub skill is scanned by Hermes before it is installed.
      </p>
      <div className="input-wrap">
        <Icon name="search" />
        <input className="input" type="search" placeholder="Search skills" aria-label="Search skills" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <section className="bd-group" aria-labelledby="bd-skills-installed">
        <h3 id="bd-skills-installed">{draft.start.kind === 'clone' ? `Skills of ${source}` : 'Skills Hermes starts it with'}</h3>
        {baselineFailed && <p className="field__error">Hermes did not answer, so its skills could not be listed.</p>}
        {!baseline && !baselineFailed && <p role="status">Loading skills…</p>}
        {baseline && installed.length === 0 && <p className="subtle">{baseline.skills.length === 0 ? 'Hermes lists no skills.' : 'No skill matches the search.'}</p>}
        <ul className="bd-list">
          {installed.slice(0, LIMIT).map((skill) => (
            <li key={skill.name}>
              <Toggle checked={!off.has(skill.name)} onChange={(on) => set({ skillsOff: on ? draft.skillsOff.filter((name) => name !== skill.name) : [...draft.skillsOff, skill.name] })}>
                <strong>{skill.name}</strong> {!skill.enabled && <span className="tag">Off in {source}</span>} <small className="subtle">{skill.description}</small>
              </Toggle>
            </li>
          ))}
        </ul>
        {installed.length > LIMIT && <p className="subtle">{installed.length - LIMIT} more match. Search to narrow the list.</p>}
        {off.size > 0 && <p className="field__help">{off.size} skill{off.size === 1 ? '' : 's'} will be switched off in the new profile.</p>}
      </section>
      <section className="bd-group" aria-labelledby="bd-skills-hub">
        <h3 id="bd-skills-hub">Add from the hub</h3>
        {officialFailed && <p className="field__error">Hermes did not answer, so the hub list could not be loaded. Add skills from Skills › Hub afterwards.</p>}
        {!official && !officialFailed && <p role="status">Loading the hub…</p>}
        <ul className="bd-list">
          {hub.slice(0, LIMIT).map((skill) => (
            <li key={skill.identifier}>
              <Toggle
                checked={picked.has(skill.identifier)}
                onChange={(on) => set({ hubSkills: on ? [...draft.hubSkills, { identifier: skill.identifier, name: skill.name }] : draft.hubSkills.filter((pick) => pick.identifier !== skill.identifier) })}
              >
                <strong>{skill.name}</strong> <small className="subtle">{skill.description}</small>
              </Toggle>
            </li>
          ))}
        </ul>
        {hub.length > LIMIT && <p className="subtle">{hub.length - LIMIT} more match. Search to narrow the list.</p>}
        <FieldError id="bd-hub-error" message={problems.hubSkills} />
        <p className="field__help">Hub skills are installed in the background after the profile is made. Hermes’s scan must find nothing: a skill with findings is left for Skills › Hub, where you read them and confirm.</p>
      </section>
    </div>
  );
}

export function McpStep({ draft, set, baseline, problems }: StepProps) {
  const [query, setQuery] = useState('');
  const catalogue = useMcpCatalog('default');
  const clone = draft.start.kind === 'clone';
  const needle = query.trim().toLowerCase();
  const entries = useMemo(() => (catalogue.value?.entries ?? []).filter(catalogueEligible).filter((entry) => needle === '' || `${entry.name} ${entry.description}`.toLowerCase().includes(needle)), [catalogue.value, needle]);
  const servers = baseline?.servers ?? [];
  const copyList = servers.filter(({ server, definition }) => copyable(server, definition));
  const held = servers.filter(({ server, definition }) => !copyable(server, definition));
  const toggle = (list: 'mcpCopy' | 'mcpCatalogue', name: string, on: boolean) => set({ [list]: on ? [...draft[list], name] : draft[list].filter((item) => item !== name) });
  return (
    <div className="bd-step">
      <p className="bd-note">
        An <Term id="mcp-server">MCP server</Term> gives the agent more tools. Adding a server that runs a program on this computer asks you to type its name when you finish.
      </p>
      {clone ? (
        <section className="bd-group" aria-labelledby="bd-mcp-kept">
          <h3 id="bd-mcp-kept">Kept from {baseline?.source}</h3>
          {servers.length === 0 ? <p className="subtle">The profile has no MCP servers.</p> : <p>{servers.map(({ server }) => server.name).join(', ')}. Hermes copies them with the profile.</p>}
        </section>
      ) : (
        <section className="bd-group" aria-labelledby="bd-mcp-copy">
          <h3 id="bd-mcp-copy">Servers of the default profile</h3>
          {copyList.length === 0 && <p className="subtle">None can be copied.</p>}
          <ul className="bd-list">
            {copyList.map(({ server }) => (
              <li key={server.name}>
                <Toggle checked={draft.mcpCopy.includes(server.name)} onChange={(on) => toggle('mcpCopy', server.name, on)}>
                  <strong>{server.name}</strong> <span className="tag">{server.transport === 'stdio' ? 'Command' : server.transport.toUpperCase()}</span>
                </Toggle>
              </li>
            ))}
          </ul>
          {held.length > 0 && <p className="field__help">{held.map(({ server }) => server.name).join(', ')} {held.length === 1 ? 'has' : 'have'} keys, variables or a sign-in that Hermes keeps masked, so {held.length === 1 ? 'it cannot' : 'they cannot'} be copied here. Add {held.length === 1 ? 'it' : 'them'} on Tools & MCP once the profile exists.</p>}
        </section>
      )}
      <section className="bd-group" aria-labelledby="bd-mcp-catalogue">
        <h3 id="bd-mcp-catalogue">From Hermes’s catalogue</h3>
        <div className="input-wrap">
          <Icon name="search" />
          <input className="input" type="search" placeholder="Search the catalogue" aria-label="Search the catalogue" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {catalogue.failed && !catalogue.value && <p className="field__error">Hermes did not answer, so its catalogue could not be loaded.</p>}
        {!catalogue.value && !catalogue.failed && <p role="status">Loading the catalogue…</p>}
        <ul className="bd-list">
          {entries.slice(0, LIMIT).map((entry) => (
            <li key={entry.name}>
              <Toggle checked={draft.mcpCatalogue.includes(entry.name)} onChange={(on) => toggle('mcpCatalogue', entry.name, on)}>
                <strong>{entry.name}</strong> <span className="tag">{entry.transport === 'stdio' ? 'Command' : entry.transport.toUpperCase()}</span> <small className="subtle">{entry.description}</small>
              </Toggle>
            </li>
          ))}
        </ul>
        {entries.length > LIMIT && <p className="subtle">{entries.length - LIMIT} more match. Search to narrow the list.</p>}
        <p className="field__help">Entries that need a key or a client secret are not listed: install them on Tools & MCP, where the values are typed and masked.</p>
      </section>
      <FieldError id="bd-mcp-error" message={problems.mcps} />
    </div>
  );
}

const ASKS: Record<Asks, string> = { nothing: '', confirm: 'asks you to confirm', type: 'asks you to type a name' };

export function ReviewStep({
  draft,
  plan,
  baseline,
  results,
  running,
  heldAt,
}: {
  draft: Draft;
  plan: readonly PlanStep[];
  baseline: Baseline | undefined;
  results: Readonly<Record<string, StepResult>>;
  /** The id of the step Finish is on. */
  running: string | undefined;
  /** The step with a problem that holds Finish back, if any. */
  heldAt: string | undefined;
}) {
  const start = draft.start.kind === 'blank' ? 'Blank' : draft.start.kind === 'persona' ? `Persona ${draft.start.persona}` : `Clone of ${draft.start.source}`;
  const noModel = draft.start.kind !== 'clone' && draft.model === undefined;
  return (
    <div className="bd-step">
      <p className="bd-note">Finish makes the profile in Hermes and then does each step below, in this order. You confirm the profile by pressing Finish; some steps ask you again, as they say.</p>
      <dl className="bd-facts">
        <div>
          <dt>Name</dt>
          <dd className="mono">{draft.name.trim().toLowerCase()}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd>{start}</dd>
        </div>
      </dl>
      {noModel && (
        <div className="banner" data-tone="warning">
          <Icon name="alert" />
          <span className="banner__content">No model is chosen, so the profile cannot chat until you set one on its Model tab.</span>
        </div>
      )}
      {heldAt && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">A step above needs attention first: {heldAt}.</span>
        </div>
      )}
      <ol className="bd-plan" aria-label="What Finish does" tabIndex={0}>
        {plan.map((step) => {
          const result = results[step.id];
          const ask = asks(step, baseline);
          return (
            <li key={step.id} data-state={running === step.id ? 'running' : (result?.state ?? 'waiting')}>
              <Icon name={running === step.id ? 'running' : result?.state === 'done' ? 'check' : result?.state === 'failed' ? 'alert' : result?.state === 'cancelled' ? 'x' : 'queued'} small />
              <span>
                <span className="sr-only">{running === step.id ? 'Running: ' : result?.state === 'done' ? 'Done: ' : result?.state === 'failed' ? 'Failed: ' : result?.state === 'cancelled' ? 'Declined: ' : 'Waiting: '}</span>
                {step.label}
                {ask !== 'nothing' && <span className="subtle"> · {ASKS[ask]}</span>}
                {result?.state === 'failed' && <span className="bd-plan__why"> {result.message}</span>}
                {result?.state === 'cancelled' && <span className="bd-plan__why"> You declined this step.</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
