// Work › Playbooks › one definition (`/work/playbooks/:playbookId`, `?version=N` for an older one): its inputs, its stages in order with an inspector
// for the stage you choose (a side panel on a wide screen, a sheet elsewhere), and its YAML with a live check by the server. Saving the YAML writes the
// next version (Tier 1); the version it replaces stays readable. A seed is read-only: it is only duplicated. Everything here is Caduceus's own; the
// server only says which profiles and skills Hermes does not have.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useBlocker, useParams, useSearch } from '@tanstack/react-router';
import { isTemplate, type Playbook, type PlaybookStage, type TemplateCategory } from '@caduceus/contracts/playbooks';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { BRIEF_SECTIONS } from './brief.ts';
import { kindOf, offsetOfLine, outgoingEdges, playbookPath, saveBlock, WHEN_LABEL, yamlNotes, type PlaybookDetailData, type PlaybookWarning, type YamlCheck, type YamlNote } from './playbook-model.ts';
import { PlaybookGraphView } from './PlaybookGraphView.tsx';
import { RunSheet } from './RunSheet.tsx';
import { RunsOfPlaybook } from './RunsList.tsx';
import { useRuns } from './playbook-run-data.ts';
import { KindBadge } from './TemplateParts.tsx';
import { checkYaml, DefinitionRefused, deletePlaybook, duplicatePlaybook, restorePlaybook, savePlaybookYaml, usePlaybook, usePlaybookLibrary } from './template-data.ts';
import { useWide } from './use-wide.ts';
import './templates.css';
import './work.css';

const fail = (error: unknown) => toast(error instanceof Error ? error.message : 'Caduceus did not do that.', { tone: 'danger' });

/** How long the typing pauses before the server is asked to check the YAML (each check is a request). */
const CHECK_PAUSE_MS = 400;

const GATE_WORDS = {
  approval: { label: 'Approval gate', tone: 'warning', what: 'Its task waits in review until you approve or reject it.' },
  clarify: { label: 'Clarify gate', tone: 'info', what: 'Its task is blocked with a question until you answer.' },
} as const;

