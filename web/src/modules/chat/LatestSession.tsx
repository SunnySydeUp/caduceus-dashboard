// Talk with no session in the address (`/chat?profile=coder`, which the crew's rows and the phone bridge link to): the agent's newest conversation opens, or a new
// chat when it has none. The address is replaced, so Back does not return to this step. The list is Hermes's, read once for this.
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { readHermes } from './read-hermes.ts';
import { listPath, parseSessions, readSessionsView } from './sessions-model.ts';
import { latestSession, TALK_SCOPE } from './talk-sessions.ts';

/** How many of the agent's newest sessions are read to find the newest conversation among them (a page of Hermes's list is at most 100). */
const LOOK_AT = 50;

export function LatestSession({ profile }: { profile: string }) {
  const navigate = useAppNavigate();
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
    setFailure(undefined);
    readHermes(listPath(readSessionsView({}, TALK_SCOPE), { profile, offset: 0, limit: LOOK_AT }), abort.signal).then(
      (body) => {
        const latest = latestSession(parseSessions(body).items);
        void navigate(latest === undefined ? '/chat/new' : `/chat/${encodeURIComponent(latest.id)}`, { replace: true });
      },
      (error: unknown) => {
        if (!abort.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => abort.abort();
    // The router's navigate changes with the address; opening the agent's newest conversation happens once for each agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  return (
    <section className="chat__conversation chat__none" aria-label="Conversation">
      {failure === undefined ? (
        <p className="subtle" role="status">
          Opening {profile}’s latest conversation…
        </p>
      ) : (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="alert" />
          </span>
          <h3>Hermes did not give {profile}’s sessions</h3>
          <p>{failure}</p>
          <AppLink className="btn btn--primary" to="/chat/new">
            <Icon name="plus" />
            Start a new chat
          </AppLink>
        </div>
      )}
    </section>
  );
}
