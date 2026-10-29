import { useEffect, useId, useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { useAppNavigate, useRouteInfo } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { toast } from '../../shell/toasts.ts';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ActionLogSheet, type LogRun } from './ActionLogSheet.tsx';
import { HubDetail, TRUST_WORDS } from './HubDetail.tsx';
import { SkillsFrame } from './SkillsFrame.tsx';
import { updateAllHubSkills } from './hub-actions.ts';
import { fetchHubOfficial, fetchHubSearch, fetchHubSources } from './hub-data.ts';
import { combineResults, hubSearchParams, installResult, officialMatches, pageOf, readHubView, type HubSkill, type HubView } from './hub-model.ts';
import { useSkills } from './skills-data.ts';
import { useLoaded } from './use-loaded.ts';
import '../profiles/profiles.css';
import './skills.css';

/** A search of the hub in Hermes: the sources it asks can take up to half a minute, so this is a state of its own. */
type Searched = { state: 'idle' } | { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; skills: HubSkill[]; timedOut: string[] };

function HubRow({ skill, sourceLabel, installed, onOpen }: { skill: HubSkill; sourceLabel: string; installed: boolean; onOpen(): void }) {
  return (
    <li>
      <button type="button" className="list-row sk-hubrow" aria-haspopup="dialog" onClick={onOpen}>
        <span className="sk-row__open">
          <span className="sk-row__name mono">{skill.name}</span>
          <span className="sk-row__desc">{skill.description || <span className="subtle">No description.</span>}</span>
          <span className="list-row__meta">
            {/* The official source and the official trust level are one fact: say it once. */}
            {!(skill.source === 'official' && skill.trust === 'builtin') && <span className="tag">{sourceLabel}</span>}
            <span className="tag" data-tone={skill.trust === 'community' ? 'neutral' : 'accent'}>
              {TRUST_WORDS[skill.trust]}
            </span>
            {skill.category && <span className="tag">{skill.category}</span>}
            {installed && (
              <span className="tag" data-tone="success">
                <Icon name="check" small />
                Installed
              </span>
            )}
          </span>
        </span>
        <Icon name="chev-r" small />
      </button>
    </li>
  );
}

function Pager({ page, pages, onGo }: { page: number; pages: number; onGo(page: number): void }) {
  if (pages <= 1) return null;
  return (
    <nav className="sk-pager" aria-label="Pages of results">
      <button type="button" className="btn btn--secondary" disabled={page <= 1} onClick={() => onGo(page - 1)}>
        <Icon name="chev-l" small />
        Previous
      </button>
      <span role="status">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn btn--secondary" disabled={page >= pages} onClick={() => onGo(page + 1)}>
        Next
        <Icon name="chev-r" small />
      </button>
    </nav>
  );
}

