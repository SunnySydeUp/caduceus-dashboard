import { describe, expect, test } from 'vitest';
import { DEFAULT_CHIPS, type ChipPreference } from '@caduceus/contracts/chat-chips';
import { composerBar, composerMenus, composerPaths, type ComposerFacts } from '../src/modules/chat/composer-controls.ts';
import { INTENTS } from '../src/modules/chat/composer-intent.ts';

// What the composer draws for an empty field, a typed one and a busy chat (M8 #09 step A), free of the DOM.

describe('what the composer bar shows', () => {
  test('an empty field has the add button, the context button and the voice entry, and no Send', () => {
    expect(composerBar({ empty: true, running: false, intent: 'ask' })).toEqual(['add', 'context', 'mic', 'voice']);
  });

  test('a field with words swaps the voice entry for Send and its Send as menu', () => {
    expect(composerBar({ empty: false, running: false, intent: 'ask' })).toEqual(['add', 'context', 'send', 'sendAs']);
  });

  test('the intent changes nothing about which controls show, only the words on Send', () => {
    expect(composerBar({ empty: false, running: false, intent: 'delegate' })).toEqual(composerBar({ empty: false, running: false, intent: 'ask' }));
    expect(composerBar({ empty: true, running: false, intent: 'repeat' })).toEqual(composerBar({ empty: true, running: false, intent: 'ask' }));
  });

  test('while Hermes answers, Steer, Queue and Stop are there, with the voice entry or the Send as menu beside them as before', () => {
    expect(composerBar({ empty: true, running: true, intent: 'ask' })).toEqual(['add', 'context', 'mic', 'voice', 'steer', 'queue', 'stop']);
    expect(composerBar({ empty: false, running: true, intent: 'ask' })).toEqual(['add', 'context', 'sendAs', 'steer', 'queue', 'stop']);
  });

  test('a busy chat under Delegate or Repeat has one button for the intent and Stop: Steer and Queue are for Ask', () => {
    expect(composerBar({ empty: false, running: true, intent: 'delegate' })).toEqual(['add', 'context', 'sendAs', 'send', 'stop']);
    expect(composerBar({ empty: true, running: true, intent: 'repeat' })).toEqual(['add', 'context', 'mic', 'voice', 'send', 'stop']);
  });
});

describe('what each menu holds', () => {
  const owner = DEFAULT_CHIPS;

  test('This chat lists the settings in the owner’s order, then prompts, context, Fast mode, YOLO and the way to change the list', () => {
    expect(composerMenus({ preference: owner, touch: false }).context).toEqual(['profile', 'model', 'reasoning', 'workspace', 'toolsets', 'prompts', 'context', 'fast', 'yolo', 'customise']);
    const own = { order: ['model', 'toolsets', 'profile', 'reasoning', 'workspace'], hidden: ['profile'] } satisfies ChipPreference;
    expect(composerMenus({ preference: own, touch: false }).context).toEqual(['model', 'toolsets', 'reasoning', 'workspace', 'prompts', 'context', 'fast', 'yolo', 'customise']);
  });

  test('YOLO is not offered in a Fast chat: there is no agent to run commands, and nothing to approve', () => {
    expect(composerMenus({ preference: owner, touch: false, fast: true }).context).not.toContain('yolo');
    expect(composerMenus({ preference: owner, touch: false, fast: true }).context).toContain('fast');
  });

  test('Add holds files, a recording, a file of the workspace and saved prompts, and the camera only on a touch screen', () => {
    expect(composerMenus({ preference: owner, touch: false }).add).toEqual(['files', 'record', 'workspace', 'prompts']);
    expect(composerMenus({ preference: owner, touch: true }).add).toEqual(['files', 'camera', 'record', 'workspace', 'prompts']);
  });

  test('Send as holds the three intents, Ask first, and the voice entry holds hands-free conversation', () => {
    const menus = composerMenus({ preference: owner, touch: false });
    expect(menus.sendAs).toEqual(INTENTS);
    expect(menus.voice).toEqual(['handsFree']);
  });
});

// Nothing is deleted, only moved: every control the composer had before the calmer Talk, and the one tap (or tap and menu) that reaches it now.
describe('every control the composer had is still reachable', () => {
  const idle = { empty: false, running: false, intent: 'ask' } as const;
  const empty = { empty: true, running: false, intent: 'ask' } as const;
  const busy = { empty: false, running: true, intent: 'ask' } as const;
  const options = { preference: DEFAULT_CHIPS, touch: true };

  const before: readonly (readonly [control: string, facts: ComposerFacts, path: string])[] = [
    ['profile chip', empty, 'context > profile'],
    ['model chip', empty, 'context > model'],
    ['reasoning chip', empty, 'context > reasoning'],
    ['workspace chip', empty, 'context > workspace'],
    ['toolsets chip', empty, 'context > toolsets'],
    ['prompts chip', empty, 'context > prompts'],
    ['customise chips', empty, 'context > customise'],
    ['config sheet on a phone (every setting)', empty, 'context'],
    ['context ring', empty, 'context > context'],
    ['Fast mode', empty, 'context > fast'],
    ['attach files', empty, 'add > files'],
    ['attach photo', empty, 'add > camera'],
    ['record an audio message', empty, 'add > record'],
    ['a file of the workspace', empty, 'add > workspace'],
    ['saved prompts from attach', empty, 'add > prompts'],
    ['Ask', idle, 'sendAs > ask'],
    ['Delegate', idle, 'sendAs > delegate'],
    ['Repeat', idle, 'sendAs > repeat'],
    ['mic', empty, 'mic'],
    ['hands-free conversation', empty, 'voice > handsFree'],
    ['Send', idle, 'send'],
    ['Steer', busy, 'steer'],
    ['Queue', busy, 'queue'],
    ['Stop', busy, 'stop'],
    ['Delegate while Hermes answers', busy, 'sendAs > delegate'],
    ['YOLO for this chat', empty, 'context > yolo'],
  ];

  test.each(before)('%s', (_control, facts, path) => {
    expect(composerPaths(facts, options)).toContain(path);
  });

  test('a setting the owner hid from the list is brought back from the same menu', () => {
    const hidden = { order: DEFAULT_CHIPS.order, hidden: ['model'] } satisfies ChipPreference;
    const paths = composerPaths(empty, { preference: hidden, touch: false });
    expect(paths).not.toContain('context > model');
    expect(paths).toContain('context > customise');
  });
});
