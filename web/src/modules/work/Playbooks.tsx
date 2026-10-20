// Work › Playbooks: the library of templates (one stage) and playbooks (several stages), with the seeds that ship with Caduceus, and the categories
// that group them. A template starts a task in the Brief editor (Use) and can be edited; a playbook opens its detail (stages, inspector, YAML,
// versions); every card can be duplicated, and all but a seed deleted (delete is undone from a toast). A seed is read-only. Categories are
// created, renamed, reordered (↑ and ↓, or drag) and deleted. Everything here is Caduceus's own (YAML files and its store): nothing is sent to Hermes.
import { useId, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { isTemplate, type Playbook, type TemplateCategory } from '@caduceus/contracts/playbooks';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { kindOf, playbookPath, type PlaybookKind } from './playbook-model.ts';
import { addCategory, deleteCategory, deletePlaybook, duplicatePlaybook, renameCategory, reorderCategories, restorePlaybook, usePlaybookLibrary } from './template-data.ts';
import { groupTemplates, moveItem, moveItemTo, searchPlaybooks } from './template-model.ts';
import { RunsByPlaybook } from './RunsList.tsx';
import { useRuns } from './playbook-run-data.ts';
import { CategoryPills, KindBadge } from './TemplateParts.tsx';
import './templates.css';
import './work.css';

const fail = (error: unknown) => toast(error instanceof Error ? error.message : 'Caduceus did not do that.', { tone: 'danger' });

/** Asks for one name: a new category, or a category's new name. */
function NameSheet({ title, initial, submit, onSubmit, onClose }: { title: string; initial: string; submit: string; onSubmit(name: string): Promise<void>; onClose(): void }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const name = value.replace(/\s+/g, ' ').trim();
    if (name === '') return setProblem('Give the category a name.');
    if (name.length > 40) return setProblem('Use 40 characters or fewer.');
    setBusy(true);
    try {
      await onSubmit(name);
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Caduceus did not save the category.');
      setBusy(false);
    }
  };
  return (
    <Sheet title={title} initialFocus="input" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void send(event)} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Name
          </label>
          <input id={id} className="input" value={value} maxLength={40} autoComplete="off" aria-invalid={problem ? true : undefined} aria-describedby={`${id}-error`} onChange={(event) => setValue(event.target.value)} />
          <p className="field__error" id={`${id}-error`} role="alert">
            {problem && (
              <>
                <Icon name="alert" small />
                {problem}
              </>
            )}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            {submit}
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}

interface CardProps {
  playbook: Playbook;
  kind: PlaybookKind;
  category: string;
  onDuplicate(): void;
  onDelete(): void;
}

/** One definition: what it is, what it asks and how many stages it has, and what can be done with it (a seed can only be opened and duplicated). */
function PlaybookCard({ playbook, kind, category, onDuplicate, onDelete }: CardProps) {
  const questions = playbook.inputs.length === 0 ? 'No questions' : `${playbook.inputs.length} ${playbook.inputs.length === 1 ? 'question' : 'questions'}`;
  const meta = [kind === 'template' ? undefined : `${playbook.stages.length} stages`, questions, kind === 'template' ? playbook.stages[0].assignee : undefined, kind === 'seed' ? 'Built in, read-only' : playbook.version > 1 ? `Version ${playbook.version}` : undefined].filter(Boolean);
  return (
    <li className="tpl__card" data-kind={kind}>
      <div className="row">
        <h3 className="tpl__title">
          <AppLink to={playbookPath(playbook.id)}>{playbook.name}</AppLink>
        </h3>
        <KindBadge kind={kind} />
      </div>
      <p className="tpl__category subtle">{category}</p>
      {playbook.description && <p className="tpl__desc">{playbook.description}</p>}
      <p className="tpl__meta subtle">{meta.join(' · ')}</p>
      <div className="tpl__actions">
        {kind === 'template' ? (
          <>
            <AppLink className="btn btn--primary btn--sm" to={`/work/tasks/new?template=${encodeURIComponent(playbook.id)}`}>
              Use
              <span className="sr-only"> {playbook.name}</span>
            </AppLink>
            <AppLink className="btn btn--secondary btn--sm" to={playbookPath(playbook.id, '/edit')}>
              <Icon name="sliders" />
              Edit
              <span className="sr-only"> {playbook.name}</span>
            </AppLink>
          </>
        ) : (
          <AppLink className="btn btn--primary btn--sm" to={playbookPath(playbook.id)}>
            <Icon name="playbook" />
            Open
            <span className="sr-only"> {playbook.name}</span>
          </AppLink>
        )}
        <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={onDuplicate}>
          <Icon name="copy" />
          Duplicate
          <span className="sr-only"> {playbook.name}</span>
        </WriteButton>
        {kind !== 'seed' && (
          <WriteButton type="button" className="btn btn--ghost btn--sm" onClick={onDelete}>
            <Icon name="trash" />
            Delete
            <span className="sr-only"> {playbook.name}</span>
          </WriteButton>
        )}
      </div>
    </li>
  );
}

