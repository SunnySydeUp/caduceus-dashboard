import { useMemo } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { JobTable } from './JobTable.tsx';
import { SchedulerNotice, useNow } from './JobParts.tsx';
import { useJobs } from './schedules-data.ts';
import { JOB_STATUSES, JOB_TYPES, readSchedulesView, schedulerStatus, schedulesSearch, selectJobs, sortJobs, type JobStatusFilter, type JobType, type SchedulesView } from './schedules-model.ts';
import './work.css';

/** The two ways to make a schedule: the builder, or a blueprint of Hermes's. */
function BuilderLinks() {
  return (
    <div className="row">
      <AppLink className="btn btn--primary" to="/work/schedules/new">
        <Icon name="plus" />
        New schedule
      </AppLink>
      <AppLink className="btn btn--secondary" to="/work/schedules/blueprints">
        <Icon name="package" />
        Browse blueprints
      </AppLink>
    </div>
  );
}

const STATUS_ORDER = Object.keys(JOB_STATUSES) as JobStatusFilter[];

export function Schedules() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const view = readSchedulesView(search);
  const navigate = useAppNavigate();
  const now = useNow();
  const { jobs, failed, reload } = useJobs();

  const go = (next: SchedulesView) => {
    const query = new URLSearchParams(schedulesSearch(next)).toString();
    void navigate(`/work/schedules${query ? `?${query}` : ''}`, { replace: true });
  };

  const scheduler = useMemo(() => (jobs ? schedulerStatus(jobs) : undefined), [jobs]);
  const shown = useMemo(() => (jobs ? sortJobs(selectJobs(jobs, view)) : []), [jobs, view.profile, view.type, view.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const profiles = useMemo(() => [...new Set([...(jobs ?? []).map((job) => job.profile), ...(view.profile ? [view.profile] : [])])].sort(), [jobs, view.profile]);
  // The number on a status chip is how many jobs it would show with the profile and the type that are chosen.
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((status) => [status, jobs ? selectJobs(jobs, { ...view, status }).length : 0])) as Record<JobStatusFilter, number>, [jobs, view.profile, view.type]); // eslint-disable-line react-hooks/exhaustive-deps
  const narrowed = view.profile !== undefined || view.type !== undefined || view.status !== undefined;
  const total = jobs ? selectJobs(jobs, { profile: view.profile, type: view.type }).length : 0;

  return (
    <div className="bpage tlist sched">
      <PageHeader overline="Work" title="Schedules" subtitle={jobs ? `${shown.length} ${shown.length === 1 ? 'job' : 'jobs'}${narrowed ? ' match' : ''}` : 'Hermes cron'} actions={jobs && jobs.length > 0 ? <BuilderLinks /> : undefined} />
      <p className="help-text">
        Every <Term id="schedule">schedule</Term> of every profile, with its <Term id="job-types">type</Term>, when it runs next and how it last went. Hermes runs them; this list only reads them. New schedule makes one.
      </p>

      <SchedulerNotice status={scheduler} />
      {failed && (
        <div className="banner wb-repair" data-tone="danger" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>{jobs ? 'Hermes did not answer, so this list may be out of date' : 'Hermes’s scheduler did not answer, so there are no jobs to show'}</strong>
            <p>
              Caduceus reads the jobs from Hermes each time, and keeps no copy. Check <AppLink to="/observe/health">Health</AppLink> to see whether the Hermes backend is running. Caduceus tries again by itself.
            </p>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Try again
          </button>
        </div>
      )}
      {jobs === undefined && !failed && <p role="status">Loading the schedules…</p>}

      {jobs && jobs.length > 0 && (
        <div className="tlist__tools" role="search" aria-label="Filter schedules">
          <div className="chips-scroll" role="group" aria-label="Status">
            <button type="button" className="chip" aria-pressed={view.status === undefined} onClick={() => go({ ...view, status: undefined })}>
              All<span className="mono subtle">{total}</span>
            </button>
            {STATUS_ORDER.map((status) => (
              <button key={status} type="button" className="chip" aria-pressed={view.status === status} onClick={() => go({ ...view, status })}>
                {JOB_STATUSES[status]}
                <span className="mono subtle">{counts[status]}</span>
              </button>
            ))}
          </div>
          <div className="sched__menus">
            <label className="sr-only" htmlFor="sched-profile">
              Profile
            </label>
            <select id="sched-profile" className="input" value={view.profile ?? ''} onChange={(event) => go({ ...view, profile: event.target.value || undefined })}>
              <option value="">Every profile</option>
              {profiles.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="sched-type">
              Type
            </label>
            <select id="sched-type" className="input" value={view.type ?? ''} onChange={(event) => go({ ...view, type: (event.target.value || undefined) as JobType | undefined })}>
              <option value="">Every type</option>
              {(Object.keys(JOB_TYPES) as JobType[]).map((type) => (
                <option key={type} value={type}>
                  {JOB_TYPES[type].label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <p className="sr-only" role="status">
        {jobs ? `${shown.length} ${shown.length === 1 ? 'job' : 'jobs'}` : ''}
      </p>

      {jobs && jobs.length === 0 && !failed && (
        <div className="empty">
          <Icon name="calendar" />
          <h2>There are no schedules yet</h2>
          <p>A schedule is a job Hermes runs by itself on a timer: a morning briefing, a nightly check, a weekly task for the board.</p>
          <BuilderLinks />
        </div>
      )}
      {jobs && jobs.length > 0 && shown.length === 0 && (
        <div className="empty">
          <Icon name="filter" />
          <h2>No schedules match</h2>
          <p>Nothing here fits that filter. Clear it to see every schedule.</p>
          <button type="button" className="btn btn--primary" onClick={() => go({})}>
            Clear filter
          </button>
        </div>
      )}
      {shown.length > 0 && <JobTable jobs={shown} now={now} caption="Schedules, the next to run first" />}
    </div>
  );
}
