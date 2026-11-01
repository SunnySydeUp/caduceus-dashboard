// The crew as the shell shows it, kept current: who the profiles are (Hermes's list, through the profile scope) and what each is doing (the Inbox's stream:
// approvals and questions, the runs under way; and what is ready for review). `deriveCrew` reads them; nothing here is stored.
import { useEffect, useMemo } from 'react';
import { isReading } from '../../read-ladder.ts';
import { settled } from '../../settled.ts';
import { useReadLadder } from '../../use-read-ladder.ts';
import { useSettled } from '../../use-settled.ts';
import { loadChatBehaviour, useChatBehaviour } from '../chat/chat-behaviour.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { useReadyAnswer, useReadyItems } from '../today/ready-feed.ts';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { deriveCrew, type CrewMember } from './crew-state.ts';
import { knowledge } from './knowledge.ts';

export function useCrew(): CrewMember[] {
  const { hermes } = useProfileScope();
  const { items, running, status, hermesUp } = useInbox();
  const ready = useReadyItems();
  const answer = useReadyAnswer();
  // The device's choice to hide the Finished ring and tick (Settings › Chat): `sigil.css` reads it from <html>, so every sigil follows it. The state itself stays.
  const { finishedMarks } = useChatBehaviour().device;
  useEffect(() => void settled.then(() => loadChatBehaviour()), []);
  useEffect(() => void document.documentElement.toggleAttribute('data-finished-marks-hidden', !finishedMarks), [finishedMarks]);
  // An agent with nothing to show is idle only once what the crew is made of has answered (`knowledge.ts`): while a read is on its way it is being read, climbing the one read ladder
  // (the ready list is first asked once the first screen has settled, so the wait starts then), and when a read failed or the ladder gave up it cannot be checked.
  const waiting = status === 'connecting' || answer === 'waiting';
  const asked = useSettled();
  const stage = useReadLadder(isReading({ status: waiting ? 'loading' : 'ready', asked }), false);
  const known = knowledge({ feed: status, hermesUp, ready: answer, stage });
  return useMemo(() => deriveCrew({ profiles: hermes?.profiles.map((profile) => profile.name) ?? [], items, running, ready, knowledge: known }), [hermes, items, running, ready, known]);
}
