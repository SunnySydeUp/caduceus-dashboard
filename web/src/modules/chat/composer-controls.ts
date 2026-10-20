// What the composer draws and where every control lives (M8 #09 step A), free of the DOM and of React. The composer is one field with a few controls: add, a quiet
// context button, the voice entry or Send, depending on what is in the field. Everything else is one tap away in a menu. This file decides what shows; the
// composer draws it and carries out each choice.
import type { ChipId, ChipPreference } from '@caduceus/contracts/chat-chips';
import { shownChips } from './composer-model.ts';
import { INTENTS, type Intent } from './composer-intent.ts';

/** A control in the bar under the field. */
export type BarControl = 'add' | 'context' | 'mic' | 'voice' | 'send' | 'sendAs' | 'steer' | 'queue' | 'stop';

export interface ComposerFacts {
  /** Nothing typed and nothing attached. */
  empty: boolean;
  /** Hermes is answering. */
  running: boolean;
  intent: Intent;
}

/** The controls of the bar, in the order they are drawn. */
export function composerBar({ empty, running, intent }: ComposerFacts): BarControl[] {
  const bar: BarControl[] = ['add', 'context'];
  if (empty) bar.push('mic', 'voice');
  if (!running) {
    if (!empty) bar.push('send', 'sendAs');
    return bar;
  }
  if (!empty) bar.push('sendAs');
  bar.push(...(intent === 'ask' ? (['steer', 'queue'] as const) : (['send'] as const)), 'stop');
  return bar;
}

/** A row of the This chat menu: one of the chat's settings (the owner's chips), or one of the fixed rows after them. YOLO is the chat's own switch, as Fast mode is. */
export type ChatRow = ChipId | 'prompts' | 'context' | 'fast' | 'yolo' | 'customise';
/** A row of the Add menu. */
export type AddRow = 'files' | 'camera' | 'record' | 'workspace' | 'prompts';
/** A row of the voice entry's menu. */
export type VoiceRow = 'handsFree';

/** The menu each bar control opens, and the rows in it. The menu of a control that has none is absent. */
export interface ComposerMenus {
  context: ChatRow[];
  add: AddRow[];
  sendAs: readonly Intent[];
  voice: VoiceRow[];
}

/** The rows of the This chat menu: the owner's settings in their order (a chip they switched off is not here; Customise brings it back), then the fixed rows. A Fast chat has no agent and runs no commands, so it has no YOLO. */
export function chatRows(preference: ChipPreference, { fast = false }: { fast?: boolean } = {}): ChatRow[] {
  return [...shownChips(preference), 'prompts', 'context', 'fast', ...(fast ? [] : (['yolo'] as const)), 'customise'];
}

/** The rows of the Add menu. `touch` is a phone or a tablet, where the camera is offered. */
export function addRows(touch: boolean): AddRow[] {
  return ['files', ...(touch ? (['camera'] as const) : []), 'record', 'workspace', 'prompts'];
}

/** The rows of the menus. */
export function composerMenus({ preference, touch, fast = false }: { preference: ChipPreference; touch: boolean; fast?: boolean }): ComposerMenus {
  return { context: chatRows(preference, { fast }), add: addRows(touch), sendAs: INTENTS, voice: ['handsFree'] };
}

/** Every control reachable now, as `bar` for a control in the bar and `bar > row` for a row in the menu it opens. For the table that says nothing was lost, and for a screen that wants to know. */
export function composerPaths(facts: ComposerFacts, options: { preference: ChipPreference; touch: boolean; fast?: boolean }): string[] {
  const menus: Partial<Record<BarControl, readonly string[]>> = composerMenus(options);
  return composerBar(facts).flatMap((control) => [control, ...(menus[control] ?? []).map((row) => `${control} > ${row}`)]);
}
