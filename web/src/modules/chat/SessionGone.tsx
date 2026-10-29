// A conversation Hermes does not have in the tab's profile (talk audit #3, #4; today-shell #23). Before it says the conversation is gone, it asks the other profiles:
// a link without `?profile=` (or an old bookmark) names a session of another agent. Found: the address is replaced with the right profile and the chat opens
// under it, so the header names the agent the session belongs to from the start. Not found: a plain note and the two ways on.
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { readHermes } from './read-hermes.ts';
import { findSessionHome, type SessionHome } from './session-home.ts';

export function SessionGone({ profile, storedId }: { profile: string; storedId: string }) {
  const navigate = useAppNavigate();
  const { hermes, unavailable } = useProfileScope();
  const [home, setHome] = useState<SessionHome>();
  const [asked, setAsked] = useState(0);
  const profiles = hermes?.profiles.map((entry) => entry.name);
  const known = profiles !== undefined;
  useEffect(() => {
    if (!known && !unavailable) return;
    let current = true;
    setHome(undefined);
    findSessionHome(readHermes, { storedId, tried: profile, profiles: profiles ?? [] }).then((found) => {
      if (!current) return;
      // The address is replaced: Back must not return to the address that had the wrong profile.
      if (found.kind === 'found') void navigate(`/chat/${encodeURIComponent(storedId)}?profile=${encodeURIComponent(found.profile)}`, { replace: true });
      else setHome(found);
    });
    return () => {
      current = false;
    };
    // The list of profiles is read once Hermes has answered; the lookup runs for each session, profile and retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedId, profile, known, unavailable, asked]);
  if (home === undefined) {
    return (
      <section className="chat__conversation chat__none" aria-label="Conversation">
        <p className="subtle" role="status">
          Looking for this conversation…
        </p>
      </section>
    );
  }
  return (
    <section className="chat__conversation chat__none" aria-label="Conversation">
      <div className="empty">
        <span className="empty__icon">
          <Icon name="alert" />
        </span>
        <h3>That conversation no longer exists.</h3>
        <p>{home.kind === 'unknown' ? 'It is not in this profile, and Hermes did not answer for every other profile, so it may still be in one of them.' : 'It may have been deleted, or the link may be for another Hermes.'}</p>
        <div className="empty__actions">
          <button type="button" className="btn btn--primary" onClick={() => void navigate(`/chat?profile=${encodeURIComponent(profile)}`, { replace: true })}>
            Open the latest chat
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void navigate('/chat/new', { replace: true })}>
            <Icon name="plus" />
            New chat
          </button>
          {home.kind === 'unknown' && (
            <button type="button" className="btn btn--ghost" onClick={() => setAsked((count) => count + 1)}>
              Try again
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
