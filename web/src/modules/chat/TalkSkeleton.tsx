import { Loading } from '../../shell/Loading.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';

/**
 * What Talk shows until it knows whose thread to open (the first read of the profiles is on its way): the shape of the real Talk header and thread, named Talk, so the page
 * is never a generic "Chat / Loading…". The sigil is a block, since no agent is known yet. It climbs the same read ladder as Today's blocks (`Loading`): a skeleton, "Still reading Hermes…", and "Couldn't be read" with a Retry that asks Hermes for its agents again
 * only once the read has failed or passed the longer bound.
 */
export function TalkSkeleton() {
  const { reload, unavailable } = useProfileScope();
  return (
    <div className="chat">
      <section className="chat__conversation" aria-label="Talk">
        <div className="talk__header">
          <PageHeader lead={<span className="skel talk__skel-sigil" aria-hidden="true" />} title="Talk" />
        </div>
        <Loading label="Opening Talk…" lines={4} failed={unavailable} onRetry={reload} />
      </section>
    </div>
  );
}
