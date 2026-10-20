// Work › Schedules › Blueprints: every Automation Blueprint Hermes lists, with search. Choosing one opens the builder with it filled in.
import { useMemo } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { useBuilderData } from './builder-data.ts';
import { searchBlueprints } from './job-form.ts';
import './work.css';

export function Blueprints() {
  const data = useBuilderData();
  const navigate = useAppNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const query = typeof search.q === 'string' ? search.q : '';
  const shown = useMemo(() => searchBlueprints(data.blueprints, query), [data.blueprints, query]);
  const use = (key: string) => `/work/schedules/new?blueprint=${encodeURIComponent(key)}`;

  return (
    <div className="bpage sched bp">
      <PageHeader
        overline="Work › Schedules"
        title="Blueprints"
        subtitle={data.status === 'ready' ? `${shown.length} of ${data.blueprints.length} ${data.blueprints.length === 1 ? 'blueprint' : 'blueprints'}` : 'Hermes’s ready-made automations'}
        actions={
          <AppLink className="btn btn--secondary" to="/work/schedules">
            <Icon name="calendar" />
            All schedules
          </AppLink>
        }
      />
      <p className="help-text">
        A <Term id="blueprint">blueprint</Term> is one of Hermes’s ready-made automations: it knows what to ask and when, and needs only a few inputs from you. Choose one to fill in the schedule builder.
      </p>
      {data.status === 'loading' && <p role="status">Loading Hermes’s blueprints…</p>}
      {data.status === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so there are no blueprints to show.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={data.reload}>
            Try again
          </button>
        </div>
      )}
      {data.status === 'ready' && (
        <div className="input-wrap" role="search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="bp-search">
            Search blueprints
          </label>
          <input id="bp-search" className="input" type="search" value={query} placeholder="Search by name, topic or kind" autoComplete="off" onChange={(event) => void navigate(`/work/schedules/blueprints${event.target.value ? `?q=${encodeURIComponent(event.target.value)}` : ''}`, { replace: true })} />
        </div>
      )}
      <p className="sr-only" role="status">
        {data.status === 'ready' ? `${shown.length} ${shown.length === 1 ? 'blueprint' : 'blueprints'}` : ''}
      </p>
      {data.status === 'ready' && shown.length === 0 && (
        <div className="empty">
          <Icon name="search" />
          <h2>No blueprint matches</h2>
          <p>Nothing Hermes lists fits “{query}”. Try a shorter word, or clear the search.</p>
          <AppLink className="btn btn--primary" to="/work/schedules/blueprints">
            Clear search
          </AppLink>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="bp__grid">
          {shown.map((blueprint) => (
            <li key={blueprint.key} className="bp__card">
              <div className="row">
                <h2 className="bp__title">{blueprint.title}</h2>
                {blueprint.category && <span className="tag">{blueprint.category}</span>}
              </div>
              <p className="bp__desc">{blueprint.description}</p>
              <p className="bp__when subtle">
                <Icon name="clock" small /> {blueprint.scheduleHuman || 'On a schedule'}
              </p>
              <AppLink className="btn btn--secondary" to={use(blueprint.key)}>
                Use this blueprint
                <span className="sr-only">: {blueprint.title}</span>
                <Icon name="arrow-r" />
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
