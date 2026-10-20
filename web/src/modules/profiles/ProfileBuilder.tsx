// Agents › Profiles › New profile (M4 #12): the five-step builder. The draft lives in the tab (`builder-draft.ts`), so a reload or a visit to
// another screen resumes it; Back keeps every entry; each step is checked before Next. Finish makes the profile in Hermes and then does each
// step through the calls the other screens make (`builder-apply.ts`); what failed is listed with its reason and Retry runs only the rest.
// On a phone a step is a full-screen sheet with its Back and Next fixed at the bottom; elsewhere it is a panel of the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useMcpCatalog } from '../tools/mcp-data.ts';
import { clearSaved, loadSaved, save } from './builder-draft.ts';
import { fetchBaseline, pageRunner, useBaseline } from './builder-data.ts';
import { buildPlan, emptyDraft, firstProblemStep, startDraft, stepProblems, STEPS, summary, type Draft, type Start, type StepId, type StepResult } from './builder-model.ts';
import { IdentityStep, McpStep, ModelStep, ReviewStep, SkillsStep } from './BuilderSteps.tsx';
import { personaById } from './personas.ts';
import { useProfiles } from './profiles-data.ts';
import './profiles.css';

/** The start the address asks for (`?clone=coder`, `?persona=pirate`), if it asks for one. */
function startOfAddress(search: { clone?: unknown; persona?: unknown }): Start | undefined {
  if (typeof search.clone === 'string' && search.clone !== '') return { kind: 'clone', source: search.clone };
  if (typeof search.persona === 'string' && personaById(search.persona)) return { kind: 'persona', persona: search.persona };
  return undefined;
}

