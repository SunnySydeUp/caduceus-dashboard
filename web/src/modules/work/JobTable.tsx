// The job list: a table on a wide container and the same rows restacked as cards on a narrow one (the stylesheet decides which, by the
// container's width). A person has tens of jobs, not thousands, so every row is drawn.
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { jobHref, LastResult, NextRun, TypeBadge } from './JobParts.tsx';
import type { Job } from './schedules-model.ts';

export function JobTable({ jobs, now, caption }: { jobs: readonly Job[]; now: number; caption: string }) {
  const navigate = useAppNavigate();
  return (
    <table className="jt">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="jt__main">
            Schedule
          </th>
          <th scope="col" className="jt__type">
            Type
          </th>
          <th scope="col" className="jt__profile">
            Profile
          </th>
          <th scope="col" className="jt__when">
            Runs
          </th>
          <th scope="col" className="jt__next">
            Next run
          </th>
          <th scope="col" className="jt__last">
            Last result
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={`${job.profile}/${job.id}`} className={`jt__row${job.lastStatus === 'error' ? ' is-failed' : ''}${job.enabled ? '' : ' is-off'}`} onClick={(event) => !(event.target as HTMLElement).closest('a, button') && void navigate(jobHref(job))}>
            <td className="jt__main">
              <AppLink className="jt__link" to={jobHref(job)} title={job.name}>
                {job.name}
              </AppLink>
              <div className="jt__sub mono">{job.id}</div>
            </td>
            <td className="jt__type">
              <TypeBadge type={job.type} />
            </td>
            <td className="jt__profile">
              <span className="ptag">
                <Sigil name={job.profile} size="xs" />
                <span className="ptag__name">{job.profile}</span>
              </span>
            </td>
            <td className="jt__when">
              <span title={job.scheduleExpression || undefined}>{job.schedule}</span>
            </td>
            <td className="jt__next">
              <NextRun job={job} now={now} />
            </td>
            <td className="jt__last">
              <LastResult job={job} now={now} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
