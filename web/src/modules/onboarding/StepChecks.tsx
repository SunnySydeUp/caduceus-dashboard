import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import type { SetupView } from './setup-data.ts';

/** Step 1: what Hermes says of itself and what Caduceus knows of this device, each as pass or fail with the link that fixes it. */
export function StepChecks({ setup }: { setup: SetupView }) {
  const { checks, checking, recheck } = setup;
  const failing = checks?.filter((check) => check.state === 'fail') ?? [];
  const required = failing.filter((check) => check.need === 'required').length;
  return (
    <div className="stack">
      <p>
        Caduceus asks <Term id="hermes">Hermes</Term> whether it can run and which <Term id="provider-check">provider</Term> it would use, and looks at this device. Nothing here is changed. Every check says how to fix it, and none of them stops you going on.
      </p>
      <p className="ob-summary" role="status">
        {checks === undefined
          ? 'Checking…'
          : failing.length === 0
            ? 'Everything passes.'
            : `${failing.length} of ${checks.length} ${failing.length === 1 ? 'check fails' : 'checks fail'}${required > 0 ? `, ${required === 1 ? 'one that Caduceus needs' : `${required} that Caduceus needs`}` : ', all of them advice'}.`}
      </p>
      {checks && (
        <ul className="ob-checks panel" aria-label="Checks">
          {checks.map((check) => (
            <li key={check.id} className="ob-check" data-state={check.state}>
              <div className="ob-check__head">
                <span className="ob-check__label">{check.label}</span>
                <StatusBadge state={check.state === 'pass' ? 'succeeded' : 'failed'} label={check.state === 'pass' ? 'Pass' : 'Fail'} variant="plain" />
                {check.state === 'fail' && check.need === 'recommended' && <span className="tag">Advice</span>}
              </div>
              <p className="ob-check__detail">{check.detail}</p>
              {check.fix && (
                <AppLink className="btn btn--secondary btn--sm ob-check__fix" to={check.fix.to}>
                  {check.fix.label}
                  <Icon name="arrow-r" small />
                </AppLink>
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" className="btn btn--secondary" disabled={checking} aria-busy={checking} onClick={() => void recheck()}>
          <Icon name="refresh" />
          Check again
        </button>
      </div>
    </div>
  );
}
