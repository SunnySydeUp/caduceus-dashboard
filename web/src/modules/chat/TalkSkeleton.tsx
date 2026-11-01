import { Loading } from '../../shell/Loading.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';

/**
 * What Talk shows until it knows whose thread to open (the first read of the profiles is on its way): the shape of the real Talk header and thread, named Talk, so the page
 * is never a generic "Chat / Loading…". The sigil is a block, since no agent is known yet. When the wait goes on, it says so with a Retry that asks Hermes for its agents again,
 * as Today's blocks do.
 */
export function TalkSkeleton() {
  const { reload } = useProfileScope();
  return (
    <div className="chat">
      <section className="chat__conversation" aria-label="Talk">
        <div className="talk__header">
          <PageHeader lead={<span className="skel talk__skel-sigil" aria-hidden="true" />} title="Talk" />
        </div>
        <Loading label="Opening Talk…" lines={4} onRetry={reload} />
      </section>
    </div>
  );
}
