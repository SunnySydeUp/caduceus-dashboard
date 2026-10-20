// Calls back once with each reply that finishes in front of the owner (M7 #07): what auto-read speaks. `finishedReply` decides what counts.
import { useEffect, useRef } from 'react';
import { finishedReply, type ReplyView } from './replies.ts';

const WORKING: ReplyView = { running: true, turn: undefined, error: undefined, messages: [] };

export function useFinishedReply(state: ReplyView, onReply: (reply: ReplyView['messages'][number]) => void): void {
  const watching = useRef(false);
  const latest = useRef(onReply);
  latest.current = onReply;
  useEffect(() => {
    if (state.running || state.turn !== undefined) {
      watching.current = true;
      return;
    }
    if (!watching.current) return;
    const reply = finishedReply(WORKING, state);
    if (reply) {
      watching.current = false;
      latest.current(reply);
    } else if (state.error !== undefined || state.messages.at(-1)?.role === 'assistant') {
      watching.current = false;
    }
  }, [state]);
}