export function Playbooks() {
  const { library, error, reload } = usePlaybookLibrary();
  const runs = useRuns();
  const [category, setCategory] = useState<string>();
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState<{ kind: 'add' } | { kind: 'rename'; category: TemplateCategory }>();
  const [dragging, setDragging] = useState<string>();
  const [announce, setAnnounce] = useState('');
  // The categories are managed by what the owner has in them (a seed never keeps a category from being deleted); the pills and cards show the seeds too.
  const owned = useMemo(() => (library ? groupTemplates(library) : []), [library]);
  const everything = useMemo(() => (library ? [...library.templates, ...library.seeds] : []), [library]);
  const seedIds = useMemo(() => new Set(library?.seeds.map((seed) => seed.id)), [library]);
  const groups = useMemo(() => (library ? groupTemplates({ categories: library.categories, templates: everything }) : []), [library, everything]);
  const total = everything.length;
  const inCategory = category === undefined ? groups.flatMap((group) => group.templates) : (groups.find((group) => group.id === category)?.templates ?? []);
  const shown = useMemo(() => searchPlaybooks(inCategory, query), [inCategory, query]);
  const nameOf = (id: string) => library?.categories.find((entry) => entry.id === id)?.name ?? 'Other';
  const ids = library?.categories.map((entry) => entry.id) ?? [];

  const duplicate = (playbook: Playbook) =>
    void duplicatePlaybook(playbook, library?.categories ?? []).then((copy) => {
      const template = isTemplate(copy);
      toast(`Copied as “${copy.name}”`, { tone: 'success', action: { label: template ? 'Edit' : 'Open', onClick: () => history.pushState(null, '', playbookPath(copy.id, template ? '/edit' : '')) } });
      reload();
    }, fail);

  const remove = (playbook: Playbook) =>
    void deletePlaybook(playbook).then((done) => {
      if (!done) return;
      toast(`Deleted “${playbook.name}”`, { undo: () => void restorePlaybook(playbook).then(reload, fail) });
      reload();
    }, fail);

  const reorder = (next: string[], moved: string) =>
    void reorderCategories(next).then(() => {
      setAnnounce(`${nameOf(moved)} is now number ${next.indexOf(moved) + 1} of ${next.length}.`);
      reload();
    }, fail);

  const removeCategory = (entry: TemplateCategory) =>
    void deleteCategory(entry.id).then(() => {
      toast(`Deleted the category “${entry.name}”`, { undo: () => void addCategory(entry.name).then(reload, fail) });
      reload();
    }, fail);

  const drop = (event: DragEvent, target: string) => {
    event.preventDefault();
    if (dragging !== undefined && dragging !== target) reorder(moveItemTo(ids, dragging, target), dragging);
    setDragging(undefined);
  };

  return (
    <div className="bpage tpl">
      <PageHeader
        overline="Work"
        title="Playbooks"
        subtitle={library ? `${library.templates.length + library.seeds.length} in the library, in ${library.categories.length} ${library.categories.length === 1 ? 'category' : 'categories'}` : 'Templates and multi-stage playbooks'}
        actions={
          // Starting a run is on a playbook's detail page (Run); this is where a library-wide action goes.
          <AppLink className="btn btn--primary" to="/work/playbooks/new">
            <Icon name="plus" />
            New template
          </AppLink>
        }
      />
      <p className="help-text">
        A <Term id="playbook">playbook</Term> is a plan of <Term id="stage">stages</Term>; a <Term id="template">template</Term> is the one-stage kind, a brief with blanks. Open a playbook to see its stages and its YAML. Seeds are built in and read-only: duplicate one to make your own. <Term id="template-category">Categories</Term> only group them here.
      </p>

      {error && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">The playbooks could not be read: {error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {!error && library === undefined && <p role="status">Loading the playbooks…</p>}
      {library && library.problems.length > 0 && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <div className="banner__content">
            <p>Some definition files could not be read, and are left as they are:</p>
            <ul>
              {library.problems.map((problem) => (
                <li key={problem} className="mono">
                  {problem}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {library && (
        <>
          <section className="sb__section tpl__templates" aria-labelledby="tpl-templates">
            <h2 id="tpl-templates">Library</h2>
            {total === 0 ? (
              <div className="empty">
                <Icon name="file" />
                <h2>Nothing here yet</h2>
                <p>Make a template here, or open a task and choose Save as template.</p>
                <AppLink className="btn btn--primary" to="/work/playbooks/new">
                  New template
                </AppLink>
              </div>
            ) : (
              <>
                <form className="input-wrap tpl__search" role="search" onSubmit={(event) => event.preventDefault()}>
                  <Icon name="search" />
                  <input type="search" className="input" aria-label="Search playbooks" placeholder="Search by name, question or stage…" autoComplete="off" spellCheck={false} enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} />
                </form>
                <CategoryPills groups={groups} selected={category} onSelect={setCategory} total={total} />
                {shown.length === 0 ? (
                  <div className="empty">
                    <Icon name="search" />
                    <h2>No match</h2>
                    <p>{query.trim() === '' ? 'There is nothing in this category yet.' : `Nothing here has “${query.trim()}” in its name, description, questions or stage titles.`}</p>
                    {query.trim() !== '' && (
                      <button type="button" className="btn btn--secondary" onClick={() => setQuery('')}>
                        Clear the search
                      </button>
                    )}
                  </div>
                ) : (
                  <ul className="tpl__grid">
                    {shown.map((playbook) => (
                      <PlaybookCard key={`${seedIds.has(playbook.id) ? 'seed' : 'own'}:${playbook.id}`} playbook={playbook} kind={kindOf(playbook, seedIds.has(playbook.id))} category={nameOf(playbook.category)} onDuplicate={() => duplicate(playbook)} onDelete={() => remove(playbook)} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="sb__section tpl__runs" aria-labelledby="tpl-runs">
            <h2 id="tpl-runs">Runs</h2>
            <p className="subtle">
              Every <Term id="playbook-run">playbook run</Term>, by playbook and version. Open a playbook and press Run to start one.
            </p>
            <RunsByPlaybook state={runs} />
          </section>

          <section className="sb__section tpl__categories" aria-labelledby="tpl-categories">
            <div className="row tpl__head">
              <h2 id="tpl-categories">Categories</h2>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setNaming({ kind: 'add' })}>
                <Icon name="plus" />
                Add category
              </button>
            </div>
            <p className="subtle">Drag a category, or use its arrows, to change the order the pills show them in.</p>
            <ol className="tpl__cats">
              {library.categories.map((entry, index) => {
                const count = owned.find((group) => group.id === entry.id)?.templates.length ?? 0;
                return (
                  <li key={entry.id} className="tpl__cat" draggable onDragStart={() => setDragging(entry.id)} onDragEnd={() => setDragging(undefined)} onDragOver={(event) => dragging !== undefined && event.preventDefault()} onDrop={(event) => drop(event, entry.id)} data-dragging={dragging === entry.id || undefined}>
                    <Icon name="grip" />
                    <span className="tpl__catname">
                      <strong>{entry.name}</strong>
                      <span className="subtle"> · {count} {count === 1 ? 'playbook' : 'playbooks'} of yours</span>
                    </span>
                    <span className="tpl__catactions">
                      <WriteButton type="button" className="btn btn--ghost btn--icon" aria-label={`Move ${entry.name} up`} disabled={index === 0} onClick={() => reorder(moveItem(ids, entry.id, -1), entry.id)}>
                        <Icon name="chev-u" />
                      </WriteButton>
                      <WriteButton type="button" className="btn btn--ghost btn--icon" aria-label={`Move ${entry.name} down`} disabled={index === library.categories.length - 1} onClick={() => reorder(moveItem(ids, entry.id, 1), entry.id)}>
                        <Icon name="chev-d" />
                      </WriteButton>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setNaming({ kind: 'rename', category: entry })}>
                        Rename<span className="sr-only"> {entry.name}</span>
                      </button>
                      <WriteButton type="button" className="btn btn--ghost btn--sm" disabled={count > 0} title={count > 0 ? 'Move or delete its playbooks first.' : undefined} onClick={() => removeCategory(entry)}>
                        <Icon name="trash" />
                        Delete<span className="sr-only"> {entry.name}</span>
                      </WriteButton>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="sr-only" role="status">
              {announce}
            </p>
          </section>
        </>
      )}

      {naming?.kind === 'add' && <NameSheet title="Add a category" initial="" submit="Add category" onClose={() => setNaming(undefined)} onSubmit={(name) => addCategory(name).then(reload)} />}
      {naming?.kind === 'rename' && <NameSheet title="Rename category" initial={naming.category.name} submit="Rename" onClose={() => setNaming(undefined)} onSubmit={(name) => renameCategory(naming.category.id, name).then(reload)} />}
    </div>
  );
}