/** The hub for one profile: search across Hermes's skill sources, Hermes's official list, and what is featured. */
function HubScreen({ profile }: { profile: string }) {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { pathname } = useRouteInfo();
  const navigate = useAppNavigate();
  const view = readHubView(search);
  const opened = typeof search.skill === 'string' ? search.skill : undefined;
  const sourceId = useId();
  const sources = useLoaded(() => fetchHubSources(profile), profile);
  const official = useLoaded(() => fetchHubOfficial(profile), profile);
  const { skills: installedSkills, reload: reloadInstalled } = useSkills(profile);
  const [draft, setDraft] = useState(view.q);
  useEffect(() => setDraft(view.q), [view.q]);
  const [searched, setSearched] = useState<Searched>({ state: 'idle' });
  const [run, setRun] = useState<LogRun>();

  const go = (next: Partial<HubView> & { skill?: string }) => {
    const { skill, ...rest } = next;
    const query = new URLSearchParams(hubSearchParams({ ...view, ...rest }));
    if (skill) query.set('skill', skill);
    const text = query.toString();
    void navigate(`${pathname}${text ? `?${text}` : ''}`, { replace: true });
  };

  // Hermes's network search: for a query, in every source but the official list, which Hermes keeps on disk and which is matched here.
  const query = view.q.trim();
  const needsSearch = query !== '' && view.source !== 'official';
  useEffect(() => {
    if (!needsSearch) {
      setSearched({ state: 'idle' });
      return;
    }
    let current = true;
    setSearched({ state: 'loading' });
    fetchHubSearch(profile, { q: query, source: view.source }).then(
      ({ skills, timedOut }) => current && setSearched({ state: 'ready', skills, timedOut }),
      (error: unknown) => current && setSearched({ state: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [profile, query, view.source, needsSearch]);

  const sourceList = sources.loaded.state === 'ready' ? sources.loaded.value.sources : [];
  const labelOf = (id: string) => sourceList.find((source) => source.id === id)?.label ?? (id === 'official' ? 'Official (Nous)' : id || 'Unknown source');
  const officialList = official.loaded.state === 'ready' ? official.loaded.value : [];
  const featured = sources.loaded.state === 'ready' ? sources.loaded.value.featured : [];
  const installedNames = useMemo(() => new Set((installedSkills ?? []).filter((skill) => skill.provenance === 'hub').map((skill) => skill.name)), [installedSkills]);

  const showFeatured = query === '' && view.source === 'all';
  const matched = view.source === 'all' || view.source === 'official' ? officialMatches(officialList, query) : [];
  const results = showFeatured ? [] : combineResults(matched, searched.state === 'ready' ? searched.skills : []);
  const shown = pageOf(results, view.page);
  const known = [...officialList, ...featured, ...results].find((skill) => skill.identifier === opened);

  const updateAll = async () => {
    const outcome = await updateAllHubSkills(profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    setRun({
      action: outcome.body.action,
      title: `Updating the hub skills of ${profile}`,
      doneTitle: `Updated the hub skills of ${profile}`,
      async judge(log) {
        const result = installResult(log, log.exitCode === 0);
        await reloadInstalled();
        return result.ok ? { ok: true, message: 'Hermes finished the update. Its log says which skills changed and which it skipped.' } : result;
      },
    });
  };

  const waiting = (query !== '' && view.source !== 'official' && searched.state === 'loading') || (official.loaded.state === 'loading' && (view.source === 'official' || query !== ''));
  return (
    <div className="sk">
      <div className="sk-tools">
        <form
          className="sk-hubsearch"
          role="search"
          aria-label="Search the skills hub"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: draft, page: 1 });
          }}
        >
          <div className="input-wrap sk-search">
            <Icon name="search" />
            <input className="input" type="search" placeholder="Search the hub" aria-label="Search the hub" autoComplete="off" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} />
          </div>
          <button type="submit" className="btn btn--primary">
            Search
          </button>
        </form>
        <label className="sk-category" htmlFor={sourceId}>
          <span className="sr-only">Source</span>
          <select id={sourceId} className="input" value={view.source} onChange={(event) => go({ source: event.target.value, page: 1 })}>
            <option value="all">All sources</option>
            {/* Hermes's official list is always there; its sources endpoint names the rest. */}
            {sourceList.some((source) => source.id === 'official') ? null : <option value="official">Official (Nous)</option>}
            {sourceList.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sources.loaded.state === 'loading' && (
        <p className="subtle sk-note" role="status">
          Asking Hermes for its hub sources…
        </p>
      )}
      {sources.loaded.state === 'failed' && (
        <div className="banner pf-error" data-tone="warning" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not name its hub sources, so only the official list and a search of all sources are offered, and nothing is featured.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={sources.retry}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {official.loaded.state === 'failed' && (
        <p className="sk-error" role="alert">
          Hermes did not send its official list.{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={official.retry}>
            Retry
          </button>
        </p>
      )}

      {showFeatured && (
        <section className="sk-section" aria-labelledby="sk-featured-title">
          <h2 id="sk-featured-title" className="section__title">
            Featured
          </h2>
          {sources.loaded.state === 'ready' && featured.length === 0 && (
            <p className="muted">Hermes has nothing featured: its skills index is not available right now. Search the hub, or open the official list.</p>
          )}
          {featured.length > 0 && (
            <ul className="list panel sk-list" aria-label="Featured skills">
              {featured.map((skill) => (
                <HubRow key={skill.identifier} skill={skill} sourceLabel={labelOf(skill.source)} installed={installedNames.has(skill.name)} onOpen={() => go({ skill: skill.identifier })} />
              ))}
            </ul>
          )}
          <p>
            <button type="button" className="btn btn--secondary" onClick={() => go({ source: 'official', page: 1 })}>
              <Icon name="package" />
              Browse the official list{official.loaded.state === 'ready' ? ` (${officialList.length})` : ''}
            </button>
          </p>
        </section>
      )}

      {!showFeatured && (
        <section className="sk-section" aria-labelledby="sk-results-title">
          <h2 id="sk-results-title" className="section__title">
            {query === '' ? `${labelOf(view.source)}` : `Results for “${query}”`}
          </h2>
          {view.source !== 'all' && view.source !== 'official' && query === '' && <p className="muted">Type what you are looking for to search {labelOf(view.source)}.</p>}
          {waiting && (
            <p role="status" aria-live="polite">
              Hermes is searching its sources. This can take up to half a minute…
            </p>
          )}
          {searched.state === 'failed' && (
            <p className="sk-error" role="alert">
              Hermes’s search failed: {searched.message}
            </p>
          )}
          {searched.state === 'ready' && searched.timedOut.length > 0 && (
            <p className="muted sk-note" role="status">
              These sources did not answer in time, so their results are missing: {searched.timedOut.map(labelOf).join(', ')}.
            </p>
          )}
          {shown.items.length > 0 && (
            <>
              <p className="subtle sk-count" role="status">
                {shown.total} {shown.total === 1 ? 'skill' : 'skills'}
              </p>
              <ul className="list panel sk-list" aria-label="Hub skills">
                {shown.items.map((skill) => (
                  <HubRow key={skill.identifier} skill={skill} sourceLabel={labelOf(skill.source)} installed={installedNames.has(skill.name)} onOpen={() => go({ skill: skill.identifier })} />
                ))}
              </ul>
              <Pager page={shown.page} pages={shown.pages} onGo={(page) => go({ page })} />
            </>
          )}
          {shown.items.length === 0 && !waiting && searched.state !== 'failed' && (query !== '' || view.source === 'official') && official.loaded.state !== 'loading' && <p className="muted">No skill in {view.source === 'all' ? 'the hub' : labelOf(view.source)} matches{query ? ` “${query}”` : ''}.</p>}
        </section>
      )}

      {installedNames.size > 0 && (
      <div className="sk-update">
        <WriteButton type="button" className="btn btn--secondary" onClick={() => void updateAll()}>
          <Icon name="refresh" />
          Update all
        </WriteButton>
        <span className="subtle sk-note">
          Installs newer versions of the skills you installed from the hub. It needs your passkey, and you type a name to confirm.
        </span>
      </div>
      )}

      {opened && (
        <HubDetail
          key={opened}
          profile={profile}
          identifier={opened}
          known={known}
          sourceLabel={labelOf}
          installedNames={installedNames}
          onClose={() => go({})}
          onInstalled={() => void reloadInstalled()}
          onStarted={(next) => {
            go({});
            setRun(next);
          }}
        />
      )}
      {run && (
        <ActionLogSheet
          run={run}
          onClose={() => setRun(undefined)}
          onFinished={(verdict) => {
            toast(verdict.ok ? run.doneTitle : `${run.title}: it did not finish`, { tone: verdict.ok ? 'success' : 'danger', detail: verdict.message });
            void reloadInstalled();
          }}
        />
      )}
    </div>
  );
}

/** Agents › Skills › Hub. */
export function Hub() {
  const { effective } = useProfileScope();
  return (
    <SkillsFrame title="Skills hub">
      <p className="help-text">
        The <Term id="skills-hub">skills hub</Term> is where Hermes finds skills other people published. Hermes scans each one before it installs it, and shows you its <Term id="security-scan">security scan</Term> first.
      </p>
      {effective ? <HubScreen key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
    </SkillsFrame>
  );
}