function GateBadge({ gate }: { gate: NonNullable<PlaybookStage['gate']> }) {
  return (
    <span className="tag" data-tone={GATE_WORDS[gate].tone}>
      {GATE_WORDS[gate].label}
    </span>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="pb__row">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One stage: its brief template, its settings and where it leads. `onSelect` jumps to the stage an edge leads to. */
function StageInspector({ playbook, stage, warnings, onSelect }: { playbook: Playbook; stage: PlaybookStage; warnings: readonly PlaybookWarning[]; onSelect(key: string): void }) {
  const index = playbook.stages.indexOf(stage);
  const edges = outgoingEdges(playbook, stage.key);
  const sections = BRIEF_SECTIONS.filter((section) => stage.brief[section.id]);
  const workspace = stage.workspace;
  return (
    <div className="pb__inspector-body">
      <p className="overline">
        Stage {index + 1} of {playbook.stages.length} · <span className="mono">{stage.key}</span>
      </p>
      <h3 className="pb__stage-title">{stage.title}</h3>
      {warnings.map((warning) => (
        <p key={warning.message} className="pb__warning" role="note">
          <Icon name="alert" small />
          {warning.message}
        </p>
      ))}
      <section aria-label="Settings">
        <dl className="pb__dl">
          <Row name="Assignee">{stage.assignee ?? <span className="subtle">Not set: chosen when it runs</span>}</Row>
          <Row name="Model">{stage.model ? `${stage.model}${stage.provider ? ` (${stage.provider})` : ''}` : <span className="subtle">The profile’s model</span>}</Row>
          {stage.reasoning_effort && <Row name="Reasoning effort">{stage.reasoning_effort}</Row>}
          <Row name="Skills">{stage.skills && stage.skills.length > 0 ? stage.skills.join(', ') : <span className="subtle">None</span>}</Row>
          <Row name="Deliverable">{stage.deliverable ? <>Files attached to its task are kept in <AppLink to="/workspace/artifacts">Artifacts</AppLink></> : <span className="subtle">No</span>}</Row>
          <Row name="Goal mode">{stage.goal_mode ? `On${stage.goal_max_turns ? `, at most ${stage.goal_max_turns} turns` : ''}` : <span className="subtle">Off</span>}</Row>
          <Row name="Completion contract">{stage.completion_contract ? <span className="mono">{stage.completion_contract}</span> : <span className="subtle">local-only (the default)</span>}</Row>
          <Row name="Gate">
            {stage.gate ? (
              <>
                <GateBadge gate={stage.gate} /> <span className="subtle">{GATE_WORDS[stage.gate].what}</span>
              </>
            ) : (
              <span className="subtle">None</span>
            )}
          </Row>
          <Row name="Attempts">{stage.max_attempts ? `Up to ${stage.max_attempts}` : <span className="subtle">One, unless a loop says more</span>}</Row>
          {stage.max_runtime && <Row name="Time limit">{stage.max_runtime}</Row>}
          {stage.max_retries !== undefined && <Row name="Retries">{stage.max_retries}</Row>}
          {stage.priority !== undefined && <Row name="Priority">{stage.priority}</Row>}
          {stage.project && <Row name="Project">{stage.project}</Row>}
          {workspace && <Row name="Workspace">{workspace.kind === 'scratch' ? 'A scratch folder' : `${workspace.kind === 'dir' ? 'Folder' : 'Worktree'}${workspace.path ? ` ${workspace.path}` : ''}${workspace.kind === 'worktree' && workspace.branch ? `, branch ${workspace.branch}` : ''}`}</Row>}
        </dl>
      </section>
      <section aria-label="Brief template">
        <h4 className="overline">Brief template</h4>
        {sections.length === 0 ? (
          <p className="subtle">This stage has no brief text.</p>
        ) : (
          sections.map((section) => (
            <div key={section.id} className="pb__section">
              <h5>{section.heading}</h5>
              <pre className="pb__text">{stage.brief[section.id]}</pre>
            </div>
          ))
        )}
      </section>
      <section aria-label="Where it leads">
        <h4 className="overline">Leads to</h4>
        {edges.length === 0 ? (
          <p className="subtle">Nowhere: the run ends after this stage.</p>
        ) : (
          <ul className="pb__edges">
            {edges.map((edge) => (
              <li key={`${edge.when}:${edge.to}`}>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => onSelect(edge.to)}>
                  <span className="subtle">{WHEN_LABEL[edge.when]}</span>
                  <Icon name="arrow-r" small />
                  {edge.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The inputs and the stages, with the inspector. */
function Overview({ playbook, warnings }: { playbook: Playbook; warnings: readonly PlaybookWarning[] }) {
  const wide = useWide();
  const [selected, setSelected] = useState<string>();
  const [graph, setGraph] = useState(false);
  const [opened, setOpened] = useState(0);
  const inspectorRef = useRef<HTMLElement>(null);
  // The graph is offered from 1024 px up, and only for a playbook that has edges to draw; below that nothing of it is rendered.
  const graphOffered = wide && playbook.stages.length > 1;
  const showGraph = graphOffered && graph;
  const stage = playbook.stages.find((candidate) => candidate.key === selected);
  const inspector = stage && <StageInspector playbook={playbook} stage={stage} warnings={warnings.filter((warning) => warning.stage === stage.key)} onSelect={setSelected} />;
  // Enter on a node of the graph opens the stage in the inspector, and moves the keyboard there.
  useEffect(() => {
    if (opened > 0) inspectorRef.current?.focus();
  }, [opened]);
  return (
    <div className="pb__layout">
      <div className="pb__main">
        <section className="sb__section" aria-labelledby="pb-inputs">
          <h2 id="pb-inputs">Inputs</h2>
          {playbook.inputs.length === 0 ? (
            <p className="subtle">It asks nothing: a run starts as it is.</p>
          ) : (
            <ul className="pb__inputs">
              {playbook.inputs.map((input) => (
                <li key={input.key} className="pb__input">
                  <strong>{input.label}</strong>
                  <code>{`{{${input.key}}}`}</code>
                  {input.required && <span className="tag">Required</span>}
                  {input.multiline && <span className="tag">Long answer</span>}
                  {input.default !== undefined && <span className="subtle">Starts as “{input.default}”</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="sb__section" aria-labelledby="pb-stages">
          <div className="pb__stages-head">
            <h2 id="pb-stages">
              Stages <span className="subtle mono">{playbook.stages.length}</span>
            </h2>
            {graphOffered && (
              <div role="group" aria-label="Show the stages as" className="seg">
                <button type="button" aria-pressed={!graph} onClick={() => setGraph(false)}>
                  List
                </button>
                <button type="button" aria-pressed={graph} onClick={() => setGraph(true)}>
                  Graph
                </button>
              </div>
            )}
          </div>
          <p className="subtle">The run starts at the first stage and follows the edges. Choose a stage to see its brief, settings and where it leads.</p>
          {showGraph ? (
            <>
              <div className="pb__graph-bar">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setGraph(false)}>
                  View as list
                </button>
              </div>
              <PlaybookGraphView
                playbook={playbook}
                selected={selected}
                opens="stage"
                onOpen={(key) => {
                  setSelected(key);
                  setOpened((count) => count + 1);
                }}
              />
            </>
          ) : (
            <ol className="pb__stages">
              {playbook.stages.map((candidate, index) => {
                const stageWarnings = warnings.filter((warning) => warning.stage === candidate.key);
                return (
                  <li key={candidate.key}>
                    <button type="button" className="pb__stage" aria-pressed={selected === candidate.key} onClick={() => setSelected(candidate.key)}>
                      <span className="pb__number mono" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="pb__stage-body">
                        <span className="pb__stage-name">
                          <span className="sr-only">Stage {index + 1}: </span>
                          {candidate.title}
                        </span>
                        <span className="pb__stage-meta">
                          {candidate.assignee && <span className="subtle">{candidate.assignee}</span>}
                          {candidate.gate && <GateBadge gate={candidate.gate} />}
                          {candidate.max_attempts && <span className="subtle">up to {candidate.max_attempts} attempts</span>}
                          {stageWarnings.length > 0 && (
                            <span className="tag" data-tone="warning">
                              <Icon name="alert" small />
                              Not in Hermes
                            </span>
                          )}
                        </span>
                      </span>
                      <Icon name="chev-r" small />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
      {wide && (
        <aside ref={inspectorRef} className="pb__inspector" aria-label="Stage inspector" tabIndex={-1}>
          {inspector ?? <p className="subtle">Choose a stage to see it here.</p>}
        </aside>
      )}
      {!wide && stage && (
        <Sheet title={stage.title} detents={['half', 'full']} onClose={() => setSelected(undefined)}>
          {inspector}
        </Sheet>
      )}
    </div>
  );
}

interface YamlViewProps {
  detail: PlaybookDetailData;
  /** The version on screen is not the newest. */
  older: boolean;
  /** Whether a copy can be made yet (the categories are known). */
  canDuplicate: boolean;
  onDuplicate(): void;
  /** The YAML was saved as the next version. */
  onSaved(): void;
}

/** The definition as YAML, with the server's check of it under the editor, line by line. */
function YamlView({ detail, older, canDuplicate, onDuplicate, onSaved }: YamlViewProps) {
  const { playbook, seed, warnings } = detail;
  const compact = useSizeClass() === 'compact';
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(detail.yaml);
  const [checked, setChecked] = useState<{ text: string; result: YamlCheck } | { text: string; failed: string }>();
  const [refused, setRefused] = useState<DefinitionRefused>();
  const [busy, setBusy] = useState(false);
  const saved = useRef(false);
  const changed = text !== detail.yaml;
  const readOnly = compact || seed || older;
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => changed && !saved.current && (current.pathname !== next.pathname || versionIn(current.search) !== versionIn(next.search)), enableBeforeUnload: () => changed && !saved.current, withResolver: true });

  // The server checks the text once the typing pauses; an answer for text that has since changed is dropped.
  useEffect(() => {
    if (!changed) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      checkYaml(text, abort.signal).then(
        (result) => !abort.signal.aborted && setChecked({ text, result }),
        (error) => !abort.signal.aborted && setChecked({ text, failed: error instanceof Error ? error.message : 'Caduceus could not check the YAML.' }),
      );
    }, CHECK_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [text, changed]);

  // Text that is what the version holds is valid, and its warnings came with it.
  const answer = checked?.text === text ? checked : undefined;
  const check: YamlCheck | undefined = changed ? (answer && 'result' in answer ? answer.result : undefined) : { errors: [], warnings };
  const failed = changed && answer && 'failed' in answer ? answer.failed : undefined;
  const pending = changed && answer === undefined;
  const block = failed ?? saveBlock({ seed, older, changed, check });
  const notes: YamlNote[] = refused
    ? refused.problems.map((message, index): YamlNote => {
        const line = refused.lines[index];
        return { tone: 'danger', message, ...(typeof line === 'number' ? { line } : {}) };
      })
    : check
      ? yamlNotes(check)
      : [];
  const errors = notes.filter((note) => note.tone === 'danger').length;

  const goTo = (line: number) => {
    const element = area.current;
    if (!element) return;
    const at = offsetOfLine(text, line);
    element.focus();
    element.setSelectionRange(at, at);
  };

  const save = async () => {
    setBusy(true);
    setRefused(undefined);
    try {
      const stored = await savePlaybookYaml(playbook, text);
      if (stored === undefined) return setBusy(false);
      saved.current = true;
      toast(`Saved “${stored.name}” as version ${stored.version}`, { tone: 'success' });
      onSaved();
    } catch (error) {
      setBusy(false);
      if (error instanceof DefinitionRefused) setRefused(error);
      else fail(error);
    }
  };

  return (
    <section className="sb__section pb__yaml-view" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>YAML</h2>
      {seed && <p className="subtle">This is a built-in playbook, so the YAML is read-only. Duplicate it to make a copy you can change.</p>}
      {older && <p className="subtle">This is version {playbook.version}, which is kept as it was written. Open the newest version to change the playbook.</p>}
      {compact && !seed && !older && (
        <p className="pb__handoff">
          <Icon name="info" small />
          Edit on a larger screen. On a phone the YAML is read-only, so a long definition is not changed by a slip of the thumb.
        </p>
      )}
      <label className="sr-only" htmlFor={`${id}-text`}>
        Definition as YAML
      </label>
      <textarea
        ref={area}
        id={`${id}-text`}
        className="input pb__yaml mono"
        value={text}
        readOnly={readOnly}
        wrap="off"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        aria-invalid={errors > 0 ? true : undefined}
        aria-describedby={`${id}-notes`}
        onChange={(event) => {
          setText(event.target.value);
          setRefused(undefined);
        }}
      />
      <div id={`${id}-notes`} className="pb__notes" role="status" aria-live="polite">
        {notes.length === 0 ? (
          <p className="subtle">{pending ? 'Checking the YAML…' : (failed ?? 'No problems found.')}</p>
        ) : (
          <ul>
            {notes.map((note, index) => (
              <li key={`${index}:${note.message}`} className="pb__note" data-tone={note.tone}>
                <Icon name="alert" small />
                {note.line !== undefined && (
                  <button type="button" className="btn btn--ghost btn--sm pb__line" onClick={() => goTo(note.line!)}>
                    Line {note.line}
                  </button>
                )}
                <span>{note.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="row pb__bar">
        {seed ? (
          <WriteButton type="button" className="btn btn--primary" disabled={!canDuplicate} onClick={onDuplicate}>
            <Icon name="copy" />
            Duplicate
          </WriteButton>
        ) : (
          <>
            {changed && !busy && (
              <button type="button" className="btn btn--ghost" onClick={() => setText(detail.yaml)}>
                Discard changes
              </button>
            )}
            <WriteButton type="button" className="btn btn--primary" disabled={block !== undefined || readOnly || busy} aria-busy={busy} aria-describedby={block !== undefined || readOnly ? `${id}-why` : undefined} onClick={() => void save()}>
              <Icon name="check" />
              Save as version {playbook.version + 1}
            </WriteButton>
          </>
        )}
        {!seed && (block !== undefined || readOnly) && (
          <p id={`${id}-why`} className="field__help">
            {readOnly && !older ? (compact ? 'The YAML is read-only on a phone: edit it on a larger screen.' : block) : block}
          </p>
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
                Discard
              </button>
            </>
          }
        >
          <p>The YAML is not saved yet. Leaving now throws away what you wrote.</p>
        </Sheet>
      )}
    </section>
  );
}

const TABS = ['overview', 'yaml'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: 'Stages', yaml: 'YAML' };

interface ViewProps {
  detail: PlaybookDetailData;
  categories: readonly TemplateCategory[] | undefined;
  reload(): void;
  reloadLibrary(): void;
}

function DetailView({ detail, categories, reload, reloadLibrary }: ViewProps) {
  const { playbook, seed, versions, warnings } = detail;
  const navigate = useAppNavigate();
  const id = useId();
  const [tab, setTab] = useState<Tab>('overview');
  const [running, setRunning] = useState(false);
  const runs = useRuns();
  const newest = Math.max(...versions);
  const older = playbook.version < newest;
  const kind = kindOf(playbook, seed);
  const template = isTemplate(playbook);
  const sorted = useMemo(() => [...versions].sort((a, b) => b - a), [versions]);
  const categoryName = categories?.find((entry) => entry.id === playbook.category)?.name ?? 'Other';

  const onKeys = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : step === 0 ? undefined : (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
    if (next === undefined) return;
    event.preventDefault();
    setTab(TABS[next]);
    document.getElementById(`${id}-tab-${TABS[next]}`)?.focus();
  };

  const duplicate = () =>
    void duplicatePlaybook(playbook, categories ?? []).then((copy) => {
      toast(`Copied as “${copy.name}”`, { tone: 'success' });
      reloadLibrary();
      void navigate(playbookPath(copy.id));
    }, fail);

  const remove = () =>
    void deletePlaybook(playbook).then((done) => {
      if (!done) return;
      toast(`Deleted “${playbook.name}”`, { undo: () => void restorePlaybook(playbook).then(() => toast(`Brought back “${playbook.name}”`, { tone: 'success' }), fail) });
      void navigate('/work/playbooks');
    }, fail);

  return (
    <div className="bpage pb">
      <PageHeader
        overline="Work › Playbooks"
        title={playbook.name}
        subtitle={
          <span className="pb__sub">
            <KindBadge kind={kind} />
            <span className="subtle">{categoryName}</span>
            <span className="subtle">
              {playbook.stages.length} {playbook.stages.length === 1 ? 'stage' : 'stages'}
            </span>
          </span>
        }
        actions={
          // Run is the primary action of the current version; an older version is only read.
          <>
            {!older && (
              <WriteButton type="button" className="btn btn--primary" onClick={() => setRunning(true)}>
                <Icon name="play" />
                Run
              </WriteButton>
            )}
            {template && !older && (
              <AppLink className="btn btn--secondary" to={`/work/tasks/new?template=${encodeURIComponent(playbook.id)}`}>
                <Icon name="play" />
                Use
              </AppLink>
            )}
            {template && !seed && !older && (
              <AppLink className="btn btn--secondary" to={playbookPath(playbook.id, '/edit')}>
                <Icon name="sliders" />
                Edit as brief
              </AppLink>
            )}
            <WriteButton type="button" className="btn btn--secondary" disabled={categories === undefined} onClick={duplicate}>
              <Icon name="copy" />
              Duplicate
            </WriteButton>
            {!seed && !older && (
              <WriteButton type="button" className="btn btn--ghost" onClick={remove}>
                <Icon name="trash" />
                Delete
              </WriteButton>
            )}
          </>
        }
      />
      <div className="pb__versions">
        <label className="field__label" htmlFor={`${id}-version`}>
          Version
        </label>
        <select
          id={`${id}-version`}
          className="input pb__version"
          value={playbook.version}
          onChange={(event) => {
            const chosen = Number(event.target.value);
            void navigate(chosen === newest ? playbookPath(playbook.id) : `${playbookPath(playbook.id)}?version=${chosen}`);
          }}
        >
          {sorted.map((version) => (
            <option key={version} value={version}>
              {version === newest ? `${version} (newest)` : version}
            </option>
          ))}
        </select>
        {seed && <span className="subtle">Built in, read-only</span>}
      </div>
      <p className="help-text">
        {template ? (
          <>
            A <Term id="template">template</Term> has one <Term id="stage">stage</Term>: a brief with blanks that starts one task.
          </>
        ) : (
          <>
            A <Term id="playbook">playbook</Term> is a plan of <Term id="stage">stages</Term>. A stage can wait for you at a <Term id="gate">gate</Term>, and stages that start together are a <Term id="parallel-group">parallel group</Term>.
          </>
        )}
      </p>
      {older && (
        <div className="banner" data-tone="info" role="note">
          <Icon name="info" />
          <span className="banner__content">
            You are reading version {playbook.version}; the newest is {newest}. A run started from version {playbook.version} keeps using it.
          </span>
          <AppLink className="btn btn--secondary btn--sm" to={playbookPath(playbook.id)}>
            Open version {newest}
          </AppLink>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <div className="banner__content">
            <p>Hermes does not have everything this definition names. The definition is still valid: correct the names, or add them to Hermes, before a run reaches these stages.</p>
            <ul>
              {warnings.map((warning) => (
                <li key={`${warning.stage}:${warning.message}`}>
                  <strong>{playbook.stages.find((stage) => stage.key === warning.stage)?.title ?? warning.stage}</strong>: {warning.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {playbook.description && <p className="pb__desc">{playbook.description}</p>}

      <div role="tablist" aria-label="Playbook views" className="seg pb__tabs" onKeyDown={onKeys}>
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}>
            {TAB_LABEL[name]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel-overview`} aria-labelledby={`${id}-tab-overview`} hidden={tab !== 'overview'}>
        <Overview playbook={playbook} warnings={warnings} />
      </div>
      <div role="tabpanel" id={`${id}-panel-yaml`} aria-labelledby={`${id}-tab-yaml`} hidden={tab !== 'yaml'}>
        <YamlView
          detail={detail}
          older={older}
          canDuplicate={categories !== undefined}
          onDuplicate={duplicate}
          onSaved={() => {
            reload();
            reloadLibrary();
          }}
        />
      </div>
      <section className="sb__section pb__runs" aria-labelledby={`${id}-runs`}>
        <h2 id={`${id}-runs`}>Runs</h2>
        <RunsOfPlaybook state={runs} playbookId={playbook.id} />
      </section>
      {running && <RunSheet playbook={playbook} onClose={() => setRunning(false)} />}
    </div>
  );
}

/** A `?version=` that names a version (a whole number from 1); anything else reads the newest. */
function versionOf(value: unknown): number | undefined {
  return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : undefined;
}

/** The version a location's search names. */
const versionIn = (search: unknown) => (isRecord(search) ? versionOf(search.version) : undefined);

export function PlaybookDetail() {
  const { playbookId = '' } = useParams({ strict: false }) as { playbookId?: string };
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const version = versionOf(search.version);
  const state = usePlaybook(playbookId, version);
  const library = usePlaybookLibrary();

  if (state.status === 'ready') {
    // Keyed by what is shown, so the YAML starts again from a version that was just saved or chosen.
    return <DetailView key={`${state.detail.playbook.id}@${state.detail.playbook.version}`} detail={state.detail} categories={library.library?.categories} reload={state.reload} reloadLibrary={library.reload} />;
  }
  return (
    <div className="bpage pb">
      <PageHeader overline="Work › Playbooks" title="Playbook" />
      {state.status === 'loading' && <p role="status">Loading the playbook…</p>}
      {state.status === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">The playbook could not be read: {state.error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={state.reload}>
            Try again
          </button>
        </div>
      )}
      {state.status === 'missing' && (
        <div className="empty">
          <Icon name="playbook" />
          <h2>{version === undefined ? 'This playbook is gone' : `There is no version ${version}`}</h2>
          <p>{version === undefined ? 'It was deleted, perhaps on another device.' : 'That version was never written.'}</p>
          <AppLink className="btn btn--primary" to={version === undefined ? '/work/playbooks' : playbookPath(playbookId)}>
            {version === undefined ? 'Back to Playbooks' : 'Open the newest version'}
          </AppLink>
        </div>
      )}
    </div>
  );
}
