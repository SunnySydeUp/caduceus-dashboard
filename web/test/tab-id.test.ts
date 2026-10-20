import { describe, expect, test } from 'vitest';
import { gatewayUrl, tabId } from '../src/tab-id.ts';

const storage = () => {
  const kept = new Map<string, string>();
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
};

describe('which tab a gateway socket is for', () => {
  test('a tab makes its id once and keeps it, so a reload is the same tab and another tab is not', () => {
    const tab = storage();
    let made = 0;
    const random = () => `id-${++made}`;

    expect(tabId(tab, random)).toBe('id-1');
    expect(tabId(tab, random)).toBe('id-1');
    expect(tabId(storage(), random)).toBe('id-2');
  });

  test('the gateway address names the tab, over wss on https and ws otherwise', () => {
    expect(gatewayUrl({ protocol: 'https:', host: 'mac.tail1234.ts.net:9443' }, 'a b')).toBe('wss://mac.tail1234.ts.net:9443/api/ws?tab=a%20b');
    expect(gatewayUrl({ protocol: 'http:', host: '127.0.0.1:9130' }, 'abc')).toBe('ws://127.0.0.1:9130/api/ws?tab=abc');
  });
});
