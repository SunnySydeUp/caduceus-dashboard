// The start of a new chat, before its first message: the agent it is with, and the rest of the crew, each one tap from a new chat with them instead. A
// conversation never moves between profiles, so the choice is offered only while the chat has no session; once the first message is on its way it is gone.
import { AppLink } from '../../shell/navigation.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { useCrew } from '../crew/use-crew.ts';

export function NewChatStart({ profile }: { profile: string }) {
  const others = useCrew().filter((row) => row.profile !== profile);
  return (
    <div className="chat__start">
      <Sigil name={profile} size="lg" />
      <h2 className="chat__start-title">New chat with {profile}</h2>
      {others.length > 0 && (
        <div className="chat__start-others" role="group" aria-labelledby="chat-start-others">
          <p className="subtle" id="chat-start-others">
            Someone else?
          </p>
          <ul>
            {others.map((row) => (
              <li key={row.profile}>
                <AppLink className="chip chip--profile" to={`/chat/new?profile=${encodeURIComponent(row.profile)}`} aria-label={`New chat with ${row.profile}`}>
                  <Sigil name={row.profile} size="xs" />
                  {row.profile}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
