import { describe, expect, test } from 'vitest';
import { filterWords, needsHermesComputer, statusOf, type McpServer } from '../src/modules/tools/mcp-model.ts';

const server = (over: Partial<McpServer> = {}): McpServer => ({ name: 's', transport: 'http', url: 'http://x', command: undefined, args: [], envNames: [], auth: undefined, enabled: true, filter: undefined, ...over });

describe('how a server shows in the list', () => {
  test('off wins over what Hermes last had, and the runtime states have their own words', () => {
    expect(statusOf(server({ enabled: false }), { state: 'connected', tools: 3 })).toMatchObject({ state: 'paused', label: 'Off' });
    expect(statusOf(server(), { state: 'connected', tools: 3 })).toEqual({ state: 'online', label: 'Connected', detail: '3 tools loaded in Hermes' });
    expect(statusOf(server(), { state: 'connected', tools: 1 }).detail).toBe('1 tool loaded in Hermes');
    expect(statusOf(server(), { state: 'failed', tools: 0 })).toMatchObject({ state: 'failed', label: 'Failed to connect' });
    expect(statusOf(server(), { state: 'connecting', tools: 0 })).toMatchObject({ state: 'reconnecting' });
    expect(statusOf(server(), { state: 'lazy', tools: 0 })).toMatchObject({ label: 'Starts on demand' });
    expect(statusOf(server(), { state: 'configured', tools: 0 })).toMatchObject({ label: 'Not started' });
    expect(statusOf(server(), undefined)).toMatchObject({ label: 'Not started' });
  });

  test('a tool filter reads as words, and no filter is every tool', () => {
    expect(filterWords(undefined)).toBeUndefined();
    expect(filterWords({})).toBeUndefined();
    expect(filterWords({ include: ['echo', 'add'] })).toBe('Only echo, add');
    expect(filterWords({ exclude: ['rm'] })).toBe('All except rm');
  });
});

describe('a catalogue note that only works on the computer that runs Hermes', () => {
  test('is flagged when it points at localhost, which a phone or another computer cannot reach', () => {
    expect(needsHermesComputer('Sign in: the OAuth callback is http://localhost:27890/callback on the machine running Hermes.')).toBe(true);
    expect(needsHermesComputer('Open http://127.0.0.1:8080 to finish.')).toBe(true);
    expect(needsHermesComputer('Create a token at https://example.com/settings and paste it above.')).toBe(false);
    expect(needsHermesComputer(undefined)).toBe(false);
  });
});
