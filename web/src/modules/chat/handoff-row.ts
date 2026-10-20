// A handoff in the thread (M8 #04): one agent asking another. Hermes has no call from one profile to another; what it does send is a delegation, a child agent the
// agent gave a goal (`subagent.*` events and a stored `delegate_task` call). That is what the row says: the goal, and what the child answered or how it ended.
// Nothing here is made up for a field Hermes did not send. Pure.
import type { SubagentActivity } from './activity.ts';

export interface Handoff {
  asked: string;
  goal: string;
  state: 'working' | 'answered' | 'stopped';
  /** The helper's reply row; none while it is working. `text` is empty when it finished and said nothing. */
  answer: { label: string; text: string } | undefined;
}

const ENDED: Partial<Record<SubagentActivity['status'], { state: Handoff['state']; label: string }>> = {
  completed: { state: 'answered', label: 'The helper answered' },
  failed: { state: 'stopped', label: 'The helper failed' },
  error: { state: 'stopped', label: 'The helper failed' },
  timeout: { state: 'stopped', label: 'The helper timed out' },
  interrupted: { state: 'stopped', label: 'The helper was stopped' },
};

export function handoffOf(child: SubagentActivity): Handoff {
  const asked = 'Asked a helper agent';
  const ended = ENDED[child.status];
  if (ended === undefined) return { asked, goal: child.goal, state: 'working', answer: undefined };
  return { asked, goal: child.goal, state: ended.state, answer: { label: ended.label, text: child.summary ?? child.note ?? '' } };
}
