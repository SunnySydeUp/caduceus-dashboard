import { classifyRest, resolveTier } from '@caduceus/contracts/policy/rest';
import { describe, expect, test } from 'vitest';
import { createRequest, emptyDraft, parseWebhooks, readCreated, readEnableAnswer, webhookTier } from '../src/modules/webhooks/webhooks-model.ts';

describe('reading Hermes’s webhooks', () => {
  test('a subscription is on unless Hermes says it is off, and a route with no name is not listed', () => {
    const { subscriptions } = parseWebhooks({
      enabled: true,
      base_url: 'http://localhost:8644',
      subscriptions: [
        { name: 'a', secret_set: true, events: ['push', 7], skills: ['x'], deliver_only: true, deliver: 'telegram' },
        { name: 'b', enabled: false },
        { description: 'no name' },
      ],
    });
    expect(subscriptions.map(({ name, enabled, secretSet, events, skills, deliver, deliverOnly }) => ({ name, enabled, secretSet, events, skills, deliver, deliverOnly }))).toEqual([
      { name: 'a', enabled: true, secretSet: true, events: ['push'], skills: ['x'], deliver: 'telegram', deliverOnly: true },
      { name: 'b', enabled: false, secretSet: false, events: [], skills: [], deliver: 'log', deliverOnly: false },
    ]);
    expect(parseWebhooks('nonsense')).toEqual({ enabled: false, baseUrl: '', subscriptions: [] });
  });
});

describe('what a create form sends', () => {
  test('the name is kept as Hermes keeps it, lists are split on commas and new lines, and what was left empty is left out', () => {
    const { body } = createRequest({ ...emptyDraft(), name: '  GitHub Push ', events: 'push,\n pull_request ,', skills: ' a , b', deliver: ' telegram ', deliverChatId: ' 42 ' }, 'coder');
    expect(body).toEqual({ name: 'github-push', events: ['push', 'pull_request'], prompt: '', skills: ['a', 'b'], deliver: 'telegram', deliver_only: false, deliver_chat_id: '42' });
    expect(createRequest(emptyDraft(), 'a b').path).toBe('/api/webhooks?profile=a%20b');
  });

  test('a script makes it Tier 3, as the policy map says, and without one it is Tier 2', () => {
    const drafts = [{ ...emptyDraft(), script: '' }, { ...emptyDraft(), script: ' x.py ' }];
    expect(drafts.map(webhookTier)).toEqual(['T2', 'T3']);
    // The same answer from the policy map itself, for the request the page really sends.
    const tiers = drafts.map((draft) => {
      const { path, body } = createRequest(draft, 'default');
      const url = new URL(path, 'http://caduceus.local');
      const match = classifyRest('POST', url.pathname);
      return match.ok ? resolveTier(match, { query: url.searchParams, body }).tier : undefined;
    });
    expect(tiers).toEqual(['T2', 'T3']);
  });
});

describe('what Hermes answers', () => {
  test('a create answer has the secret only when Hermes gave one; an enable answer says whether the gateway restarts itself', () => {
    expect(readCreated({ name: 'a', secret: 's3cret', secret_set: true })).toMatchObject({ webhook: { name: 'a', secretSet: true }, secret: 's3cret' });
    expect(readCreated({ name: 'a', secret: '' }).secret).toBeUndefined();
    expect(readCreated('x')).toEqual({ webhook: undefined, secret: undefined });

    expect(readEnableAnswer({ ok: true, needs_restart: false, restart_started: true })).toEqual({ needsRestart: false, restartStarted: true });
    expect(readEnableAnswer({ ok: true, needs_restart: true, restart_started: false, restart_error: 'boom' })).toEqual({ needsRestart: true, restartStarted: false });
  });
});
