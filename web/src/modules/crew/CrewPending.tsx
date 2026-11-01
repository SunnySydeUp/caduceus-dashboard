import { Icon } from '../../icons.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { STILL_READING_WORDS } from '../../read-ladder.ts';
import { skeletonRows } from './crew-memory.ts';
import type { CrewRead } from './use-crew-read.ts';

const CREW_COULD_NOT_READ = 'Crew couldn’t be read';
const CREW_OFFLINE = 'You are offline. The crew loads when you are back online.';

/** What the crew's place says while there is no crew to draw: to a screen reader always, and on the page when the sidebar's list has the room. */
const PENDING_WORDS: Record<'loading' | 'slow' | 'offline', string> = { loading: 'Loading the crew…', slow: STILL_READING_WORDS, offline: CREW_OFFLINE };

/**
 * The crew's place before there is a crew to draw, on the read ladder (`read-ladder.ts`): while the first read is on its way, one skeleton row for each agent known from the
 * last load (with its name and sigil, which a name alone draws) or three nameless ones, with no words; once the wait is long, the same skeleton and "Still reading Hermes…";
 * only when the read failed (or passed the longer bound), what happened and a Retry. While the device is offline it is not waited for: the known rows stay, and the words say
 * the crew loads when the device is back online. The rail has 72 px to say it in, so there the words are for a screen reader only and the failed state is one Retry button.
 */
export function CrewPending({ read, variant }: { read: CrewRead; variant: 'list' | 'rail' }) {
  const rail = variant === 'rail';
  if (read.status === 'failed') {
    if (rail) {
      return (
        <div className="rail__crew rail__crew--failed">
          <span className="sr-only" role="status">
            {CREW_COULD_NOT_READ}
          </span>
          <button type="button" className="nav-item nav-item--button rail__item rail__retry" data-tag={`${CREW_COULD_NOT_READ}. Retry`} aria-label={`${CREW_COULD_NOT_READ}. Retry`} onClick={read.retry}>
            <span className="rail__icon">
              <Icon name="refresh" />
            </span>
            <span className="nav-label">Retry</span>
          </button>
        </div>
      );
    }
    return (
      <section className="crewlist" aria-labelledby="crewlist-title">
        <h2 className="nav-heading" id="crewlist-title">
          Crew
        </h2>
        <div className="crew-failed" role="status">
          <p>{CREW_COULD_NOT_READ}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={read.retry}>
            <Icon name="refresh" small />
            Retry
          </button>
        </div>
      </section>
    );
  }
  const status = read.status === 'slow' || read.status === 'offline' ? read.status : 'loading';
  // The words are a sibling of the list, never one of its items: a list holds only its rows.
  const skeleton = (
    <>
      <ul className={rail ? 'rail__crew' : 'crewlist__scroll'} aria-label="Crew" aria-busy={status !== 'offline'} data-stale={status === 'offline' ? '' : undefined}>
        {skeletonRows(read.known).map((name, index) => (
          <li key={name ?? index} className="crew__slot">
            {rail ? (
              <span className="nav-item rail__item rail__mate mate--pending" aria-hidden="true">
                {name ? <Sigil name={name} size="sm" /> : <span className="skel mate__skel-sigil" />}
                {name ? <span className="nav-label">{name}</span> : <span className="skel mate__skel-line" />}
              </span>
            ) : (
              <span className="mate mate--pending" aria-hidden="true">
                {name ? <Sigil name={name} size="md" /> : <span className="skel mate__skel-sigil" />}
                <span className="mate__text">
                  {name ? <span className="mate__name">{name}</span> : <span className="skel mate__skel-line" />}
                  <span className="skel mate__skel-line mate__skel-line--short" />
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        {PENDING_WORDS[status]}
      </span>
    </>
  );
  if (rail) return skeleton;
  return (
    <section className="crewlist" aria-labelledby="crewlist-title">
      <h2 className="nav-heading" id="crewlist-title">
        Crew {read.known.length > 0 && <span>{read.known.length}</span>}
      </h2>
      {status !== 'loading' && (
        <div className="crew-failed" aria-hidden="true">
          <p>{PENDING_WORDS[status]}</p>
        </div>
      )}
      {skeleton}
    </section>
  );
}
