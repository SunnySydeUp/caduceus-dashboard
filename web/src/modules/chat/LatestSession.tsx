// Talk with no session in the address (`/chat?profile=coder`, which the crew's rows and the phone bridge link to): the agent's newest conversation opens, or a new
// chat when it has none. The address is replaced, so Back does not return to this step. The list is Hermes's, read once for this.
import { useEffect, useState } from 'react';
import { plainFailureOf, type PlainFailure } from '../../failure-words.ts';
import { Icon } from '../../icons.tsx';
import { useOnline } from '../../shell/connection.ts';
import { FailureDetails } from '../../shell/FailureDetails.tsx';
import { needsConnection } from '../../shell/link-memory.ts';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { readHermes } from './read-hermes.ts';
import { listPath, parseSessions, readSessionsView } from './sessions-model.ts';
import { latestSession, TALK_SCOPE } from './talk-sessions.ts';

/** How many of the agent's newest sessions are read to find the newest conversation among them (a page of Hermes's list is at most 100). */
const LOOK_AT = 50;

export function LatestSession({ profile }: { profile: string }) {
  const navigate = useAppNavigate();
  const [failure, setFailure] = useState<PlainFailure>();
  const online = useOnline();
  const size = useSizeClass();
  useEffect(() => {
    setFailure(undefined);
    // Offline the list cannot be asked for: the page waits, and reads it when the device is back (the banner says why, once).
    if (!online) return;
    const abort = new AbortController();
    // Only the chats are read: the agent's automation runs would otherwise fill the page that is looked at, and Talk never opens on one.
    readHermes(listPath(readSessionsView({ tab: 'chats' }, TALK_SCOPE), { profile, offset: 0, limit: LOOK_AT }), abort.signal).then(
      (body) => {
        const latest = latestSession(parseSessions(body).items);
        void navigate(latest === undefined ? '/chat/new' : `/chat/${encodeURIComponent(latest.id)}`, { replace: true });
      },
      (error: unknown) => {
        if (!abort.signal.aborted) setFailure(plainFailureOf(error));
      },
    );
    return () => abort.abort();
    // The router's navigate changes with the address; opening the agent's newest conversation happens once for each agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, online]);
  // The list is a column from 600 px and a sheet on a phone, so only there is this pane the one place that can say the list could not be read.
  const listBesideIt = size !== 'compact';
  return (
    <section className="chat__conversation" aria-label="Conversation">
      <div className="talk__header">
        {/* While a conversation opens, the header is the real Talk header's shape (`TalkHeader`), in the same place: the crew row's sigil and name fly to it
            (`shell.css`, `desk-flight`) and the conversation's own header then takes its place without a jump. When none opens there is no conversation header. */}
        {failure !== undefined ? (
          <PageHeader title="Talk" />
        ) : (
          <PageHeader lead={<Sigil name={profile} size="md" />} title={profile} subtitle="Latest conversation" />
        )}
      </div>
      <div className="chat__none">
        {!online ? (
          <div className="empty" role="status">
            <h2>Waiting for a connection</h2>
            <p>{profile}’s latest conversation opens by itself when you are back online.</p>
            <button type="button" className="btn btn--primary" disabled aria-label={needsConnection('Start a new chat')}>
              <Icon name="plus" />
              Start a new chat
            </button>
          </div>
        ) : failure === undefined ? (
          <p className="subtle" role="status">
            Opening {profile}’s latest conversation…
          </p>
        ) : (
          <div className="empty">
            {listBesideIt ? (
              <>
                <h2>No conversation is open</h2>
                <p>Start a new chat with {profile}.</p>
              </>
            ) : (
              <>
                <h2>{failure.message}</h2>
                <p>{failure.next ?? `${profile}’s sessions could not be read.`}</p>
                <FailureDetails detail={failure.detail} />
              </>
            )}
            <AppLink className="btn btn--primary" to="/chat/new">
              <Icon name="plus" />
              Start a new chat
            </AppLink>
          </div>
        )}
      </div>
    </section>
  );
}
