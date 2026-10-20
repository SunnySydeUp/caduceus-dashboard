// The one line a run of the agent's cards folds into in the thread (M8 #09): "3 commands ran, 1 failed". Pure: it counts what the cards already say. The cards
// themselves are `ActivityCards.tsx`'s, and open from this line.
import { SUBAGENT_FINAL, type ActivityItem, type SubagentState } from './activity.ts';

export interface ActivitySummary {
  text: string;
  /** `running` while any call or helper is still going; else `failed` if one failed; else `done`. */
  tone: 'running' | 'failed' | 'done';
  /** The tool calls and helpers counted; reasoning is not a step. */
  count: number;
  failed: number;
  running: number;
}

const SUBAGENT_FAILED: readonly SubagentState[] = SUBAGENT_FINAL.filter((state) => state !== 'completed');
const SUBAGENT_RUNNING: readonly SubagentState[] = ['queued', 'running'];

const plural = (count: number, [one, many]: readonly [string, string]): string => `${count} ${count === 1 ? one : many}`;

/** What a run of cards is called when it is shown as one line; `undefined` when it shows no card at all (an empty reasoning card is not one). */
export function summaryOf(items: readonly ActivityItem[]): ActivitySummary | undefined {
  const steps = items.filter((item) => item.kind !== 'reasoning');
  const thoughts = items.filter((item) => item.kind === 'reasoning' && item.text !== '');
  if (steps.length === 0) {
    if (thoughts.length === 0) return undefined;
    const thinking = thoughts.some((item) => item.kind === 'reasoning' && item.streaming);
    return { text: thinking ? 'Thinking…' : 'Reasoned', tone: thinking ? 'running' : 'done', count: 0, failed: 0, running: 0 };
  }
  let failed = 0;
  let running = 0;
  let noResult = 0;
  for (const step of steps) {
    if (step.kind === 'tool') {
      if (step.status === 'failed') failed++;
      else if (step.status === 'running' || step.status === 'generating') running++;
      else if (step.status === 'incomplete') noResult++;
    } else if (SUBAGENT_FAILED.includes(step.status)) failed++;
    else if (SUBAGENT_RUNNING.includes(step.status)) running++;
  }
  const noun = steps.every((step) => step.kind === 'tool' && step.name === 'terminal') ? (['command', 'commands'] as const) : steps.every((step) => step.kind === 'subagent') ? (['helper', 'helpers'] as const) : (['step', 'steps'] as const);
  const counted = plural(steps.length, noun);
  const parts = [running > 0 ? counted : `${counted} ran`, ...(failed > 0 ? [`${failed} failed`] : []), ...(running > 0 ? [`${running} running`] : []), ...(noResult > 0 ? [`${noResult} had no result`] : [])];
  return { text: parts.join(', '), tone: running > 0 ? 'running' : failed > 0 ? 'failed' : 'done', count: steps.length, failed, running };
}
