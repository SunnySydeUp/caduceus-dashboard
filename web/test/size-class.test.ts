import { expect, test } from 'vitest';
import tokensCss from '../../docs/design/tokens.css?raw';
import { navModeFor, sizeClassForWidth } from '../src/size-class.ts';

/** A breakpoint token in px, read from the design tokens (rem × the browser's default 16px). */
function breakpointPx(name: 'rail' | 'sidebar'): number {
  const match = new RegExp(`--breakpoint-${name}:\\s*([\\d.]+)rem`).exec(tokensCss);
  if (!match) throw new Error(`tokens.css has no --breakpoint-${name}`);
  return Number(match[1]) * 16;
}

test('the window width alone picks the size class, switching exactly at the token breakpoints', () => {
  // Information architecture §2: navigation bar < 600, rail 600-1199, sidebar >= 1200.
  expect([breakpointPx('rail'), breakpointPx('sidebar')]).toEqual([600, 1200]);

  expect(sizeClassForWidth(320)).toBe('compact');
  expect(sizeClassForWidth(599)).toBe('compact');
  expect(sizeClassForWidth(600)).toBe('medium');
  expect(sizeClassForWidth(820)).toBe('medium');
  expect(sizeClassForWidth(1199)).toBe('medium');
  expect(sizeClassForWidth(1200)).toBe('large');
  expect(sizeClassForWidth(1440)).toBe('large');
});

test('compact windows get a tab bar, medium ones a rail, and large ones a sidebar that can collapse to the rail', () => {
  expect(navModeFor('compact', false)).toBe('bar');
  expect(navModeFor('compact', true)).toBe('bar');
  expect(navModeFor('medium', false)).toBe('rail');
  expect(navModeFor('medium', true)).toBe('rail');
  expect(navModeFor('large', false)).toBe('sidebar');
  expect(navModeFor('large', true)).toBe('rail');
});
