import { useEffect, useId, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { AppLink, useAppNavigate, useRouteInfo } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { provenanceWords, SkillCommandsProvider, useSkillCommands, editorPath } from './SkillCommands.tsx';
import { SkillDetail } from './SkillDetail.tsx';
import { SkillsFrame } from './SkillsFrame.tsx';
import { useSkills } from './skills-data.ts';
import { categoriesOf, filterSkills, readSkillsView, skillsSearch, UNCATEGORISED, type SkillRow, type SkillsView, type SkillState } from './skills-model.ts';
import '../profiles/profiles.css';
import './skills.css';

const STATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'On' },
  { value: 'disabled', label: 'Off' },
] as const satisfies readonly { value: SkillState; label: string }[];

function SkillRowView({ skill }: { skill: SkillRow }) {
  const commands = useSkillCommands();
  return (
    <li>
      <div className="list-row sk-row">
        <button type="button" className="sk-row__open" aria-haspopup="dialog" onClick={() => commands.open(skill)}>
          <span className="sk-row__name mono">{skill.name}</span>
          <span className="sk-row__desc">{skill.description || <span className="subtle">No description.</span>}</span>
          <span className="list-row__meta">
            {skill.category && <span className="tag">{skill.category}</span>}
            <span className="tag" data-tone={skill.provenance === 'hub' ? 'accent' : 'neutral'}>
              {provenanceWords(skill)}
            </span>
            <span>
              Hermes usage count <span className="mono">{skill.usage}</span>
            </span>
          </span>
        </button>
        <div className="list-row__end sk-row__end">
          <WriteButton type="button" role="switch" className="switch" aria-checked={skill.enabled} aria-label={skill.name} disabled={commands.busy.has(skill.name)} onClick={() => void commands.toggle(skill)} />
          <button type="button" className="btn btn--ghost btn--icon" aria-label={`Actions for ${skill.name}`} aria-haspopup="dialog" onClick={() => commands.openMenu(skill)}>
            <Icon name="dots-v" />
          </button>
        </div>
      </div>
    </li>
  );
}

function EmptyList({ profile, filtered, onClear }: { profile: string; filtered: boolean; onClear(): void }) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name="stack" />
      </span>
      {filtered ? (
        <>
          <p>No skill matches this search.</p>
          <button type="button" className="btn btn--secondary" onClick={onClear}>
            Clear search and filters
          </button>
        </>
      ) : (
        <>
          <p>{profile} has no skills yet.</p>
          <div className="row">
            <AppLink className="btn btn--primary" to={editorPath(profile, 'new')}>
              <Icon name="plus" />
              Create skill
            </AppLink>
            <AppLink className="btn btn--secondary" to="/agents/skills/hub">
              <Icon name="package" />
              Browse hub
            </AppLink>
          </div>
        </>
      )}
    </div>
  );
}

