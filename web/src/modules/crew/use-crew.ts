// The crew as the shell shows it, kept current: who the profiles are (Hermes's list, through the profile scope) and what each is doing (the Inbox's stream:
// approvals and questions, the runs under way, the runs finished and not yet opened). `deriveCrew` reads them; nothing here is stored.
import { useMemo } from 'react';
import { useInbox } from '../inbox/inbox-feed.ts';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { deriveCrew, type CrewMember } from './crew-state.ts';

export function useCrew(): CrewMember[] {
  const { hermes } = useProfileScope();
  const { items, running, activity, unseen } = useInbox();
  return useMemo(() => deriveCrew({ profiles: hermes?.profiles.map((profile) => profile.name) ?? [], items, running, activity, unseen }), [hermes, items, running, activity, unseen]);
}
