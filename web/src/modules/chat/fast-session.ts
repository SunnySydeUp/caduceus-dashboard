// What a browser tab holds for fast chat (M1 #18): whether the composer is in Fast mode, and each profile's fast conversation. All of it is in this page's memory:
// a reload loses it, which is what the banner and the leave warning say. Nothing is stored here, in Hermes or in Caduceus. No React, no DOM.
import { gatewayConnection } from '../../gateway.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { createFastChat, type FastChat } from './fast-chat.ts';
import { createStore } from './store.ts';

/** Fast mode of the composer. It is the tab's, not a chat's: it stays on as the owner moves between chats. */
export const fastMode = createStore({ on: false });
export const setFastMode = (on: boolean): void => fastMode.set({ on });

/** What the chat on screen says about itself: the model that will answer, and the Hermes session that lends it (see `FastOptions.session`). */
export const fastLens: { model: () => string | undefined; session: () => string | undefined } = { model: () => undefined, session: () => undefined };

const chats = new Map<string, FastChat>();

/** The fast conversation of a profile in this tab. */
export function fastChatOf(profile: string): FastChat {
  let made = chats.get(profile);
  if (!made) {
    made = createFastChat({
      client: gatewayConnection().client,
      profile,
      model: () => fastLens.model(),
      session: () => fastLens.session(),
      confirm: ({ model }) =>
        confirmTier({
          tier: 'T1',
          moduleId: 'chat',
          action: 'chat.fast',
          label: 'Send fast prompts?',
          text: `A fast chat sends your messages straight to ${model ?? 'the profile’s model'}, with no agent and nothing saved in Hermes. Each prompt is a model call that costs tokens on your provider. You are asked once in this tab.`,
          profile,
          confirmLabel: 'Use fast chat',
        }),
    });
    chats.set(profile, made);
  }
  return made;
}

/** Whether any fast conversation of this tab has something in it: leaving the page would lose it. */
export const hasFastConversation = (): boolean => [...chats.values()].some((chat) => chat.state.messages.length > 0);

/** The owner chose to leave: every fast conversation of the tab is forgotten. */
export function discardFastConversations(): void {
  for (const chat of chats.values()) chat.clear();
}
