// The composer's three intents (M8 #06), free of the DOM and of React. The intent belongs to one message: Ask talks to the agent here (as the composer always has),
// Delegate starts the message as one of Hermes's background runs, and Repeat opens the schedule builder with the message in it. What each does with a draft,
// the hint that says so, and when the intent goes back to Ask are decided here; the composer only carries them out.
import { looksLikeSlashCommand } from '@caduceus/contracts/hermes/shared/slash';

export const INTENTS = ['ask', 'delegate', 'repeat'] as const;
export type Intent = (typeof INTENTS)[number];

/** What the control calls each intent, and what the send button says while it is chosen. */
export const INTENT_META: Record<Intent, { label: string; action: string }> = {
  ask: { label: 'Ask', action: 'Send' },
  delegate: { label: 'Delegate', action: 'Delegate' },
  repeat: { label: 'Repeat', action: 'Choose when' },
};

/** The one line under the composer that says what the chosen intent does. `agent` is the profile the chat talks to. */
export function intentHint(intent: Intent, agent: string): string {
  switch (intent) {
    case 'ask':
      return `${agent} answers here, and you can follow along.`;
    case 'delegate':
      return 'Runs in the background. You are told only when it needs you or finishes.';
    case 'repeat':
      return 'Pick when it should run again. It shows up under Work. Your words stay in this box.';
  }
}

/** The words of the chip above the field while an intent other than Ask is chosen; Ask has no chip. */
export function intentChip(intent: Intent): string | undefined {
  switch (intent) {
    case 'ask':
      return undefined;
    case 'delegate':
      return `${INTENT_META.delegate.label}: runs in the background`;
    case 'repeat':
      return `${INTENT_META.repeat.label}: you pick when, your words stay here`;
  }
}

/** What the composer does with the draft under an intent. */
export type DraftPlan =
  /** Nothing to send. */
  | { kind: 'nothing' }
  /** Send it the way the composer always has: message, command, attachments, steer or queue. */
  | { kind: 'ask' }
  /** Start `text` as a Hermes background run. */
  | { kind: 'delegate'; text: string }
  /** Open the schedule builder with `text` as the prompt. */
  | { kind: 'repeat'; text: string }
  /** The intent cannot take this draft; `message` says why and what to do. The draft stays as it is. */
  | { kind: 'refuse'; reason: 'command' | 'attachments'; message: string };

/**
 * What the intent does with the draft. Ask takes whatever the composer takes. Delegate and Repeat carry the words of a message and nothing else: a slash command is
 * Hermes's to run in this chat, and a background run or a schedule has nowhere to put attachments, so those are refused with the way out rather than changed quietly.
 */
export function planDraft({ intent, text, attachments }: { intent: Intent; text: string; attachments: number }): DraftPlan {
  const words = text.trim();
  if (words === '' && attachments === 0) return { kind: 'nothing' };
  if (intent === 'ask') return { kind: 'ask' };
  const label = INTENT_META[intent].label;
  if (attachments > 0) return { kind: 'refuse', reason: 'attachments', message: `${label} carries words only. Remove the attachments, or switch to Ask to send them.` };
  if (looksLikeSlashCommand(words)) return { kind: 'refuse', reason: 'command', message: `A command runs in this chat. Switch to Ask to run it, or write a message to ${intent === 'delegate' ? 'delegate' : 'repeat'}.` };
  return { kind: intent, text: words };
}

/** The intent after the draft was dealt with: a draft that went (or opened the builder) ends its intent, one that was refused or empty did not go, so the choice stays. */
export function intentAfter(intent: Intent, plan: DraftPlan): Intent {
  return plan.kind === 'refuse' || plan.kind === 'nothing' ? intent : 'ask';
}
