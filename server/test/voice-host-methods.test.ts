import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifyGatewayMethod, GATEWAY_METHODS } from '../../contracts/policy/gateway.ts';

// Voice (M7 #07) uses Hermes's REST audio routes. The gateway's host-side `voice.*` and `wake.*` methods use the microphone and speaker of the Mac
// that runs Hermes, which are not the owner's device, so Caduceus never calls one: the policy refuses every such frame, and nothing in the page
// or the server names one (the list of methods comes from the pinned gateway contract, not from this test).
const root = path.resolve(import.meta.dirname, '../..');
const hostMethods = Object.keys(GATEWAY_METHODS).filter((method) => /^(voice|wake)\./.test(method));

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

describe('host-side voice', () => {
  test('the gateway contract has host-side voice methods for the test to look for', () => {
    expect(hostMethods).toEqual(expect.arrayContaining(['voice.record', 'voice.toggle', 'voice.tts', 'wake.feed']));
  });

  test('the policy refuses a frame that calls one', () => {
    for (const method of hostMethods.filter((name) => ['voice.record', 'voice.toggle', 'voice.tts', 'wake.start', 'wake.feed'].includes(name))) {
      expect(classifyGatewayMethod(method, {}), method).toMatchObject({ ok: false, reason: 'host-hardware' });
    }
  });

  test('nothing in the web app or the server calls one', () => {
    const calls = [...sources(path.join(root, 'web/src')), ...sources(path.join(root, 'server/src'))].flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return hostMethods.filter((method) => text.includes(`'${method}'`) || text.includes(`"${method}"`) || text.includes(`\`${method}\``)).map((method) => `${path.relative(root, file)}: ${method}`);
    });
    expect(calls).toEqual([]);
  });
});