export function ProfileBuilder() {
  const compact = useSizeClass() === 'compact';
  const navigate = useAppNavigate();
  const scope = useProfileScope();
  const profiles = useProfiles();
  const search = useSearch({ strict: false }) as { clone?: unknown; persona?: unknown };
  const existing = useMemo(() => (profiles.cards ?? []).map((card) => card.name), [profiles.cards]);

  // The tab's saved builder, unless the address asks for a start of its own.
  const [initial] = useState(() => {
    const asked = startOfAddress(search);
    const saved = loadSaved();
    if (asked && JSON.stringify(saved?.draft.start) !== JSON.stringify(asked)) return { draft: emptyDraft(asked), step: 'identity' as StepId, results: {} as Record<string, StepResult>, fresh: true };
    return { draft: saved?.draft ?? emptyDraft({ kind: 'blank' }), step: saved?.step ?? ('identity' as StepId), results: saved?.results ?? {}, fresh: !saved };
  });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [step, setStep] = useState<StepId>(initial.step);
  const [results, setResults] = useState<Record<string, StepResult>>(initial.results);
  // Once Finish has made the profile, its name is of course a profile Hermes has: it is no longer a conflict, only the profile being finished.
  const made = results.create?.state === 'done';
  const taken = useMemo(() => (made ? existing.filter((name) => name !== draft.name.trim().toLowerCase()) : existing), [existing, made, draft.name]);
  const [attempted, setAttempted] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [running, setRunning] = useState<string>();
  const [finished, setFinished] = useState(false);
  const { baseline, failed: baselineFailed } = useBaseline(draft.start);
  const catalogue = useMcpCatalog('default').value?.entries ?? [];

  useEffect(() => {
    save({ draft, step, results });
  }, [draft, step, results]);

  // A start from the address needs its profile read before the draft has anything of it (a persona needs nothing).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !initial.fresh || !profiles.cards) return;
    seeded.current = true;
    if (draft.start.kind !== 'blank') void chooseStart(draft.start);
    // Once, when Hermes has said which names are taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.cards]);

  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  async function chooseStart(start: Start) {
    setResults({});
    setAttempted(false);
    if (start.kind !== 'clone') {
      setDraft(startDraft(start, taken, undefined));
      return;
    }
    setDraft({ ...emptyDraft(start), name: draft.name });
    setSeeding(true);
    try {
      setDraft(startDraft(start, taken, await fetchBaseline(start)));
    } catch {
      toast('Hermes did not answer, so the profile could not be read to clone it.', { tone: 'danger' });
    } finally {
      setSeeding(false);
    }
  }

  const index = STEPS.findIndex((candidate) => candidate.id === step);
  const problems = stepProblems(step, draft, taken);
  const held = firstProblemStep(draft, taken);
  const plan = useMemo(() => buildPlan(draft, baseline), [draft, baseline]);
  const outcome = summary(plan, results);
  const started = Object.keys(results).length > 0;

  const next = () => {
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setAttempted(false);
    setStep(STEPS[index + 1]!.id);
  };
  const back = () => {
    setAttempted(false);
    setStep(STEPS[index - 1]!.id);
  };

  const finish = async () => {
    if (held || running) return;
    setRunning('create');
    const done = await pageRunner.run({
      plan,
      baseline,
      catalogue,
      results,
      onStep: (current, result) => {
        setRunning(result ? undefined : current.id);
        if (result) setResults((now) => ({ ...now, [current.id]: result }));
      },
    });
    setRunning(undefined);
    setResults(done);
    const name = draft.name.trim().toLowerCase();
    const left = summary(plan, done).left;
    if (done.create?.state === 'done') {
      scope.reload();
      await profiles.reload();
    }
    if (left.length === 0) {
      toast(`Created the profile ${name}`);
      clearSaved();
      setFinished(true);
      void navigate(`/agents/profiles/${name}`, { replace: true });
    } else if (done.create?.state === 'done') {
      toast(`${name} was made, but ${left.length} step${left.length === 1 ? '' : 's'} did not finish`, { tone: 'warning', detail: 'Retry runs only what is left.' });
    } else {
      toast(done.create?.state === 'failed' ? done.create.message : 'The profile was not made.', { tone: 'danger' });
    }
  };

  const startOver = () => {
    clearSaved();
    setDraft(emptyDraft({ kind: 'blank' }));
    setResults({});
    setStep('identity');
    setAttempted(false);
  };
  const leave = () => void navigate('/agents/profiles');

  const props = { draft, set, baseline, baselineFailed, problems: attempted ? problems : {} };
  const panel =
    step === 'identity' ? (
      <IdentityStep {...props} cards={profiles.cards ?? []} chooseStart={(start) => void chooseStart(start)} seeding={seeding} />
    ) : step === 'model' ? (
      <ModelStep {...props} />
    ) : step === 'skills' ? (
      <SkillsStep {...props} />
    ) : step === 'mcps' ? (
      <McpStep {...props} />
    ) : (
      <ReviewStep draft={draft} plan={plan} baseline={baseline} results={results} running={running} heldAt={held ? `${STEPS.find((candidate) => candidate.id === held)!.label}` : undefined} />
    );

  const partial = started && outcome.left.length > 0 && !running;
  const footer = (
    <div className="bd-foot" data-testid="builder-footer">
      <button type="button" className="btn btn--secondary" onClick={back} disabled={index === 0 || running !== undefined || (started && results.create?.state === 'done')}>
        <Icon name="chev-l" />
        Back
      </button>
      <span className="bd-foot__count" role="status">
        Step {index + 1} of {STEPS.length}
      </span>
      {step !== 'review' ? (
        <button type="button" className="btn btn--primary" onClick={next} disabled={seeding}>
          Next
          <Icon name="chev-r" />
        </button>
      ) : (
        <WriteButton type="button" className="btn btn--primary" onClick={() => void finish()} disabled={held !== undefined || running !== undefined || finished} aria-busy={running !== undefined}>
          <Icon name={partial ? 'refresh' : 'check'} />
          {partial ? 'Retry the rest' : 'Finish'}
        </WriteButton>
      )}
    </div>
  );

  const body = (
    <>
      <ol className="bd-steps" aria-label="Steps">
        {STEPS.map((candidate, at) => (
          <li key={candidate.id} aria-current={candidate.id === step ? 'step' : undefined} data-done={at < index ? 'true' : undefined}>
            <span className="bd-steps__n">{at + 1}</span>
            <span className="bd-steps__label">{candidate.label}</span>
          </li>
        ))}
      </ol>
      <h2 className="bd-title">{STEPS[index]!.label}</h2>
      {panel}
    </>
  );

  return (
    <div className="pf bd">
      <PageHeader
        overline="Profiles"
        title="New profile"
        subtitle={`Step ${index + 1} of ${STEPS.length}: ${STEPS[index]!.label}`}
        actions={
          <>
            {!started && (
              <button type="button" className="btn btn--ghost" onClick={startOver}>
                Start over
              </button>
            )}
            <button type="button" className="btn btn--secondary" onClick={leave}>
              Close
            </button>
          </>
        }
      />
      {compact ? (
        <Sheet title={`New profile · Step ${index + 1} of ${STEPS.length}`} detents={['full']} className="bd-sheet" footer={footer} onClose={leave}>
          {body}
        </Sheet>
      ) : (
        <section className="panel panel--pad bd-panel" aria-label="Profile builder">
          {body}
          {footer}
        </section>
      )}
    </div>
  );
}
