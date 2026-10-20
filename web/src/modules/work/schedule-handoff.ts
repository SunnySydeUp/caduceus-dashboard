// What the composer's Repeat gives the schedule builder to start from: the message, and the agent it was written to. Held in memory only (a message can hold anything the
// owner typed: it belongs in no address and in no storage) and taken once, by the builder that opens next. Nothing is created until the owner confirms the schedule there.
import { newDraft, type JobDraft } from './job-form.ts';

export interface ScheduleOffer {
  /** The message: it becomes the job's prompt. */
  text: string;
  /** The agent profile the chat talks to: it becomes the job's profile. */
  profile: string;
}

let pending: ScheduleOffer | undefined;

/** Leaves a message for the next new-schedule builder to start from. A later offer replaces an earlier one that no builder took. */
export function offerSchedule(offer: ScheduleOffer): void {
  pending = offer;
}

/** Takes the offer waiting for the builder, once; `undefined` when there is none. */
export function takeSchedule(): ScheduleOffer | undefined {
  const taken = pending;
  pending = undefined;
  return taken;
}

const NAME_MAX = 60;

/** The name a job made from a message starts with: its first line with words in it, cut with an ellipsis when long. */
function nameOf(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')?.replace(/\s+/g, ' ').trim() ?? '';
  return line.length <= NAME_MAX ? line : `${line.slice(0, NAME_MAX - 1).trimEnd()}…`;
}

/** The builder's starting draft for an offer: an agent job that asks the agent the message. A profile Hermes no longer lists is kept, so the form says so rather than choosing another. */
export function scheduleDraftFrom(offer: ScheduleOffer): JobDraft {
  return { ...newDraft('agent', offer.profile), name: nameOf(offer.text), prompt: offer.text };
}