/** The search box: what is typed is the URL's `q`, so a reload or a shared link shows the same list. */
function SearchBox({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState(value);
  // Back and forward, or a link, change the URL under the box.
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="input-wrap sk-search">
      <Icon name="search" />
      <input
        className="input"
        type="search"
        placeholder="Search skills"
        aria-label="Search skills"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function Detail({ name, skills, onClose }: { name: string; skills: readonly SkillRow[] | undefined; onClose(): void }) {
  // The list may still be loading: the sheet reads SKILL.md meanwhile, and the actions come once the skill is in the list.
  return <SkillDetail name={name} skill={skills?.find((candidate) => candidate.name === name)} onClose={onClose} />;
}

/**
 * The profile's installed skills as Hermes lists them: search, category and state live in the URL (`?q=`, `?category=`, `?state=`),
 * and so does the skill whose detail is open (`?skill=`). A switch asks Hermes and then shows what Hermes says.
 */
export function InstalledSkills({ profile }: { profile: string }) {
  const { skills, failed, reload } = useSkills(profile);
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { pathname } = useRouteInfo();
  const navigate = useAppNavigate();
  const view = readSkillsView(search);
  const opened = typeof search.skill === 'string' ? search.skill : undefined;
  const stateLabel = useId();

  /** Changes the URL's query in place: the list's own state never piles up history entries. */
  const go = (next: { view?: SkillsView; skill?: string }) => {
    const query = new URLSearchParams(skillsSearch(next.view ?? view));
    if (next.skill) query.set('skill', next.skill);
    const text = query.toString();
    void navigate(`${pathname}${text ? `?${text}` : ''}`, { replace: true });
  };
  const shown = skills ? filterSkills(skills, view) : [];
  const categories = skills ? categoriesOf(skills) : [];
  const filtered = view.q.trim() !== '' || view.category !== '' || view.state !== 'all';

  return (
    <SkillCommandsProvider profile={profile} reload={reload} open={(skill) => go({ skill: skill.name })} closeDetail={() => go({})}>
      <div className="sk">
        {failed && (
          <div className="banner pf-error" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not answer, so the skills of {profile} could not be listed{skills ? ': this is the list from a moment ago' : ''}.</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        )}
        {!skills && !failed && <Loading label="Loading skills…" lines={5} onRetry={() => void reload()} />}
        {skills && skills.length > 0 && (
          <div className="sk-tools" role="search" aria-label="Find skills">
            <SearchBox value={view.q} onChange={(q) => go({ view: { ...view, q }, skill: opened })} />
            <label className="sk-category">
              <span className="sr-only">Category</span>
              <select className="input" value={view.category} onChange={(event) => go({ view: { ...view, category: event.target.value }, skill: opened })}>
                <option value="">All categories ({skills.length})</option>
                {categories.map((category) => (
                  <option key={category.name} value={category.name}>
                    {category.name === UNCATEGORISED ? 'No category' : category.name} ({category.count})
                  </option>
                ))}
              </select>
            </label>
            <span id={stateLabel} className="sr-only">
              Show skills that are
            </span>
            <RadioGroup labelledBy={stateLabel} className="seg" value={view.state} options={STATE_OPTIONS} onChange={(state) => go({ view: { ...view, state }, skill: opened })} />
          </div>
        )}
        {skills && skills.length > 0 && (
          <p className="subtle sk-count" role="status">
            {shown.length === skills.length ? `${skills.length} skills` : `${shown.length} of ${skills.length} skills`}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="list panel sk-list" aria-label={`Skills of ${profile}`}>
            {shown.map((skill) => (
              <SkillRowView key={skill.name} skill={skill} />
            ))}
          </ul>
        )}
        {skills && shown.length === 0 && <EmptyList profile={profile} filtered={filtered} onClear={() => go({ view: { q: '', category: '', state: 'all' }, skill: opened })} />}
      </div>
      {opened && <Detail name={opened} skills={skills} onClose={() => go({ view })} />}
    </SkillCommandsProvider>
  );
}

/** Agents › Skills › Installed: the skills of the profile this tab is scoped to. */
export function Skills() {
  const { effective } = useProfileScope();
  return (
    <SkillsFrame
      title="Skills"
      actions={
        effective && (
          <>
            <AppLink className="btn btn--secondary" to="/agents/skills/hub">
              <Icon name="package" />
              Browse hub
            </AppLink>
            <AppLink className="btn btn--primary" to={editorPath(effective.name, 'new')}>
              <Icon name="plus" />
              New skill
            </AppLink>
          </>
        )
      }
    >
      <p className="help-text">
        A <Term id="skill">skill</Term> is a written procedure the agent loads when a task needs it. Each one is a <Term id="skill-md">SKILL.md</Term> file. A skill is not a <Term id="toolset-vs-skill">toolset</Term>.
      </p>
      {effective ? <InstalledSkills key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
    </SkillsFrame>
  );
}
