import { useEffect, useId, useState, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { SkillDocument } from './SkillDetail.tsx';
import { createSkill, saveSkill } from './skill-actions.ts';
import { checkSkill, checkSkillIdentity, joinSkill, NEW_DESCRIPTION_LIMIT, newSkillText, splitSkill, type SkillParts } from './skill-document.ts';
import { fetchSkillContent } from './skills-data.ts';
import '../chat/chat.css';
import '../profiles/profiles.css';
import './skills.css';

type Pane = 'edit' | 'preview';

const PANES = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
] as const satisfies readonly { value: Pane; label: string }[];

/** Says whether what the editor holds would be refused, and why: the page's own checks first, then Hermes's rules over the whole text. */
function useProblem(text: string | undefined, { isNew, identity }: { isNew: boolean; identity: string | undefined }): string | undefined {
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    if (text === undefined) return;
    let current = true;
    checkSkill(text, { isNew }).then((reason) => current && setProblem(reason));
    return () => {
      current = false;
    };
  }, [text, isNew]);
  return identity ?? (text === undefined ? undefined : problem);
}

/** Warns before the page is left with text that was not saved. */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

interface FrameProps {
  profile: string;
  /** The name of the skill, or `undefined` for a new one. */
  name: string | undefined;
  pane: Pane;
  onPane(pane: Pane): void;
  problem: string | undefined;
  /** What Hermes or the check before saving said when the last save did not go through. */
  failure: string | undefined;
  busy: boolean;
  canSave: boolean;
  onSave(): void;
  preview: { text: string; name: string } | undefined;
  children: ReactNode;
}

/** The editor's page: title, Preview/Edit, the save bar and the reason a save is blocked. */
function EditorFrame({ profile, name, pane, onPane, problem, failure, busy, canSave, onSave, preview, children }: FrameProps) {
  const paneLabel = useId();
  const back = name ? `/agents/skills?skill=${encodeURIComponent(name)}&profile=${encodeURIComponent(profile)}` : `/agents/skills?profile=${encodeURIComponent(profile)}`;
  return (
    <div className="pf sk-editor">
      <PageHeader
        overline="Skills"
        title={name ? `Edit ${name}` : 'New skill'}
        subtitle={
          <>
            In <strong>{profile}</strong> · <Term id="skill-md">SKILL.md</Term>
          </>
        }
        actions={
          <>
            <AppLink className="btn btn--secondary" to={back}>
              Cancel
            </AppLink>
            <WriteButton type="button" className="btn btn--primary" disabled={!canSave || busy} aria-busy={busy} onClick={onSave}>
              <Icon name="check" />
              {name ? 'Save SKILL.md' : 'Create skill'}
            </WriteButton>
          </>
        }
      />
      <p className="help-text">
        A SKILL.md starts with <Term id="frontmatter">frontmatter</Term>, the YAML between two <code>---</code> lines. Hermes needs its <code>name</code> and <code>description</code>. Any other key is kept just as you see it.
      </p>
      <div className="sk-editor__bar">
        <span id={paneLabel} className="sr-only">
          Show
        </span>
        <RadioGroup labelledBy={paneLabel} className="seg" value={pane} options={PANES} onChange={onPane} />
      </div>
      <div className="sk-editor__problem" role="alert">
        {(problem ?? failure) && (
          <p className="field__error">
            <Icon name="alert" small />
            <span>{problem ? `This cannot be saved yet: ${problem}` : failure}</span>
          </p>
        )}
      </div>
      {pane === 'edit' ? <div className="sk-editor__fields">{children}</div> : preview && <div className="panel panel--pad sk-preview"><SkillDocument text={preview.text} name={preview.name} /></div>}
    </div>
  );
}

function Area({ label, help, value, onChange, rows, id }: { label: string; help?: string; value: string; onChange(value: string): void; rows: number; id: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="input input--mono sk-area" rows={rows} value={value} spellCheck={false} autoCapitalize="none" autoComplete="off" aria-describedby={help ? `${id}-help` : undefined} onChange={(event) => onChange(event.target.value)} />
      {help && (
        <p className="field__help" id={`${id}-help`}>
          {help}
        </p>
      )}
    </div>
  );
}

