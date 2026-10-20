// Work's landing view (M8 #07): everything with a lifecycle in one place, by state: Waiting on you, Running, Ready for review, Scheduled, with a row of
// agents to narrow it. Board, Tasks, Playbooks, Schedules and Projects are the chips above (the shell's Work sub-navigation). The grouping is `work-desk-model.ts`.
import { useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { toast } from '../../shell/toasts.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { useNow } from './JobParts.tsx';
import { pauseJob, resumeJob } from './schedules-actions.ts';
import { useJobs } from './schedules-data.ts';
import type { Job } from './schedules-model.ts';
import { groupWork, whenInWords, WORK_GROUP_META, WORK_GROUPS, type WorkAction, type WorkGroupId, type WorkRow } from './work-desk-model.ts';
import { useAllBoards } from './work-desk-data.ts';
import { useReadyForReview } from './work-review.ts';
import './work.css';
import './work-desk.css';

/** Which sigil mark a group's rows carry: finished work shows it, a schedule that has not started rests, and the others show their state in words. */
const SIGIL_STATE: Record<WorkGroupId, 'done' | 'idle' | undefined> = { waiting: undefined, running: undefined, review: 'done', scheduled: 'idle' };

const ACTION_LABEL: Record<Exclude<WorkAction, 'pause' | 'resume'>, string> = { decide: 'Decide', open: 'Open', review: 'Review' };

function RowAction({ row, busy, onToggle, onOpen }: { row: WorkRow; busy: boolean; onToggle(job: Job): void; onOpen(): void }) {
  if (row.action === 'pause' || row.action === 'resume') {
    const verb = row.action === 'pause' ? 'Pause' : 'Resume';
    return (
      <button type="button" className="btn btn--secondary btn--sm btn--icon" aria-label={`${verb} ${row.title}`} disabled={busy} onClick={() => row.job && onToggle(row.job)}>
        <Icon name={row.action === 'pause' ? 'paused' : 'play'} />
      </button>
    );
  }
  return (
    <AppLink className={`btn btn--sm ${row.action === 'decide' ? 'btn--primary' : 'btn--secondary'}`} to={row.to} aria-label={`${ACTION_LABEL[row.action]} ${row.title}`} onClick={onOpen}>
      {ACTION_LABEL[row.action]}
    </AppLink>
  );
}

function Row({ row, now, busy, onToggle, onOpen }: { row: WorkRow; now: number; busy: boolean; onToggle(job: Job): void; onOpen(): void }) {
  const when = whenInWords(row.when, now);
  return (
    <li className="wd-row" data-source={row.source}>
      {row.profile === undefined ? <UnassignedSigil size="sm" /> : <Sigil name={row.profile} size="sm" state={SIGIL_STATE[row.group]} />}
      <span className="wd-main">
        <AppLink className="wd-title" to={row.to} onClick={onOpen}>
          {row.title}
        </AppLink>
        <small className="wd-line">
          {row.line}
          {when && <span className="wd-when-inline"> · {when}</span>}
        </small>
      </span>
      <span className="wd-when">{when}</span>
      <RowAction row={row} busy={busy} onToggle={onToggle} onOpen={onOpen} />
    </li>
  );
}

export function WorkDesk() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const agent = typeof search.agent === 'string' && search.agent.trim() !== '' ? search.agent : undefined;
  const navigate = useAppNavigate();
  const now = useNow();
  const { hermes } = useProfileScope();
  const boards = useAllBoards();
  const { jobs, failed: jobsFailed, reload } = useJobs();
  const inbox = useInbox();
  const review = useReadyForReview(boards.boards);
  const [busy, setBusy] = useState<string>();

  const loaded = !boards.loading && (jobs !== undefined || jobsFailed) && review.asked;
  const { groups, agents } = useMemo(
    () => groupWork({ boards: boards.boards, runs: inbox.running, ready: review.ready, jobs: jobs ?? [] }, agent),
    [boards.boards, inbox.running, review.ready, jobs, agent],
  );
  // Everyone Hermes lists is a chip, whether or not they have work, and so is whoever has a row (or is in the address) that Hermes does not list.
  const chips = useMemo(() => [...new Set([...(hermes?.profiles.map((profile) => profile.name) ?? []), ...agents, ...(agent ? [agent] : [])])], [hermes, agents, agent]);
  const shown = WORK_GROUPS.filter((id) => groups[id].length > 0);
  const waiting = groups.waiting.length;

  const filterTo = (next: string | undefined) => void navigate(next === undefined ? '/work' : `/work?agent=${encodeURIComponent(next)}`, { replace: true });

  const toggle = async (job: Job) => {
    const resuming = !job.enabled;
    setBusy(`job:${job.profile}/${job.id}`);
    try {
      const outcome = await (resuming ? resumeJob(job) : pauseJob(job));
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      await reload();
      toast(resuming ? `Resumed “${job.name}”` : `Paused “${job.name}”`, { tone: 'info' });
    } finally {
      setBusy(undefined);
    }
  };

  const unreachable = boards.failed || jobsFailed || review.failed;
  const summary = loaded ? `${waiting} waiting on you · ${groups.running.length} running · ${groups.review.length} ready for review · ${groups.scheduled.length} scheduled` : 'Reading Hermes';

  return (
    <div className="bpage wd">
      <PageHeader
        title="Work"
        subtitle={summary}
        actions={
          <AppLink className="btn btn--primary" to="/work/tasks/new">
            <Icon name="plus" />
            New task
          </AppLink>
        }
      />

      {unreachable && (
        <div className="banner wb-repair" data-tone="danger" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>{loaded ? 'Hermes did not answer in full, so this list may be out of date or missing rows' : 'Hermes did not answer, so there is nothing to show yet'}</strong>
            <p>
              Caduceus reads the tasks and the schedules from Hermes each time and keeps no copy. Check <AppLink to="/observe/health">Health</AppLink> to see whether the Hermes backend is running. Caduceus tries again by itself.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              boards.retry();
              void reload();
              void review.reload();
            }}
          >
            <Icon name="refresh" />
            Try again
          </button>
        </div>
      )}

      <div className="wd-filters" role="group" aria-label="Filter by agent">
        <button type="button" className="chip" aria-pressed={agent === undefined} onClick={() => filterTo(undefined)}>
          All agents
        </button>
        {chips.map((name) => (
          <button key={name} type="button" className="chip chip--profile" aria-pressed={agent === name} onClick={() => filterTo(name)}>
            <Sigil name={name} size="xs" />
            {name}
          </button>
        ))}
      </div>

      <p className="sr-only" role="status">
        {loaded ? summary : ''}
      </p>
      {!loaded && !unreachable && <p role="status">Reading what is going on…</p>}

      {loaded && shown.length === 0 && (
        <div className="empty">
          <Icon name={agent ? 'filter' : 'work'} />
          <h2>{agent ? `${agent} has nothing here` : 'Nothing is going on'}</h2>
          <p>{agent ? 'No task, run or schedule of this agent is in flight. Show every agent to see the rest.' : 'No task, run or schedule has a lifecycle to follow. Start a task, or schedule one.'}</p>
          {agent ? (
            <button type="button" className="btn btn--primary" onClick={() => filterTo(undefined)}>
              Show all agents
            </button>
          ) : (
            <div className="row">
              <AppLink className="btn btn--primary" to="/work/tasks/new">
                <Icon name="plus" />
                New task
              </AppLink>
              <AppLink className="btn btn--secondary" to="/work/schedules/new">
                <Icon name="calendar" />
                New schedule
              </AppLink>
            </div>
          )}
        </div>
      )}

      {loaded &&
        shown.map((id) => (
          <section key={id} className="wd-group" aria-labelledby={`wd-${id}`}>
            <h2 className="wd-label" id={`wd-${id}`}>
              {WORK_GROUP_META[id].label}
              <span className={id === 'waiting' ? 'count' : 'wd-n'}>{groups[id].length}</span>
            </h2>
            <ul className="wd-list">
              {groups[id].map((row) => (
                <Row key={row.key} row={row} now={now} busy={busy === row.key} onToggle={(job) => void toggle(job)} onOpen={() => row.opened && void review.opened(row.opened)} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
