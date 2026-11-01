// The crew as the shell shows it, kept current: who the profiles are (Hermes's list, through the profile scope) and what each is doing (the Inbox's stream:
// approvals and questions, the runs under way; and what is ready for review). `deriveCrew` reads them; nothing here is stored.
import { useEffect, useMemo } from 'react';
import { settled } from '../../settled.ts';
import { loadChatBehaviour, useChatBehaviour } from '../chat/chat-behaviour.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { useReadyFailed, useReadyItems } from '../today/ready-feed.ts';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { deriveCrew, type CrewMember } from './crew-state.ts';

export function useCrew(): CrewMember[] {
  const { hermes } = useProfileScope();
  const { items, running, status, hermesUp } = useInbox();
  const ready = useReadyItems();
  const readyFailed = useReadyFailed();
  // The device's choice to hide the Finished ring and tick (Settings › Chat): `sigil.css` reads it from <html>, so every sigil follows it. The state itself stays.
  const { finishedMarks } = useChatBehaviour().device;
  useEffect(() => void settled.then(() => loadChatBehaviour()), []);
  useEffect(() => void document.documentElement.toggleAttribute('data-finished-marks-hidden', !finishedMarks), [finishedMarks]);
  // What the crew is made of could not be read (Caduceus lost the Inbox's stream or cannot reach Hermes, or the ready list failed): an agent with nothing to show is not known to be idle.
  const unread = status === 'offline' || !hermesUp || readyFailed;
  return useMemo(() => deriveCrew({ profiles: hermes?.profiles.map((profile) => profile.name) ?? [], items, running, ready, unread }), [hermes, items, running, ready, unread]);
}