/** Editing a skill that exists: its frontmatter and its instructions are two fields, joined back without touching a byte of either one the owner did not change. */
function EditExisting({ profile, name }: { profile: string; name: string }) {
  const navigate = useAppNavigate();
  const [original, setOriginal] = useState<string | 'missing'>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [parts, setParts] = useState<SkillParts>();
  /** A SKILL.md Hermes holds that has no readable frontmatter is edited as one piece, so it can be mended. */
  const [whole, setWhole] = useState<string>();
  const [pane, setPane] = useState<Pane>('edit');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const id = useId();

  useEffect(() => {
    let current = true;
    fetchSkillContent(profile, name).then(
      (loaded) => {
        if (!current) return;
        if (!loaded) return setOriginal('missing');
        setOriginal(loaded.content);
        const split = splitSkill(loaded.content);
        setParts(split);
        setWhole(split ? undefined : loaded.content);
      },
      () => current && setLoadFailed(true),
    );
    return () => {
      current = false;
    };
  }, [profile, name, attempt]);

  const text = parts ? joinSkill(parts) : whole;
  const problem = useProblem(text, { isNew: false, identity: undefined });
  const dirty = original !== undefined && original !== 'missing' && text !== undefined && text !== original;
  useLeaveGuard(dirty);

  if (loadFailed) {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so SKILL.md could not be read.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setLoadFailed(false); setAttempt((count) => count + 1); }}>
          Retry
        </button>
      </div>
    );
  }
  if (original === undefined) return <p role="status">Loading SKILL.md…</p>;
  if (original === 'missing') {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="stack" />
        </span>
        <p>Hermes has no skill called “{name}” in {profile}.</p>
        <AppLink className="btn btn--primary" to={`/agents/skills?profile=${encodeURIComponent(profile)}`}>
          Back to skills
        </AppLink>
      </div>
    );
  }

  const save = async () => {
    if (text === undefined) return;
    setBusy(true);
    setFailure(undefined);
    // Hermes holds one copy, and the agent writes skills too: what was opened must still be what is there.
    const now = await fetchSkillContent(profile, name).catch(() => undefined);
    if (now && now.content !== original) {
      setFailure('SKILL.md changed in Hermes after you opened it, so nothing was saved. Your text is still here: copy what you need, then reload to start from the new version.');
      setBusy(false);
      return;
    }
    const outcome = await saveSkill(profile, name, text);
    setBusy(false);
    if (outcome.kind === 'failed') {
      setFailure(outcome.message);
      return;
    }
    if (outcome.kind !== 'done') return;
    setOriginal(text);
    toast(`Saved the SKILL.md of ${name}`, { tone: 'info', detail: `In ${profile}. New sessions use it.` });
    await navigate(`/agents/skills?skill=${encodeURIComponent(name)}&profile=${encodeURIComponent(profile)}`, { replace: true });
  };

  return (
    <EditorFrame profile={profile} name={name} pane={pane} onPane={setPane} problem={problem} failure={failure} busy={busy} canSave={dirty && problem === undefined} onSave={() => void save()} preview={text === undefined ? undefined : { text, name }}>
      {parts ? (
        <>
          <Area id={`${id}-front`} label="Frontmatter (YAML)" rows={9} value={parts.frontmatter} onChange={(frontmatter) => setParts({ ...parts, frontmatter })} help="Edit what you mean to change. Comments, key order and keys Caduceus does not know stay exactly as they are." />
          <Area id={`${id}-body`} label="Instructions (Markdown)" rows={18} value={parts.body} onChange={(body) => setParts({ ...parts, body })} />
        </>
      ) : (
        <Area id={`${id}-whole`} label="The whole SKILL.md" rows={26} value={whole ?? ''} onChange={setWhole} help="Hermes holds this file without valid frontmatter. Add it, between two --- lines at the very top." />
      )}
    </EditorFrame>
  );
}

