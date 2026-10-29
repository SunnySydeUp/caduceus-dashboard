import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useBlocker, useParams, useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ConfigTools, ConfigViews } from './ConfigTools.tsx';
import { fieldDomId, FieldRow } from './ConfigField.tsx';
import { saveConfig } from './config-actions.ts';
import { useConfigForm } from './config-data.ts';
import {
  configSearch,
  diffRows,
  matchingFields,
  parseConfigQuery,
  readConfigView,
  stageValue,
  type ConfigField,
  type ConfigFilter,
  type ConfigForm,
  type ConfigValue,
  type ConfigView,
} from './config-model.ts';
import './config.css';

const FILTER_CHIPS: { id: ConfigFilter; label: string; hint: string }[] = [
  { id: 'modified', label: '@modified', hint: 'Differs from the Hermes default, or is being edited' },
  { id: 'profile', label: '@profile', hint: 'Set in this profile’s own config' },
  { id: 'restart-required', label: '@restart-required', hint: 'Applies when the gateway restarts' },
];

/** How many results show before "Show more": a search for one letter must not build every field at once. */
const PAGE = 100;

/** The review of what will be saved, as a list: each key with what it was and what it becomes. */
function Review({ form, pending }: { form: ConfigForm; pending: ReadonlyMap<string, ConfigValue> }) {
  const rows = diffRows(form.fields, pending);
  if (rows.length === 0) return <p>Nothing is waiting to be saved.</p>;
  return (
    <ul className="cf-review">
      {rows.map((row) => (
        <li key={row.key} className="cf-review__row">
          <div className="cf-review__name">
            <strong>{row.label}</strong>
            <code>{row.key}</code>
            {row.restartRequired && (
              <span className="tag" data-tone="warning">
                <Icon name="refresh" small />
                Restart
              </span>
            )}
          </div>
          <div className="cf-review__change">
            <span className="cf-review__old">
              <span className="sr-only">Was </span>
              {row.before}
            </span>
            <Icon name="arrow-r" small />
            <span className="cf-review__new">
              <span className="sr-only">Becomes </span>
              {row.after}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Config() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { category } = useParams({ strict: false }) as { category?: string };
  const view = readConfigView(search);
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const profile = effective?.name ?? 'default';
  const compact = useSizeClass() === 'compact';
  const readOnly = useReadOnly();
  const searchId = useId();
  const jumpId = useId();

  const { form, failed, reload } = useConfigForm(profile);
  const [pending, setPending] = useState<ReadonlyMap<string, ConfigValue>>(new Map());
  const [draft, setDraft] = useState(view.text);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const dirty = pending.size > 0;
  const profileInUrl = ({ search: query }: { search: unknown }) => (typeof query === 'object' && query !== null && 'profile' in query ? query.profile : undefined);
  // Leaving the page, or this profile's config for another's, would lose the edits; a change of search, filter or section would not.
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && !(next.pathname.startsWith('/system/config') && profileInUrl(current) === profileInUrl(next)),
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  // Edits belong to one profile's config.
  useEffect(() => setPending(new Map()), [profile]);

  const go = (next: ConfigView, section: string | undefined, replace = false) => {
    const query = new URLSearchParams(configSearch(next)).toString();
    void navigate(`/system/config${section ? `/${encodeURIComponent(section)}` : ''}${query ? `?${query}` : ''}`, { replace });
  };

  const searching = view.text !== '' || view.filters.length > 0;
  const linked = form?.fields.find((field) => field.key === view.field);
  // On a wide screen a section is always open; on a phone the sections are a list until one is chosen (or a link names a field).
  const known = (id: string | undefined) => (id !== undefined && form?.sections.some((section) => section.id === id) ? id : undefined);
  const sectionId = known(category) ?? known(linked?.section) ?? (compact ? undefined : form?.sections[0]?.id);
  const section = form?.sections.find((candidate) => candidate.id === sectionId);

  const pendingKeys = useMemo(() => new Set(pending.keys()), [pending]);
  const matches = useMemo(() => {
    if (!form) return [];
    const found = matchingFields(form.fields, view, pendingKeys);
    return searching ? found : found.filter((field) => field.section === sectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is read as its parts
  }, [form, view.text, view.filters.join(','), pendingKeys, searching, sectionId]);
  useEffect(() => setShown(PAGE), [view.text, view.filters.join(','), sectionId]);

  // A link to a field scrolls to it once it is on the page.
  useEffect(() => {
    if (!form || !view.field) return;
    document.getElementById(fieldDomId(view.field))?.scrollIntoView({ block: 'center' });
  }, [form, view.field, sectionId]);

  useEffect(() => setDraft(view.text), [view.text]);
  const applyQuery = (text: string) => {
    const parsed = parseConfigQuery(text);
    go({ text: parsed.text, filters: [...new Set([...view.filters, ...parsed.filters])], field: view.field }, category);
  };
  // Typing is applied once it pauses, so every letter is not a new view; Enter applies it at once.
  useEffect(() => {
    if (draft.trim() === view.text) return;
    const timer = setTimeout(() => applyQuery(draft), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `applyQuery` reads the view this effect lists
  }, [draft, view.text, view.filters.join(',')]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    applyQuery(draft);
  };
  const toggleFilter = (id: ConfigFilter) => go({ ...view, filters: view.filters.includes(id) ? view.filters.filter((filter) => filter !== id) : [...view.filters, id] }, category, true);

  const stage = (field: ConfigField, value: ConfigValue) => setPending((current) => stageValue(current, field, value));
  const undo = (field: ConfigField) =>
    setPending((current) => {
      const next = new Map(current);
      next.delete(field.key);
      return next;
    });
  const reset = (field: ConfigField) => setPending((current) => stageValue(current, field, field.default));
  const copyLink = async (field: ConfigField) => {
    const url = `${location.origin}/system/config/${encodeURIComponent(field.section)}?${new URLSearchParams({ field: field.key, profile })}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`Copied the link to ${field.key}`);
    } catch {
      toast('Could not copy. Select the address of the page instead.', { tone: 'danger' });
    }
  };

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const outcome = await saveConfig(profile, form.fields, pending);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      const { saved, restart } = outcome.body;
      setPending(new Map());
      setReviewing(false);
      toast(`Saved ${saved.length === 1 ? '1 setting' : `${saved.length} settings`} for ${profile}`, { detail: restart.length === 0 ? 'Hermes uses them from now on.' : `A gateway restart applies ${restart.length === saved.length ? (saved.length === 1 ? 'it' : 'them') : `${restart.length} of them`}. The notice at the top offers it.` });
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const restartCount = form ? diffRows(form.fields, pending).filter((row) => row.restartRequired).length : 0;
  const saveReason = readOnly ? 'Read-only mode is on, so nothing can be saved.' : undefined;
  const results = matches.slice(0, shown);
  const groups = searching && form ? form.sections.map((candidate) => ({ section: candidate, fields: results.filter((field) => field.section === candidate.id) })).filter((group) => group.fields.length > 0) : [{ section, fields: results }];

  const rows = (fields: ConfigField[]) => (
    <div className="cf-list panel">
      {fields.map((field) => (
        <FieldRow key={field.key} field={field} staged={pending.get(field.key)} linked={field.key === view.field} onStage={stage} onUndo={undo} onReset={reset} onCopyLink={(target) => void copyLink(target)} />
      ))}
    </div>
  );

  return (
    <div className="cf">
      <PageHeader overline="System" title="Config" subtitle={form ? `${form.fields.length} settings · profile ${profile}` : `Profile ${profile}`} />
      <ConfigViews current="form" />
      <ConfigTools
        profile={profile}
        form={form}
        onChanged={async () => {
          // The config was replaced under the edits waiting here, which were made against the old one.
          setPending(new Map());
          await reload();
        }}
      />
      <p className="help-text">
        Hermes’s own settings, built from what Hermes says it has. A setting that is <Term id="modified">modified</Term> differs from its <Term id="default-value">default value</Term>; one marked restart applies when the gateway restarts (<Term id="restart-required">restart required</Term>). Saving is a Tier 3 action.
      </p>

      {blocker.status === 'blocked' && (
        <div className="banner cf-leave" data-tone="warning" role="alertdialog" aria-labelledby="cf-leave-title">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="cf-leave-title">Leave without saving?</strong>
            <p>
              {pending.size} unsaved {pending.size === 1 ? 'change' : 'changes'} will be lost.
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" autoFocus onClick={() => blocker.reset()}>
              Stay and keep editing
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => blocker.proceed()}>
              Leave and discard
            </button>
          </div>
        </div>
      )}

      <div className="cf-tools" role="search" aria-label="Search the settings">
        <form className="cf-search" onSubmit={submit}>
          <label className="sr-only" htmlFor={searchId}>
            Search settings by name, description or choice; type @modified, @profile or @restart-required to filter
          </label>
          <div className="input-wrap">
            <Icon name="search" />
            <input id={searchId} className="input input--mono" type="search" value={draft} placeholder="Search, or type @modified" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
          </div>
        </form>
        <div className="cf-chips" role="group" aria-label="Filters">
          {FILTER_CHIPS.map((chip) => (
            <button key={chip.id} type="button" className="chip" aria-pressed={view.filters.includes(chip.id)} title={chip.hint} onClick={() => toggleFilter(chip.id)}>
              {chip.label}
            </button>
          ))}
        </div>
        {!compact && form && (
          <div className="field cf-jump">
            <label className="field__label" htmlFor={jumpId}>
              Jump to
            </label>
            <select id={jumpId} className="input" value={sectionId ?? ''} onChange={(event) => go({ text: view.text, filters: view.filters, field: undefined }, event.target.value)}>
              {form.sections.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title} ({candidate.count})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {failed && !form && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>Hermes did not answer</strong>
            <p>The settings come from Hermes, which is not reachable right now.</p>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}
      {!form && !failed && <p role="status">Reading Hermes’s config…</p>}

      {form && (
        <>
          <p className="sr-only" role="status">
            {searching ? `${matches.length} ${matches.length === 1 ? 'setting' : 'settings'} found` : section ? `${section.title}: ${matches.length} settings` : `${form.sections.length} sections`}
          </p>
          {searching && (
            <p className="cf-count">
              {matches.length} {matches.length === 1 ? 'setting' : 'settings'} found in every section
              {view.filters.length > 0 && ` · ${view.filters.map((filter) => `@${filter}`).join(' ')}`}
            </p>
          )}

          {!searching && compact && !section && (
            <nav aria-label="Sections">
              <ul className="list panel cf-sections">
                {form.sections.map((candidate) => {
                  const edited = form.fields.filter((field) => field.section === candidate.id && pending.has(field.key)).length;
                  return (
                    <li key={candidate.id}>
                      <AppLink className="list-row cf-section" to={`/system/config/${encodeURIComponent(candidate.id)}`}>
                        <span className="list-row__main">
                          <span className="list-row__title">{candidate.title}</span>
                          <small className="subtle">
                            {candidate.count} settings{edited > 0 ? ` · ${edited} unsaved` : ''}
                          </small>
                        </span>
                        <Icon name="chev-r" />
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}

          {!searching && compact && section && (
            <AppLink className="section__link cf-back" to="/system/config">
              <Icon name="chev-l" small />
              All sections
            </AppLink>
          )}

          {(searching || section) &&
            (matches.length === 0 ? (
              <div className="empty">
                <Icon name="search" />
                <h2>No setting matches</h2>
                <p>{view.filters.includes('modified') && !view.text ? 'Nothing differs from the Hermes defaults.' : 'Try a key such as agent.max_turns, a word from its description, or clear the filters.'}</p>
                <button type="button" className="btn btn--secondary" onClick={() => go({ text: '', filters: [], field: undefined }, category)}>
                  Clear search
                </button>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.section?.id ?? 'all'} className="cf-group" aria-labelledby={`cf-g-${group.section?.id}`}>
                  <h2 className="cf-group__title" id={`cf-g-${group.section?.id}`}>
                    {group.section?.title}
                    <span className="subtle">{searching ? group.fields.length : group.section?.count}</span>
                  </h2>
                  {rows(group.fields)}
                </section>
              ))
            ))}

          {matches.length > shown && (
            <button type="button" className="btn btn--secondary" onClick={() => setShown((count) => count + PAGE)}>
              Show {Math.min(PAGE, matches.length - shown)} more of {matches.length - shown}
            </button>
          )}

          {dirty && (
            <div className="cf-savebar" role="region" aria-label="Unsaved changes">
              <p className="cf-savebar__msg">
                <strong>
                  {pending.size} unsaved {pending.size === 1 ? 'change' : 'changes'}
                </strong>
                {restartCount > 0 && <span className="subtle"> · {restartCount} need{restartCount === 1 ? 's' : ''} a restart</span>}
                {saveReason && <span className="subtle"> · {saveReason}</span>}
              </p>
              <div className="cf-savebar__acts">
                <button type="button" className="btn btn--ghost btn--sm" aria-haspopup="dialog" onClick={() => setReviewing(true)}>
                  Review
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    const discarded = pending;
                    setPending(new Map());
                    toast(`Discarded ${discarded.size === 1 ? '1 unsaved change' : `${discarded.size} unsaved changes`}`, { undo: () => setPending(discarded) });
                  }}
                >
                  Discard
                </button>
                <WriteButton type="button" className="btn btn--primary btn--sm" disabled={saving || readOnly} title={saveReason} aria-busy={saving} onClick={() => void save()}>
                  <Icon name="lock" small />
                  {saving ? 'Saving…' : 'Save…'}
                </WriteButton>
              </div>
            </div>
          )}

          {reviewing && (
            <Sheet
              title="Review changes"
              detents={['half', 'full']}
              onClose={() => setReviewing(false)}
              footer={
                <div className="row">
                  <button type="button" className="btn btn--secondary" onClick={() => setReviewing(false)}>
                    Keep editing
                  </button>
                  <WriteButton type="button" className="btn btn--primary" disabled={saving || readOnly || !dirty} title={saveReason} onClick={() => void save()}>
                    <Icon name="lock" small />
                    Save…
                  </WriteButton>
                </div>
              }
            >
              <Review form={form} pending={pending} />
            </Sheet>
          )}
        </>
      )}
    </div>
  );
}