/** Making a skill: the fields Hermes needs, the owner's own frontmatter keys if any, and the instructions. The text is composed and checked as it is typed. */
function CreateNew({ profile }: { profile: string }) {
  const navigate = useAppNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [extra, setExtra] = useState('');
  const [body, setBody] = useState('# Skill title\n\nWhen to use this skill, and the steps to follow.\n');
  const [text, setText] = useState<string>();
  const [pane, setPane] = useState<Pane>('edit');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const id = useId();

  useEffect(() => {
    let current = true;
    newSkillText({ name: name.trim(), description: description.trim(), extra, body }).then((composed) => current && setText(composed));
    return () => {
      current = false;
    };
  }, [name, description, extra, body]);

  const identity = checkSkillIdentity({ name: name.trim(), category });
  const problem = useProblem(text, { isNew: true, identity });
  const started = name !== '' || description !== '';
  useLeaveGuard(started);

  const create = async () => {
    if (text === undefined) return;
    setBusy(true);
    setFailure(undefined);
    const outcome = await createSkill(profile, { name: name.trim(), category, content: text });
    setBusy(false);
    if (outcome.kind === 'failed') {
      setFailure(outcome.message);
      return;
    }
    if (outcome.kind !== 'done') return;
    toast(`Created the skill ${name.trim()}`, { tone: 'info', detail: `In ${profile}.` });
    await navigate(`/agents/skills?skill=${encodeURIComponent(name.trim())}&profile=${encodeURIComponent(profile)}`, { replace: true });
  };

  return (
    <EditorFrame profile={profile} name={undefined} pane={pane} onPane={setPane} problem={started ? problem : undefined} failure={failure} busy={busy} canSave={problem === undefined && text !== undefined} onSave={() => void create()} preview={text === undefined ? undefined : { text, name: name.trim() || 'new-skill' }}>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <input id={`${id}-name`} className="input input--mono" value={name} autoComplete="off" spellCheck={false} autoCapitalize="none" aria-describedby={`${id}-name-help`} onChange={(event) => setName(event.target.value)} />
        <p className="field__help" id={`${id}-name-help`}>
          Lowercase letters, numbers, dots, hyphens and underscores. It is the folder the skill lives in.
        </p>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-category`}>
          Category (optional)
        </label>
        <input id={`${id}-category`} className="input input--mono" value={category} autoComplete="off" spellCheck={false} autoCapitalize="none" aria-describedby={`${id}-category-help`} onChange={(event) => setCategory(event.target.value)} />
        <p className="field__help" id={`${id}-category-help`}>
          One folder name that groups skills, such as writing.
        </p>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-description`}>
          Description
        </label>
        <input id={`${id}-description`} className="input" value={description} autoComplete="off" aria-describedby={`${id}-description-help`} onChange={(event) => setDescription(event.target.value)} />
        <p className="field__help" id={`${id}-description-help`}>
          {description.trim().length} of {NEW_DESCRIPTION_LIMIT} characters. One sentence, with when to use the skill first: Hermes’s skill index cuts a new skill’s description longer than that.
        </p>
      </div>
      <Area id={`${id}-extra`} label="More frontmatter (optional)" rows={4} value={extra} onChange={setExtra} help="Other YAML keys, such as version or metadata, one per line. They are written after name and description exactly as typed." />
      <Area id={`${id}-body`} label="Instructions (Markdown)" rows={18} value={body} onChange={setBody} />
    </EditorFrame>
  );
}

/** Agents › Skills › editor: `/agents/skills/new` makes a skill, `/agents/skills/:name` edits the SKILL.md of one. */
export function SkillEditor() {
  const { name } = useParams({ strict: false }) as { name?: string };
  const { effective } = useProfileScope();
  if (!effective) return <p role="status">Loading…</p>;
  return name === undefined ? <CreateNew key={effective.name} profile={effective.name} /> : <EditExisting key={`${effective.name}/${name}`} profile={effective.name} name={name} />;
}
